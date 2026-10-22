import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  BookOpen,
  Camera,
  Image as ImageIcon,
  UploadCloud,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus
} from 'lucide-react';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';
import { cleanPhoto, buildA4PdfFromPages } from '../services/scannerService';
import { generateFileThumbnail } from '../utils/thumbnailHelper';
import { showNotificationBanner } from '../utils/notificationBannerService';

const BASE_URL = API_BASE_URL;

// ── Principle 5: input method matched to context ──────────────────────────────
// UUID field stays as text input (precise, one-time). File stays as file input.
// Program is now selected by ID (not free-text name) so it can never
// mismatch a database row — see server.js getOrCreateProgram/getOrCreateCourse.
// ─────────────────────────────────────────────────────────────────────────────

const AdminUpload = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
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

// ── Redesign: Content Kind & Source Type ──
const initialKind = location.state?.defaultKind || location.state?.kind || 'paper';
const initialSource = (location.state?.defaultType === 'pdf' || initialKind === 'tutorial') ? 'typed_pdf' : 'photos';
const [contentKind, setContentKind] = useState(initialKind);
const [sourceType, setSourceType] = useState(initialSource);
const [tutorialTitle, setTutorialTitle] = useState('');
const [examType, setExamType] = useState('end_sem'); // 'mid_sem' | 'end_sem' | 'test' | 'assignment'
const [duplicateWarning, setDuplicateWarning] = useState(null);
const [checkingDuplicate, setCheckingDuplicate] = useState(false);
const [uploadProgress, setUploadProgress] = useState(0);

