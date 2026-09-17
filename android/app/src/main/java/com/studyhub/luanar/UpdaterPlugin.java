package com.studyhub.luanar;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "AppUpdater")
public class UpdaterPlugin extends Plugin {
    private static final String TAG = "AppUpdaterPlugin";

    /**
     * Checks if the app has permission to install unknown apps (Android 8.0+ / API 26+).
     */
    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
                ret.put("canInstall", canInstall);
            } else {
                ret.put("canInstall", true);
            }
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error checking package install permission", e);
            ret.put("canInstall", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * Opens the system settings screen where the user can toggle "Allow from this source".
     */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                call.resolve(ret);
            } else {
                JSObject ret = new JSObject();
                ret.put("opened", false);
                call.resolve(ret);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error opening install permission settings", e);
            call.reject("Failed to open install settings: " + e.getMessage());
        }
    }

    private File findApkRecursively(File dir, String targetName) {
        if (dir == null || !dir.exists()) return null;
        File direct = new File(dir, targetName);
        if (direct.exists() && direct.isFile() && direct.length() > 0) {
            return direct;
        }
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) {
                    File found = findApkRecursively(child, targetName);
                    if (found != null) return found;
                } else if (child.isFile() && (child.getName().equalsIgnoreCase(targetName) || child.getName().endsWith(".apk")) && child.length() > 0) {
                    return child;
                }
            }
        }
        return null;
    }

    /**
     * Triggers the Android package installer for a downloaded APK file.
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        String rawPath = call.getString("filePath");
        if (rawPath == null || rawPath.trim().isEmpty()) {
            call.reject("filePath is required");
            return;
        }

        try {
            Context context = getContext();
            File apkFile = null;

            // 1. Content URI handling
            if (rawPath.startsWith("content://")) {
                try {
                    Uri contentUri = Uri.parse(rawPath);
                    File destination = new File(context.getCacheDir(), "studyhub-update.apk");
                    try (InputStream in = context.getContentResolver().openInputStream(contentUri);
                         OutputStream out = new FileOutputStream(destination)) {
                        if (in != null) {
                            byte[] buf = new byte[8192];
                            int len;
                            while ((len = in.read(buf)) > 0) {
                                out.write(buf, 0, len);
                            }
                            if (destination.exists() && destination.length() > 0) {
                                apkFile = destination;
                            }
                        }
                    }
                } catch (Exception ex) {
                    Log.w(TAG, "Could not stream from content URI: " + ex.getMessage());
                }
            }

            // 2. Direct path check
            if (apkFile == null || !apkFile.exists()) {
                String path = rawPath;
                if (path.startsWith("file://")) {
                    path = Uri.parse(path).getPath();
                }
                if (path != null) {
                    File f = new File(path);
                    if (f.exists() && f.length() > 0) {
                        apkFile = f;
                    }
                }
            }

            // 3. Decoded path check
            if (apkFile == null || !apkFile.exists()) {
                try {
                    String decoded = Uri.decode(rawPath.replace("file://", ""));
                    File f = new File(decoded);
                    if (f.exists() && f.length() > 0) {
                        apkFile = f;
                    }
                } catch (Exception ignored) {}
            }

            // 4. Recursive search across all app storage directories
            if (apkFile == null || !apkFile.exists()) {
                String candidateName = "studyhub-update.apk";
                File[] dirs = new File[] {
                    context.getCacheDir(),
                    context.getExternalCacheDir(),
                    context.getFilesDir(),
                    context.getExternalFilesDir(null),
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                };

                for (File dir : dirs) {
                    File found = findApkRecursively(dir, candidateName);
                    if (found != null && found.exists() && found.length() > 0) {
                        apkFile = found;
                        break;
                    }
                }
            }

            if (apkFile == null || !apkFile.exists()) {
                call.reject("APK file does not exist at path: " + rawPath);
                return;
            }

            Log.i(TAG, "Installing APK from: " + apkFile.getAbsolutePath() + " (" + apkFile.length() + " bytes)");

            String authority = context.getPackageName() + ".fileprovider";
            Uri contentUri = FileProvider.getUriForFile(context, authority, apkFile);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch package installer", e);
            call.reject("Installation failed: " + e.getMessage());
        }
    }
}
