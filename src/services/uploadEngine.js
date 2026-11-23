/**
 * uploadEngine.js
 * High-speed, concurrent, direct-to-storage upload engine with live byte-level tracking,
 * automatic retry, and fallback proxy support.
 */

import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';
import { generateFileThumbnail } from '../utils/thumbnailHelper';

export const MAX_CONCURRENT_UPLOADS = 3;

/**
 * Execute direct-to-storage upload using presigned/signed URL,
 * falling back seamlessly to server proxy upload if direct transfer fails.
 */
export async function uploadSingleFile({
  item,
  token,
  onProgress, // (percent: number, loadedBytes: number) => void
  onStage,    // (stage: 'connecting' | 'uploading' | 'processing') => void
}) {
  onStage?.('connecting');
  onProgress?.(0, 0);

  // 1. Generate local thumbnail in parallel for instant visual previews
  let thumbDataUrl = null;
  try {
    if (item.file && (item.file.type?.startsWith('image/') || item.file.name?.match(/\.(pdf|png|jpg|jpeg)$/i))) {
      thumbDataUrl = await generateFileThumbnail(item.file, 450);
    }
  } catch (tErr) {
    console.warn('[uploadEngine] Local thumbnail warning:', tErr.message);
  }

  // 2. Request upload authorization from backend
  const initRes = await fetch(`${API_BASE_URL}/api/storage/init-upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: item.category || 'notes',
      fileName: item.name,
      fileSize: item.size,
      mimeType: item.mimeType || item.file.type || 'application/octet-stream',
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
    throw new Error(initData.message || initData.error || 'Upload authorization rejected by server.');
  }

  onStage?.('uploading');

  let storageRef = null;
  let storageType = initData.storage_type || 'supabase';

  // 3. Direct transfer
  try {
    if (initData.storage_type === 'gdrive' && initData.uploadUrl) {
      // Google Drive direct resumable PUT
      storageRef = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', initData.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', item.mimeType || item.file.type || 'application/octet-stream');
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
            onProgress?.(pct, evt.loaded);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const resJson = JSON.parse(xhr.responseText);
              resolve(resJson.id);
            } catch {
              reject(new Error('Google Drive upload succeeded but returned unexpected payload.'));
            }
          } else {
            reject(new Error(`Google Drive upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during Google Drive upload.'));
        xhr.ontimeout = () => reject(new Error('Google Drive upload timed out.'));
        xhr.send(item.file);
      });
    } else if (initData.signedUrl) {
      // Supabase Storage direct signed URL PUT
      storageRef = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', initData.signedUrl, true);
        xhr.setRequestHeader('Content-Type', item.mimeType || item.file.type || 'application/octet-stream');
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
            onProgress?.(pct, evt.loaded);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(initData.path);
          } else {
            reject(new Error(`Storage direct PUT failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network connection error during file upload.'));
        xhr.ontimeout = () => reject(new Error('Upload transfer timed out.'));
        xhr.send(item.file);
      });
    } else {
      // Direct token upload via Supabase JS client
      const { error: uploadErr } = await supabase.storage
        .from(initData.bucket)
        .uploadToSignedUrl(initData.path, initData.token, item.file);
      if (uploadErr) throw uploadErr;
      storageRef = initData.path;
      onProgress?.(95, Math.round(item.size * 0.95));
    }
  } catch (directErr) {
    console.warn('[uploadEngine] Direct storage transfer failed, falling back to server proxy:', directErr.message);
    // Fallback: Proxy upload
    return await uploadViaServerProxy({ item, token, onProgress, onStage });
  }

  // 4. Finalize database metadata
  onStage?.('processing');
  onProgress?.(99, item.size);

  const completeRes = await fetch(`${API_BASE_URL}/api/storage/complete`, {
    method: 'POST',
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
      size: item.size,
      mimeType: item.mimeType || item.file.type,
      year: item.year || undefined,
      examType: item.examType || undefined,
      title: item.title || undefined,
      sourceType: item.sourceType || 'typed_pdf',
      thumbnail_data: thumbDataUrl,
    }),
  });

  const completeData = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) {
    throw new Error(completeData.message || completeData.error || 'Failed to save resource record in database.');
  }

  onProgress?.(100, item.size);

  return {
    success: true,
    id: completeData.id,
    url: completeData.url,
    thumbnailUrl: thumbDataUrl || completeData.thumbnail_url,
    category: item.category,
  };
}

/**
 * Fallback: Upload via server proxy if direct storage upload encounters CORS or network block
 */
async function uploadViaServerProxy({ item, token, onProgress, onStage }) {
  onStage?.('uploading');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/api/storage/upload`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        onProgress?.(pct, evt.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve(res);
        } catch {
          reject(new Error('Invalid response from proxy upload service.'));
        }
      } else {
        let msg = 'Upload failed';
        try {
          const data = JSON.parse(xhr.responseText);
          msg = data.message || data.error || msg;
        } catch (_) {}
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error('Network error uploading file via proxy.'));
    xhr.ontimeout = () => reject(new Error('Proxy upload timed out.'));

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