// ── PDF upload state ──────────────────────────────────────────────────────────
const [uploadType, setUploadType] = useState((location.state?.defaultType === 'pdf' || initialKind === 'tutorial') ? 'pdf' : 'image');
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
        if (p?.originalUrl) URL.revokeObjectURL(p.originalUrl);
        if (p?.cleanedUrl && p.cleanedUrl !== p.originalUrl) URL.revokeObjectURL(p.cleanedUrl);
      });
    };
  }, [previews]);

  const authHeader = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { Authorization: `Bearer ${token}` };
  };

  // ── Poll GET /api/exam/paper-document/:pastPaperId until the background
  // PDF generation resolves to 'ready' or 'failed'.
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
          return;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    onUpdate({ status: 'timeout' });
  };

  const addFiles = async (newRawFiles) => {
    if (!newRawFiles || newRawFiles.length === 0) return;
    const incoming = Array.from(newRawFiles).filter((f) => f.type?.startsWith('image/'));
    if (incoming.length === 0) return;

    const availableSlots = 12 - previews.length;
    if (availableSlots <= 0) {
      setError('Maximum 12 pages allowed per upload. Remove a page before adding another.');
      return;
    }

    const toProcess = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      setError(`Notice: Only ${availableSlots} more page(s) could be selected (max 12 pages per upload).`);
    } else {
      setError(null);
    }

    // Create placeholder page items immediately
    const newItems = toProcess.map((f, i) => {
      const url = URL.createObjectURL(f);
      return {
        id: `${Date.now()}_${Math.random()}_${i}`,
        originalFile: f,
        originalBlob: f,
        originalUrl: url,
        cleanedBlob: f,
        cleanedUrl: url,
        useOriginal: false,
        showCleaned: true,
        cleaning: true,
        cleaningStage: 'Loading document scanner…',
        name: f.name,
        size: (f.size / 1024).toFixed(0) + ' KB',
        error: null,
      };
    });

    setPreviews((prev) => [...prev, ...newItems]);
    setResult(null);
    setErrorRawPaperId(null);

    // Process one page at a time with OpenCV in the worker
    for (const item of newItems) {
      try {
        const cleanResult = await cleanPhoto(item.originalFile, (stageInfo) => {
          setPreviews((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, cleaningStage: stageInfo.message } : p))
          );
        });

        setPreviews((prev) =>
          prev.map((p) => {
            if (p.id !== item.id) return p;
            return {
              ...p,
              cleaning: false,
              cleaningStage: '',
              cleanedBlob: cleanResult.cleanedBlob,
              cleanedUrl: cleanResult.cleanedUrl,
              useOriginal: cleanResult.useOriginal || false,
              error: cleanResult.error || null,
              size: ((cleanResult.cleanedBlob?.size || item.originalFile.size) / 1024).toFixed(0) + ' KB',
            };
          })
        );
      } catch (err) {
        setPreviews((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, cleaning: false, useOriginal: true, error: err.message || 'Cleanup error' }
              : p
          )
        );
      }
    }
  };

  const toggleShowCleaned = (id) => {
    setPreviews((prev) =>
      prev.map((p) => (p.id === id ? { ...p, showCleaned: !p.showCleaned } : p))
    );
  };

  const toggleUseOriginal = (id) => {
    setPreviews((prev) =>
      prev.map((p) => (p.id === id ? { ...p, useOriginal: !p.useOriginal } : p))
    );
  };

  const removeFileAt = (index) => {
    setPreviews((prev) => {
      const target = prev[index];
      if (target?.originalUrl) URL.revokeObjectURL(target.originalUrl);
      if (target?.cleanedUrl && target.cleanedUrl !== target.originalUrl) {
        URL.revokeObjectURL(target.cleanedUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const moveFile = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= previews.length) return;
    setPreviews((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  };

  const clearAllFiles = () => {
    previews.forEach((p) => {
      if (p?.originalUrl) URL.revokeObjectURL(p.originalUrl);
      if (p?.cleanedUrl && p.cleanedUrl !== p.originalUrl) {
        URL.revokeObjectURL(p.cleanedUrl);
      }
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

const checkDuplicate = async (courseName, sem, exType, yr) => {
  if (!courseName || !courseName.trim()) return;
  setCheckingDuplicate(true);
  try {
    let query = supabase
      .from('past_paper')
      .select('id, course, semester, exam_type, Mid, year, file_name')
      .ilike('course', courseName.trim());

    if (sem) query = query.eq('semester', String(sem).trim());
    const { data, error: qErr } = await query;
    if (qErr || !data || data.length === 0) {
      setDuplicateWarning(null);
      return;
    }

    const normTargetExType = exType ? exType.toLowerCase() : null;
    const targetYr = yr ? parseInt(yr, 10) : null;

    const matches = data.filter((row) => {
      const rowMid = (row.exam_type || row.Mid || '').toLowerCase();
      let matchExType = true;
      if (normTargetExType) {
        if (normTargetExType === 'end_sem') {
          matchExType = rowMid.includes('end');
        } else if (normTargetExType === 'mid_sem') {
          matchExType = rowMid.includes('mid');
        } else if (normTargetExType === 'test') {
          matchExType = rowMid.includes('test') || rowMid.includes('quiz');
        } else if (normTargetExType === 'assignment') {
          matchExType = rowMid.includes('assign');
        }
      }
      let matchYr = true;
      if (targetYr && row.year) {
        matchYr = targetYr === row.year;
      }
      return matchExType && matchYr;
    });

    if (matches.length > 0) {
      setDuplicateWarning({
        count: matches.length,
        match: matches[0],
      });
    } else {
      setDuplicateWarning(null);
    }
  } catch (err) {
    console.warn('Duplicate check error:', err);
  } finally {
    setCheckingDuplicate(false);
  }
};

const handleUploadAndExtract = async () => {
  if (previews.length === 0) return;
  if (!uploadProgramId || !uploadCourse.trim()) {
    setError('Program and course name are required.');
    setErrorRawPaperId(null);
    return;
  }
  if (contentKind === 'paper' && !uploadSemester.trim()) {
    setError('Semester is required for past papers.');
    setErrorRawPaperId(null);
    return;
  }
  if (contentKind === 'tutorial' && !tutorialTitle.trim()) {
    setError('Tutorial title/number is required (e.g. "Tutorial 1").');
    setErrorRawPaperId(null);
    return;
  }

  // Check if any page is still in the middle of scanner cleaning
  if (previews.some((p) => p.cleaning)) {
    setError('Please wait a moment for all pages to finish scan cleanup.');
    return;
  }

  setUploading(true);
  setUploadStage('compiling');
  setUploadProgress(30);
  setError(null);
  setErrorRawPaperId(null);

  try {
    const cleanCourse = uploadCourse.trim().replace(/\s+/g, '_');
    const pdfFilename = `${cleanCourse}_Exam_${previews.length}pages.pdf`;

    // Step 1: Compile multi-page A4 PDF from cleaned (or original) pages client-side
    const compiledPdfFile = await buildA4PdfFromPages(previews, pdfFilename);
    const firstThumb = previews[0]?.useOriginal ? previews[0]?.originalUrl : (previews[0]?.cleanedUrl || previews[0]?.originalUrl);

    setUploadStage('uploading');
    setUploadProgress(65);

    const headers = await authHeader();
    const formData = new FormData();
    formData.append('paper', compiledPdfFile);
    formData.append('pagesCount', String(previews.length));
    formData.append('programId', uploadProgramId);
    formData.append('course', uploadCourse.trim());
    formData.append('semester', uploadSemester.trim() || '1');
    if (uploadYear.trim()) formData.append('year', uploadYear.trim());
    formData.append('kind', contentKind);
    formData.append('sourceType', 'scan');
    if (firstThumb) formData.append('thumbnailData', firstThumb);
    if (contentKind === 'tutorial') {
      formData.append('title', tutorialTitle.trim());
    } else {
      formData.append('examType', examType);
    }

    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper-pdf`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Upload failed');
      err.rawPaperId = data.raw_paper_id || null;
      throw err;
    }

    const rawPaperId = data.raw_paper_id;
    const progName = programs.find(p => p.id === uploadProgramId)?.name || '';
    setUploadStage('done');
    setUploadProgress(100);
    clearAllFiles();

    // Trigger visual notification banner with the uploaded image
    showNotificationBanner({
      type: contentKind === 'tutorial' ? 'tutorial' : 'paper',
      uploadType: contentKind === 'tutorial' ? 'Tutorial' : 'Past paper',
      title: contentKind === 'tutorial' ? 'New Tutorial Uploaded' : 'New Past Paper Uploaded',
      program: progName,
      course: uploadCourse.trim(),
      semester: uploadSemester.trim() || '1',
      filename: pdfFilename,
      imageUrl: firstThumb || data.thumbnail_url || null,
      url: contentKind === 'tutorial' ? '/tutorials' : '/papers',
    });

    if (contentKind === 'tutorial') {
      queryClient.invalidateQueries({ queryKey: ['tutorialsList'] });
      setResult({
        extracted: 0,
        paperId: rawPaperId,
        rawPaperId,
        reviewNote: null,
        isTutorial: true,
        message: 'Tutorial uploaded successfully.',
      });
      return;
    }

    // Past paper: uploaded with pending status, extraction deferred to Batch tab
    setResult({
      extracted: 0,
      paperId: rawPaperId,
      rawPaperId,
      reviewNote: null,
      message: 'Paper uploaded. Extract it from the Batch tab.',
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
  if (!uploadProgramId || !uploadCourse.trim()) {
    setPdfError('Program and course name are required.');
    setPdfErrorRawPaperId(null);
    return;
  }
  if (contentKind === 'paper' && !uploadSemester.trim()) {
    setPdfError('Semester is required for past papers.');
    setPdfErrorRawPaperId(null);
    return;
  }
  if (contentKind === 'tutorial' && !tutorialTitle.trim()) {
    setPdfError('Tutorial title/number is required (e.g. "Tutorial 1").');
    setPdfErrorRawPaperId(null);
    return;
  }
  if (pdfFile.size > 10 * 1024 * 1024) {
    setPdfError('PDF file must be under 10 MB.');
    return;
  }

  setPdfUploading(true);
  setPdfUploadStage('uploading');
  setUploadProgress(50);
  setPdfError(null);
  setPdfErrorRawPaperId(null);

  try {
    const headers = await authHeader();

    let thumbDataUrl = null;
    try {
      thumbDataUrl = await generateFileThumbnail(pdfFile, 450);
    } catch (tErr) {
      console.warn('[AdminUpload] Failed to generate PDF thumbnail:', tErr);
    }

    const formData = new FormData();
    formData.append('paper', pdfFile);
    formData.append('programId', uploadProgramId);
    formData.append('course', uploadCourse.trim());
    formData.append('semester', uploadSemester.trim() || '1');
    if (uploadYear.trim()) formData.append('year', uploadYear.trim());
    formData.append('kind', contentKind);
    formData.append('sourceType', 'typed_pdf');
    if (thumbDataUrl) formData.append('thumbnailData', thumbDataUrl);
    if (contentKind === 'tutorial') {
      formData.append('title', tutorialTitle.trim());
    } else {
      formData.append('examType', examType);
    }

    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper-pdf`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Upload failed');
      err.rawPaperId = data.raw_paper_id || null;
      throw err;
    }

    const rawPaperId = data.raw_paper_id;
    const progName = programs.find(p => p.id === uploadProgramId)?.name || '';
    setPdfUploadStage('done');
    setUploadProgress(100);
    setPdfFile(null);
    if (pdfFileInputRef.current) pdfFileInputRef.current.value = '';

    // Trigger visual notification banner with the uploaded image
    showNotificationBanner({
      type: contentKind === 'tutorial' ? 'tutorial' : 'paper',
      uploadType: contentKind === 'tutorial' ? 'Tutorial' : 'Past paper',
      title: contentKind === 'tutorial' ? 'New Tutorial Uploaded' : 'New Past Paper Uploaded',
      program: progName,
      course: uploadCourse.trim(),
      semester: uploadSemester.trim() || '1',
      filename: pdfFile.name,
      imageUrl: thumbDataUrl || data.thumbnail_url || null,
      url: contentKind === 'tutorial' ? '/tutorials' : '/papers',
    });

    if (contentKind === 'tutorial') {
      queryClient.invalidateQueries({ queryKey: ['tutorialsList'] });
      setPdfResult({
        extracted: 0,
        paperId: rawPaperId,
        rawPaperId,
        reviewNote: null,
        isTutorial: true,
        message: 'Tutorial uploaded successfully.',
      });
      return;
    }

    // Past paper: uploaded with pending status, extraction deferred to Batch tab
    setPdfResult({
      extracted: 0,
      paperId: rawPaperId,
      rawPaperId,
      reviewNote: null,
      message: 'Paper uploaded. Extract it from the Batch tab.',
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
            background: '#2563eb',
            color: '#ffffff',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(37,99,235,0.25)',
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#93c5fd', animation: 'pulse 1.5s infinite' }}></span>
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
          {/* ── Content Kind Toggle: Past Paper vs Tutorial ── */}
          <div style={{ display: 'flex', gap: '6px', background: '#f3f4f6', borderRadius: '12px', padding: '4px', marginBottom: '16px' }}>
            {[
              { key: 'paper', label: 'Past Paper', icon: FileText, desc: 'Question splitting & quiz practice' },
              { key: 'tutorial', label: 'Tutorial', icon: BookOpen, desc: 'View-first with Ask AI per page' },
            ].map(({ key, label, icon: Icon, desc }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setContentKind(key); setResult(null); setError(null); }}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  border: 'none',
                  borderRadius: '9px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                  background: contentKind === key ? '#ffffff' : 'transparent',
                  color: contentKind === key ? '#111827' : '#6b7280',
                  boxShadow: contentKind === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <Icon size={18} color={contentKind === key ? '#2563eb' : '#6b7280'} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* ── Source Type Selection: Photos vs Typed PDF ── */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => { setSourceType('photos'); setUploadType('image'); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1.5px solid ${sourceType === 'photos' ? '#2563eb' : '#e5e7eb'}`,
                background: sourceType === 'photos' ? '#eff6ff' : '#ffffff',
                color: sourceType === 'photos' ? '#1d4ed8' : '#374151',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Camera size={16} />
              <span>Camera / Photos (up to 12)</span>
            </button>
            <button
              type="button"
              onClick={() => { setSourceType('typed_pdf'); setUploadType('pdf'); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1.5px solid ${sourceType === 'typed_pdf' ? '#2563eb' : '#e5e7eb'}`,
                background: sourceType === 'typed_pdf' ? '#eff6ff' : '#ffffff',
                color: sourceType === 'typed_pdf' ? '#1d4ed8' : '#374151',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <UploadCloud size={16} />
              <span>PDF Document</span>
            </button>
          </div>

          {/* ── Metadata Fields ── */}
          <Section title={contentKind === 'paper' ? 'Past Paper Details' : 'Tutorial Details'} style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={uploadProgramId}
                  onChange={(e) => setUploadProgramId(e.target.value)}
                  style={{ ...uuidInput, flex: '1 1 180px', fontFamily: 'inherit' }}
                >
                  <option value="">Select Program…</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Course name (e.g. Soil Science)…"
                  value={uploadCourse}
                  onChange={(e) => {
                    setUploadCourse(e.target.value);
                    if (contentKind === 'paper') checkDuplicate(e.target.value, uploadSemester, examType, uploadYear);
                  }}
                  onBlur={() => {
                    if (contentKind === 'paper') checkDuplicate(uploadCourse, uploadSemester, examType, uploadYear);
                  }}
                  style={{ ...uuidInput, flex: '2 1 200px', fontFamily: 'inherit' }}
                />
              </div>

              {contentKind === 'paper' ? (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <select
                    value={uploadSemester}
                    onChange={(e) => {
                      setUploadSemester(e.target.value);
                      checkDuplicate(uploadCourse, e.target.value, examType, uploadYear);
                    }}
                    style={{ ...uuidInput, flex: '1 1 120px', fontFamily: 'inherit' }}
                  >
                    <option value="">Semester…</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                      <option key={s} value={String(s)}>Semester {s}</option>
                    ))}
                  </select>

                  <select
                    value={examType}
                    onChange={(e) => {
                      setExamType(e.target.value);
                      checkDuplicate(uploadCourse, uploadSemester, e.target.value, uploadYear);
                    }}
                    style={{ ...uuidInput, flex: '1 1 150px', fontFamily: 'inherit' }}
                  >
                    <option value="end_sem">End of Semester</option>
                    <option value="mid_sem">Mid-Semester</option>
                    <option value="test">Test</option>
                    <option value="assignment">Assignment</option>
                  </select>

                  <input
                    type="text"
                    placeholder="Year (e.g. 2024)…"
                    value={uploadYear}
                    onChange={(e) => {
                      setUploadYear(e.target.value);
                      checkDuplicate(uploadCourse, uploadSemester, examType, e.target.value);
                    }}
                    style={{ ...uuidInput, flex: '1 1 110px', fontFamily: 'inherit' }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Tutorial title / number (e.g. Tutorial 2 - Photosynthesis)…"
                    value={tutorialTitle}
                    onChange={(e) => setTutorialTitle(e.target.value)}
                    style={{ ...uuidInput, flex: '3 1 240px', fontFamily: 'inherit' }}
                  />
                  <select
                    value={uploadSemester}
                    onChange={(e) => setUploadSemester(e.target.value)}
                    style={{ ...uuidInput, flex: '1 1 120px', fontFamily: 'inherit' }}
                  >
                    <option value="1">Semester 1</option>
                    {[2, 3, 4, 5, 6, 7, 8].map((s) => (
                      <option key={s} value={String(s)}>Semester {s}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Duplicate Detection Warning Banner */}
              {contentKind === 'paper' && duplicateWarning && (
                <div style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  marginTop: '4px'
                }}>
                  <AlertTriangle size={20} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ fontSize: '0.84rem', color: '#92400e', lineHeight: 1.4 }}>
                    <strong>Possible Duplicate Warning:</strong> A past paper for <strong>{duplicateWarning.match.course}</strong> (Sem {duplicateWarning.match.semester}, {duplicateWarning.match.Mid || duplicateWarning.match.exam_type}{duplicateWarning.match.year ? ` ${duplicateWarning.match.year}` : ''}) is already in the database.
                    <br />
                    <span style={{ fontSize: '0.78rem', color: '#78350f' }}>You can still proceed if this is a different sitting or revised copy.</span>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* ── IMAGE UPLOAD (MULTIPLE PAGES UP TO 12) ── */}
          {sourceType === 'photos' && (
            <Section title={`Upload Pages (Up to 12 Photos)`}>
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
                        Uploading {previews.length} Page(s)...
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ width: '100%', height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden', marginBottom: '14px' }}>
                      <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#2563eb', transition: 'width 0.3s ease' }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: uploadStage === 'compiling' ? '#2563eb' : '#1d4ed8', fontWeight: uploadStage === 'compiling' ? 600 : 400 }}>
                        {uploadStage === 'compiling' ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle size={15} color="#2563eb" />}
                        <span>Compiling pages into standard A4 PDF</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: uploadStage === 'uploading' ? '#2563eb' : uploadStage === 'done' ? '#1d4ed8' : '#9ca3af', fontWeight: uploadStage === 'uploading' ? 600 : 400 }}>
                        {uploadStage === 'uploading' ? <RefreshCw size={15} className="animate-spin" /> : uploadStage === 'done' ? <CheckCircle size={15} color="#2563eb" /> : <span style={{ width: 15, display: 'inline-block' }}>•</span>}
                        <span>Uploading document to storage</span>
                      </div>
                    </div>
                  </div>
                ) : previews.length === 0 ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                      <ImageIcon size={44} color="#9ca3af" />
                    </div>
                    <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                      Drop pages here, or choose 1 to 12 photos
                    </p>
                    <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 16px' }}>
                      Photos are cleaned with OpenCV scanner and compiled into an A4 PDF
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} style={btnPrimary}>
                        <ImageIcon size={16} /> Choose from Gallery
                      </button>
                      <button
                        type="button"
                        style={{ ...btnSecondary, position: 'relative', overflow: 'hidden' }}
                      >
                        <Camera size={16} /> Take Photo
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
                          {previews.length} of 12 Pages Selected
                        </span>
                        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                          Preview cleaned scans, toggle original, or reorder pages before uploading.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {previews.length < 12 && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ ...btnSecondary, padding: '5px 12px', fontSize: '0.78rem' }}
                          >
                            <Plus size={14} /> Add Page ({12 - previews.length} left)
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                      {previews.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          style={{
                            border: '1px solid #e5e7eb',
                            borderRadius: '10px',
                            padding: '10px',
                            background: '#ffffff',
                            position: 'relative',
                            textAlign: 'left',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          }}
                        >
                          {/* Image preview with before/after toggle */}
                          <div style={{ position: 'relative', height: '140px', overflow: 'hidden', borderRadius: '6px', background: '#f3f4f6', marginBottom: '8px' }}>
                            <img
                              src={item.useOriginal || !item.showCleaned ? item.originalUrl : item.cleanedUrl}
                              alt={`Page ${idx + 1}`}
                              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
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
                            <span
                              style={{
                                position: 'absolute',
                                bottom: '4px',
                                left: '4px',
                                background: item.useOriginal ? '#4b5563' : item.showCleaned ? '#1d4ed8' : '#374151',
                                color: '#ffffff',
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {item.useOriginal ? 'Original' : item.showCleaned ? 'Cleaned' : 'Original view'}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFileAt(idx)}
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                background: '#dc2626',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '50%',
                                width: '22px',
                                height: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                              title="Remove page"
                            >
                              <Trash2 size={12} />
                            </button>

                            {/* Cleaning overlay */}
                            {item.cleaning && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(255, 255, 255, 0.92)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '8px',
                                  textAlign: 'center',
                                }}
                              >
                                <Spinner dark />
                                <span style={{ fontSize: '0.72rem', color: '#1d4ed8', fontWeight: 600, marginTop: '6px' }}>
                                  {item.cleaningStage || 'Cleaning scan…'}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Controls: View Cleaned / View Original toggle & Use original checkbox */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                            {!item.useOriginal && (
                              <button
                                type="button"
                                disabled={item.cleaning}
                                onClick={() => toggleShowCleaned(item.id)}
                                style={{
                                  padding: '3px 6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  background: '#f9fafb',
                                  color: '#1d4ed8',
                                  cursor: item.cleaning ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {item.showCleaned ? 'View Original' : 'View Cleaned'}
                              </button>
                            )}

                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.72rem',
                                color: '#374151',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={item.useOriginal}
                                onChange={() => toggleUseOriginal(item.id)}
                                style={{ accentColor: '#2563eb' }}
                              />
                              <span>Use original</span>
                            </label>
                          </div>

                          {/* Page footer: size & reorder buttons */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid #f3f4f6' }}>
                            <span style={{ fontSize: '0.7rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                                <ChevronLeft size={13} />
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
                                <ChevronRight size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Add page slot if under limit */}
                      {previews.length < 12 && (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            border: '2px dashed #d1d5db',
                            borderRadius: '10px',
                            minHeight: '160px',
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
                          <Plus size={24} color="#6b7280" style={{ marginBottom: '4px' }} />
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Add Page {previews.length + 1}</span>
                          <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>up to 12</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleUploadAndExtract}
                        disabled={uploading || previews.some((p) => p.cleaning)}
                        style={{
                          ...btnPrimary,
                          background: (uploading || previews.some((p) => p.cleaning)) ? '#93c5fd' : '#2563eb',
                          cursor: (uploading || previews.some((p) => p.cleaning)) ? 'not-allowed' : 'pointer',
                          padding: '10px 20px',
                          fontSize: '0.9rem',
                        }}
                      >
                        <UploadCloud size={18} />
                        {contentKind === 'tutorial'
                          ? `Upload Tutorial (${previews.length} Pages)`
                          : `Upload Past Paper (${previews.length} Pages)`}
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
                Upload a past exam paper PDF (digital or scanned, max 10 MB). Extraction is processed from the Batch tab.
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setPdfDragOver(true); }}
                onDragLeave={() => setPdfDragOver(false)}
                onDrop={handlePdfDrop}
                onClick={() => !pdfFile && !pdfUploading && pdfFileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${pdfDragOver ? '#2563eb' : pdfFile ? '#d1d5db' : '#d1d5db'}`,
                  borderRadius: '12px',
                  background: pdfDragOver ? '#eff6ff' : pdfFile ? '#fafafa' : '#fafafa',
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
                      <span style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '0.95rem' }}>Uploading PDF to storage...</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden', marginBottom: '14px' }}>
                      <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#2563eb', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                ) : !pdfFile ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                      <FileText size={40} color="#9ca3af" />
                    </div>
                    <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
                      Drop a PDF here, or choose one
                    </p>
                    <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 16px' }}>
                      Digital or scanned PDF · Max 10 MB
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); pdfFileInputRef.current?.click(); }}
                      style={{ ...btnPrimary, background: '#2563eb' }}
                    >
                      Choose PDF
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: '10px', background: '#eff6ff',
                      border: '1px solid #bfdbfe', flexShrink: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <FileText size={28} color="#2563eb" />
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
                          style={{ ...btnPrimary, background: pdfUploading ? '#93c5fd' : '#2563eb', cursor: pdfUploading ? 'not-allowed' : 'pointer' }}
                        >
                          Upload Past Paper
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
          {result && <SuccessBanner result={result} onDismiss={() => setResult(null)} onGoToBatch={() => setTab('batch')} />}
          {error && (
            <ErrorBanner
              message={error}
              onDismiss={() => { setError(null); setErrorRawPaperId(null); }}
              rawPaperId={errorRawPaperId}
              onReprocess={handleReprocessFromError}
            />
          )}
          {pdfResult && <SuccessBanner result={pdfResult} onDismiss={() => setPdfResult(null)} onGoToBatch={() => setTab('batch')} />}
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
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <CheckCircle size={28} color="#2563eb" />
                </div>
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
                      <div style={{ width: '44px', height: '44px', borderRadius: '6px', background: '#eff6ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileText size={20} color="#2563eb" />
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
                        {!p.course_id && <span style={{ color: '#b45309' }}>Notice: No course_id (upload via Single tab to fix)</span>}
                        {p.processing_status === 'pending' && (
                          <span style={{ color: '#2563eb', fontWeight: 600 }}>Pending extraction</span>
                        )}
                        {p.processing_status === 'processing' && (
                          <span style={{ color: '#2563eb', fontWeight: 600 }}>Currently processing…</span>
                        )}
                        {p.processing_status === 'failed' && (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>Extraction failed — select to retry</span>
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
                      background: r.success ? '#eff6ff' : '#fef2f2',
                    }}
                  >
                    <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      {r.success ? <CheckCircle size={18} color="#2563eb" /> : <XCircle size={18} color="#dc2626" />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#374151', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.id}
                      </p>
                      {r.success ? (
                        <>
                          <p style={{ fontSize: '0.8rem', color: '#1d4ed8', margin: 0, fontWeight: 500 }}>
                            {r.extracted} questions extracted
                            {r.flagged_for_review ? ` · ${r.flagged_for_review} flagged for review` : ''}
                          </p>
                          {docStatuses[r.id] && (
                            <p style={{
                              fontSize: '0.75rem',
                              margin: '2px 0 0',
                              color: docStatuses[r.id] === 'ready' ? '#1d4ed8' : docStatuses[r.id] === 'failed' ? '#dc2626' : '#6b7280',
                            }}>
                              {docStatuses[r.id] === 'generating' && 'Document generating…'}
                              {docStatuses[r.id] === 'ready' && 'Document ready'}
                              {docStatuses[r.id] === 'failed' && 'Document generation failed'}
                              {docStatuses[r.id] === 'timeout' && 'Still generating (check later)'}
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

const SuccessBanner = ({ result, onDismiss, onGoToBatch }) => (
  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px', marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
    <CheckCircle size={22} color="#2563eb" style={{ flexShrink: 0, marginTop: '2px' }} />
    <div style={{ flex: 1 }}>
      <p style={{ fontWeight: 700, color: '#1e40af', margin: '0 0 2px', fontSize: '0.9rem' }}>
        {result.message
          ? result.message
          : result.isTutorial
          ? 'Tutorial uploaded successfully'
          : result.reprocessed
          ? 'Paper reprocessed successfully'
          : 'Paper uploaded. Extract it from the Batch tab.'}
      </p>
      {result.paperId && (
        <p style={{ color: '#1d4ed8', margin: '2px 0 0', fontSize: '0.82rem' }}>
          ID: <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{result.paperId}</span>
          {result.extracted > 0 && <span> · {result.extracted} questions extracted</span>}
        </p>
      )}
      {!result.isTutorial && onGoToBatch && (
        <button
          type="button"
          onClick={onGoToBatch}
          style={{
            marginTop: '8px',
            padding: '5px 12px',
            background: '#ffffff',
            border: '1px solid #bfdbfe',
            borderRadius: '6px',
            color: '#2563eb',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          Go to Batch tab →
        </button>
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
    <XCircle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
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