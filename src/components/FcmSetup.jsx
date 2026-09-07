import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from '../firebase';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';

const BASE_URL = API_BASE_URL;
const VAPID_KEY = 'BKolFxr4YYRukImWVT8_YPOgyrIDk0y0xPvIS-FIwH6adpzl9fr8bvhLmfie-5KUyONylN7u96fgz4pbyrT5q6A';

async function saveTokenToServer(token, userId) {
  console.log('[FCM] saveTokenToServer called, token exists:', !!token);
  if (!token) return;
  if (localStorage.getItem('fcm_token') === token) {
    console.log('[FCM] token unchanged, skipping upload');
    return;
  }

  const { data: profile } = await supabase
    .from('profiles').select('program').eq('id', userId).maybeSingle();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    console.log('[FCM] no access_token, aborting save');
    return;
  }

  console.log('[FCM] posting token to', `${BASE_URL}/save-token`);
  const res = await fetch(`${BASE_URL}/save-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ token, program: profile?.program || null }),
  });
  console.log('[FCM] save-token response status:', res.status);
  if (res.ok) localStorage.setItem('fcm_token', token);
}

async function registerNative(userId) {
  console.log('[FCM] registerNative entered');
  const { PushNotifications } = await import('@capacitor/push-notifications');
  console.log('[FCM] PushNotifications module imported');

  let permStatus = await PushNotifications.checkPermissions();
  console.log('[FCM] checkPermissions:', JSON.stringify(permStatus));

  if (permStatus.receive === 'prompt') {
    console.log('[FCM] requesting permissions...');
    permStatus = await PushNotifications.requestPermissions();
    console.log('[FCM] requestPermissions result:', JSON.stringify(permStatus));
  }

  if (permStatus.receive !== 'granted') {
    console.log('[FCM] permission not granted, stopping. receive =', permStatus.receive);
    return;
  }

  console.log('[FCM] permission granted, adding listeners');

  try {
    await PushNotifications.createChannel({
      id: 'studyhub_channel',
      name: 'StudyHub Notifications',
      description: 'Alerts for new quizzes, past papers, and study materials',
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
      lightColor: '#064e3b',
    });
    console.log('[FCM] studyhub_channel created with importance 5');
  } catch (channelErr) {
    console.warn('[FCM] createChannel error:', channelErr);
  }

  await PushNotifications.addListener('registration', (token) => {
    console.log('[FCM] registration event fired, token:', token.value?.slice(0, 20) + '...');
    saveTokenToServer(token.value, userId);
  });
  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[FCM] registrationError:', JSON.stringify(err));
  });
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('[FCM] push received in foreground:', notification);
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[FCM] push notification tapped:', action);
    const url = action.notification?.data?.url;
    if (url) {
      window.location.href = url;
    }
  });

  console.log('[FCM] calling PushNotifications.register()');
  await PushNotifications.register();
  console.log('[FCM] register() call completed');
}

async function registerWeb(userId) {
  console.log('[FCM] registerWeb entered');
  if (!(await isSupported())) {
    console.log('[FCM] web push not supported, stopping');
    return;
  }
  if (Notification.permission === 'denied') {
    console.log('[FCM] notification permission previously denied');
    return;
  }
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    console.log('[FCM] web requestPermission result:', permission);
    if (permission !== 'granted') return;
  }

  const swRegistration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const currentToken = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swRegistration,
  });
  console.log('[FCM] web token obtained:', !!currentToken);
  await saveTokenToServer(currentToken, userId);
}

export default function FcmSetup() {
  const initialized = useRef(false);

  useEffect(() => {
    console.log('[FCM] FcmSetup mounted');
    if (initialized.current) return;
    initialized.current = true;

    const run = (userId) => {
      console.log('[FCM] run() called for user', userId);
      const delayed = () => {
        console.log('[FCM] 3s timer fired, isNativePlatform =', Capacitor.isNativePlatform());
        if (Capacitor.isNativePlatform()) {
          registerNative(userId).catch(err => console.error('[FCM] native setup failed:', err));
        } else {
          registerWeb(userId).catch(err => console.error('[FCM] web setup failed:', err));
        }
      };
      setTimeout(delayed, 3000);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[FCM] getSession resolved, session exists:', !!session?.user);
      if (session?.user) run(session.user.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[FCM] auth event:', event);
      if (event === 'SIGNED_IN' && session?.user) run(session.user.id);
    });

    return () => authListener?.subscription?.unsubscribe();
  }, []);

  return null;
}