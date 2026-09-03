// ============================================================
// Files.jsx – Aligned to Programs.jsx's data contract.
// See Viewer.jsx: fileId is now also carried in the URL query
// string (?fileId=...) so it survives reload/bookmark — router
// `state` alone is not durable across a hard refresh.
// Now sources from the `notes` table (not `files`), so file.id
// is the SAME id the Viewer's download cache and StudyHub's
// /api/luna/chat backend already understand. This fixes:
//   1. Slow open after download (cache lookup was missing by id)
//   2. "No document is open" in StudyHub chat (fileId was wrong)
// ============================================================
import React, {
  useState, useEffect, useCallback, useMemo, useRef,
  useDeferredValue, memo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useQuery } from '@tanstack/react-query';
import {
  Grid3x3, List, FileText, Download, CheckCircle, RefreshCcw, X
} from 'lucide-react';
import { useIsDownloaded, useDownloadProgress, useDownloadManager } from '../hooks/useDownloadManager';

// ─── Helpers ──────────────────────────────────────────────

// Same shape Programs.jsx's fetchUserNotes() produces — keep these
// two in sync (or better, extract to a shared module).
const mapNote = (n) => ({
  id: n.id,                              // ✅ canonical notes.id — matches Programs.jsx, the download cache, and studyhub-router.js
  filename: n.filename,
  program: n.program,
  semester: n.semester,
  course_name: n.course_name,
  uploaded_at: n.uploaded_at,
  url: n.url || '',
  filepath: n.filepath || '',
  storage_type: n.storage_type || 'supabase',
});

const getNotePublicUrl = (note) => {
  if (note.storage_type === 'gdrive' && note.filepath) {
    return `https://drive.google.com/file/d/${note.filepath}/view`;
  }
  if (note.filepath && note.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(note.filepath);
    if (data?.publicUrl) return data.publicUrl;
  }
  if (note.url && (note.url.startsWith('http://') || note.url.startsWith('https://'))) {
    return note.url;
  }
  return null;
};

const getFileType = (filename) => {
  const ext = String(filename || '').split('.').pop()?.toLowerCase();
  return ext === 'pptx' || ext === 'ppt' ? 'pptx' : 'pdf';
};

const getFileTypeColor = (filename) => {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  const colors = {
    pdf: 'bg-red-50 text-red-700 border-red-100',
    doc: 'bg-blue-50 text-blue-700 border-blue-100',
    docx: 'bg-blue-50 text-blue-700 border-blue-100',
    ppt: 'bg-orange-50 text-orange-700 border-orange-100',
    md: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  };
  return colors[ext] || 'bg-slate-50 text-slate-700 border-slate-100';
};

// ─── Toast ──────────────────────────────────────────────────
function Toast({ message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-xl shadow-lg text-sm">
      {message}
    </div>
  );
}

// ─── Fallback Auth Hook ──────────────────────────────────
const useAuthFallback = (skip) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!skip);

  useEffect(() => {
    if (skip) return;
    let mounted = true;

    const fetchProfile = async () => {
      try {
        setLoading(true); // ✅ re-arm loading on SIGNED_IN refetch, avoids stale-profile flash
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted || !session) {
          if (mounted) setLoading(false);
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (mounted) {
          setProfile(data);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) setLoading(false);
      }
    };

    fetchProfile();
    const { data: listener } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_IN') fetchProfile();
      if (ev === 'SIGNED_OUT' && mounted) { setProfile(null); setLoading(false); }
    });

    return () => { mounted = false; listener?.subscription?.unsubscribe(); };
  }, [skip]);

  return { profile, loading };
};

// ─── PDF Thumbnail ────────────────────────────────────────
const PDFThumbnail = memo(({ url }) => {
  const [thumbnail, setThumbnail] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); }
    }, { threshold: 0.1 });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || !url || thumbnail) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
        const loadingTask = pdfjs.getDocument({ url, disableAutoFetch: true });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) setThumbnail(canvas.toDataURL('image/jpeg', 0.6));
        pdf.destroy();
      } catch (e) { /* silent fail */ }
    })();
    return () => { cancelled = true; };
  }, [isVisible, url, thumbnail]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      {thumbnail ? (
        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
      ) : (
        <FileText size={32} className="text-slate-200" />
      )}
    </div>
  );
});

