import { supabase } from '../supabase';

export async function setupDeepLinkHandler() {
  try {
    const { App } = await import('@capacitor/app');

    App.addListener('appUrlOpen', async (data) => {
      const url = data.url;

      if (url.startsWith('com.studyhub.luanar://')) {
        if (url.includes('access_token=')) {
          try {
            const fragment = url.includes('#') ? url.split('#')[1] : '';
            const params = new URLSearchParams(fragment);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');

            if (access_token && refresh_token) {
              const { error } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });

              if (error) {
                console.error('setSession failed:', error.message);
                // Optionally show an alert, but for production we'll just log
              } else {
                // Session stored – reload the app so it picks up the new session
                window.location.href = '/';
              }
            }
          } catch (err) {
            console.error('Failed to parse deep link', err);
          }
        }
      }
    });

    // Handle cold start (app was launched from a deep link)
    const { value } = await App.getLaunchUrl();
    if (value?.url?.startsWith('com.studyhub.luanar://')) {
      if (value.url.includes('access_token=')) {
        const fragment = value.url.includes('#') ? value.url.split('#')[1] : '';
        const params = new URLSearchParams(fragment);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (!error) {
            window.location.href = '/';
          }
        }
      }
    }
  } catch (e) {
    // Not running inside Capacitor – ignore
  }
}