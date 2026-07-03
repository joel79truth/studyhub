import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.studyhub.luanar',
  appName: 'StudyHub LUANAR',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['com.studyhub.luanar://*']
  }
};

export default config;