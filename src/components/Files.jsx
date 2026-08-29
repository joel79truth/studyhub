// ============================================================
// Files.jsx – Optimized for stability and flickering fixes
// ============================================================
import React, {
  useState, useEffect, useCallback, useMemo, useRef,
  useDeferredValue, memo, useTransition,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useQuery } from '@tanstack/react-query';
import {
  Grid3x3, List, FileText, Download, BookOpen, CheckCircle, RefreshCcw
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────

const getNotePublicUrl = (file) => {
  if (file.storage_type === 'gdrive' && file.filepath) {
    return `https://drive.google.com/file/d/${file.filepath}/view`;
  }
  if (file.filepath && file.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(file.filepath);
    return data?.publicUrl || null;
  }
  return file.url || null;
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

// ─── Fallback Auth Hook ──────────────────────────────────
const useAuthFallback = (skip) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!skip);

  useEffect(() => {
    if (skip) return;
    let mounted = true;

    const fetchProfile = async () => {
      try {
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

// ─── PDF Thumbnail ───────────────────────────────────────
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

// ─── File Card ───────────────────────────────────────────
const FileCard = memo(({ file, onPress, isSelected, isDownloaded, onDownloadComplete }) => {
  const [downloadState, setDownloadState] = useState({ status: 'idle', progress: 0 });
  const publicUrl = useMemo(() => getNotePublicUrl(file), [file]);

  const handleDownload = useCallback(async (e) => {
    e.stopPropagation();
    if (isDownloaded || downloadState.status === 'downloading' || !publicUrl) return;

    setDownloadState({ status: 'downloading', progress: 0 });
    try {
      const response = await fetch(publicUrl);
      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length');
      let receivedLength = 0;
      let chunks = [];

      while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength) {
          const p = Math.round((receivedLength / contentLength) * 100);
          setDownloadState(s => s.progress === p ? s : { ...s, progress: p });
        }
      }

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename || 'document';
      a.click();
      URL.revokeObjectURL(url);
      
      setDownloadState({ status: 'done', progress: 100 });
      onDownloadComplete(file.id);
    } catch (err) {
      setDownloadState({ status: 'idle', progress: 0 });
    }
  }, [file, isDownloaded, downloadState.status, publicUrl, onDownloadComplete]);

  return (
    <div className={`relative bg-white rounded-2xl border-2 transition-all ${
      isSelected ? 'border-blue-500 ring-4 ring-blue-50 shadow-md' : 'border-slate-100 hover:border-blue-100'
    }`}>
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
              {downloadState.status === 'downloading' ? (
                <span className="text-[10px] font-bold text-blue-600">{downloadState.progress}%</span>
              ) : isDownloaded ? (
                <CheckCircle size={14} className="text-green-500" />
              ) : (
                <button onClick={handleDownload} className="p-1 text-slate-400 hover:text-blue-600">
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
  const [, startTransition] = useTransition();

  const needsOwnAuth = !profileProp;
  const { profile: fetchedProfile, loading: authLoading } = useAuthFallback(!needsOwnAuth);
  const profile = profileProp || fetchedProfile;

  const [viewMode, setViewMode] = useState('grid');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  
  const [downloadedIds, setDownloadedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('downloadedFiles') || '[]'); } catch { return []; }
  });

  const { data: files = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['files', profile?.program, profile?.semester, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .ilike('program', `%${profile.program}%`)
        .eq('semester', profile.semester)
        .order('uploaded_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },
    // The crucial fix: Query only runs if we have a profile.
    // If enabled is false, isLoading remains true.
    enabled: !!profile,
    staleTime: 1000 * 60 * 5,
  });

  // Persist downloads
  const markAsDownloaded = useCallback((id) => {
    setDownloadedIds(prev => {
      const next = prev.includes(id) ? prev : [...prev, id];
      localStorage.setItem('downloadedFiles', JSON.stringify(next));
      return next;
    });
  }, []);

  const deferredSearch = useDeferredValue(searchQuery);
  const filteredFiles = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    return files.filter(f => (f.course_name || f.filename || '').toLowerCase().includes(q));
  }, [files, deferredSearch]);

  const handleAction = (file) => {
    if (selectionMode) {
      setSelectedIds(p => p.includes(file.id) ? p.filter(i => i !== file.id) : [...p, file.id]);
      return;
    }
    if (onFileClick) { onFileClick(file); return; }
    const url = getNotePublicUrl(file);
    if (url) navigate('/viewer', { state: { url, filename: file.course_name || file.filename } });
  };

  // ─── UI Logic ───────────────────────────────────────────

  // 1. Show loader while auth is fetching OR while database is fetching for the first time
  if ((needsOwnAuth && authLoading) || (isLoading && !files.length)) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="h-40 bg-slate-50 animate-pulse rounded-2xl" />
        ))}
      </div>
    );
  }

  // 2. Error State
  if (error) {
    return (
      <div className="p-10 text-center bg-red-50 rounded-2xl border border-red-100">
        <p className="text-red-600 font-medium">Failed to load files</p>
        <button onClick={() => refetch()} className="mt-2 text-sm font-bold text-red-700 underline">Retry</button>
      </div>
    );
  }

  // 3. No Files Found (Only show if NOT loading and NOT currently fetching new data)
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
            onPress={() => handleAction(file)}
            isSelected={selectedIds.includes(file.id)}
            isDownloaded={downloadedIds.includes(file.id)}
            onDownloadComplete={markAsDownloaded}
          />
        ))}
      </div>
    </div>
  );
}