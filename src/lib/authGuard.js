import { supabase } from '../supabase';

/**
 * Detects a corrupted Supabase session where the stored `user.id` doesn't
 * match the `sub` claim embedded in the stored `access_token`. This can
 * happen when a redirect-based OAuth flow overlaps with an existing session
 * (e.g. switching Google accounts, multiple tabs completing sign-in at
 * once, or a token refresh landing between two auth state updates).
 *
 * Every RLS policy in this app checks `auth.uid() = id`. Postgres derives
 * `auth.uid()` from the access token's `sub` claim — NOT from anything in
 * the client's `user` object — so a corrupted session causes every
 * insert/update to fail with 42501 even though the app "looks" signed in
 * correctly (userData renders, displayName shows up, etc).
 *
 * Call this once after any SIGNED_IN / USER_UPDATED event, and once on
 * app/page load before trusting an existing session.
 *
 * @returns {Promise<boolean>} true if the session is healthy or absent,
 *   false if it was corrupted and has been cleared (caller should treat
 *   this as signed-out and redirect to /login).
 */
export async function ensureConsistentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return true; // no session = nothing to validate

  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    if (payload.sub !== session.user.id) {
      console.error(
        'Corrupted Supabase session detected (user.id !== access_token sub). Forcing sign-out.',
        { userId: session.user.id, tokenSub: payload.sub }
      );
      await supabase.auth.signOut();
      return false;
    }
  } catch (e) {
    console.error('Failed to decode/validate session token — forcing sign-out.', e);
    await supabase.auth.signOut();
    return false;
  }

  return true;
}