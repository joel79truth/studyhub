import { supabase } from '../supabase';

const OFFLINE_SESSION_KEY = 'studyhub_auth_session';

/**
 * Save an offline session snapshot to localStorage so the app can verify
 * identity and render personal data even when completely disconnected.
 */
export function saveOfflineSessionSnapshot(session) {
  if (!session?.user) return;
  try {
    const snapshot = {
      user: {
        id: session.user.id,
        email: session.user.email,
        user_metadata: session.user.user_metadata || {},
      },
      savedAt: Date.now(),
      expiresAt: session.expires_at ? session.expires_at * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[authGuard] Could not save offline session snapshot:', err);
  }
}

/**
 * Retrieve the offline session snapshot. Returns null if absent.
 */
export function getOfflineSessionSnapshot() {
  try {
    const raw = localStorage.getItem(OFFLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Allow up to 30 days of offline grace period
    const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
    if (parsed.savedAt && (Date.now() - parsed.savedAt > GRACE_PERIOD_MS)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clear the offline session snapshot on explicit sign-out or corrupted token.
 */
export function clearOfflineSessionSnapshot() {
  try {
    localStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {}
}

/**
 * Detects a corrupted Supabase session where the stored `user.id` doesn't
 * match the `sub` claim embedded in the stored `access_token`.
 *
 * Safe for offline: if the user is offline, trusts the offline session snapshot
 * instead of forcing a sign-out.
 */
export async function ensureConsistentSession() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineSnap = getOfflineSessionSnapshot();
    return !!offlineSnap;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const offlineSnap = getOfflineSessionSnapshot();
    return !!offlineSnap;
  }

  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    if (payload.sub !== session.user.id) {
      console.error(
        'Corrupted Supabase session detected (user.id !== access_token sub). Forcing sign-out.',
        { userId: session.user.id, tokenSub: payload.sub }
      );
      clearOfflineSessionSnapshot();
      await supabase.auth.signOut();
      return false;
    }
    // Save healthy session snapshot
    saveOfflineSessionSnapshot(session);
  } catch (e) {
    console.error('Failed to decode/validate session token — forcing sign-out.', e);
    clearOfflineSessionSnapshot();
    await supabase.auth.signOut();
    return false;
  }

  return true;
}
