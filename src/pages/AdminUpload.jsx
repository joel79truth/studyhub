import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';

const BASE_URL = API_BASE_URL;

// ── Principle 5: input method matched to context ──────────────────────────────
// UUID field stays as text input (precise, one-time). File stays as file input.
// Program is now selected by ID (not free-text name) so it can never
// mismatch a database row — see server.js getOrCreateProgram/getOrCreateCourse.
// ─────────────────────────────────────────────────────────────────────────────

const AdminUpload = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState('single');

  // Multi-image upload (up to 5 pages)
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');  // e.g. 'uploading', 'analyzing', 'done'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorRawPaperId, setErrorRawPaperId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // reprocess-by-id
  const [existingPaperId, setExistingPaperId] = useState('');
  const [processingExisting, setProcessingExisting] = useState(false);

  // batch
  const [unprocessed, setUnprocessed] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadingUnprocessed, setLoadingUnprocessed] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const [batchError, setBatchError] = useState(null);
  // rawPaperId -> 'generating' | 'ready' | 'failed' | 'timeout'
  const [docStatuses, setDocStatuses] = useState({});


const [uploadProgramId, setUploadProgramId] = useState('');
const [uploadCourse, setUploadCourse] = useState('');
const [uploadSemester, setUploadSemester] = useState('');
const [uploadYear, setUploadYear] = useState('');
const [programs, setPrograms] = useState([]); // [{ id, name }]

// ── PDF upload state ──────────────────────────────────────────────────────────
const [uploadType, setUploadType] = useState('image'); // 'image' | 'pdf'
const [pdfFile, setPdfFile] = useState(null);
const [pdfDragOver, setPdfDragOver] = useState(false);
const [pdfUploading, setPdfUploading] = useState(false);
const [pdfUploadStage, setPdfUploadStage] = useState(''); // 'uploading' | 'analyzing' | 'done'
const [pdfResult, setPdfResult] = useState(null);
const [pdfError, setPdfError] = useState(null);
const [pdfErrorRawPaperId, setPdfErrorRawPaperId] = useState(null);
const pdfFileInputRef = useRef(null);

useEffect(() => {
  fetch(`${BASE_URL}/api/programs`)
    .then(r => r.json())
    .then(d => setPrograms(d.programs || []))
    .catch(() => {});
}, []);




  useEffect(() => {
    return () => {
      previews.forEach((p) => {
        if (p?.url) URL.revokeObjectURL(p.url);
      });
    };
  }, [previews]);

  const authHeader = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { Authorization: `Bearer ${token}` };
  };

  // ── Poll GET /api/exam/paper-document/:pastPaperId until the background
  // PDF generation resolves to 'ready' or 'failed'. The endpoint returns
  // the LATEST attempt regardless of status (not just ready ones), so
  // 'failed' is a real, distinguishable terminal state — not indistinguishable
  // from "still working" or "not started". 'timeout' means we stopped polling
  // while it was still 'generating' (or no row existed yet) — genuinely
  // unknown, not a failure. ──
  const pollForDocument = async (rawPaperId, onUpdate, { intervalMs = 2000, maxAttempts = 15 } = {}) => {
    const headers = await authHeader();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}/api/exam/paper-document/${rawPaperId}`, { headers });
        const data = await res.json();
        const doc = data?.document;

        if (doc?.status === 'ready') {
          onUpdate({ status: 'ready', url: doc.document_url });
          return;
        }
        if (doc?.status === 'failed') {
          onUpdate({ status: 'failed' });
          return; // won't resolve itself — stop polling
        }
        // doc.status === 'generating', or doc is null (not started yet) — keep polling
      } catch (_) {
        // transient network error — keep polling
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    onUpdate({ status: 'timeout' });
  };

  const compressOneImage = async (rawFile) => {
    if (!rawFile) return null;
    let finalFile = rawFile;
    if (rawFile.type?.startsWith('image/') && rawFile.size > 1.5 * 1024 * 1024) {
      try {
        const imageCompressionModule = await import('browser-image-compression');
        const imageCompression = imageCompressionModule.default || imageCompressionModule;
        const compressedBlob = await imageCompression(rawFile, {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          fileType: 'image/jpeg',
        });
        finalFile = new File([compressedBlob], (rawFile.name || 'photo.jpg').replace(/\.[^/.]+$/, "") + ".jpg", {
          type: 'image/jpeg',
        });
      } catch (compErr) {
        console.warn('Image compression fallback:', compErr);
      }
    }
    return finalFile;
  };

  const addFiles = async (newRawFiles) => {
    if (!newRawFiles || newRawFiles.length === 0) return;
    const incoming = Array.from(newRawFiles).filter((f) => f.type?.startsWith('image/'));
    if (incoming.length === 0) return;

    const availableSlots = 5 - files.length;
    if (availableSlots <= 0) {
      setError('Maximum 5 pages allowed per exam paper. Remove a page before adding another.');
      return;
    }

    const toProcess = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      setError(`Notice: Only ${availableSlots} more page(s) could be selected (max 5 pages per exam).`);
    } else {
      setError(null);
    }

    const compressed = (await Promise.all(toProcess.map(compressOneImage))).filter(Boolean);
    const newPreviews = compressed.map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      name: f.name,
      size: (f.size / 1024).toFixed(0) + ' KB',
    }));

    setFiles((prev) => [...prev, ...compressed]);
    setPreviews((prev) => [...prev, ...newPreviews]);
    setResult(null);
    setErrorRawPaperId(null);
  };

  const removeFileAt = (index) => {
    setPreviews((prev) => {
      if (prev[index]?.url) URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const moveFile = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= files.length) return;
    setFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
    setPreviews((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  };

  const clearAllFiles = () => {
    previews.forEach((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
    });
    setFiles([]);
    setPreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    // Snapshot the FileList synchronously — Android WebView clears it after
    // an async yield, so we must grab the array before any await.
    const snapshotted = e.target.files ? Array.from(e.target.files) : [];
    // Reset the input value so the same file can be re-selected after removal,
    // and so the camera can be opened again without a stale value blocking it.
    e.target.value = '';
    if (snapshotted.length > 0) {
      addFiles(snapshotted); // deliberately not awaited — state updates are batched
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      await addFiles(e.dataTransfer.files);
    }
  };

  // NOTE: the camera <input capture="environment"> is embedded INSIDE the Take Photo
  // button using the overlay pattern (opacity:0, absolute fill). This means the user's
  // finger tap lands directly on the real input element — a genuine user gesture —
  // which prevents the Android/Capacitor WebView from treating it as a synthetic click
  // and doing a full page reload when the camera app returns.

  // ── Poll /api/exam/paper-status/:rawPaperId until done or failed ──
  const pollForPaperStatus = async (rawPaperId, { intervalMs = 3000, maxAttempts = 60 } = {}) => {
    const headers = await authHeader();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}/api/exam/paper-status/${rawPaperId}`, { headers });
        if (!res.ok) { await new Promise((r) => setTimeout(r, intervalMs)); continue; }
        const data = await res.json();
        if (data.status === 'done') return { success: true, ...data };
        if (data.status === 'failed') return { success: false, error: data.error || 'Extraction failed' };
        // still 'processing' — keep polling
      } catch (_) { /* transient network error */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { success: false, error: 'Timed out waiting for AI extraction (>3 min). Check the Batch tab.' };
  };

