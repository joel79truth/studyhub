// hooks/useDownloadManager.js
import { useCallback, useSyncExternalStore } from 'react';
import {
  putDownload,
  getDownload,
  deleteDownload,
  listDownloadIds,
  hasRoomFor,
} from '../utils/downloadStore';

// Module-level store so every component (list row, viewer, badge) sees
// the same state instantly without prop-drilling or context.
const downloadedIds = new Set();
const progressMap = new Map(); // fileId -> number (0-100) | 'indeterminate'
const controllers = new Map(); // fileId -> AbortController, so downloads are cancellable
const listeners = new Set();

const notify = () => listeners.forEach((l) => l());
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

let hydrated = false;
let storeUnavailable = false;

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const ids = await listDownloadIds();
    ids.forEach((id) => downloadedIds.add(id));
  } catch (e) {
    console.warn('Could not hydrate downloads — offline downloads may be unavailable:', e);
    storeUnavailable = true;
  }
  notify();
}
hydrate();

export function useIsDownloaded(fileId) {
  return useSyncExternalStore(subscribe, () => downloadedIds.has(fileId));
}

// Returns: number (0-100), 'indeterminate' (in progress, size unknown), or null (idle)
export function useDownloadProgress(fileId) {
  return useSyncExternalStore(subscribe, () => progressMap.get(fileId) ?? null);
}

export function useDownloadsAvailable() {
  return useSyncExternalStore(subscribe, () => !storeUnavailable);
}

export function useDownloadManager() {
  const startDownload = useCallback(async (file, getUrl, fetchImpl) => {
    if (storeUnavailable) {
      return { ok: false, reason: 'unavailable', message: 'Downloads aren\u2019t available on this device.' };
    }
    if (downloadedIds.has(file.id)) {
      return { ok: true, alreadyDownloaded: true };
    }
    if (progressMap.has(file.id)) {
      // A tap landed while a download from an earlier tap is still running —
      // ignore it rather than starting a second, duplicate fetch.
      return { ok: false, reason: 'in_progress' };
    }

    const controller = new AbortController();
    controllers.set(file.id, controller);
    progressMap.set(file.id, 0);
    notify();

    try {
      const url = getUrl(file);
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = Number(res.headers.get('content-length')) || 0;
      if (!total) progressMap.set(file.id, 'indeterminate');

      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        progressMap.set(
          file.id,
          total ? Math.min(99, Math.round((received / total) * 100)) : 'indeterminate'
        );
        notify();
      }

      const blob = new Blob(chunks);

      // Check space before the write, not after — a failed write after
      // a full download is a worse experience than an upfront warning.
      const roomOk = await hasRoomFor(blob.size);
      if (!roomOk) {
        progressMap.delete(file.id);
        notify();
        return {
          ok: false,
          reason: 'quota',
          message: 'Not enough storage on your device. Free up some space and try again.',
        };
      }

      const result = await putDownload(file.id, blob, {
        filename: file.filename,
        course: file.course,
        fileType: file.filename?.split('.').pop()?.toLowerCase(),
      });

      progressMap.delete(file.id);

      if (!result.ok) {
        notify();
        return {
          ok: false,
          reason: result.reason,
          message:
            result.reason === 'quota'
              ? 'Not enough storage on your device. Free up some space and try again.'
              : 'Couldn\u2019t save this file. Please try again.',
        };
      }

      downloadedIds.add(file.id);
      notify();
      return { ok: true };
    } catch (err) {
      progressMap.delete(file.id);
      notify();

      if (err.name === 'AbortError') {
        return { ok: false, cancelled: true };
      }

      const message = !navigator.onLine
        ? 'You\u2019re offline — connect to the internet and try again.'
        : `Couldn\u2019t download ${file.filename || 'this file'}. Check your connection and try again.`;

      return { ok: false, reason: 'network', message, error: err.message };
    } finally {
      controllers.delete(file.id);
    }
  }, []);

  const cancelDownload = useCallback((fileId) => {
    controllers.get(fileId)?.abort();
  }, []);

  const removeDownload = useCallback(async (fileId) => {
    const removed = await deleteDownload(fileId);
    if (removed) {
      downloadedIds.delete(fileId);
      notify();
    }
    return removed;
  }, []);

  return { startDownload, cancelDownload, removeDownload };
}