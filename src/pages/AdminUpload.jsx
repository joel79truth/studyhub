import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';

const BASE_URL = API_BASE_URL;

// ── Principle 5: input method matched to context ──────────────────────────────
// UUID field stays as text input (precise, one-time). File stays as file input.
// Program is now selected by ID (not free-text name) so it can never
// mismatch a database row — see server.js getOrCreateProgram/getOrCreateCourse.
// ─────────────────────────────────────────────────────────────────────────────

const AdminUpload = () => {
  const [tab, setTab] = useState('single');

  // single upload
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Set alongside `error` ONLY when the backend's 400 response for
  // "no valid questions extracted" includes a raw_paper_id — the original
  // image was still saved successfully, so we can offer a one-click
  // reprocess instead of just showing red text with no next step.
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
const [programs, setPrograms] = useState([]); // [{ id, name }]

useEffect(() => {
  fetch(`${BASE_URL}/api/programs`)
    .then(r => r.json())
    .then(d => setPrograms(d.programs || []))
    .catch(() => {});
}, []);




  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

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

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      if (preview) URL.revokeObjectURL(preview);
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
      setResult(null);
      setError(null);
      setErrorRawPaperId(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('image/')) {
      if (preview) URL.revokeObjectURL(preview);
      setFile(dropped);
      setPreview(URL.createObjectURL(dropped));
      setResult(null);
      setError(null);
      setErrorRawPaperId(null);
    }
  };

  const handleCameraCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => handleFileChange(e);
    input.click();
  };

const handleUploadAndExtract = async () => {
  if (!file) return;
  if (!uploadProgramId || !uploadCourse.trim() || !uploadSemester.trim()) {
    setError('Program, course, and semester are all required.');
    setErrorRawPaperId(null);
    return;
  }
  setUploading(true);
  setError(null);
  setErrorRawPaperId(null);
  try {
    const headers = await authHeader();
    const formData = new FormData();
    formData.append('paper', file);
    formData.append('programId', uploadProgramId);
    formData.append('course', uploadCourse.trim());
    formData.append('semester', uploadSemester.trim());
    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
      method: 'POST', headers, body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      // Backend still saves + stores the original image even when zero
      // questions get extracted (see server.js: "No valid questions
      // extracted..." branch), and returns raw_paper_id for that saved
      // record so it can be reprocessed instead of re-uploaded from
      // scratch. Surface it here rather than dropping it on the floor.
      const err = new Error(data.error || 'Upload failed');
      err.rawPaperId = data.raw_paper_id || null;
      throw err;
    }
    const reviewNote = data.flagged_for_review
      ? `${data.flagged_for_review} question(s) flagged for review.`
      : null;
    setResult({
      extracted: data.extracted,
      paperId: data.paper_id,
      rawPaperId: data.raw_paper_id,
      reviewNote,
      documentStatus: 'generating',
    });
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    pollForDocument(data.raw_paper_id, (docState) => {
      setResult((prev) => (prev ? { ...prev, documentStatus: docState.status, documentUrl: docState.url } : prev));
    });
  } catch (err) {
    setError(err.message);
    setErrorRawPaperId(err.rawPaperId || null);
  } finally {
    setUploading(false);
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

      data.results.forEach((r) => {
        if (r.success) {
          setDocStatuses((prev) => ({ ...prev, [r.id]: 'generating' }));
          pollForDocument(r.id, (docState) => {
            setDocStatuses((prev) => ({ ...prev, [r.id]: docState.status }));
          });
        }
      });

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
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#6b7280', textTransform: 'uppercase', marginBottom: '4px' }}>
          Admin Panel
        </p>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
          Past Paper Extraction
        </h1>
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
          {/* ── Upload zone ── Principle 2: guide the moment of intent ── */}
          <Section title="Upload New Image">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
  <select value={uploadProgramId} onChange={e => setUploadProgramId(e.target.value)} style={{ ...uuidInput, flex: '1 1 140px', fontFamily: 'inherit' }}>
    <option value="">Program…</option>
    {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select>
  <input type="text" placeholder="Course name…" value={uploadCourse} onChange={e => setUploadCourse(e.target.value)} style={{ ...uuidInput, flex: '1 1 140px', fontFamily: 'inherit' }} />
  <input type="text" placeholder="Semester…" value={uploadSemester} onChange={e => setUploadSemester(e.target.value)} style={{ ...uuidInput, flex: '1 1 100px', fontFamily: 'inherit' }} />
</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !preview && fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#2563eb' : preview ? '#d1d5db' : '#d1d5db'}`,
                borderRadius: '12px',
                background: dragOver ? '#eff6ff' : preview ? '#fafafa' : '#fafafa',
                transition: 'all 0.15s ease',
                cursor: preview ? 'default' : 'pointer',
                padding: preview ? '16px' : '40px 20px',
                textAlign: 'center',
              }}
            >
              {!preview ? (
                /* ── Empty state: guide the user ── */
                <div>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📄</div>
                  <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                    Drop an image here, or choose one
                  </p>
                  <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 16px' }}>
                    PNG, JPG, WEBP supported
                  </p>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      style={btnPrimary}
                    >
                      Choose from Gallery
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCameraCapture(); }}
                      style={btnSecondary}
                    >
                      Take Photo
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Preview: confirm & act ── */
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <img
                    src={preview}
                    alt="Preview"
                    style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: '1px solid #e5e7eb' }}
                  />
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <p style={{ fontWeight: 600, color: '#111827', margin: '0 0 2px', fontSize: '0.9rem' }}>
                      {file?.name}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '0 0 12px' }}>
                      {file ? (file.size / 1024).toFixed(0) + ' KB' : ''}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleUploadAndExtract}
                        disabled={uploading}
                        style={{ ...btnPrimary, background: uploading ? '#93c5fd' : '#2563eb', cursor: uploading ? 'not-allowed' : 'pointer' }}
                      >
                        {uploading ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Spinner /> Extracting…
                          </span>
                        ) : 'Upload & Extract'}
                      </button>
                      <button
                        onClick={() => { setFile(null); setPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        style={btnGhost}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </Section>

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

          {/* ── Principle 3: confident status messages ── */}
          {result && <SuccessBanner result={result} onDismiss={() => setResult(null)} />}
          {error && (
            <ErrorBanner
              message={error}
              onDismiss={() => { setError(null); setErrorRawPaperId(null); }}
              rawPaperId={errorRawPaperId}
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