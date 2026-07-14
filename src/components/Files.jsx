import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabase';
import { 
  Grid3x3, List, FileText, MoreVertical, 
  Download, Pencil, Copy, Check, X 
} from 'lucide-react';

// ============================================================
// HELPERS
// ============================================================

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const relativeTime = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSeconds = Math.floor((now - date) / 1000);
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const getFileTypeColor = (filename) => {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  const colors = {
    pdf: 'bg-red-100 text-red-700',
    doc: 'bg-blue-100 text-blue-700',
    docx: 'bg-blue-100 text-blue-700',
    ppt: 'bg-orange-100 text-orange-700',
    pptx: 'bg-orange-100 text-orange-700',
    md: 'bg-purple-100 text-purple-700',
    txt: 'bg-gray-100 text-gray-700',
  };
  return colors[ext] || 'bg-gray-100 text-gray-700';
};

// ============================================================
// GET DOWNLOAD URL (handles Supabase + Google Drive)
// ============================================================
const getDownloadUrl = (file) => {
  let url = file.url || null;
  
  // If no direct URL, try file_path from Supabase Storage
  if (!url && file.file_path) {
    const { data: { publicUrl } } = supabase.storage
      .from('notes')
      .getPublicUrl(file.file_path);
    url = publicUrl;
  }

  if (!url) return null;

  // --- Google Drive handling ---
  if (url.includes('drive.google.com')) {
    // Pattern: /d/FILE_ID/
    const match = url.match(/\/d\/(.*?)\//);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    // If it's already a download link
    if (url.includes('export=download')) return url;
    // Fallback: return original (might open in browser)
    return url;
  }

  return url;
};

// ============================================================
// CIRCULAR PROGRESS COMPONENT
// ============================================================
const CircularProgress = ({ progress }) => {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="w-8 h-8 transform -rotate-90">
        <circle
          className="text-gray-200"
          strokeWidth="3"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="16"
          cy="16"
        />
        <circle
          className="text-[#024927] transition-all duration-300"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="16"
          cy="16"
        />
      </svg>
      <span className="absolute text-[10px] font-medium text-[#024927]">
        {progress}%
      </span>
    </div>
  );
};

