import { Device } from '@capacitor/device';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { compareVersions } from './versionCompare';

const UPDATE_API_URL = 'https://studyhub-backend.onrender.com/api/update';

export async function checkForUpdate() {
  try {
    const info = await Device.getInfo();
    const currentVersion = info.appVersion; // e.g. "1.0.0"

    const response = await fetch(UPDATE_API_URL);
    const data = await response.json();
    if (!data.version) return null;

    if (compareVersions(data.version, currentVersion) > 0) {
      return {
        currentVersion,
        ...data,   // version, forceUpdate, title, message, apkUrl
      };
    }
    return null;
  } catch (err) {
    console.warn('Update check failed', err);
    return null;
  }
}

export async function downloadAndInstall(apkUrl, onProgress) {
  const fileName = 'studyhub-update.apk';

  try {
    // Download with progress
    const blob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', apkUrl, true);
      xhr.responseType = 'blob';

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress && onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) resolve(xhr.response);
        else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });

    // Convert blob to base64 and save to cache
    const base64Data = await blobToBase64(blob);
    const savedFile = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });

    // Open the APK using the Cordova plugin
    if (window.plugins && window.plugins.fileOpener2) {
      window.plugins.fileOpener2.open(
        savedFile.uri,
        'application/vnd.android.package-archive',
        {
          error: (err) => {
            console.error('File opener error:', err);
            alert('Could not open installer. Try again.');
          },
          success: () => console.log('Installer opened'),
        }
      );
    } else {
      alert('Installer plugin not available. Please update manually.');
    }
  } catch (err) {
    console.error('Download/install error:', err);
    throw err;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onloadend = () => {
      const base64data = reader.result.split(',')[1];
      resolve(base64data);
    };
    reader.readAsDataURL(blob);
  });
}