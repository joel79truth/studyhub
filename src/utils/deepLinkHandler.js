import { supabase } from '../supabase';

export async function setupDeepLinkHandler() {
  try {
    const { App } = await import('@capacitor/app');

    // Handle deep link when app is already running
    App.addListener('appUrlOpen', async (data) => {
      await processDeepLink(data.url);
    });

    // Cold start: app launched via deep link
    const { value } = await App.getLaunchUrl();
    if (value?.url) {
      await processDeepLink(value.url);
    }
  } catch {
    // Not in Capacitor environment — nothing to do
  }
}
async function processDeepLink(url) {
  if (!url.startsWith('com.studyhub.luanar://')) return;

  try {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    if (!code) return;

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('OAuth exchange error:', error.message);
      window.location.replace('/login');
      return;
    }

    // Instead of forcing multiple raw refreshes, push directly to root base.
    // The ProtectedRoute system will now catch the new session smoothly without an infinite loop.
    window.location.replace('/'); 
  } catch (err) {
    console.error('Deep link processing error:', err);
    window.location.replace('/login');
  }
}