// ============================================================
// GRID CARD (with circular download button)
// ============================================================
const GridCard = ({ 
  file, 
  onPress, 
  onLongPress, 
  isSelected, 
  isDownloading, 
  progress, 
  onDownload 
}) => {
  const title = file.title || file.filename || 'Untitled';
  const subject = file.subject || 'General';
  const category = file.category || 'Other';
  const updatedAt = file.updated_at || file.created_at || new Date().toISOString();
  const size = file.file_size || 0;
  const fileType = file.filename?.split('.').pop()?.toUpperCase() || 'FILE';

  const accentColors = {
    'Math': 'bg-blue-500',
    'Biology': 'bg-green-500',
    'Physics': 'bg-purple-500',
    'Chemistry': 'bg-yellow-500',
    'English': 'bg-pink-500',
    'History': 'bg-orange-500',
    'General': 'bg-gray-400',
  };
  const accent = accentColors[category] || 'bg-gray-400';

  return (
    <div className="relative group bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      {/* Accent ribbon */}
      <div className={`h-1 w-full ${accent}`}></div>

      {/* Clickable area */}
      <div 
        className="cursor-pointer"
        onClick={onPress}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      >
        <div className="p-3">
          {/* Preview - shorter aspect ratio 4:3 */}
          <div className="relative aspect-[4/3] bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
            <div className="absolute inset-0 p-3 flex flex-col gap-1.5">
              <div className="h-2 w-3/4 bg-gray-200 rounded"></div>
              <div className="h-2 w-full bg-gray-200 rounded"></div>
              <div className="h-2 w-5/6 bg-gray-200 rounded"></div>
              <div className="h-2 w-4/5 bg-gray-200 rounded"></div>
              <div className="h-6 w-3/4 bg-gray-200 rounded mt-1"></div>
            </div>
            <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${getFileTypeColor(file.filename)} backdrop-blur-sm bg-white/80`}>
              {fileType}
            </span>

            {/* --- Circular Download Button (bottom-right) --- */}
            <div className="absolute bottom-2 right-2">
              {isDownloading ? (
                <CircularProgress progress={progress} />
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDownload(file); }}
                  className="w-8 h-8 bg-black hover:bg-gray-800 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105"
                >
                  <Download size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-2">
            <h4 className="text-sm font-semibold text-gray-800 truncate">{title}</h4>
            <p className="text-xs text-gray-500 truncate">{subject}</p>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>{relativeTime(updatedAt)}</span>
              <span>{formatFileSize(size)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-select checkbox */}
      {isSelected !== undefined && (
        <div className="absolute top-2 left-2">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300'
          }`}>
            {isSelected && <Check size={12} />}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// LIST ROW (with circular download button on the right)
// ============================================================
const ListRow = ({ 
  file, 
  onPress, 
  onLongPress, 
  isSelected, 
  isDownloading, 
  progress, 
  onDownload 
}) => {
  const title = file.title || file.filename || 'Untitled';
  const subject = file.subject || 'General';
  const updatedAt = file.updated_at || file.created_at || new Date().toISOString();
  const size = file.file_size || 0;

  return (
    <div className={`relative bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors ${
      isSelected ? 'bg-blue-50' : ''
    }`}>
      <div 
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={onPress}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      >
        <div className="w-8 flex-shrink-0">
          {isSelected !== undefined ? (
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300'
            }`}>
              {isSelected && <Check size={12} />}
            </div>
          ) : (
            <FileText size={20} className="text-gray-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{title}</p>
          <p className="text-xs text-gray-500 truncate">{subject}</p>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-gray-400 flex-shrink-0">
          <span>{relativeTime(updatedAt)}</span>
          <span>{formatFileSize(size)}</span>
        </div>

        {/* Download button (circular) in list row */}
        <div className="flex-shrink-0 ml-2">
          {isDownloading ? (
            <CircularProgress progress={progress} />
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(file); }}
              className="w-8 h-8 bg-black hover:bg-gray-800 text-white rounded-full flex items-center justify-center shadow transition-all duration-200 hover:scale-105"
            >
              <Download size={16} />
            </button>
          )}
        </div>

        <button 
          className="p-1 rounded-full hover:bg-gray-200 transition-colors flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onLongPress(); }}
        >
          <MoreVertical size={16} className="text-gray-500" />
        </button>
      </div>
    </div>
  );
};

// ============================================================
// MAIN FILES COMPONENT
// ============================================================
export default function Files({ searchQuery = '', limit = 6 }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [userProgram, setUserProgram] = useState('');
  
  // Download state per file
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Load user program
  useEffect(() => {
    const fetchUserProgram = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('program')
        .eq('id', user.id)
        .maybeSingle();
      if (profile) setUserProgram(profile.program);
    };
    fetchUserProgram();
  }, []);

  // Load files with limit
  const loadFiles = useCallback(async () => {
    if (!userProgram) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .ilike('program', userProgram.trim())
        .order('uploaded_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      setFiles(data || []);
    } catch (err) {
      console.error('Error loading files:', err);
    } finally {
      setLoading(false);
    }
  }, [userProgram, limit]);

  useEffect(() => {
    if (userProgram) loadFiles();
  }, [userProgram, loadFiles]);

  // Filter by search
  const filteredFiles = useMemo(() => {
    if (!searchQuery) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f => 
      (f.title || f.filename || '').toLowerCase().includes(q) ||
      (f.subject || '').toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  // ---- Interactions ----
  const handleCardPress = (file) => {
    if (selectionMode) {
      toggleSelection(file.id);
      return;
    }
    // Open file in a new tab (preview)
    const url = getDownloadUrl(file);
    if (url) {
      window.open(url, '_blank');
    } else {
      alert('File URL not available.');
    }
  };

  const handleLongPress = (file) => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds([file.id]);
    } else {
      toggleSelection(file.id);
    }
  };

  const toggleSelection = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds([]);
    setContextMenu(null);
  };

  // ---- DOWNLOAD with Progress & Fallback ----
  const handleDownload = async (file) => {
    const downloadUrl = getDownloadUrl(file);
    if (!downloadUrl) {
      alert('No downloadable link found for this file.');
      return;
    }

    // For Google Drive, sometimes fetch fails due to CORS or content-length.
    // We'll try fetch first, but if it fails, we fallback to window.open.
    setDownloadingId(file.id);
    setDownloadProgress(0);

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = response.headers.get('content-length');
      const total = parseInt(contentLength, 10);
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) {
          setDownloadProgress(Math.round((loaded / total) * 100));
        } else {
          // If no content-length, just estimate (max 100)
          const estimated = Math.min(100, Math.round((loaded / (1024 * 1024)) * 5));
          setDownloadProgress(estimated);
        }
      }

      const blob = new Blob(chunks);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = file.filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      setDownloadProgress(100);
      setTimeout(() => setDownloadingId(null), 1200);
    } catch (err) {
      console.warn('Fetch download failed, falling back to window.open:', err);
      // Fallback: open in new tab (works for many services including Google Drive)
      window.open(downloadUrl, '_blank');
      setDownloadingId(null);
    }
  };

  // ---- Context Menu Actions ----
  const contextActions = [
    { 
      label: 'Download', 
      icon: Download, 
      action: (file) => handleDownload(file) 
    },
    { 
      label: 'Rename', 
      icon: Pencil, 
      action: (file) => { alert('Rename coming soon'); } 
    },
    { 
      label: 'Copy Link', 
      icon: Copy, 
      action: (file) => { 
        const url = getDownloadUrl(file);
        if (url) {
          navigator.clipboard.writeText(url);
          alert('Link copied to clipboard!');
        } else {
          alert('No link to copy.');
        }
      } 
    },
  ];

  // ---- Render ----
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm animate-pulse">
            <div className="h-1 w-full bg-gray-200"></div>
            <div className="p-3">
              <div className="aspect-[4/3] bg-gray-100 rounded-lg"></div>
              <div className="mt-2 space-y-1">
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                <div className="h-2 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredFiles.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">
          {files.length === 0 ? 'No notes uploaded yet.' : 'No matches found.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* View toggle + selection controls */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Grid3x3 size={20} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <List size={20} />
          </button>
        </div>

        {selectionMode && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{selectedIds.length} selected</span>
            <button onClick={exitSelectionMode} className="p-1 rounded-full hover:bg-gray-200">
              <X size={16} className="text-gray-500" />
            </button>
          </div>
        )}
      </div>

      {/* Grid / List rendering */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredFiles.map(file => (
            <GridCard
              key={file.id}
              file={file}
              onPress={() => handleCardPress(file)}
              onLongPress={() => handleLongPress(file)}
              isSelected={selectionMode ? selectedIds.includes(file.id) : undefined}
              isDownloading={downloadingId === file.id}
              progress={downloadProgress}
              onDownload={handleDownload}
            />
          ))}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          {filteredFiles.map(file => (
            <ListRow
              key={file.id}
              file={file}
              onPress={() => handleCardPress(file)}
              onLongPress={() => handleLongPress(file)}
              isSelected={selectionMode ? selectedIds.includes(file.id) : undefined}
              isDownloading={downloadingId === file.id}
              progress={downloadProgress}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {/* Bottom action bar for multi-select */}
      {selectionMode && selectedIds.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
          <div className="max-w-md mx-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-3 flex items-center justify-around">
            <button 
              className="p-2 rounded-full hover:bg-gray-100" 
              onClick={() => {
                const first = files.find(f => f.id === selectedIds[0]);
                if (first) handleDownload(first);
              }}
            >
              <Download size={20} className="text-gray-600" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100" onClick={exitSelectionMode}>
              <X size={20} className="text-gray-600" />
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextActions.map((action, i) => (
            <button
              key={i}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              onClick={() => {
                action.action(contextMenu.file);
                setContextMenu(null);
              }}
            >
              <action.icon size={16} />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}