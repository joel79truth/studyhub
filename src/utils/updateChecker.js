import { Capacitor } from '@capacitor/core';

export async function checkForUpdate() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const res = await fetch('https://studyhub-backend-opdd.onrender.com/version.json');
    const remote = await res.json();

    // This number must increase every time you release a new APK
    const currentVersionCode = 1;

    if (remote.versionCode > currentVersionCode) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Browser } = await import('@capacitor/browser');

      const result = await Filesystem.downloadFile({
        url: remote.apkUrl,
        path: 'studyhub_update.apk',
        directory: Directory.ExternalStorage
      });

      // Open the APK so the user can install the update
      await Browser.open({ url: result.path });
    }
  } catch (e) {
    console.error('Update check failed', e);
  }
}