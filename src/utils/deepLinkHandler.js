export async function setupDeepLinkHandler() {
  try {
    const { App } = await import('@capacitor/app');

    App.addListener('appUrlOpen', async (data) => {
      const url = data.url;

      if (url.startsWith('com.studyhub.luanar://')) {
        // Extract the authorization code
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');

        if (code) {
          // Store the code globally so Login.jsx can pick it up
          window.__OAUTH_CODE__ = code;
          // Navigate to the login page (which will process the code)
          window.location.href = '/login';
        }
      }
    });

    // Cold start – same logic
    const { value } = await App.getLaunchUrl();
    if (value?.url?.startsWith('com.studyhub.luanar://')) {
      const urlObj = new URL(value.url);
      const code = urlObj.searchParams.get('code');
      if (code) {
        window.__OAUTH_CODE__ = code;
        window.location.href = '/login';
      }
    }
  } catch (e) {
    // Not running in Capacitor
  }
}