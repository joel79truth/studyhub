// src/hooks/useDownloadManager.js
import { useCallback, useSyncExternalStore } from 'react';
import {
  downloadFileToDevice,
  isFileDownloadedSync,
  getDownloadProgress,
  getDownloadError,
  cancelDeviceDownload,
  removeDownloadedFile,
  subscribeToDownloads,
  verifyFileExistsOnDevice,
  buildNoteFileName,
  buildPaperFileName,
} from '../services/deviceDownloadService';
import { trackNotesDownloaded } from '../lib/analytics';

/**
 * Hook to reactively check if a file is already downloaded to the device.
 * Automatically checks and hides the download button once downloaded.
 */
export function useIsDownloaded(fileId) {
  return useSyncExternalStore(
    subscribeToDownloads,
    () => isFileDownloadedSync(fileId),
    () => isFileDownloadedSync(fileId)
  );
}

/**
 * Hook to reactively track download progress (0-100 or null if idle).
 */
export function useDownloadProgress(fileId) {
  return useSyncExternalStore(
    subscribeToDownloads,
    () => getDownloadProgress(fileId),
    () => null
  );
}

/**
 * Hook to reactively get download error for a file.
 */
export function useDownloadError(fileId) {
  return useSyncExternalStore(
    subscribeToDownloads,
    () => getDownloadError(fileId),
    () => null
  );
}

export function useDownloadsAvailable() {
  return true;
}

export function useDownloadManager() {
  /**
   * Start downloading a single file to public Documents/StudyHub.
   */
  const startDownload = useCallback(async (file, getUrl, fetchImpl) => {
    if (!file) return { ok: false, message: 'Invalid file provided.' };

    const fileId = file.id || file.fileId || file.paperId || file.pastPaperId;
    if (!fileId) return { ok: false, message: 'Missing file ID.' };

    let fileUrl = '';
    if (typeof getUrl === 'function') {
      try { fileUrl = getUrl(file); } catch {}
    }
    if (!fileUrl) {
      fileUrl = file.fileUrl || file.file_url || file.url || file.downloadUrl;
    }

    if (!fileUrl) {
      return { ok: false, reason: 'missing_url', message: 'No downloadable link available for this file.' };
    }

    // Determine clean human-readable name
    let fileName = file.filename || file.fileName;
    if (!fileName) {
      if (file.year || file.course_code || file.paperNumber || file.paperId) {
        fileName = buildPaperFileName(file, fileUrl);
      } else {
        fileName = buildNoteFileName(file);
      }
    }

    trackNotesDownloaded({
      filename: fileName,
      subject: file.course || file.course_name || file.subject || 'StudyHub',
    });

    return await downloadFileToDevice({
      fileId,
      fileName,
      fileUrl,
    });
  }, []);

  /**
   * Download multiple files (e.g. for Notes page).
   * Runs through the selected files, skipping already downloaded files.
   * If one file fails, others still complete and the failed ones can be retried.
   */
  const downloadMultiple = useCallback(async (fileList = [], { getUrl, onFileComplete, onFileError } = {}) => {
    if (!Array.isArray(fileList) || fileList.length === 0) {
      return { total: 0, completed: 0, failed: 0, skipped: 0 };
    }

    let completed = 0;
    let failed = 0;
    let skipped = 0;
    const failedItems = [];

    for (const item of fileList) {
      const id = item.id || item.fileId;
      if (isFileDownloadedSync(id)) {
        skipped++;
        continue;
      }

      let url = '';
      if (typeof getUrl === 'function') {
        try { url = getUrl(item); } catch {}
      }
      if (!url) {
        url = item.fileUrl || item.file_url || item.url;
      }

      if (!url) {
        failed++;
        failedItems.push({ item, reason: 'No downloadable URL' });
        continue;
      }

      let fileName = item.filename || item.fileName || buildNoteFileName(item);
      const res = await downloadFileToDevice({
        fileId: id,
        fileName,
        fileUrl: url,
      });

      if (res.ok) {
        completed++;
        if (onFileComplete) onFileComplete(item);
      } else {
        failed++;
        failedItems.push({ item, error: res.message || res.error });
        if (onFileError) onFileError(item, res);
      }
    }

    return {
      total: fileList.length,
      completed,
      failed,
      skipped,
      failedItems,
    };
  }, []);

  const cancelDownload = useCallback((fileId) => {
    cancelDeviceDownload(fileId);
  }, []);

  const removeDownload = useCallback(async (fileId) => {
    return await removeDownloadedFile(fileId);
  }, []);

  const verifyExistence = useCallback(async (fileId) => {
    return await verifyFileExistsOnDevice(fileId);
  }, []);

  return {
    startDownload,
    downloadMultiple,
    cancelDownload,
    removeDownload,
    verifyExistence,
  };
}