const handleUploadAndExtract = async () => {
  if (files.length === 0) return;
  if (!uploadProgramId || !uploadCourse.trim() || !uploadSemester.trim()) {
    setError('Program, course, and semester are all required.');
    setErrorRawPaperId(null);
    return;
  }
  setUploading(true);
  setUploadStage('uploading');
  setError(null);
  setErrorRawPaperId(null);
  try {
    const headers = await authHeader();
    const formData = new FormData();
    // Pass each image under 'papers' and first image under 'paper' for backward compatibility
    files.forEach((f) => {
      formData.append('papers', f);
    });
    formData.append('paper', files[0]);
    formData.append('pagesCount', String(files.length));
    formData.append('programId', uploadProgramId);
    formData.append('course', uploadCourse.trim());
    formData.append('semester', uploadSemester.trim());
    if (uploadYear.trim()) formData.append('year', uploadYear.trim());

    // ── Step 1: upload file (fast — returns 202 immediately) ──
    setUploadStage('uploading');
    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
      method: 'POST', headers, body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Upload failed');
      err.rawPaperId = data.raw_paper_id || null;
      throw err;
    }

    const rawPaperId = data.raw_paper_id;
    console.log('[AdminUpload] Images uploaded successfully. Raw Paper ID:', rawPaperId);

    // ── Step 2: poll for AI extraction completion ──
    setUploadStage('analyzing');
    const statusResult = await pollForPaperStatus(rawPaperId);

    if (!statusResult.success) {
      const err = new Error(statusResult.error);
      err.rawPaperId = rawPaperId;
      throw err;
    }

    // ── Step 3: done ──
    setUploadStage('done');
    clearAllFiles();

    setResult({
      extracted: statusResult.extracted,
      paperId: statusResult.paper_id,
      rawPaperId,
      reviewNote: null,
      documentStatus: 'generating',
    });

    pollForDocument(rawPaperId, (docState) => {
      setResult((prev) => (prev ? { ...prev, documentStatus: docState.status, documentUrl: docState.url } : prev));
    });
  } catch (err) {
    setError(err.message);
    setErrorRawPaperId(err.rawPaperId || null);
  } finally {
    setUploading(false);
    setUploadStage('');
  }
};

// ── PDF upload handlers ───────────────────────────────────────────────────────
const handlePdfDrop = (e) => {
  e.preventDefault();
  setPdfDragOver(false);
  const dropped = e.dataTransfer.files?.[0];
  if (dropped && dropped.type === 'application/pdf') {
    setPdfFile(dropped);
    setPdfResult(null);
    setPdfError(null);
    setPdfErrorRawPaperId(null);
  }
};

