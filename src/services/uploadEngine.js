/**
 * uploadEngine.js
 * High-speed, concurrent, direct-to-storage upload engine with strictly monotonic
 * byte-level progress tracking, AbortSignal cancellation, and server proxy fallback.
 */

import { API_BASE_URL } from '../lib/apiConfig';
import { generateFileThumbnail } from '../utils/thumbnailHelper';

export const MAX_CONCURRENT_UPLOADS = 3;

function isNonRetryableStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 413;
}

function createUploadError(message, { retryable = true, status = null, name = 'UploadError' } = {}) {
  const err = new Error(message);
  err.name = name;
  err.retryable = retryable;
  if (status != null) err.status = status;
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createUploadError('Upload cancelled', { retryable: false, name: 'AbortError' });
  }
}

/**
 * Execute direct-to-storage upload using presigned/signed URL,
 * falling back seamlessly to server proxy upload if direct transfer fails.
 */
export async function uploadSingleFile({
  item,
  token,
  signal,
  onProgress, // (percent: number, loadedBytes: number) => void
  onStage,    // (stage: 'preparing' | 'uploading' | 'processing' | 'completed') => void
}) {
  throwIfAborted(signal);

  const totalSize = Math.max(0, Number(item.size) || Number(item.file?.size) || 0);
  let highWaterPct = Math.min(99, Math.max(0, Number(item.progress) || 0));
  let highWaterLoaded = Math.min(totalSize, Math.max(0, Number(item.loadedBytes) || 0));
  let lastEmitAt = 0;

  const reportProgress = (rawPct, rawLoaded, force = false) => {
    const boundedPct = Math.min(99, Math.max(0, Math.round(rawPct || 0)));
    const boundedLoaded = Math.min(totalSize, Math.max(0, Math.round(rawLoaded || 0)));

    const nextPct = Math.max(highWaterPct, boundedPct);
    const nextLoaded = Math.max(highWaterLoaded, boundedLoaded);
    const now = Date.now();

    if (!force && nextPct === highWaterPct && now - lastEmitAt < 120) {
      return;
    }

    highWaterPct = nextPct;
    highWaterLoaded = nextLoaded;
    lastEmitAt = now;
    onProgress?.(highWaterPct, highWaterLoaded);
  };

  // Stage 1: Preparing (thumbnail reuse/generation + upload authorization)
  onStage?.('preparing');
  if (highWaterPct > 0 || highWaterLoaded > 0) {
    onProgress?.(highWaterPct, highWaterLoaded);
  } else {
    onProgress?.(0, 0);
  }

  let thumbDataUrl = item.thumbnailDataUrl || item.metadata?.thumbnailDataUrl || null;
  if (!thumbDataUrl) {
    try {
      if (item.file && (item.file.type?.startsWith('image/') || item.file.name?.match(/\.(pdf|png|jpg|jpeg)$/i))) {
        thumbDataUrl = await generateFileThumbnail(item.file, 450);
      }
    } catch (tErr) {
      console.warn('[uploadEngine] Local thumbnail warning:', tErr.message);
    }
  }

  throwIfAborted(signal);

  const initRes = await fetch(`${API_BASE_URL}/api/storage/init-upload`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: item.category || 'notes',
      fileName: item.name,
      fileSize: totalSize,
      mimeType: item.mimeType || item.file?.type || 'application/octet-stream',
      program: item.program,
      programId: item.programId || undefined,
      semester: String(item.semester),
      subject: item.subject,
      courseId: item.courseId || undefined,
      year: item.year || undefined,
      examType: item.examType || undefined,
      title: item.title || undefined,
      sourceType: item.sourceType || 'typed_pdf',
    }),
  });

  const initData = await initRes.json().catch(() => ({}));
  if (!initRes.ok) {
    throw createUploadError(
      initData.message || initData.error || 'Upload authorization rejected by server.',
      { retryable: !isNonRetryableStatus(initRes.status), status: initRes.status }
    );
  }

  throwIfAborted(signal);
  onStage?.('uploading');

  let storageRef = null;
  const storageType = initData.storage_type || 'supabase';

  // Stage 2: Direct transfer via XHR (real byte-level progress) or proxy fallback
  const runXhrPut = (targetUrl, parseResponse) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createUploadError('Upload cancelled', { retryable: false, name: 'AbortError' }));
        return;
      }

      const xhr = new XMLHttpRequest();
      const onAbort = () => {
        try { xhr.abort(); } catch { /* ignore */ }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };

      xhr.open('PUT', targetUrl, true);
      xhr.setRequestHeader('Content-Type', item.mimeType || item.file?.type || 'application/octet-stream');

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const ratio = Math.min(1, Math.max(0, evt.loaded / evt.total));
          // Cap direct-transfer XHR progress at 99% until server /complete confirms persistence
          const pct = Math.min(99, Math.round(ratio * 99));
          const mappedLoaded = Math.round(ratio * totalSize);
          reportProgress(pct, mappedLoaded);
        }
      };

      xhr.upload.onload = () => {
        reportProgress(99, totalSize, true);
      };

      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(parseResponse(xhr.responseText));
          } catch (parseErr) {
            reject(parseErr);
          }
        } else {
          reject(createUploadError(`Direct upload failed (${xhr.status})`, {
            retryable: !isNonRetryableStatus(xhr.status),
            status: xhr.status,
          }));
        }
      };

      xhr.onerror = () => {
        cleanup();
        reject(createUploadError('Network error during file upload.'));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(createUploadError('Upload transfer timed out.'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(createUploadError('Upload cancelled', { retryable: false, name: 'AbortError' }));
      };

      xhr.send(item.file);
    });

  let usedProxyCompletion = false;
  let proxyResult = null;

  try {
    if (initData.storage_type === 'gdrive' && initData.uploadUrl) {
      storageRef = await runXhrPut(initData.uploadUrl, (responseText) => {
        const resJson = JSON.parse(responseText || '{}');
        if (!resJson.id) {
          throw new Error('Google Drive upload succeeded but returned unexpected payload.');
        }
        return resJson.id;
      });
    } else if (initData.signedUrl) {
      storageRef = await runXhrPut(initData.signedUrl, () => initData.path);
    } else {
      // No direct signed URL provided — stream through server proxy with real XHR progress
      proxyResult = await uploadViaServerProxy({
        item,
        token,
        signal,
        totalSize,
        reportProgress,
        onStage,
      });
      usedProxyCompletion = true;
    }
  } catch (directErr) {
    if (directErr?.name === 'AbortError' || signal?.aborted) {
      throw directErr;
    }
    console.warn('[uploadEngine] Direct storage transfer failed, falling back to server proxy:', directErr.message);
    proxyResult = await uploadViaServerProxy({
      item,
      token,
      signal,
      totalSize,
      reportProgress,
      onStage,
    });
    usedProxyCompletion = true;
  }

  if (usedProxyCompletion && proxyResult) {
    onProgress?.(100, totalSize);
    onStage?.('completed');
    return {
      success: true,
      id: proxyResult.id,
      url: proxyResult.url,
      thumbnailUrl: thumbDataUrl || proxyResult.thumbnail_url || null,
      category: item.category,
    };
  }

  throwIfAborted(signal);

  // Stage 3: Processing (finalize database metadata record)
  onStage?.('processing');
  reportProgress(99, totalSize, true);

  const completeRes = await fetch(`${API_BASE_URL}/api/storage/complete`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      storage_type: storageType,
      storage_ref: storageRef,
      uploadId: initData.uploadId,
      category: item.category || 'notes',
      program: item.program,
      programId: item.programId || undefined,
      semester: String(item.semester),
      subject: item.subject,
      courseId: item.courseId || undefined,
      filename: item.name,
      size: totalSize,
      mimeType: item.mimeType || item.file?.type,
      year: item.year || undefined,
      examType: item.examType || undefined,
      title: item.title || undefined,
      sourceType: item.sourceType || 'typed_pdf',
      thumbnail_data: thumbDataUrl,
    }),
  });

  const completeData = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) {
    throw createUploadError(
      completeData.message || completeData.error || 'Failed to save resource record in database.',
      { retryable: !isNonRetryableStatus(completeRes.status), status: completeRes.status }
    );
  }

  onProgress?.(100, totalSize);
  onStage?.('completed');

  return {
    success: true,
    id: completeData.id,
    url: completeData.url,
    thumbnailUrl: thumbDataUrl || completeData.thumbnail_url,
    category: item.category,
  };
}

