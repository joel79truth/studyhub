import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.studyhub.luanar',
  appName: 'StudyHub LUANAR',
  webDir: 'dist',

  // Live reload configuration (only for development)
  //server: {
  //  url: 'http://10.159.158.4:5173/',
   // cleartext: true,
 // },

  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '985257842533-buh0i8r3jb1gtu1rbod1lql940ckn0hk.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
    SocialLogin: {
      google: {
        enabled: true
      }
    }
  }
};

export default config;