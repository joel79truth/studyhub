import { supabase } from '../supabase';

export async function setupDeepLinkHandler() {
  try {
    const { App } = await import('@capacitor/app');

    App.addListener('appUrlOpen', async (data) => {
      const url = data.url;

      // Only handle our custom scheme
      if (url.startsWith('com.studyhub.luanar://')) {
        // Extract the authorization code from the query string
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');

        if (code) {
          try {
            // Exchange the code for a session (this is the missing step)
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error) {
              // Session created – reload to pick it up
              window.location.href = '/';
            } else {
              console.error('exchangeCodeForSession failed:', error.message);
            }
          } catch (err) {
            console.error('Failed to exchange code:', err);
          }
        } else {
          console.log('No code found in URL:', url);
        }
      }
    });

    // Handle cold start (app was launched with a deep link)
    const { value } = await App.getLaunchUrl();
    if (value?.url?.startsWith('com.studyhub.luanar://')) {
      const urlObj = new URL(value.url);
      const code = urlObj.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          window.location.href = '/';
        }
      }
    }
  } catch (e) {
    // Not running inside Capacitor – ignore
  }
}