// ─── File Card ────────────────────────────────────────────
const FileCard = memo(({ file, onPress, onStartDownload, onCancelDownload, onRemoveDownload }) => {
  const isDownloaded = useIsDownloaded(file.id);
  const progress = useDownloadProgress(file.id);
  const isDownloading = progress !== null;
  const fileType = useMemo(() => getFileType(file.filename), [file.filename]);
  const publicUrl = useMemo(() => getNotePublicUrl(file), [file]);

  const handleDownloadTap = useCallback((e) => {
    e.stopPropagation();
    if (isDownloading) {
      onCancelDownload(file.id);
      return;
    }
    if (isDownloaded) {
      onRemoveDownload(file.id);
      return;
    }
    onStartDownload(file, publicUrl, fileType);
  }, [isDownloading, isDownloaded, file, publicUrl, fileType, onStartDownload, onCancelDownload, onRemoveDownload]);

  return (
    <div className="relative bg-white rounded-2xl border-2 border-slate-100 hover:border-blue-100 transition-all">
      <div className="p-3 cursor-pointer" onClick={onPress}>
        <div className="relative aspect-[4/3] bg-slate-50 rounded-xl overflow-hidden border border-slate-50">
          {file.filename?.toLowerCase().endsWith('.pdf') ? (
            <PDFThumbnail url={publicUrl} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileText size={32} className="text-slate-200" />
            </div>
          )}
          <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase ${getFileTypeColor(file.filename)}`}>
            {file.filename?.split('.').pop()}
          </span>
        </div>
        <div className="mt-3">
          <h4 className="text-sm font-bold text-slate-800 truncate">{file.course_name || file.filename}</h4>
          <div className="flex items-center justify-between mt-1">
            <p className="text-[10px] text-slate-400 truncate w-24">{file.program || 'General'}</p>
            <div className="flex items-center">
              {isDownloading ? (
                <button onClick={handleDownloadTap} className="flex items-center gap-1 p-1 text-blue-600" title="Cancel download" aria-label={`Cancel download of ${file.filename}`}>
                  <span className="text-[10px] font-bold tabular-nums">
                    {progress === 'indeterminate' ? '…' : `${progress}%`}
                  </span>
                  <X size={11} />
                </button>
              ) : isDownloaded ? (
                <button onClick={handleDownloadTap} className="p-1 text-green-500 hover:text-red-500" title="Downloaded — tap to remove" aria-label={`Remove download of ${file.filename}`}>
                  <CheckCircle size={14} />
                </button>
              ) : (
                <button onClick={handleDownloadTap} className="p-1 text-slate-400 hover:text-blue-600" title="Download for offline use" aria-label={`Download ${file.filename}`}>
                  <Download size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── Main Component ───────────────────────────────────────
export default function Files({ searchQuery = '', limit = 10, onFileClick, profile: profileProp }) {
  const navigate = useNavigate();

  const needsOwnAuth = !profileProp;
  const { profile: fetchedProfile, loading: authLoading } = useAuthFallback(!needsOwnAuth);
  const profile = profileProp || fetchedProfile;

  const [viewMode, setViewMode] = useState('grid');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [toast, setToast] = useState(null);

  // ✅ FIX #1: source from `notes` (same table Programs.jsx uses), not `files`.
  // This is the table studyhub-router.js and the download cache key off of —
  // reading from a different table meant file.id never matched what those
  // systems expected.
  const { data: files = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['files', profile?.program, profile?.semester, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('id, filename, program, semester, course_name, uploaded_at, url, filepath, storage_type')
        .ilike('program', `%${profile.program}%`)
        .eq('semester', profile.semester)
        .order('uploaded_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).map(mapNote);
    },
    enabled: !!profile,
    staleTime: 1000 * 60 * 5,
  });

  const deferredSearch = useDeferredValue(searchQuery);
  const filteredFiles = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    return files.filter(f => (f.course_name || f.filename || '').toLowerCase().includes(q));
  }, [files, deferredSearch]);

  // ── View a file ──
  const handleFileClick = useCallback((file) => {
    if (selectionMode) {
      setSelectedIds(p => p.includes(file.id) ? p.filter(i => i !== file.id) : [...p, file.id]);
      return;
    }
    if (onFileClick) { onFileClick(file); return; }

    // ✅ FIX #2: file.id is now always the real notes.id — no more
    // fallback chain that could pick a wrong/unrelated id.
    const url = getNotePublicUrl(file);
    if (!url) {
      setToast('File URL not available.');
      return;
    }

    // ✅ fileId travels in the URL (survives reload/bookmark/PWA relaunch),
    // router `state` is only used as a same-session fast-path so the Viewer
    // doesn't have to re-fetch what we already have in hand.
    navigate(`/viewer?fileId=${encodeURIComponent(file.id)}`, {
      state: {
        fileId: file.id,
        filename: file.course_name || file.filename || 'Document',
        fileType: getFileType(file.filename),
        url,
        context: {
          course: file.course_name,
          semester: file.semester,
          program: file.program,
        },
      },
    });
  }, [selectionMode, onFileClick, navigate]);

  // ── Download handlers ──
  const { startDownload, cancelDownload, removeDownload } = useDownloadManager();

  const handleStartDownload = useCallback(async (file, publicUrl, fileType) => {
    if (!publicUrl) { setToast('No downloadable link.'); return; }
    if (fileType === 'pptx') {
      setToast("PowerPoint files can't be saved for offline use yet.");
      return;
    }

    // ✅ FIX #3: pass the full mapped note object (same shape Programs.jsx
    // passes), not a hand-built subset — so the download cache entry looks
    // identical regardless of which page started the download.
    const result = await startDownload(
      file,
      () => publicUrl,
      (u, opts) => fetch(u, opts)
    );

    if (!result.ok && !result.cancelled && result.reason !== 'in_progress') {
      setToast(result.message || `Couldn't download ${file.filename}. Check your connection and try again.`);
    }
  }, [startDownload]);

  const handleCancelDownload = useCallback((fileId) => {
    cancelDownload(fileId);
  }, [cancelDownload]);

  const handleRemoveDownload = useCallback(async (fileId) => {
    const removed = await removeDownload(fileId);
    if (removed) setToast('Download removed.');
  }, [removeDownload]);

  // ── UI states ──
  if ((needsOwnAuth && authLoading) || (isLoading && !files.length)) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="h-40 bg-slate-50 animate-pulse rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 text-center bg-red-50 rounded-2xl border border-red-100">
        <p className="text-red-600 font-medium">Failed to load files</p>
        <button onClick={() => refetch()} className="mt-2 text-sm font-bold text-red-700 underline">Retry</button>
      </div>
    );
  }

  if (!isLoading && !isFetching && filteredFiles.length === 0) {
    return (
      <div className="py-20 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
        <FileText size={48} className="mx-auto text-slate-300 mb-4" />
        <p className="text-slate-500 font-medium">No documents found for {profile?.program} Semester {profile?.semester}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}><Grid3x3 size={16}/></button>
          <button onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}><List size={16}/></button>
        </div>

        <div className="flex items-center gap-2">
          {isFetching && <RefreshCcw size={14} className="animate-spin text-slate-400" />}
          <button
            onClick={() => setSelectionMode(!selectionMode)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all ${selectionMode ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {selectionMode ? `Done (${selectedIds.length})` : 'Select'}
          </button>
        </div>
      </div>

      <div className={viewMode === 'grid' ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" : "flex flex-col gap-2"}>
        {filteredFiles.map(file => (
          <FileCard
            key={file.id}
            file={file}
            onPress={() => handleFileClick(file)}
            onStartDownload={handleStartDownload}
            onCancelDownload={handleCancelDownload}
            onRemoveDownload={handleRemoveDownload}
          />
        ))}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}