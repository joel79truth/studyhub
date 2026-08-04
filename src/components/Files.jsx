import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import {
  Grid3x3, List, FileText, Download, BookOpen
} from 'lucide-react';

// ─── HELPERS ──────────────────────────────────────────────

const getNotePublicUrl = (file) => {
  if (file.storage_type === 'gdrive' && file.filepath) {
    return `https://drive.google.com/file/d/${file.filepath}/view`;
  }
  if (file.filepath && file.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(file.filepath);
    if (data?.publicUrl) return data.publicUrl;
  }
  if (file.url && (file.url.startsWith('http://') || file.url.startsWith('https://'))) {
    return file.url;
  }
  return null;
};

const formatFileSize = (bytes) => {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const getFileTypeColor = (filename) => {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  const colors = {
    pdf: 'bg-red-100 text-red-700 border-red-200',
    doc: 'bg-blue-100 text-blue-700 border-blue-200',
    docx: 'bg-blue-100 text-blue-700 border-blue-200',
    ppt: 'bg-orange-100 text-orange-700 border-orange-200',
    pptx: 'bg-orange-100 text-orange-700 border-orange-200',
    md: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    txt: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return colors[ext] || 'bg-gray-100 text-gray-700 border-gray-200';
};

// ─── GRID CARD ─────────────────────────────────────────────

const GridCard = React.memo(({
  file,
  onPress,
  isSelected,
  onDownload,
  isDownloading,
  progress,
  isDownloaded,
}) => {
  const title = file.course_name || file.filename || 'Untitled Document';
  const subject = file.program || 'General Study';
  const fileType = file.filename?.split('.').pop()?.toUpperCase() || 'FILE';

  return (
    <div className={`relative group bg-white rounded-2xl border-2 transition-all duration-300 overflow-hidden ${
      isSelected ? 'border-blue-500 ring-4 ring-blue-50 shadow-lg' : 'border-slate-100 hover:border-blue-200 hover:shadow-md'
    }`}>
      <div className="cursor-pointer" onClick={onPress}>
        <div className="p-3">
          <div className="relative aspect-[4/3] bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex items-center justify-center">
            <div className="absolute inset-0 opacity-10 flex flex-col gap-2 p-4">
              <div className="h-2 w-full bg-slate-900 rounded" />
              <div className="h-2 w-5/6 bg-slate-900 rounded" />
              <div className="h-2 w-full bg-slate-900 rounded" />
              <div className="h-6 w-1/2 bg-slate-900 rounded mt-auto" />
            </div>

            <FileText size={40} className="text-slate-200 group-hover:text-blue-200 transition-colors" />

            <span className={`absolute top-2 left-2 px-2 py-1 rounded-md text-[10px] font-bold border ${getFileTypeColor(file.filename)}`}>
              {fileType}
            </span>

            <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/5 transition-colors flex items-center justify-center">
              <div className="transform translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all">
                <button className="bg-blue-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-2">
                  <BookOpen size={14} /> STUDY
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 px-1">
            <h4 className="text-sm font-bold text-slate-800 truncate leading-tight">{title}</h4>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-slate-500 font-medium truncate">{subject}</p>
              <div className="flex items-center gap-2">
                {isDownloading ? (
                  <div className="text-[10px] font-bold text-blue-600">{progress}%</div>
                ) : isDownloaded ? (
                  <div className="text-[10px] font-bold text-green-600">✓ Downloaded</div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownload(file); }}
                    className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── MAIN COMPONENT ───────────────────────────────────────

export default function Files({ searchQuery = '', limit = 10 }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [userProfile, setUserProfile] = useState(null);

  // Download state per file: { [fileId]: { status: 'idle'|'downloading'|'done', progress: 0 } }
  const [downloadStates, setDownloadStates] = useState({});
  // Downloaded file IDs from localStorage
  const [downloadedIds, setDownloadedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('downloadedFiles') || '[]');
    } catch { return []; }
  });

  // Helper to add a file ID to downloaded list
  const markAsDownloaded = useCallback((fileId) => {
    setDownloadedIds(prev => {
      if (prev.includes(fileId)) return prev;
      const newList = [...prev, fileId];
      localStorage.setItem('downloadedFiles', JSON.stringify(newList));
      return newList;
    });
  }, []);

  // Check if file is already downloaded
  const isFileDownloaded = useCallback((fileId) => downloadedIds.includes(fileId), [downloadedIds]);

  // ─── Auth & Profile ──────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        setUserProfile(profile);
      }
    };
    init();
  }, []);

  // ─── Load Files ──────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .ilike('program', `%${userProfile.program}%`)
        .eq('semester', userProfile.semester)
        .order('uploaded_at', { ascending: false })
        .limit(limit);
      if (!error) setFiles(data || []);
    } finally {
      setLoading(false);
    }
  }, [userProfile, limit]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // ─── File Open ────────────────────────────────────────────
  const handleFileAction = useCallback((file) => {
    if (selectionMode) {
      setSelectedIds(prev =>
        prev.includes(file.id)
          ? prev.filter(id => id !== file.id)
          : [...prev, file.id]
      );
      return;
    }

    const finalUrl = getNotePublicUrl(file);
    if (!finalUrl) {
      alert('File URL not available.');
      return;
    }

    navigate('/viewer', {
      state: {
        url: finalUrl,
        filename: file.course_name || file.filename,
      },
    });
  }, [selectionMode, navigate]);

  // ─── Download with Progress ──────────────────────────────
  const handleDownload = useCallback(async (file) => {
    const fileId = file.id;

    // If already downloaded, do nothing (icon hidden anyway)
    if (isFileDownloaded(fileId)) return;

    const url = getNotePublicUrl(file);
    if (!url) {
      alert('No downloadable link available.');
      return;
    }

    // Set downloading state
    setDownloadStates(prev => ({
      ...prev,
      [fileId]: { status: 'downloading', progress: 0 },
    }));

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Network response was not ok');
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total > 0) {
          const percent = Math.round((loaded / total) * 100);
          setDownloadStates(prev => ({
            ...prev,
            [fileId]: { status: 'downloading', progress: Math.min(percent, 100) },
          }));
        } else {
          // If no content-length, show indeterminate
          setDownloadStates(prev => ({
            ...prev,
            [fileId]: { status: 'downloading', progress: 0 },
          }));
        }
      }

      // Combine chunks into a Blob
      const blob = new Blob(chunks);
      const objectUrl = URL.createObjectURL(blob);

      // Trigger download
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

      // Mark as downloaded
      markAsDownloaded(fileId);
      setDownloadStates(prev => ({
        ...prev,
        [fileId]: { status: 'done', progress: 100 },
      }));
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again.');
      setDownloadStates(prev => {
        const newState = { ...prev };
        delete newState[fileId];
        return newState;
      });
    }
  }, [isFileDownloaded, markAsDownloaded]);

  // ─── Filter ──────────────────────────────────────────────
  const filteredFiles = useMemo(() => {
    if (!searchQuery) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f =>
      (f.course_name || f.filename || '').toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  if (loading) return <LoadingGrid limit={limit} />;

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
          >
            <Grid3x3 size={18} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
          >
            <List size={18} />
          </button>
        </div>

        <button
          onClick={() => setSelectionMode(!selectionMode)}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
            selectionMode ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {selectionMode ? `CANCEL (${selectedIds.length})` : 'SELECT FILES'}
        </button>
      </div>

      {/* File Grid */}
      {filteredFiles.length === 0 ? (
        <div className="py-20 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
          <FileText size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">No documents found for your current semester.</p>
        </div>
      ) : (
        <div className={viewMode === 'grid'
          ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
          : "flex flex-col gap-2"
        }>
          {filteredFiles.map(file => {
            const state = downloadStates[file.id];
            const isDownloading = state?.status === 'downloading';
            const progress = state?.progress || 0;
            const isDownloaded = isFileDownloaded(file.id);

            return (
              <GridCard
                key={file.id}
                file={file}
                onPress={() => handleFileAction(file)}
                isSelected={selectedIds.includes(file.id)}
                onDownload={handleDownload}
                isDownloading={isDownloading}
                progress={progress}
                isDownloaded={isDownloaded}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
const PDFThumbnail = ({ url }) => {
  const [thumbnail, setThumbnail] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef(null);

  // 1. Only start processing when the card is visible on screen
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true);
    }, { threshold: 0.1 });
    
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 2. Generate the thumbnail once visible
  useEffect(() => {
    if (!isVisible || !url || thumbnail) return;

    const generateThumb = async () => {
      try {
        const loadingTask = pdfjs.getDocument({ url, disableAutoFetch: true });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        const viewport = page.getViewport({ scale: 0.3 }); // Small scale for speed
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        setThumbnail(canvas.toDataURL('image/jpeg', 0.7)); // High compression
        pdf.destroy(); // Free memory immediately
      } catch (e) {
        console.error("Thumbnail error", e);
      }
    };
    generateThumb();
  }, [isVisible, url]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-slate-50">
      {thumbnail ? (
        <img src={thumbnail} alt="" className="w-full h-full object-cover animate-in fade-in duration-500" />
      ) : (
        <FileText size={40} className="text-slate-200" />
      )}
    </div>
  );
};
const LoadingGrid = ({ limit }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
    {[...Array(limit)].map((_, i) => (
      <div key={i} className="h-48 bg-slate-100 animate-pulse rounded-2xl" />
    ))}
  </div>
);