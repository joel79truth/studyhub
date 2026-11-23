/**
 * useUploadQueue.js
 * React hook orchestrating multi-file parallel uploads with controlled concurrency (max 3),
 * real-time byte tracking, automatic retry, and queue management.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../supabase';
import { uploadSingleFile, MAX_CONCURRENT_UPLOADS } from '../services/uploadEngine';

export function useUploadQueue({ onFileSuccess, onBatchComplete } = {}) {
  const [queue, setQueue] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Ref to hold current queue state to avoid closure staleness during concurrent executions
  const queueRef = useRef([]);
  queueRef.current = queue;

  const activeUploadsCount = useRef(0);
  const cancelRequested = useRef(false);

  // Helper to update a specific file item in state and ref
  const updateItem = useCallback((id, updates) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  // Add files to queue
  const addFiles = useCallback((files, defaultMetadata = {}) => {
    const newItems = Array.from(files).map((file, idx) => ({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${idx}`,
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      status: 'waiting', // 'waiting' | 'uploading' | 'processing' | 'completed' | 'failed' | 'retrying'
      progress: 0,
      loadedBytes: 0,
      error: null,
      retryCount: 0,
      stage: '',
      resultUrl: null,
      resultId: null,
      ...defaultMetadata,
    }));

    setQueue((prev) => {
      // Avoid exact duplicates in current queue
      const existingNames = new Set(prev.map((i) => `${i.name}_${i.size}`));
      const filtered = newItems.filter((i) => !existingNames.has(`${i.name}_${i.size}`));
      return [...prev, ...filtered];
    });

    return newItems;
  }, []);

  // Remove a file from queue
  const removeFile = useCallback((id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Worker processor that pulls next waiting file
  const processNext = useCallback(async () => {
    if (cancelRequested.current) return;
    if (activeUploadsCount.current >= MAX_CONCURRENT_UPLOADS) return;

    // Find first waiting item
    const waitingItem = queueRef.current.find(
      (item) => item.status === 'waiting' || item.status === 'retrying'
    );

    if (!waitingItem) {
      // If no waiting items and no active uploads, batch is done
      if (activeUploadsCount.current === 0) {
        setIsUploading(false);
        const allCompleted = queueRef.current.length > 0 && queueRef.current.every((i) => i.status === 'completed');
        const anyCompleted = queueRef.current.some((i) => i.status === 'completed');
        if (anyCompleted) {
          onBatchComplete?.({
            total: queueRef.current.length,
            completed: queueRef.current.filter((i) => i.status === 'completed').length,
            failed: queueRef.current.filter((i) => i.status === 'failed').length,
            allSuccess: allCompleted,
          });
        }
      }
      return;
    }

    activeUploadsCount.current += 1;
    updateItem(waitingItem.id, { status: 'uploading', error: null, stage: 'connecting' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No active session. Please log in again.');

      const result = await uploadSingleFile({
        item: waitingItem,
        token,
        onProgress: (pct, loaded) => {
          updateItem(waitingItem.id, { progress: pct, loadedBytes: loaded });
        },
        onStage: (stage) => {
          updateItem(waitingItem.id, { stage });
        },
      });

      updateItem(waitingItem.id, {
        status: 'completed',
        progress: 100,
        loadedBytes: waitingItem.size,
        resultUrl: result.url,
        resultId: result.id,
        stage: 'done',
      });

      onFileSuccess?.(waitingItem, result);
    } catch (err) {
      console.error(`[useUploadQueue] Upload failed for ${waitingItem.name}:`, err.message);

      // Automatic retry with exponential backoff if retryCount < 2
      if (waitingItem.retryCount < 2) {
        updateItem(waitingItem.id, {
          status: 'retrying',
          retryCount: waitingItem.retryCount + 1,
          error: `Retrying (${waitingItem.retryCount + 1}/2)... ${err.message}`,
        });
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, waitingItem.retryCount)));
        updateItem(waitingItem.id, { status: 'waiting' });
      } else {
        updateItem(waitingItem.id, {
          status: 'failed',
          error: err.message || 'Upload failed',
          stage: 'failed',
        });
      }
    } finally {
      activeUploadsCount.current -= 1;
      // Continue next item immediately
      processNext();
    }
  }, [updateItem, onFileSuccess, onBatchComplete]);

  // Start processing queue
  const startUpload = useCallback(() => {
    cancelRequested.current = false;
    setIsUploading(true);

    // Spawn up to MAX_CONCURRENT_UPLOADS concurrent workers
    for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
      processNext();
    }
  }, [processNext]);

  // Retry an individual failed file without restarting batch
  const retryFile = useCallback((id) => {
    updateItem(id, {
      status: 'waiting',
      progress: 0,
      loadedBytes: 0,
      error: null,
      retryCount: 0,
    });
    // Trigger queue processor if not already active
    setIsUploading(true);
    setTimeout(() => processNext(), 50);
  }, [updateItem, processNext]);

  // Clear completed items or reset entire queue
  const resetQueue = useCallback(() => {
    setQueue([]);
    setIsUploading(false);
    activeUploadsCount.current = 0;
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status !== 'completed'));
  }, []);

  // Compute stats and aggregate byte-level progress
  const totalFiles = queue.length;
  const completedFiles = queue.filter((i) => i.status === 'completed').length;
  const failedFiles = queue.filter((i) => i.status === 'failed').length;
  const uploadingFiles = queue.filter((i) => i.status === 'uploading' || i.status === 'processing').length;
  const waitingFiles = queue.filter((i) => i.status === 'waiting' || i.status === 'retrying').length;
  const remainingFiles = totalFiles - completedFiles;

  const totalBytes = queue.reduce((sum, item) => sum + (item.size || 0), 0);
  const totalLoadedBytes = queue.reduce((sum, item) => {
    if (item.status === 'completed') return sum + (item.size || 0);
    return sum + (item.loadedBytes || 0);
  }, 0);

  const overallProgress = totalBytes > 0 ? Math.round((totalLoadedBytes / totalBytes) * 100) : 0;

  return {
    queue,
    isUploading,
    addFiles,
    removeFile,
    retryFile,
    startUpload,
    resetQueue,
    clearCompleted,
    updateItem,
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
