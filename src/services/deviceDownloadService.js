// src/services/deviceDownloadService.js
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Toast } from '@capacitor/toast';

const REGISTRY_STORAGE_KEY = 'studyhub_downloaded_files_registry';
const SUBFOLDER = 'StudyHub';

// In-memory cache of verified downloaded file IDs
const downloadedIdsSet = new Set();
const progressMap = new Map(); // fileId -> number (0-100)
const errorMap = new Map();    // fileId -> string | null
const activeControllers = new Map(); // fileId -> AbortController
const listeners = new Set();

const notifyListeners = () => {
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { console.error('Listener error:', e); }
  });
};

/**
 * Load registry from localStorage
 */
function getRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save registry to localStorage
 */
function saveRegistry(registry) {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(registry));
  } catch (e) {
    console.warn('[DeviceDownload] Failed to save registry:', e);
  }
}

/**
 * Sanitize a filename for safe OS saving
 */
export function sanitizeFileName(name = 'document') {
  // Replace characters not allowed in file systems: / \ : * ? " < > |
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return cleaned || 'StudyHub_Document';
}

/**
 * Build a real human-friendly past paper filename
 * Format: "LUANAR_<Course>_<Year>_<Paper>.<ext>"
 */
export function buildPaperFileName(paper, fileUrl = '') {
  let ext = 'pdf';
  if (fileUrl) {
    const lower = fileUrl.toLowerCase();
    if (lower.includes('.png')) ext = 'png';
    else if (lower.includes('.jpg') || lower.includes('.jpeg')) ext = 'jpg';
    else if (lower.includes('.webp')) ext = 'webp';
    else if (lower.includes('.docx')) ext = 'docx';
    else if (lower.includes('.pptx')) ext = 'pptx';
  }

  const courseRaw = paper?.course_code || paper?.courseName || paper?.course || 'PastPaper';
  const yearRaw = paper?.year ? String(paper.year) : 'Exam';
  const paperRaw = paper?.paperNumber || paper?.paper_number || paper?.title || paper?.label || 'Paper';

  const course = sanitizeFileName(courseRaw);
  const year = sanitizeFileName(yearRaw);
  const paperNum = sanitizeFileName(paperRaw);

  return `LUANAR_${course}_${year}_${paperNum}.${ext}`.replace(/_+/g, '_');
}

/**
 * Build a clean note filename
 */
export function buildNoteFileName(note, defaultExt = 'pdf') {
  if (note?.filename && note.filename.includes('.')) {
    return sanitizeFileName(note.filename);
  }
  const course = sanitizeFileName(note?.course || note?.course_name || 'Note');
  const title = sanitizeFileName(note?.title || note?.filename || 'Document');
  return `LUANAR_${course}_${title}.${defaultExt}`.replace(/_+/g, '_');
}

/**
 * Request storage permission if required on Android
 */
async function ensureStoragePermission() {
  if (!Capacitor.isNativePlatform()) return true;

  try {
    const status = await Filesystem.checkPermissions();
    if (status?.publicStorage === 'granted') {
      return true;
    }
    const requested = await Filesystem.requestPermissions();
    return requested?.publicStorage === 'granted';
  } catch (err) {
    console.warn('[DeviceDownload] Permission check warning:', err);
    // On Android 11+ with Scoped Storage, standard documents directory is accessible
    return true;
  }
}

/**
 * Verify whether a specific file still exists on the physical device
 */
export async function verifyFileExistsOnDevice(fileId) {
  if (!fileId) return false;
  const registry = getRegistry();
  const record = registry[fileId];

  if (!record) {
    if (downloadedIdsSet.has(fileId)) {
      downloadedIdsSet.delete(fileId);
      notifyListeners();
    }
    return false;
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.stat({
        path: record.relativePath,
        directory: Directory.Documents,
      });
      if (!downloadedIdsSet.has(fileId)) {
        downloadedIdsSet.add(fileId);
        notifyListeners();
      }
      return true;
    } catch {
      // User deleted the file from phone's Files app!
      delete registry[fileId];
      saveRegistry(registry);
      downloadedIdsSet.delete(fileId);
      notifyListeners();
      return false;
    }
  } else {
    // Web environment: file is considered downloaded if recorded
    downloadedIdsSet.add(fileId);
    return true;
  }
}

