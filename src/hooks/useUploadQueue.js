/**
 * useUploadQueue.js
 * React hook orchestrating multi-file parallel uploads with controlled concurrency (max 3),
 * synchronous worker item claiming (preventing duplicate uploads & backwards progress),
 * monotonic byte tracking, explicit lifecycle stages, and clean cancellation/retry.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../supabase';
import { uploadSingleFile, MAX_CONCURRENT_UPLOADS } from '../services/uploadEngine';

export function useUploadQueue({ onFileSuccess, onBatchComplete } = {}) {
  const [queue, setQueue] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // Authoritative synchronous queue reference (prevents multi-worker race conditions)
  const queueRef = useRef([]);
  const claimedIdsRef = useRef(new Set());
  const abortControllersRef = useRef(new Map());
  const activeUploadsCount = useRef(0);
  const cancelRequested = useRef(false);
  const retryTimersRef = useRef(new Map());

  const onFileSuccessRef = useRef(onFileSuccess);
  const onBatchCompleteRef = useRef(onBatchComplete);
  const processNextRef = useRef(null);

  useEffect(() => {
    onFileSuccessRef.current = onFileSuccess;
    onBatchCompleteRef.current = onBatchComplete;
  }, [onFileSuccess, onBatchComplete]);

  // Apply queue mutation synchronously to queueRef AND schedule React state render
  const commitQueue = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(queueRef.current) : updater;
    queueRef.current = next;
    setQueue(next);
    return next;
  }, []);

  // Cleanup any object URLs & active transfers on unmount
  useEffect(() => {
    const controllers = abortControllersRef.current;
    const timers = retryTimersRef.current;
    return () => {
      cancelRequested.current = true;
      for (const ctrl of controllers.values()) {
        try { ctrl.abort(); } catch { /* ignore */ }
      }
      controllers.clear();
      for (const t of timers.values()) {
        clearTimeout(t);
      }
      timers.clear();
      for (const item of queueRef.current) {
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  // Helper to update a single queue item with strict monotonic progress guard
  const updateItem = useCallback((id, updates, { allowProgressReset = false } = {}) => {
    commitQueue((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...updates };
        if (!allowProgressReset) {
          if (typeof updates.progress === 'number') {
            next.progress = Math.max(item.progress || 0, updates.progress);
          }
          if (typeof updates.loadedBytes === 'number') {
            next.loadedBytes = Math.max(item.loadedBytes || 0, updates.loadedBytes);
          }
        }
        return next;
      })
    );
  }, [commitQueue]);

  // Add files to queue
  const addFiles = useCallback((files, defaultMetadata = {}) => {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) return [];

    const existingKeys = new Set(queueRef.current.map((i) => `${i.name}_${i.size}`));
    const newItems = [];

    for (let idx = 0; idx < incoming.length; idx++) {
      const file = incoming[idx];
      const dedupeKey = `${file.name}_${file.size}`;
      if (existingKeys.has(dedupeKey)) continue;
      existingKeys.add(dedupeKey);

      const isImage = Boolean(file.type?.startsWith('image/'));
      const previewUrl = isImage ? URL.createObjectURL(file) : null;

      newItems.push({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${idx}`,
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        status: 'waiting', // 'waiting' | 'preparing' | 'uploading' | 'processing' | 'completed' | 'failed' | 'retrying'
        progress: 0,
        loadedBytes: 0,
        error: null,
        retryCount: 0,
        stage: 'waiting',
        previewUrl,
        thumbnailDataUrl: defaultMetadata.thumbnailDataUrl || null,
        resultUrl: null,
        resultId: null,
        ...defaultMetadata,
      });
    }

    if (newItems.length > 0) {
      commitQueue((prev) => [...prev, ...newItems]);
    }
    return newItems;
  }, [commitQueue]);

  // Replace a waiting or failed file while keeping its slot
  const replaceFile = useCallback((id, newFile) => {
    if (!newFile) return;
    if (claimedIdsRef.current.has(id)) return;

    commitQueue((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
        const isImage = Boolean(newFile.type?.startsWith('image/'));
        return {
          ...item,
          file: newFile,
          name: newFile.name,
          size: newFile.size,
          mimeType: newFile.type || 'application/octet-stream',
          status: 'waiting',
          stage: 'waiting',
          progress: 0,
          loadedBytes: 0,
          error: null,
          retryCount: 0,
          previewUrl: isImage ? URL.createObjectURL(newFile) : null,
          thumbnailDataUrl: null,
          resultUrl: null,
          resultId: null,
        };
      })
    );
  }, [commitQueue]);

  // Remove or cancel an individual file from queue
  const removeFile = useCallback((id) => {
    const pendingTimer = retryTimersRef.current.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      retryTimersRef.current.delete(id);
    }
    const ctrl = abortControllersRef.current.get(id);
    if (ctrl) {
      try { ctrl.abort(); } catch { /* ignore */ }
      abortControllersRef.current.delete(id);
    }
    claimedIdsRef.current.delete(id);

    commitQueue((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, [commitQueue]);

  // Synchronous item claim + execution loop
  const processNext = useCallback(async () => {
    if (cancelRequested.current) return;
    if (activeUploadsCount.current >= MAX_CONCURRENT_UPLOADS) return;

    // Synchronously find & claim the next unclaimed waiting item
    const nextItem = queueRef.current.find(
      (item) =>
        (item.status === 'waiting' || item.status === 'retrying') &&
        !claimedIdsRef.current.has(item.id)
    );

    if (!nextItem) {
      if (activeUploadsCount.current === 0) {
        setIsUploading(false);
        const currentQueue = queueRef.current;
        const anyCompleted = currentQueue.some((i) => i.status === 'completed');
        const allCompleted = currentQueue.length > 0 && currentQueue.every((i) => i.status === 'completed');
        if (anyCompleted) {
          onBatchCompleteRef.current?.({
            total: currentQueue.length,
            completed: currentQueue.filter((i) => i.status === 'completed').length,
            failed: currentQueue.filter((i) => i.status === 'failed').length,
            allSuccess: allCompleted,
          });
        }
      }
      return;
    }

    // Claim synchronously BEFORE any async yield so concurrent workers never pick the same item
    claimedIdsRef.current.add(nextItem.id);
    activeUploadsCount.current += 1;

    const controller = new AbortController();
    abortControllersRef.current.set(nextItem.id, controller);

    updateItem(nextItem.id, { status: 'preparing', stage: 'preparing', error: null });

    let scheduledAutoRetry = false;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        const authErr = new Error('No active session. Please log in again.');
        authErr.retryable = false;
        throw authErr;
      }

      // Always read the latest metadata for this item before uploading
      const latestItem = queueRef.current.find((i) => i.id === nextItem.id) || nextItem;

      const result = await uploadSingleFile({
        item: latestItem,
        token,
        signal: controller.signal,
        onProgress: (pct, loaded) => {
          updateItem(nextItem.id, { progress: pct, loadedBytes: loaded });
        },
        onStage: (stage) => {
          const statusMap = {
            preparing: 'preparing',
            uploading: 'uploading',
            processing: 'processing',
            completed: 'completed',
          };
          updateItem(nextItem.id, {
            stage,
            status: statusMap[stage] || 'uploading',
          });
        },
      });

      updateItem(nextItem.id, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        loadedBytes: latestItem.size,
        resultUrl: result.url,
        resultId: result.id,
        error: null,
      });

      onFileSuccessRef.current?.(latestItem, result);
    } catch (err) {
      const wasAborted = err?.name === 'AbortError' || controller.signal.aborted || cancelRequested.current;
      const latestItem = queueRef.current.find((i) => i.id === nextItem.id);

      if (wasAborted || !latestItem) {
        // Item was cancelled/removed by user; do not overwrite with failed state
        return;
      }

      console.error(`[useUploadQueue] Upload failed for ${latestItem.name}:`, err.message);

      const canRetry = err?.retryable !== false && latestItem.retryCount < 2;
      if (canRetry) {
        const nextRetryCount = latestItem.retryCount + 1;
        const delayMs = 1200 * Math.pow(2, latestItem.retryCount);
        scheduledAutoRetry = true;

        updateItem(nextItem.id, {
          status: 'retrying',
          stage: 'retrying',
          retryCount: nextRetryCount,
          error: `Reconnecting (${nextRetryCount}/2)...`,
        });

        const timer = setTimeout(() => {
          retryTimersRef.current.delete(nextItem.id);
          if (cancelRequested.current) return;
          const stillExists = queueRef.current.some((i) => i.id === nextItem.id);
          if (!stillExists) return;
          claimedIdsRef.current.delete(nextItem.id);
          updateItem(nextItem.id, { status: 'waiting', stage: 'waiting', error: null });
          processNextRef.current?.();
        }, delayMs);
        retryTimersRef.current.set(nextItem.id, timer);
      } else {
        updateItem(nextItem.id, {
          status: 'failed',
          stage: 'failed',
          error: err.message || 'Upload failed',
        });
      }
    } finally {
      abortControllersRef.current.delete(nextItem.id);
      if (!scheduledAutoRetry) {
        claimedIdsRef.current.delete(nextItem.id);
      }
      activeUploadsCount.current = Math.max(0, activeUploadsCount.current - 1);
      processNextRef.current?.();
    }
  }, [updateItem]);

  useEffect(() => {
    processNextRef.current = processNext;
  }, [processNext]);

  // Update metadata on all waiting/failed items (e.g., if user edits Course/Program/Semester after adding files)
  const updatePendingMetadata = useCallback((metadataPatch = {}) => {
    commitQueue((prev) =>
      prev.map((item) => {
        if (item.status === 'waiting' || item.status === 'failed') {
          return { ...item, ...metadataPatch };
        }
        return item;
      })
    );
  }, [commitQueue]);

  // Start processing queue with up to MAX_CONCURRENT_UPLOADS workers
  const startUpload = useCallback((metadataPatch = null) => {
    cancelRequested.current = false;
    if (metadataPatch) {
      commitQueue((prev) =>
        prev.map((item) =>
          item.status === 'waiting' || item.status === 'failed'
            ? { ...item, ...metadataPatch }
            : item
        )
      );
    }

    const hasWaiting = queueRef.current.some(
      (i) => i.status === 'waiting' || i.status === 'retrying'
    );
    if (!hasWaiting) return;

    setIsUploading(true);
    const workersNeeded = Math.min(
      MAX_CONCURRENT_UPLOADS - activeUploadsCount.current,
      queueRef.current.filter((i) => i.status === 'waiting' && !claimedIdsRef.current.has(i.id)).length
    );
    for (let i = 0; i < workersNeeded; i++) {
      processNext();
    }
  }, [commitQueue, processNext]);

  // Retry an individual failed file cleanly from 0%
  const retryFile = useCallback((id) => {
    if (claimedIdsRef.current.has(id)) return;
    cancelRequested.current = false;
    updateItem(
      id,
      {
        status: 'waiting',
        stage: 'waiting',
        progress: 0,
        loadedBytes: 0,
        error: null,
        retryCount: 0,
      },
      { allowProgressReset: true }
    );
    setIsUploading(true);
    processNext();
  }, [updateItem, processNext]);

  // Clear completed items or reset entire queue
  const resetQueue = useCallback(() => {
    cancelRequested.current = true;
    for (const t of retryTimersRef.current.values()) {
      clearTimeout(t);
    }
    retryTimersRef.current.clear();
    for (const ctrl of abortControllersRef.current.values()) {
      try { ctrl.abort(); } catch { /* ignore */ }
    }
    abortControllersRef.current.clear();
    claimedIdsRef.current.clear();
    activeUploadsCount.current = 0;
    setIsUploading(false);

    commitQueue((prev) => {
      for (const item of prev) {
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return [];
    });
  }, [commitQueue]);

  const clearCompleted = useCallback(() => {
    commitQueue((prev) => {
      for (const item of prev) {
        if (item.status === 'completed' && item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return prev.filter((item) => item.status !== 'completed');
    });
  }, [commitQueue]);

  // Compute stats and aggregate byte-level progress
  const totalFiles = queue.length;
  const completedFiles = queue.filter((i) => i.status === 'completed').length;
  const failedFiles = queue.filter((i) => i.status === 'failed').length;
  const uploadingFiles = queue.filter((i) =>
    i.status === 'preparing' || i.status === 'uploading' || i.status === 'processing'
  ).length;
  const waitingFiles = queue.filter((i) => i.status === 'waiting' || i.status === 'retrying').length;
  const remainingFiles = totalFiles - completedFiles;

  const totalBytes = queue.reduce((sum, item) => sum + (item.size || 0), 0);
  const totalLoadedBytes = queue.reduce((sum, item) => {
    if (item.status === 'completed') return sum + (item.size || 0);
    return sum + Math.min(item.size || 0, item.loadedBytes || 0);
  }, 0);

  const overallProgress = totalBytes > 0
    ? (completedFiles === totalFiles && totalFiles > 0
        ? 100
        : Math.min(99, Math.round((totalLoadedBytes / totalBytes) * 100)))
    : 0;

  return {
    queue,
    isUploading,
    addFiles,
    replaceFile,
    removeFile,
    retryFile,
    startUpload,
    resetQueue,
    clearCompleted,
    updateItem,
    updatePendingMetadata,
    stats: {
      total: totalFiles,
      completed: completedFiles,
      failed: failedFiles,
      uploading: uploadingFiles,
      waiting: waitingFiles,
      remaining: remainingFiles,
      totalBytes,
      totalLoadedBytes,
      overallProgress,
    },
  };
}