/**
 * Fallback: Upload via server proxy if direct storage upload encounters CORS or network block.
 * Preserves monotonic progress via reportProgress.
 */
async function uploadViaServerProxy({ item, token, signal, totalSize, reportProgress, onStage }) {
  throwIfAborted(signal);
  onStage?.('uploading');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      try { xhr.abort(); } catch { /* ignore */ }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    xhr.open('POST', `${API_BASE_URL}/api/storage/upload`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const ratio = Math.min(1, Math.max(0, evt.loaded / evt.total));
        const pct = Math.min(99, Math.round(ratio * 99));
        const mappedLoaded = Math.round(ratio * totalSize);
        reportProgress(pct, mappedLoaded);
      }
    };

    xhr.upload.onload = () => {
      reportProgress(99, totalSize, true);
      onStage?.('processing');
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve(res);
        } catch {
          reject(createUploadError('Invalid response from upload service.', { retryable: true }));
        }
      } else {
        let msg = 'Upload failed';
        try {
          const data = JSON.parse(xhr.responseText);
          msg = data.message || data.error || msg;
        } catch { /* ignore non-json error body */ }
        reject(createUploadError(msg, {
          retryable: !isNonRetryableStatus(xhr.status),
          status: xhr.status,
        }));
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(createUploadError('Network error uploading file via proxy.'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(createUploadError('Proxy upload timed out.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(createUploadError('Upload cancelled', { retryable: false, name: 'AbortError' }));
    };

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('category', item.category || 'notes');
    formData.append('program', item.program);
    if (item.programId) formData.append('programId', item.programId);
    formData.append('semester', String(item.semester));
    formData.append('subject', item.subject);
    if (item.courseId) formData.append('courseId', item.courseId);
    if (item.year) formData.append('year', String(item.year));
    if (item.examType) formData.append('examType', item.examType);
    if (item.title) formData.append('title', item.title);
    if (item.sourceType) formData.append('sourceType', item.sourceType);

    xhr.send(formData);
  });
}
