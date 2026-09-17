// src/components/UpdateModal.jsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Download, CheckCircle, AlertTriangle, ArrowRight, ShieldCheck, X } from 'lucide-react';
import { updateService } from '../services/updateService';

export default function UpdateModal({
  isOpen,
  updateInfo,
  currentVersion,
  onClose,
  onDismiss,
}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking_perm' | 'perm_needed' | 'downloading' | 'installing' | 'error'
  const [progress, setProgress] = useState({ bytes: 0, contentLength: 0, percent: 0 });
  const [errorMessage, setErrorMessage] = useState('');

  // When opened, verify install permissions
  useEffect(() => {
    if (isOpen && updateService.isAndroid()) {
      updateService.canRequestPackageInstalls().then((canInstall) => {
        if (!canInstall) {
          setStatus('perm_needed');
        } else {
          setStatus('idle');
        }
      });
    }
  }, [isOpen]);

  if (!isOpen || !updateInfo) return null;

  const isForced = updateInfo.isForced;

  const handleGrantPermission = async () => {
    await updateService.openInstallPermissionSettings();
    // After returning from settings, user can tap Update Now
    setStatus('idle');
  };

  const handleStartUpdate = async () => {
    try {
      const canInstall = await updateService.canRequestPackageInstalls();
      if (!canInstall) {
        setStatus('perm_needed');
        return;
      }

      setStatus('downloading');
      setProgress({ bytes: 0, contentLength: updateInfo.apkSizeBytes || 0, percent: 0 });
      setErrorMessage('');

      await updateService.downloadAndInstall({
        apkPath: updateInfo.apkPath,
        onProgress: (prog) => {
          setProgress(prog);
        },
      });

      setStatus('installing');
    } catch (err) {
      console.error('[UpdateModal] Error during update:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Download failed. Please check your connection and try again.');
    }
  };

  const formatMB = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800"
        >
          {/* Header Banner */}
          <div className="relative p-6 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
            {!isForced && status !== 'downloading' && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-white/20 rounded-2xl backdrop-blur-md">
                <Sparkles className="w-6 h-6 text-yellow-300" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {isForced ? 'Important Update Required' : 'StudyHub Update Available'}
                </h2>
                <p className="text-xs text-blue-100 font-medium">
                  {isForced ? 'Please update to continue using StudyHub' : 'A newer and faster version is ready'}
                </p>
              </div>
            </div>

            {/* Version Badge Comparison */}
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
              <span className="px-2.5 py-1 rounded-full bg-white/15 text-white/90">
                Current: v{currentVersion?.versionName || '1.1.0'}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-white/70" />
              <span className="px-2.5 py-1 rounded-full bg-emerald-400 text-zinc-950 font-bold shadow-sm">
                New: v{updateInfo.versionName}
              </span>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 space-y-4">
            {/* Release Notes */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                What's New in v{updateInfo.versionName}
              </h3>
              <div className="max-h-40 overflow-y-auto p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed whitespace-pre-line">
                {updateInfo.releaseNotes || 'Bug fixes, performance improvements, and updated study material.'}
              </div>
            </div>

            {/* Android Security Guidance Notice */}
            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-xs text-blue-800 dark:text-blue-300">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p>
                Android will prompt you to confirm the update. Your login, notes, and preferences will be preserved.
              </p>
            </div>

            {/* Permission Needed Alert */}
            {status === 'perm_needed' && (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>One-time Android Permission Required</span>
                </div>
                <p>
                  To install updates directly, allow StudyHub in your device settings under <strong>"Install unknown apps"</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleGrantPermission}
                  className="w-full py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold transition"
                >
                  Open Settings to Enable
                </button>
              </div>
            )}

            {/* Downloading State */}
            {status === 'downloading' && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  <span>Downloading update...</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="w-full h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 rounded-full"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>{formatMB(progress.bytes)}</span>
                  <span>{formatMB(progress.contentLength || updateInfo.apkSizeBytes)}</span>
                </div>
              </div>
            )}

            {/* Installing State */}
            {status === 'installing' && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-5 h-5 animate-pulse" />
                <span>Launching Android package installer...</span>
              </div>
            )}

            {/* Error State */}
            {status === 'error' && (
              <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 space-y-2">
                <p className="font-semibold">⚠️ {errorMessage}</p>
                <button
                  type="button"
                  onClick={handleStartUpdate}
                  className="py-1.5 px-3 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition"
                >
                  Retry Download
                </button>
              </div>
            )}

            {/* Action Buttons */}
            {status !== 'downloading' && status !== 'installing' && (
              <div className="pt-2 flex gap-3">
                {!isForced && (
                  <button
                    type="button"
                    onClick={onDismiss || onClose}
                    className="flex-1 py-3 px-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                  >
                    Later
                  </button>
                )}
                <button
                  type="button"
                  onClick={status === 'perm_needed' ? handleGrantPermission : handleStartUpdate}
                  className="flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-lg shadow-blue-500/25 transition flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{status === 'perm_needed' ? 'Allow in Settings' : 'Update Now'}</span>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