const handlePdfFileChange = (e) => {
  const selected = e.target.files?.[0];
  if (selected && selected.type === 'application/pdf') {
    setPdfFile(selected);
    setPdfResult(null);
    setPdfError(null);
    setPdfErrorRawPaperId(null);
  }
};

const handlePdfUpload = async () => {
  if (!pdfFile) return;
  if (!uploadProgramId || !uploadCourse.trim() || !uploadSemester.trim()) {
    setPdfError('Program, course, and semester are all required.');
    setPdfErrorRawPaperId(null);
    return;
  }
  if (pdfFile.size > 10 * 1024 * 1024) {
    setPdfError('PDF file must be under 10 MB.');
    return;
  }

  setPdfUploading(true);
  setPdfUploadStage('uploading');
  setPdfError(null);
  setPdfErrorRawPaperId(null);

  try {
    console.log(`[AdminUpload] Starting PDF upload: "${pdfFile.name}" (${(pdfFile.size / 1024).toFixed(1)} KB)...`);
    const headers = await authHeader();
    const formData = new FormData();
    formData.append('paper', pdfFile);
    formData.append('programId', uploadProgramId);
    formData.append('course', uploadCourse.trim());
    formData.append('semester', uploadSemester.trim());
    if (uploadYear.trim()) formData.append('year', uploadYear.trim());

    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper-pdf`, {
      method: 'POST', headers, body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Upload failed');
      err.rawPaperId = data.raw_paper_id || null;
      throw err;
    }

    const rawPaperId = data.raw_paper_id;
    console.log(`[AdminUpload] PDF accepted. Tracking extraction for paper ID: ${rawPaperId}...`);

    // Poll for AI extraction completion
    setPdfUploadStage('analyzing');
    const statusResult = await pollForPaperStatus(rawPaperId);

    if (!statusResult.success) {
      const err = new Error(statusResult.error);
      err.rawPaperId = rawPaperId;
      throw err;
    }

    console.log('[AdminUpload] PDF extraction complete:', statusResult);
    setPdfUploadStage('done');
    setPdfFile(null);
    if (pdfFileInputRef.current) pdfFileInputRef.current.value = '';

    setPdfResult({
      extracted: statusResult.extracted,
      paperId: statusResult.paper_id,
      rawPaperId,
      reviewNote: null,
      documentStatus: 'generating',
    });

    pollForDocument(rawPaperId, (docState) => {
      setPdfResult((prev) => (prev ? { ...prev, documentStatus: docState.status, documentUrl: docState.url } : prev));
    });
  } catch (err) {
    console.error('[AdminUpload] PDF upload error:', err);
    setPdfError(err.message);
    setPdfErrorRawPaperId(err.rawPaperId || null);
  } finally {
    setPdfUploading(false);
    setPdfUploadStage('');
  }
};

  const handleProcessExisting = async () => {
    const trimmedId = existingPaperId.trim();
    if (!trimmedId) return;
    if (!/^[0-9a-fA-F-]{36}$/.test(trimmedId)) {
      setError('Invalid Paper UUID format (should be 36 characters).');
      setErrorRawPaperId(null);
      return;
    }
    setProcessingExisting(true);
    setError(null);
    setErrorRawPaperId(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`${BASE_URL}/api/exam/batch-upload-past-papers`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperIds: [trimmedId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Processing failed');
      const item = data.results?.[0];
      if (!item || !item.success) throw new Error(item?.error || 'Processing failed');
      const reviewNote = item.flagged_for_review ? `${item.flagged_for_review} flagged for review.` : null;
      setResult({
        extracted: item.extracted,
        paperId: item.paper_id,
        reviewNote,
        reprocessed: true,
        rawPaperId: trimmedId,
        documentStatus: 'generating',
      });
      setExistingPaperId('');

      pollForDocument(trimmedId, (docState) => {
        setResult((prev) => (prev ? { ...prev, documentStatus: docState.status, documentUrl: docState.url } : prev));
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingExisting(false);
    }
  };

  const loadUnprocessed = async () => {
    setLoadingUnprocessed(true);
    setBatchError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`${BASE_URL}/api/exam/unprocessed-papers`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load unprocessed papers');
      setUnprocessed(data.papers || []);
      setSelectedIds(new Set());
    } catch (err) {
      setBatchError(err.message);
    } finally {
      setLoadingUnprocessed(false);
    }
  };

  useEffect(() => {
    if (tab === 'batch') loadUnprocessed();
  }, [tab]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(unprocessed.map((p) => p.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const runBatch = async () => {
    if (selectedIds.size === 0) return;
    setBatchRunning(true);
    setBatchError(null);
    setBatchResults(null);
    setDocStatuses({});
    try {
      const headers = await authHeader();
      const res = await fetch(`${BASE_URL}/api/exam/batch-upload-past-papers`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch processing failed');
      setBatchResults(data.results);

      // ── Remove successfully processed papers from the list immediately ──
      const successIds = new Set(
        (data.results || []).filter((r) => r.success).map((r) => r.id)
      );
      if (successIds.size > 0) {
        setUnprocessed((prev) => prev.filter((p) => !successIds.has(p.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
      }

      data.results.forEach((r) => {
        if (r.success) {
          setDocStatuses((prev) => ({ ...prev, [r.id]: 'generating' }));
          pollForDocument(r.id, (docState) => {
            setDocStatuses((prev) => ({ ...prev, [r.id]: docState.status }));
          });
        }
      });

      // Full refresh in background to ensure list is accurate
      await loadUnprocessed();
    } catch (err) {
      setBatchError(err.message);
    } finally {
      setBatchRunning(false);
    }
  };

  // Jump straight to the batch tab, pre-select the paper that just failed
  // extraction (its raw_paper_id), and refresh the unprocessed list so it's
  // actually present to select — the original is guaranteed to be there
  // since server.js only marks `processed: true` on a successful extraction.
  const handleReprocessFromError = async (rawPaperId) => {
    setError(null);
    setErrorRawPaperId(null);
    setTab('batch');
    await loadUnprocessed();
    setSelectedIds(new Set([rawPaperId]));
  };

  return (
    // ── Shell now forces pure white background and light colour scheme ──
    <div style={shell}>
      {/* ── Header ── */}
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#6b7280', textTransform: 'uppercase', marginBottom: '4px' }}>
            Admin Panel
          </p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Past Paper Extraction
          </h1>
        </div>
        <button
          onClick={() => navigate('/admin/live')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: '#059669',
            color: '#ffffff',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(5,150,105,0.25)',
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399', animation: 'pulse 1.5s infinite' }}></span>
          <span>Live Users Command Center</span>
        </button>
      </div>

      {/* ── Tabs ── Principle 4: visual rhythm, clear active state ── */}
      <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', borderRadius: '10px', padding: '4px', marginBottom: '28px' }}>
        {[['single', 'Single Upload'], ['batch', 'Batch Process']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              padding: '8px 16px',
              border: 'none',
              borderRadius: '7px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              transition: 'all 0.15s ease',
              background: tab === key ? '#fff' : 'transparent',
              color: tab === key ? '#111827' : '#6b7280',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {label}
            {key === 'batch' && unprocessed.length > 0 && (
              <span style={{
                marginLeft: '6px', background: tab === 'batch' ? '#2563eb' : '#d1d5db',
                color: tab === 'batch' ? '#fff' : '#6b7280',
                borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 700,
                padding: '1px 7px',
              }}>
                {unprocessed.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'single' && (
        <>
          {/* ── Upload Type Toggle ── */}
          <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', borderRadius: '10px', padding: '4px', marginBottom: '16px' }}>
            {[['image', '🖼️ Image'], ['pdf', '📄 PDF']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setUploadType(key); setResult(null); setError(null); setPdfResult(null); setPdfError(null); }}
                style={{
                  flex: 1, padding: '8px 16px', border: 'none', borderRadius: '7px',
                  cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
                  transition: 'all 0.15s ease',
                  background: uploadType === key ? '#fff' : 'transparent',
                  color: uploadType === key ? '#111827' : '#6b7280',
                  boxShadow: uploadType === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Shared metadata fields ── */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <select value={uploadProgramId} onChange={e => setUploadProgramId(e.target.value)} style={{ ...uuidInput, flex: '1 1 140px', fontFamily: 'inherit' }}>
              <option value="">Program…</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="text" placeholder="Course name…" value={uploadCourse} onChange={e => setUploadCourse(e.target.value)} style={{ ...uuidInput, flex: '1 1 140px', fontFamily: 'inherit' }} />
            <input type="text" placeholder="Semester…" value={uploadSemester} onChange={e => setUploadSemester(e.target.value)} style={{ ...uuidInput, flex: '1 1 80px', fontFamily: 'inherit' }} />
            <input type="text" placeholder="Year (optional)…" value={uploadYear} onChange={e => setUploadYear(e.target.value)} style={{ ...uuidInput, flex: '1 1 110px', fontFamily: 'inherit' }} />
          </div>

          {/* ── IMAGE UPLOAD (MULTIPLE PAGES UP TO 5) ── */}
          {uploadType === 'image' && (
            <Section title="Upload Exam Pages (Up to 5 Images)">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => previews.length === 0 && !uploading && fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? '#2563eb' : previews.length > 0 ? '#d1d5db' : '#d1d5db'}`,
                  borderRadius: '12px',
                  background: dragOver ? '#eff6ff' : previews.length > 0 ? '#fafafa' : '#fafafa',
                  transition: 'all 0.15s ease',
                  cursor: previews.length > 0 || uploading ? 'default' : 'pointer',
                  padding: previews.length > 0 || uploading ? '20px' : '40px 20px',
                  textAlign: 'center',
                }}
              >
                {uploading ? (
                  <div style={{ padding: '16px 12px', textAlign: 'left', maxWidth: '420px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                      <Spinner />
                      <span style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '0.95rem' }}>
                        AI Processing {files.length} Exam Page(s) in Progress
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: uploadStage === 'uploading' ? '#2563eb' : '#059669', fontWeight: uploadStage === 'uploading' ? 600 : 400 }}>
                        <span>{uploadStage === 'uploading' ? '⏳' : '✅'}</span>
                        <span>Step 1: Storing {files.length} exam image(s)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: uploadStage === 'analyzing' ? '#2563eb' : uploadStage === 'done' ? '#059669' : '#9ca3af', fontWeight: uploadStage === 'analyzing' ? 600 : 400 }}>
                        <span>{uploadStage === 'analyzing' ? '🧠' : uploadStage === 'done' ? '✅' : '⚪'}</span>
                        <span>Step 2: AI reading all pages, tables & cropping diagrams...</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: uploadStage === 'done' ? '#059669' : '#9ca3af', fontWeight: uploadStage === 'done' ? 600 : 400 }}>
                        <span>{uploadStage === 'done' ? '✅' : '⚪'}</span>
                        <span>Step 3: Storing verified questions in database</span>
                      </div>
                    </div>
                  </div>
                ) : previews.length === 0 ? (
                  <div>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🖼️</div>
                    <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                      Drop exam images here, or choose 1 to 5 pages
                    </p>
                    <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 16px' }}>
                      Multi-page exams supported (Max 5 images: PNG, JPG, WEBP)
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} style={btnPrimary}>
                        Choose Pages from Gallery
                      </button>
                      {/* ── Take Photo button: the <input capture> is embedded INSIDE the button
                          with opacity:0 and absolute fill so the user's tap lands directly on
                          the real file input — a genuine user gesture. This prevents the
                          Android/Capacitor WebView page-reload bug caused by programmatic
                          .click() calls on hidden capture inputs. ── */}
                      <button
                        type="button"
                        style={{ ...btnSecondary, position: 'relative', overflow: 'hidden' }}
                      >
                        📷 Take Photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleFileChange}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            opacity: 0,
                            cursor: 'pointer',
                            width: '100%',
                            height: '100%',
                            fontSize: 0,
                          }}
                        />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ textAlign: 'left' }}>
                        <span style={{ fontWeight: 700, color: '#111827', fontSize: '0.92rem' }}>
                          {previews.length} of 5 Exam Pages Selected
                        </span>
                        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                          Drag or use arrows to order pages. The AI will extract all questions across these pages.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {previews.length < 5 && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ ...btnSecondary, padding: '5px 12px', fontSize: '0.78rem' }}
                          >
                            + Add Page ({5 - previews.length} left)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={clearAllFiles}
                          style={{ ...btnGhost, padding: '5px 10px', fontSize: '0.78rem' }}
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Multi-page grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                      {previews.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: '1px solid #e5e7eb',
                            borderRadius: '10px',
                            padding: '8px',
                            background: '#ffffff',
                            position: 'relative',
                            textAlign: 'left',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          }}
                        >
                          <div style={{ position: 'relative', height: '110px', overflow: 'hidden', borderRadius: '6px', background: '#f3f4f6', marginBottom: '6px' }}>
                            <img
                              src={item.url}
                              alt={`Page ${idx + 1}`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <span
                              style={{
                                position: 'absolute',
                                top: '4px',
                                left: '4px',
                                background: 'rgba(17, 24, 39, 0.85)',
                                color: '#ffffff',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              Page {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFileAt(idx)}
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                background: '#ef4444',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                              }}
                              title="Remove page"
                            >
                              ✕
                            </button>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65px' }}>
                              {item.size}
                            </span>
                            <div style={{ display: 'flex', gap: '3px' }}>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveFile(idx, idx - 1)}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '0.7rem',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  background: idx === 0 ? '#f3f4f6' : '#ffffff',
                                  cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                  color: idx === 0 ? '#9ca3af' : '#111827',
                                }}
                                title="Move earlier"
                              >
                                ◀
                              </button>
                              <button
                                type="button"
                                disabled={idx === previews.length - 1}
                                onClick={() => moveFile(idx, idx + 1)}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '0.7rem',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  background: idx === previews.length - 1 ? '#f3f4f6' : '#ffffff',
                                  cursor: idx === previews.length - 1 ? 'not-allowed' : 'pointer',
                                  color: idx === previews.length - 1 ? '#9ca3af' : '#111827',
                                }}
                                title="Move later"
                              >
                                ▶
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Add page slot if under limit */}
                      {previews.length < 5 && (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            border: '2px dashed #d1d5db',
                            borderRadius: '10px',
                            minHeight: '140px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#6b7280',
                            background: '#fafafa',
                            padding: '12px',
                          }}
                        >
                          <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>➕</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Add Page {previews.length + 1}</span>
                          <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>up to 5</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleUploadAndExtract}
                        disabled={uploading}
                        style={{ ...btnPrimary, background: uploading ? '#93c5fd' : '#2563eb', cursor: uploading ? 'not-allowed' : 'pointer', padding: '10px 20px', fontSize: '0.9rem' }}
                      >
                        Upload & Extract All {previews.length} Pages
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" id="gallery-input" accept="image/*" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            </Section>
          )}

          {/* ── PDF UPLOAD ── */}
          {uploadType === 'pdf' && (
            <Section title="Upload Exam PDF">
              <p style={hint}>
                Upload a past exam paper PDF (digital or scanned, max 10 MB). The AI will process all pages, extract tables, format mathematics, and save questions to the database.
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setPdfDragOver(true); }}
                onDragLeave={() => setPdfDragOver(false)}
                onDrop={handlePdfDrop}
                onClick={() => !pdfFile && !pdfUploading && pdfFileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${pdfDragOver ? '#7c3aed' : pdfFile ? '#d1d5db' : '#d1d5db'}`,
                  borderRadius: '12px',
                  background: pdfDragOver ? '#f5f3ff' : pdfFile ? '#fafafa' : '#fafafa',
                  transition: 'all 0.15s ease',
                  cursor: pdfFile || pdfUploading ? 'default' : 'pointer',
                  padding: pdfFile || pdfUploading ? '20px' : '40px 20px',
                  textAlign: 'center',
                }}
              >
                {pdfUploading ? (
                  <div style={{ padding: '16px 12px', textAlign: 'left', maxWidth: '420px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                      <Spinner />
                      <span style={{ fontWeight: 700, color: '#6d28d9', fontSize: '0.95rem' }}>AI PDF Extraction in Progress</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: pdfUploadStage === 'uploading' ? '#7c3aed' : '#059669', fontWeight: pdfUploadStage === 'uploading' ? 600 : 400 }}>
                        <span>{pdfUploadStage === 'uploading' ? '⏳' : '✅'}</span>
                        <span>Step 1: Uploading PDF to storage</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: pdfUploadStage === 'analyzing' ? '#7c3aed' : pdfUploadStage === 'done' ? '#059669' : '#9ca3af', fontWeight: pdfUploadStage === 'analyzing' ? 600 : 400 }}>
                        <span>{pdfUploadStage === 'analyzing' ? '🧠' : pdfUploadStage === 'done' ? '✅' : '⚪'}</span>
                        <span>Step 2: AI reading all pages & extracting tables (may take ~30-45s)...</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: pdfUploadStage === 'done' ? '#059669' : '#9ca3af', fontWeight: pdfUploadStage === 'done' ? 600 : 400 }}>
                        <span>{pdfUploadStage === 'done' ? '✅' : '⚪'}</span>
                        <span>Step 3: Storing verified questions in database</span>
                      </div>
                    </div>
                  </div>
                ) : !pdfFile ? (
                  <div>
                    <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>📄</div>
                    <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                      Drop a PDF here, or choose one
                    </p>
                    <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 16px' }}>
                      Digital or scanned PDF · Max 10 MB
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); pdfFileInputRef.current?.click(); }}
                      style={{ ...btnPrimary, background: '#7c3aed' }}
                    >
                      Choose PDF
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '10px', background: '#f5f3ff',
                      border: '1px solid #ddd6fe', flexShrink: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.6rem',
                    }}>
                      📄
                    </div>
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <p style={{ fontWeight: 600, color: '#111827', margin: '0 0 2px', fontSize: '0.9rem', wordBreak: 'break-all' }}>{pdfFile.name}</p>
                      <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '0 0 12px' }}>
                        {(pdfFile.size / 1024).toFixed(0)} KB · PDF
                      </p>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={handlePdfUpload}
                          disabled={pdfUploading}
                          style={{ ...btnPrimary, background: pdfUploading ? '#c4b5fd' : '#7c3aed', cursor: pdfUploading ? 'not-allowed' : 'pointer' }}
                        >
                          Upload & Extract
                        </button>
                        <button onClick={() => { setPdfFile(null); if (pdfFileInputRef.current) pdfFileInputRef.current.value = ''; }} style={btnGhost}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <input ref={pdfFileInputRef} type="file" accept="application/pdf" onChange={handlePdfFileChange} style={{ display: 'none' }} />
            </Section>
          )}

          {/* ── Reprocess section ── */}
          <Section title="Reprocess Existing Paper" style={{ marginTop: '16px' }}>
            <p style={hint}>
              Downloads the original image and creates a <strong>new</strong> set of extracted questions,
              using the program/course/semester already stored for that paper.
              The original paper remains unchanged. For multiple papers, use the Batch tab.
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Paste Paper UUID here…"
                value={existingPaperId}
                onChange={(e) => setExistingPaperId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleProcessExisting()}
                style={uuidInput}
                aria-label="Existing paper UUID"
                spellCheck={false}
              />
              <button
                onClick={handleProcessExisting}
                disabled={processingExisting || !existingPaperId.trim()}
                style={{
                  ...btnPrimary,
                  opacity: processingExisting || !existingPaperId.trim() ? 0.5 : 1,
                  cursor: processingExisting || !existingPaperId.trim() ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {processingExisting ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Spinner /> Processing…</span>
                ) : 'Reprocess'}
              </button>
            </div>
          </Section>

          {/* ── Status messages ── */}
          {result && <SuccessBanner result={result} onDismiss={() => setResult(null)} />}
          {error && (
            <ErrorBanner
              message={error}
              onDismiss={() => { setError(null); setErrorRawPaperId(null); }}
              rawPaperId={errorRawPaperId}
              onReprocess={handleReprocessFromError}
            />
          )}
          {pdfResult && <SuccessBanner result={pdfResult} onDismiss={() => setPdfResult(null)} />}
          {pdfError && (
            <ErrorBanner
              message={pdfError}
              onDismiss={() => { setPdfError(null); setPdfErrorRawPaperId(null); }}
              rawPaperId={pdfErrorRawPaperId}
              onReprocess={handleReprocessFromError}
            />
          )}
        </>
      )}



      {tab === 'batch' && (

        <div>
          {/* ── Toolbar ── */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={loadUnprocessed} disabled={loadingUnprocessed} style={btnSecondary}>
              {loadingUnprocessed ? <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Spinner dark /> Refreshing…</span> : '↻ Refresh'}
            </button>
            {unprocessed.length > 0 && (
              <>
                <button onClick={selectAll} style={btnGhost}>Select All</button>
                {selectedIds.size > 0 && <button onClick={clearSelection} style={btnGhost}>Clear</button>}
              </>
            )}
            <div style={{ flex: 1 }} />
            {selectedIds.size > 0 && (
              <button
                onClick={runBatch}
                disabled={batchRunning}
                style={{
                  ...btnPrimary,
                  background: batchRunning ? '#93c5fd' : '#2563eb',
                  cursor: batchRunning ? 'not-allowed' : 'pointer',
                }}
              >
                {batchRunning
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Spinner /> Processing {selectedIds.size}…</span>
                  : `Process ${selectedIds.size} selected`}
              </button>
            )}
          </div>

          <p style={{ ...hint, marginBottom: '12px' }}>
            Processes 2 papers at a time in the background, using each paper's already-stored
            program/course — you can leave this page and check back.
          </p>

          {/* ── Principle 4: category list with visual rhythm ── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
            {loadingUnprocessed ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
                <Spinner dark /> <span style={{ marginLeft: '8px' }}>Loading papers…</span>
              </div>
            ) : unprocessed.length === 0 ? (
              /* ── Empty state: principle 1 — meet the user where they are ── */
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✅</div>
                <p style={{ fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>All caught up</p>
                <p style={{ fontSize: '0.85rem', color: '#9ca3af', margin: 0 }}>No unprocessed papers in storage.</p>
              </div>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {unprocessed.map((p, i) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 16px',
                      borderBottom: i < unprocessed.length - 1 ? '1px solid #f3f4f6' : 'none',
                      cursor: 'pointer',
                      background: selectedIds.has(p.id) ? '#eff6ff' : '#fff',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      style={{ width: '16px', height: '16px', accentColor: '#2563eb', flexShrink: 0 }}
                    />
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, border: '1px solid #e5e7eb' }}
                      />
                    ) : (
                      <div style={{ width: '44px', height: '44px', borderRadius: '6px', background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                        📄
                      </div>
                    )}
                    {/* ── Show paper ID, semester, course, program ── */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {p.id}
                      </span>
                      <div style={{ fontSize: '0.7rem', color: '#374151', display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
                        {p.semester && <span>Semester: {p.semester}</span>}
                        {p.course && <span>Course: {p.course}</span>}
                        {p.program && <span>Program: {p.program}</span>}
                        {!p.course_id && <span style={{ color: '#b45309' }}>⚠️ No course_id (upload via Single tab to fix)</span>}
                        {p.processing_status === 'processing' && (
                          <span style={{ color: '#2563eb', fontWeight: 600 }}>⏳ Currently processing…</span>
                        )}
                        {p.processing_status === 'failed' && (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>❌ Extraction failed — select to retry</span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {batchError && <ErrorBanner message={batchError} onDismiss={() => setBatchError(null)} style={{ marginTop: '16px' }} />}

          {/* ── Principle 3: visual results, not a data dump ── */}
          {batchResults && (
            <div style={{ marginTop: '20px' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase', marginBottom: '10px' }}>
                Batch Results
              </p>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
                {batchResults.map((r, i) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 16px',
                      borderBottom: i < batchResults.length - 1 ? '1px solid #f3f4f6' : 'none',
                      background: r.success ? '#f0fdf4' : '#fef2f2',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{r.success ? '✅' : '❌'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#374151', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.id}
                      </p>
                      {r.success ? (
                        <>
                          <p style={{ fontSize: '0.8rem', color: '#15803d', margin: 0 }}>
                            {r.extracted} questions extracted
                            {r.flagged_for_review ? ` · ${r.flagged_for_review} flagged for review` : ''}
                          </p>
                          {docStatuses[r.id] && (
                            <p style={{
                              fontSize: '0.75rem',
                              margin: '2px 0 0',
                              color: docStatuses[r.id] === 'ready' ? '#15803d' : docStatuses[r.id] === 'failed' ? '#dc2626' : '#6b7280',
                            }}>
                              {docStatuses[r.id] === 'generating' && '⏳ Document generating…'}
                              {docStatuses[r.id] === 'ready' && '📄 Document ready'}
                              {docStatuses[r.id] === 'failed' && '❌ Document generation failed'}
                              {docStatuses[r.id] === 'timeout' && '⚠️ Still generating (check later)'}
                            </p>
                          )}
                        </>
                      ) : (
                        <p style={{ fontSize: '0.8rem', color: '#dc2626', margin: 0 }}>{r.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Section = ({ title, children, style }) => (
  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px', ...style }}>
    <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af', margin: '0 0 14px' }}>
      {title}
    </p>
    {children}
  </div>
);

// Principle 3: confident status — answers the question before it's asked
const SuccessBanner = ({ result, onDismiss }) => (
  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '16px', marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
    <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>✅</span>
    <div style={{ flex: 1 }}>
      <p style={{ fontWeight: 700, color: '#15803d', margin: '0 0 2px', fontSize: '0.9rem' }}>
        {result.reprocessed ? 'Paper reprocessed successfully' : 'Extraction complete'}
      </p>
      <p style={{ color: '#166534', margin: 0, fontSize: '0.85rem' }}>
        {result.extracted} questions extracted · Paper ID:{' '}
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{result.paperId}</span>
        {result.reviewNote && <span style={{ color: '#b45309' }}> · ⚠️ {result.reviewNote}</span>}
      </p>
      {result.documentStatus === 'generating' && (
        <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: '0.8rem' }}>⏳ Generating printable document…</p>
      )}
      {result.documentStatus === 'ready' && (
        <p style={{ color: '#166534', margin: '6px 0 0', fontSize: '0.8rem' }}>
          📄 Document ready —{' '}
          <a href={result.documentUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>view</a>
        </p>
      )}
      {result.documentStatus === 'failed' && (
        <p style={{ color: '#dc2626', margin: '6px 0 0', fontSize: '0.8rem' }}>
          ❌ Document generation failed. You can retry from the Past Papers page, or re-upload.
        </p>
      )}
      {result.documentStatus === 'timeout' && (
        <p style={{ color: '#b45309', margin: '6px 0 0', fontSize: '0.8rem' }}>
          ⚠️ Still generating — check back on the Past Papers page shortly.
        </p>
      )}
    </div>
    <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem', padding: '0', flexShrink: 0 }}>✕</button>
  </div>
);

// `rawPaperId` / `onReprocess` are optional — only the single-upload
// "no questions extracted" error passes them, since that's the only
// error path where the backend guarantees the original was still saved.
const ErrorBanner = ({ message, onDismiss, style, rawPaperId, onReprocess }) => (
  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '16px', marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start', ...style }}>
    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>❌</span>
    <div style={{ flex: 1 }}>
      <p style={{ color: '#dc2626', margin: 0, fontSize: '0.875rem' }}>{message}</p>
      {rawPaperId && (
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#991b1b' }}>{rawPaperId}</span>
          <button onClick={() => onReprocess?.(rawPaperId)} style={{ ...btnGhost, color: '#2563eb', padding: '2px 8px', fontSize: '0.8rem' }}>
            Reprocess from Batch tab →
          </button>
        </div>
      )}
    </div>
    <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem', padding: '0', flexShrink: 0 }}>✕</button>
  </div>
);

const Spinner = ({ dark }) => (
  <span style={{
    display: 'inline-block', width: '12px', height: '12px',
    border: `2px solid ${dark ? '#d1d5db' : 'rgba(255,255,255,0.3)'}`,
    borderTopColor: dark ? '#374151' : '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  }} />
);

// ── Styles ────────────────────────────────────────────────────────────────────

// ── shell now forces pure white background and light colour scheme ──
const shell = {
  maxWidth: '680px',
  margin: '0 auto',
  padding: '32px 20px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  backgroundColor: '#ffffff',      // pure white
  color: '#111827',               // dark text for contrast
  colorScheme: 'light',           // force light-mode scrollbars & controls
  minHeight: '100vh',             // fill viewport if desired
};

const btnPrimary = {
  padding: '9px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '0.875rem',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const btnSecondary = {
  padding: '9px 18px',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '0.875rem',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const btnGhost = {
  padding: '9px 14px',
  background: 'transparent',
  color: '#6b7280',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '0.875rem',
  fontWeight: 500,
};

const uuidInput = {
  flex: 1,
  minWidth: '200px',
  padding: '9px 12px',
  borderRadius: '8px',
  border: '1px solid #d1d5db',
  fontSize: '0.85rem',
  fontFamily: 'monospace',
  color: '#111827',
  background: '#fff',
  outline: 'none',
};

const hint = {
  fontSize: '0.82rem',
  color: '#9ca3af',
  margin: '0 0 12px',
  lineHeight: 1.5,
};

// Inject spinner keyframe once
if (typeof document !== 'undefined' && !document.getElementById('__spinner_kf')) {
  const s = document.createElement('style');
  s.id = '__spinner_kf';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}

export default AdminUpload;