/**
 * Synchronous check for reactive UI render
 */
export function isFileDownloadedSync(fileId) {
  if (!fileId) return false;
  return downloadedIdsSet.has(fileId);
}

/**
 * Initialize and verify all records in registry on startup
 */
export async function initializeDownloadRegistry() {
  const registry = getRegistry();
  const fileIds = Object.keys(registry);

  for (const id of fileIds) {
    await verifyFileExistsOnDevice(id);
  }
  notifyListeners();
}

// Initial sync on module evaluation
try {
  const initialRegistry = getRegistry();
  Object.keys(initialRegistry).forEach((id) => downloadedIdsSet.add(id));
  // Verify in background
  setTimeout(() => {
    initializeDownloadRegistry().catch(console.warn);
  }, 100);
} catch {}

/**
 * Download a file to phone's public Documents/StudyHub folder
 */
export async function downloadFileToDevice({
  fileId,
  fileName,
  fileUrl,
  onProgress,
}) {
  if (!fileId || !fileUrl) {
    return { ok: false, reason: 'missing_params', message: 'Missing file information to download.' };
  }

  // If already downloaded and verified
  const exists = await verifyFileExistsOnDevice(fileId);
  if (exists) {
    return { ok: true, alreadyDownloaded: true, message: 'File is already downloaded.' };
  }

  // Network check
  if (!navigator.onLine) {
    const errorMsg = 'No internet connection. Please connect to the internet and retry.';
    errorMap.set(fileId, errorMsg);
    notifyListeners();
    return { ok: false, reason: 'network', message: errorMsg };
  }

  // Request permissions
  const hasPermission = await ensureStoragePermission();
  if (!hasPermission) {
    const errorMsg = 'Storage permission was denied. Please allow storage access in device Settings.';
    errorMap.set(fileId, errorMsg);
    notifyListeners();
    return { ok: false, reason: 'permission', message: errorMsg };
  }

  const cleanName = sanitizeFileName(fileName || 'StudyHub_File.pdf');
  const relativePath = `${SUBFOLDER}/${cleanName}`;

  // Set initial state
  progressMap.set(fileId, 0);
  errorMap.delete(fileId);
  notifyListeners();

  const controller = new AbortController();
  activeControllers.set(fileId, controller);

  try {
    if (Capacitor.isNativePlatform()) {
      // 1. Ensure StudyHub directory exists in public Documents
      try {
        await Filesystem.mkdir({
          path: SUBFOLDER,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch {
        // Directory might already exist
      }

      // 2. Set up progress listener
      let progressHandle = null;
      try {
        progressHandle = await Filesystem.addListener('progress', (status) => {
          if (status.contentLength) {
            const percent = Math.min(99, Math.round((status.bytes / status.contentLength) * 100));
            progressMap.set(fileId, percent);
            if (onProgress) onProgress(percent, status.bytes, status.contentLength);
            notifyListeners();
          }
        });
      } catch (e) {
        console.warn('[DeviceDownload] Progress listener attach error:', e);
      }

      // 3. Download directly to public Documents/StudyHub
      let downloadResult;
      try {
        downloadResult = await Filesystem.downloadFile({
          url: fileUrl,
          path: relativePath,
          directory: Directory.Documents,
          recursive: true,
          progress: true,
        });
      } catch (downloadErr) {
        // Fallback: fetch blob and write file if downloadFile fails
        console.warn('[DeviceDownload] Direct downloadFile failed, using blob write fallback:', downloadErr);
        const res = await fetch(fileUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const blob = await res.blob();
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : null;
            if (base64) resolve(base64);
            else reject(new Error('Failed to convert file to base64'));
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        downloadResult = await Filesystem.writeFile({
          path: relativePath,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });
      } finally {
        if (progressHandle) {
          try { await progressHandle.remove(); } catch {}
        }
      }

      // 4. Save record
      const registry = getRegistry();
      registry[fileId] = {
        id: fileId,
        fileName: cleanName,
        relativePath,
        downloadedAt: Date.now(),
        uri: downloadResult?.path || downloadResult?.uri || relativePath,
      };
      saveRegistry(registry);

      downloadedIdsSet.add(fileId);
      progressMap.delete(fileId);
      errorMap.delete(fileId);
      activeControllers.delete(fileId);
      notifyListeners();

      // Show success toast on native
      try {
        await Toast.show({
          text: 'Saved to Documents/StudyHub',
          duration: 'short',
          position: 'bottom',
        });
      } catch {}

      return {
        ok: true,
        path: `Documents/${relativePath}`,
        message: 'Saved to Documents/StudyHub',
      };
    } else {
      // Web fallback: download via browser anchor
      const res = await fetch(fileUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const contentLength = Number(res.headers.get('content-length')) || 0;
      const reader = res.body?.getReader();
      const chunks = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) {
            const percent = Math.min(99, Math.round((received / contentLength) * 100));
            progressMap.set(fileId, percent);
            if (onProgress) onProgress(percent, received, contentLength);
            notifyListeners();
          }
        }
      } else {
        const b = await res.blob();
        chunks.push(b);
      }

      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

      const registry = getRegistry();
      registry[fileId] = {
        id: fileId,
        fileName: cleanName,
        relativePath,
        downloadedAt: Date.now(),
      };
      saveRegistry(registry);

      downloadedIdsSet.add(fileId);
      progressMap.delete(fileId);
      errorMap.delete(fileId);
      activeControllers.delete(fileId);
      notifyListeners();

      return {
        ok: true,
        path: cleanName,
        message: 'Saved to Documents/StudyHub',
      };
    }
  } catch (err) {
    progressMap.delete(fileId);
    activeControllers.delete(fileId);

    if (err.name === 'AbortError') {
      notifyListeners();
      return { ok: false, cancelled: true };
    }

    console.error('[DeviceDownload] Download error:', err);
    let reason = 'general';
    let userMsg = 'Download failed. Tap to retry.';

    const errStr = (err?.message || '').toLowerCase();
    if (!navigator.onLine || errStr.includes('network') || errStr.includes('failed to fetch')) {
      reason = 'network';
      userMsg = 'Download failed: Check your connection and retry.';
    } else if (errStr.includes('permission')) {
      reason = 'permission';
      userMsg = 'Storage permission denied. Please allow access in Settings.';
    } else if (errStr.includes('quota') || errStr.includes('space') || errStr.includes('enospc')) {
      reason = 'quota';
      userMsg = 'Not enough space on device. Free up storage and retry.';
    }

    errorMap.set(fileId, userMsg);
    notifyListeners();

    try {
      if (Capacitor.isNativePlatform()) {
        await Toast.show({ text: userMsg, duration: 'short' });
      }
    } catch {}

    return { ok: false, reason, message: userMsg, error: err.message };
  }
}

/**
 * Cancel an ongoing download
 */
export function cancelDeviceDownload(fileId) {
  if (activeControllers.has(fileId)) {
    const ctrl = activeControllers.get(fileId);
    try { ctrl.abort(); } catch {}
    activeControllers.delete(fileId);
  }
  progressMap.delete(fileId);
  notifyListeners();
}

/**
 * Remove a downloaded file from device
 */
export async function removeDownloadedFile(fileId) {
  const registry = getRegistry();
  const record = registry[fileId];
  if (!record) return false;

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.deleteFile({
        path: record.relativePath,
        directory: Directory.Documents,
      });
    } catch (e) {
      console.warn('[DeviceDownload] Delete file warning:', e);
    }
  }

  delete registry[fileId];
  saveRegistry(registry);
  downloadedIdsSet.delete(fileId);
  notifyListeners();
  return true;
}

/**
 * Subscribe to download state changes
 */
export function subscribeToDownloads(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getDownloadProgress(fileId) {
  return progressMap.get(fileId) ?? null;
}

export function getDownloadError(fileId) {
  return errorMap.get(fileId) ?? null;
}

export function getAllDownloadedIds() {
  return Array.from(downloadedIdsSet);
}
