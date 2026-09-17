// src/services/updateService.js
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { supabase } from '../supabase';

const AppUpdater = registerPlugin('AppUpdater');

// Storage key for update check throttling
const LAST_UPDATE_CHECK_KEY = 'studyhub_last_update_check';
// 4 hours in milliseconds
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export const updateService = {
  /**
   * Check if the current platform is native Android.
   */
  isAndroid() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  },

  /**
   * Get installed version details.
   */
  async getInstalledVersion() {
    if (!Capacitor.isNativePlatform()) {
      return {
        versionName: '1.1.0 (Web)',
        versionCode: 2,
      };
    }

    try {
      const info = await App.getInfo();
      return {
        versionName: info.version || '1.1.0',
        versionCode: parseInt(info.build, 10) || 2,
      };
    } catch (err) {
      console.warn('[UpdateService] Could not read App.getInfo():', err);
      return {
        versionName: '1.1.0',
        versionCode: 2,
      };
    }
  },

  /**
   * Checks Supabase for any newer active releases.
   * @param {Object} options
   * @param {boolean} options.forceCheck - Bypass time throttle (for Settings "Check for updates")
   */
  async checkForUpdates({ forceCheck = false } = {}) {
    // Only check automatically on Android
    if (!this.isAndroid() && !forceCheck) {
      return { hasUpdate: false, reason: 'not_android' };
    }

    // Check throttle unless manual check
    if (!forceCheck) {
      const lastCheck = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
      if (lastCheck) {
        const timeSince = Date.now() - parseInt(lastCheck, 10);
        if (timeSince < CHECK_INTERVAL_MS) {
          return { hasUpdate: false, throttled: true };
        }
      }
    }

    try {
      const installed = await this.getInstalledVersion();

      const { data, error } = await supabase
        .from('app_updates')
        .select('*')
        .eq('is_active', true)
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Record last check timestamp
      localStorage.setItem(LAST_UPDATE_CHECK_KEY, Date.now().toString());

      if (error) {
        console.error('[UpdateService] Supabase query error:', error);
        return { hasUpdate: false, error: error.message };
      }

      if (!data) {
        return { hasUpdate: false, currentVersion: installed };
      }

      const latestCode = Number(data.version_code);
      const installedCode = Number(installed.versionCode);

      if (latestCode > installedCode) {
        const minCode = Number(data.min_version_code || 1);
        const isForced = Boolean(data.force_update) || installedCode < minCode;

        return {
          hasUpdate: true,
          currentVersion: installed,
          updateInfo: {
            id: data.id,
            versionName: data.version_name,
            versionCode: latestCode,
            apkPath: data.apk_path,
            apkSizeBytes: data.apk_size_bytes,
            sha256: data.sha256,
            releaseNotes: data.release_notes,
            isForced,
            minVersionCode: minCode,
          },
        };
      }

      return {
        hasUpdate: false,
        currentVersion: installed,
        latestVersion: data.version_name,
      };
    } catch (err) {
      console.error('[UpdateService] Exception checking for updates:', err);
      return { hasUpdate: false, error: err.message };
    }
  },

  /**
   * Check if Android has permission to install unknown apps (Android 8+).
   */
  async canRequestPackageInstalls() {
    if (!this.isAndroid()) return true;
    try {
      const res = await AppUpdater.canRequestPackageInstalls();
      return Boolean(res?.canInstall);
    } catch (err) {
      console.warn('[UpdateService] canRequestPackageInstalls error:', err);
      return true;
    }
  },

  /**
   * Open the Android system settings screen for "Install unknown apps".
   */
  async openInstallPermissionSettings() {
    if (!this.isAndroid()) return;
    try {
      await AppUpdater.openInstallPermissionSettings();
    } catch (err) {
      console.error('[UpdateService] openInstallPermissionSettings error:', err);
    }
  },

  /**
   * Resolves the download URL from Supabase Storage (signed or public).
   */
  async getApkDownloadUrl(apkPath) {
    if (apkPath.startsWith('http://') || apkPath.startsWith('https://')) {
      return apkPath;
    }

    // Try public URL first (instant for public buckets)
    const { data: publicData } = supabase.storage
      .from('app-updates')
      .getPublicUrl(apkPath);

    if (publicData?.publicUrl) {
      return publicData.publicUrl;
    }

    // Fall back to signed URL
    try {
      const { data: signedData } = await supabase.storage
        .from('app-updates')
        .createSignedUrl(apkPath, 60 * 60);

      if (signedData?.signedUrl) {
        return signedData.signedUrl;
      }
    } catch (e) {
      console.warn('[UpdateService] Signed URL creation error:', e);
    }

    return null;
  },

  /**
   * Downloads the APK file to cache with progress tracking, then triggers installation.
   * @param {Object} params
   * @param {string} params.apkPath - Path or URL of the APK
   * @param {Function} params.onProgress - Progress callback ({ bytes, contentLength, percent })
   */
  async downloadAndInstall({ apkPath, onProgress }) {
    if (!this.isAndroid()) {
      throw new Error('In-app updates are only supported on Android devices.');
    }

    const downloadUrl = await this.getApkDownloadUrl(apkPath);
    if (!downloadUrl) {
      throw new Error('Unable to resolve download URL for update.');
    }

    const fileName = 'studyhub-update.apk';

    // Delete any previously downloaded update file to prevent stale/corrupted APKs
    try {
      await Filesystem.deleteFile({
        path: fileName,
        directory: Directory.Cache,
      });
    } catch {
      // File might not exist, ignore
    }

    // Listen to download progress
    let progressHandle = null;
    try {
      progressHandle = await Filesystem.addListener('progress', (status) => {
        if (onProgress && status.contentLength) {
          const percent = Math.min(100, Math.round((status.bytes / status.contentLength) * 100));
          onProgress({
            bytes: status.bytes,
            contentLength: status.contentLength,
            percent,
          });
        }
      });
    } catch (e) {
      console.warn('[UpdateService] Progress listener could not be attached:', e);
    }

    try {
      // Download the file
      const downloadResult = await Filesystem.downloadFile({
        url: downloadUrl,
        path: fileName,
        directory: Directory.Cache,
        progress: true,
      });

      if (progressHandle) {
        await progressHandle.remove();
        progressHandle = null;
      }

      // Pass the direct download path if available, or getUri as fallback
      let targetPath = downloadResult?.path;
      if (!targetPath) {
        try {
          const uriResult = await Filesystem.getUri({
            path: fileName,
            directory: Directory.Cache,
          });
          targetPath = uriResult?.uri;
        } catch {
          targetPath = fileName;
        }
      }

      // Launch native package installer
      await AppUpdater.installApk({ filePath: targetPath });
      return { success: true };
    } catch (err) {
      if (progressHandle) {
        await progressHandle.remove();
      }
      console.error('[UpdateService] Download or install failed:', err);
      throw err;
    }
  },
};
