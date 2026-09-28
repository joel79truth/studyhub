import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView, setAnalyticsUser } from '../lib/analytics';
import { supabase } from '../supabase';
import { Capacitor } from '@capacitor/core';

function getActionFromPath(pathname) {
  if (pathname === '/') return { action: 'Browsing Home Dashboard', category: 'browse' };
  if (pathname.startsWith('/papers')) return { action: 'Reviewing Past Papers', category: 'past_papers' };
  if (pathname.startsWith('/quiz')) return { action: 'Practicing Quizzes', category: 'quiz' };
  if (pathname.startsWith('/viewer') || pathname.startsWith('/file-viewer')) return { action: 'Reading Lecture Notes', category: 'notes' };
  if (pathname.toLowerCase().startsWith('/aichat')) return { action: 'Asking Luna / AI StudyBot', category: 'ai_chat' };
  if (pathname.startsWith('/timetable')) return { action: 'Checking Timetable', category: 'timetable' };
  if (pathname.startsWith('/programs') || pathname.startsWith('/program-detail')) return { action: 'Exploring Course Programs', category: 'programs' };
  if (pathname.startsWith('/upload')) return { action: 'Uploading Study Material', category: 'upload' };
  if (pathname.startsWith('/profile')) return { action: 'Viewing Student Profile', category: 'profile' };
  if (pathname.startsWith('/admin')) return { action: 'Admin Portal', category: 'admin' };
  return { action: 'Active in StudyHub', category: 'browse' };
}

function getOrCreateGuestId() {
  try {
    let guestId = sessionStorage.getItem('studyhub_guest_id');
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem('studyhub_guest_id', guestId);
    }
    return guestId;
  } catch {
    return 'guest_student';
  }
}

export default function AnalyticsTracker() {
  const location = useLocation();
  const presenceChannelRef = useRef(null);
  const currentProfileRef = useRef(null);
  const currentUserRef = useRef(null);
  const customActionRef = useRef(null);
  const sessionStartTimeRef = useRef(Date.now());
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  // Push presence data to Supabase Realtime channel
  const pushPresenceData = async (channel, overrideAction = null) => {
    if (!channel) return;
    if (locationRef.current.startsWith('/admin')) return;

    const user = currentUserRef.current;
    const profile = currentProfileRef.current;
    const defaultAction = getActionFromPath(locationRef.current);
    const actionInfo = overrideAction || customActionRef.current || defaultAction;

    const userId = user?.id || getOrCreateGuestId();
    const name = profile?.name?.trim() || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Guest Student';

    try {
      await channel.track({
        user_id: userId,
        name: name,
        avatar_url: profile?.profile_pic || user?.user_metadata?.avatar_url || null,
        program: profile?.program || 'General',
        semester: profile?.semester || null,
        streak: profile?.streak || 1,
        current_page: locationRef.current,
        current_action: actionInfo.action,
        action_category: actionInfo.category || 'browse',
        is_idle: document.hidden || false,
        is_admin: Boolean(profile?.is_admin || profile?.role === 'admin'),
        online_at: new Date().toISOString(),
        session_started_at: new Date(sessionStartTimeRef.current).toISOString(),
        device: Capacitor.isNativePlatform() ? 'Android App' : 'Web Browser',
      });
    } catch (err) {
      console.warn('[AnalyticsTracker] Failed to track presence:', err);
    }
  };

  // Ensure presence channel is created and subscribed
  const ensureChannel = async () => {
    // If on admin route, do not establish presence channel (allows AdminLive exclusive ownership)
    if (locationRef.current.startsWith('/admin')) {
      if (presenceChannelRef.current) {
        try {
          supabase.removeChannel(presenceChannelRef.current);
        } catch {}
        presenceChannelRef.current = null;
      }
      return null;
    }

    if (presenceChannelRef.current) {
      return presenceChannelRef.current;
    }

    const userId = currentUserRef.current?.id || getOrCreateGuestId();
    const channel = supabase.channel('studyhub-live-presence', {
      config: {
        presence: { key: userId },
      },
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        presenceChannelRef.current = channel;
        await pushPresenceData(channel);
      }
    });

    return channel;
  };

  // Sync presence wrapper
  const syncPresence = async (overrideAction = null) => {
    if (locationRef.current.startsWith('/admin')) {
      if (presenceChannelRef.current) {
        try {
          supabase.removeChannel(presenceChannelRef.current);
        } catch {}
        presenceChannelRef.current = null;
      }
      return;
    }

    if (presenceChannelRef.current) {
      await pushPresenceData(presenceChannelRef.current, overrideAction);
    } else {
      await ensureChannel();
    }
  };

  // Track page view and route updates
  useEffect(() => {
    const fullPath = location.pathname + location.search;
    trackPageView(fullPath, document.title);

    // Reset custom action unless on same action
    customActionRef.current = null;

    if (location.pathname.startsWith('/admin')) {
      if (presenceChannelRef.current) {
        try {
          supabase.removeChannel(presenceChannelRef.current);
        } catch {}
        presenceChannelRef.current = null;
      }
    } else {
      syncPresence();
    }
  }, [location.pathname]);

  // Listen for custom action changes dispatched by components
  useEffect(() => {
    const handleActionChange = (e) => {
      if (e.detail?.action) {
        customActionRef.current = e.detail;
        syncPresence(e.detail);
      }
    };
    window.addEventListener('studyhub_action_change', handleActionChange);
    return () => window.removeEventListener('studyhub_action_change', handleActionChange);
  }, []);

  // Track user session setup and auth changes
  useEffect(() => {
    const setupUser = async (user) => {
      currentUserRef.current = user || null;

      if (user) {
        // Load profile info
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('name, program, semester, year_of_study, role, streak, profile_pic, is_admin')
            .eq('id', user.id)
            .maybeSingle();

          if (profile) {
            currentProfileRef.current = profile;
            setAnalyticsUser(user.id, {
              program: profile.program,
              semester: profile.semester,
              year: profile.year_of_study,
              role: profile.role,
              isAdmin: profile.is_admin,
            });
          }
        } catch (err) {
          console.warn('[AnalyticsTracker] Failed to load profile:', err);
        }
      } else {
        currentProfileRef.current = null;
      }

      await syncPresence();
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setupUser(session?.user || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setupUser(session?.user || null);
    });

    // Update presence when user switches tabs (idle detection)
    const handleVisibilityChange = () => {
      syncPresence();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Heartbeat: update last_active in profiles every 5 minutes while active
    const heartbeatInterval = setInterval(() => {
      if (currentUserRef.current && !document.hidden) {
        supabase
          .from('profiles')
          .update({ last_active: new Date().toISOString() })
          .eq('id', currentUserRef.current.id)
          .then(() => {})
          .catch(() => {});
        syncPresence();
      }
    }, 5 * 60 * 1000);

    return () => {
      subscription?.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(heartbeatInterval);
      if (presenceChannelRef.current) {
        try {
          supabase.removeChannel(presenceChannelRef.current);
        } catch {}
        presenceChannelRef.current = null;
      }
    };
  }, []);

  return null;
}
