// src/lib/syncManager.js
// Background synchronization manager for offline-first actions in StudyHub.
// Listens to network connectivity transitions and drains queued mutations.

import { getSyncQueue, removeSyncItem, incrementSyncAttempts } from './storageCore';
import { supabase } from '../supabase';
import { API_BASE_URL } from './apiConfig';

let isFlushing = false;
const listeners = new Set();

const notifyListeners = (status) => {
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (_) {}
  });
};

export function subscribeSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function flushSyncQueue() {
  if (isFlushing || typeof navigator === 'undefined' || !navigator.onLine) return;
  isFlushing = true;
  notifyListeners({ syncing: true });

  try {
    const queue = await getSyncQueue();
    if (!queue.length) {
      notifyListeners({ syncing: false, pendingCount: 0 });
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || null;

    for (const item of queue) {
      if (item.attempts >= 5) {
        // Drop after 5 persistent failures to avoid blocking the queue
        await removeSyncItem(item.id);
        continue;
      }

      let success = false;
      try {
        if (item.type === 'quiz_submission') {
          const res = await fetch(`${API_BASE_URL}/api/exam/submit-answer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(item.payload),
          });
          success = res.ok;
        } else if (item.type === 'profile_streak' && session?.user?.id) {
          const { error } = await supabase.from('profiles').upsert(item.payload);
          success = !error;
        } else if (item.type === 'flag_question') {
          const res = await fetch(`${API_BASE_URL}/api/exam/questions/flag`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(item.payload),
          });
          success = res.ok;
        } else {
          // Unknown item type, remove it
          success = true;
        }
      } catch (syncErr) {
        console.warn('[syncManager] Failed syncing item:', item.type, syncErr);
        success = false;
      }

      if (success) {
        await removeSyncItem(item.id);
      } else {
        await incrementSyncAttempts(item.id);
        // Break to preserve sequential order and prevent hammering
        break;
      }
    }
  } catch (err) {
    console.warn('[syncManager] Queue flush error:', err);
  } finally {
    isFlushing = false;
    const remaining = await getSyncQueue().catch(() => []);
    notifyListeners({ syncing: false, pendingCount: remaining.length });
  }
}

// Auto-trigger sync on reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[syncManager] Network online detected — flushing sync queue');
    flushSyncQueue();
  });
  // Initial check shortly after boot
  setTimeout(flushSyncQueue, 4000);
}
