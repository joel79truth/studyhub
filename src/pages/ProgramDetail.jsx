// ============================================================
// ProgramDetail.jsx – server-side filtered notes query,
// no dead auth/profile fetch, cache-first render.
// ============================================================
import React, {
  useState, useEffect, useMemo, useCallback, useRef,
  useLayoutEffect, useDeferredValue, memo, useTransition,
} from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useQuery } from '@tanstack/react-query';

// ─── Read status hook (localStorage) ─────────────────────
function useReadStatus() {
  const [readFiles, setReadFiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('readFiles') || '{}'); } catch { return {}; }
  });

  const toggleRead = useCallback((fileId) => {
    setReadFiles((prev) => {
      const next = { ...prev, [fileId]: !prev[fileId] };
      try { localStorage.setItem('readFiles', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const isRead = useCallback((fileId) => !!readFiles[fileId], [readFiles]);

  return { toggleRead, isRead };
}

// ─── Helpers ──────────────────────────────────────────────
const normalize = (t) => (t || '').trim().toLowerCase();

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

// ─── File Icon Component ──────────────────────────────────
const FileIcon = memo(({ filename }) => {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
  const iconClass = 'w-6 h-6';

  if (ext === 'pdf') {
    return (
      <svg className={iconClass} viewBox="0 0 48 48">
        <path fill="#E53935" d="M40 45H8c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h22l10 10v30c0 1.1-.9 2-2 2z"/>
        <path fill="#FFCDD2" d="M38.5 14H30V5.5L38.5 14z"/>
        <text x="12" y="34" fontFamily="Arial, sans-serif" fontSize="10" fill="#fff" fontWeight="bold">PDF</text>
      </svg>
    );
  }
  if (['doc', 'docx'].includes(ext)) {
    return (
      <svg className={iconClass} viewBox="0 0 48 48">
        <path fill="#1565C0" d="M40 45H8c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h22l10 10v30c0 1.1-.9 2-2 2z"/>
        <path fill="#BBDEFB" d="M38.5 14H30V5.5L38.5 14z"/>
        <text x="12" y="34" fontFamily="Arial, sans-serif" fontSize="10" fill="#fff" fontWeight="bold">DOC</text>
      </svg>
    );
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return (
      <svg className={iconClass} viewBox="0 0 48 48">
        <path fill="#D84315" d="M40 45H8c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h22l10 10v30c0 1.1-.9 2-2 2z"/>
        <path fill="#FFCCBC" d="M38.5 14H30V5.5L38.5 14z"/>
        <text x="12" y="34" fontFamily="Arial, sans-serif" fontSize="10" fill="#fff" fontWeight="bold">PPT</text>
      </svg>
    );
  }
  if (['xls', 'xlsx'].includes(ext)) {
    return (
      <svg className={iconClass} viewBox="0 0 48 48">
        <path fill="#2E7D32" d="M40 45H8c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h22l10 10v30c0 1.1-.9 2-2 2z"/>
        <path fill="#C8E6C9" d="M38.5 14H30V5.5L38.5 14z"/>
        <text x="12" y="34" fontFamily="Arial, sans-serif" fontSize="10" fill="#fff" fontWeight="bold">XLS</text>
      </svg>
    );
  }
  if (['zip', 'rar', '7z'].includes(ext)) {
    return (
      <svg className={iconClass} viewBox="0 0 48 48">
        <path fill="#FFA000" d="M40 45H8c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h22l10 10v30c0 1.1-.9 2-2 2z"/>
        <path fill="#FFECB3" d="M38.5 14H30V5.5L38.5 14z"/>
        <text x="12" y="34" fontFamily="Arial, sans-serif" fontSize="10" fill="#fff" fontWeight="bold">ZIP</text>
      </svg>
    );
  }
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
});

// ─── FileListItem ─────────────────────────────
const FileListItem = memo(({ file, onFileClick, onDownload, onCopyLink, isRead, onToggleRead }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        close();
      }
    };
    const handleKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const toggleMenu = (e) => {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleAction = (e, action) => {
    e.stopPropagation();
    action(file);
    setMenuOpen(false);
  };

  return (
    <div className="group relative flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-xl hover:bg-white hover:shadow-sm hover:border-blue-100 transition-colors mb-3">
      <div className="w-10 h-10 flex-shrink-0 bg-blue-50/50 rounded-lg flex items-center justify-center border border-blue-100/50">
        <FileIcon filename={file.filename} />
      </div>

      <button
        className="flex-1 min-w-0 text-left cursor-pointer"
        onClick={() => onFileClick(file)}
        aria-label={`Open ${file.filename}`}
      >
        <p className={`text-[15px] font-semibold truncate transition-colors ${isRead ? 'text-gray-400 line-through' : 'text-gray-800 group-hover:text-blue-600'}`}>
          {file.filename || 'Untitled'}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md truncate max-w-[120px] sm:max-w-[200px]">
            {file.course || 'No course'}
          </span>
          {file.semester && (
            <span className="text-xs font-medium px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md">
              {file.semester}
            </span>
          )}
        </div>
      </button>

      <div className="relative">
        <button
          ref={buttonRef}
          className={`p-2 rounded-lg transition-colors active:scale-90 ${menuOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
          onClick={toggleMenu}
          aria-label={`Options for ${file.filename}`}
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-30"
            role="menu"
          >
            <button className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3" onClick={(e) => handleAction(e, onDownload)} role="menuitem">
              ⬇️ Download
            </button>
            <button className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3" onClick={(e) => handleAction(e, onCopyLink)} role="menuitem">
              🔗 Copy Link
            </button>
            <div className="h-px bg-gray-100 my-1 mx-2" />
            <button
              className={`w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 ${isRead ? 'hover:bg-orange-50' : 'hover:bg-green-50'}`}
              onClick={(e) => handleAction(e, onToggleRead)}
              role="menuitem"
            >
              {isRead ? '📖 Mark as Unread' : '✅ Mark as Read'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Toast System ──────────────────────────────────────────
const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-transform active:scale-95 cursor-pointer flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
          toast.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
          'bg-blue-100 text-blue-800 border border-blue-200'
        }`}
        onClick={() => removeToast(toast.id)}
      >
        <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>{toast.message}</span>
      </div>
    ))}
  </div>
);

// ─── Skeleton Loader ──────────────────────────────────────
const NotesSkeleton = memo(() => (
  <div className="space-y-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 animate-pulse flex items-center gap-4">
        <div className="w-10 h-10 bg-gray-200 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
        <div className="w-8 h-8 bg-gray-200 rounded-full" />
      </div>
    ))}
  </div>
));

// ─── Query fn (module scope, filtered server-side by program) ─────
const fetchNotesForProgram = async (programName) => {
  const { data, error } = await supabase
    .from('notes')
    .select('id, filename, program, semester, course_name, size, uploaded_at, url, filepath, storage_type')
    .ilike('program', `%${programName}%`)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((n) => ({
    id: n.id,
    filename: n.filename,
    program: n.program,
    semester: n.semester,
    course: n.course_name,
    size: n.size || '',
    uploadDate: n.uploaded_at ? new Date(n.uploaded_at).toLocaleDateString() : '',
    url: n.url || '',
    filepath: n.filepath || '',
    storage_type: n.storage_type || 'supabase',
  }));
};

const CACHE_PREFIX = 'programDetailNotes:';

// ─── Main Component ─────────────────────────────────────────
export default function ProgramDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { program: programParam } = useParams();
  const query = new URLSearchParams(location.search);
  const programName = programParam || query.get('program') || '';
  const [isPending, startTransition] = useTransition();

  const { toggleRead, isRead } = useReadStatus();

  const [searchQuery, setSearchQuery] = useState(() => {
    try { return sessionStorage.getItem('programDetail_search') || ''; } catch { return ''; }
  });
  const deferredSearch = useDeferredValue(searchQuery);

  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── React Query: notes for THIS program only, filtered server-side ──
  const cacheKey = `${CACHE_PREFIX}${programName}`;
  const {
    data: notes = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['programNotes', programName],
    queryFn: () => fetchNotesForProgram(programName),
    enabled: !!programName,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    initialData: () => {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) : undefined;
      } catch { return undefined; }
    },
  });

  useEffect(() => {
    if (!programName || !notes.length) return;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(notes)); } catch {}
  }, [notes, programName, cacheKey]);

  // ── Filter notes by search only now — program filtering happens
  // server-side, so this is a cheap in-memory pass over an already-small
  // list instead of the whole table. ──
  const filteredNotes = useMemo(() => {
    const q = normalize(deferredSearch);
    if (!q) return notes;
    return notes.filter((note) => {
      const course = normalize(note.course || '');
      const name = normalize(note.filename || '');
      return course.includes(q) || name.includes(q);
    });
  }, [notes, deferredSearch]);

  const stats = useMemo(() => {
    const courses = new Set(filteredNotes.map((n) => n.course).filter(Boolean));
    return { total: filteredNotes.length, courses: courses.size };
  }, [filteredNotes]);

  // ── Scroll restoration ──
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    const savedScroll = sessionStorage.getItem('programDetail_scroll');
    if (savedScroll && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  const saveScroll = useCallback(() => {
    if (scrollRef.current) {
      sessionStorage.setItem('programDetail_scroll', String(scrollRef.current.scrollTop));
    }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem('programDetail_search', searchQuery); } catch {}
  }, [searchQuery]);

  useEffect(() => {
    if (!programName) {
      startTransition(() => navigate('/programs', { replace: true }));
    }
  }, [programName, navigate]);

  if (!programName) return null;

  const handleFileClick = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) {
      addToast('File URL not available.', 'info');
      return;
    }
    navigate('/viewer', { state: { url, filename: file.filename || 'Document' } });
  }, [navigate, addToast]);

  const handleDownload = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) { addToast('No downloadable link.', 'error'); return; }
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('Download started.', 'success');
  }, [addToast]);

  const handleCopyLink = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => addToast('Link copied!', 'success'))
        .catch(() => prompt('Copy this link:', url));
    } else {
      prompt('Copy this link:', url);
    }
  }, [addToast]);

  // Skeleton only for a genuine cold start — cached data renders instantly
  const showSkeleton = isLoading && notes.length === 0;

  return (
    <div
      ref={scrollRef}
      onScroll={saveScroll}
      className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 pb-20 lg:pb-8 w-full flex flex-col overflow-y-auto"
      style={{ maxHeight: '100vh' }}
    >
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/60 shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => startTransition(() => navigate('/programs'))}
            className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md hover:bg-white hover:shadow-lg active:scale-90 transition-all flex items-center justify-center text-xl font-medium text-gray-700"
            aria-label="Back to Programs"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Notes</h1>
            <p className="text-xs text-gray-500">{programName}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="bg-white/70 px-3 py-1 rounded-full shadow-sm text-sm">📄 {stats.total} notes</span>
          <span className="bg-white/70 px-3 py-1 rounded-full shadow-sm text-sm">📚 {stats.courses} courses</span>
        </div>

        <div className="relative mb-6">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search by course name…"
            className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search notes"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 active:scale-90 transition-transform"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {!isLoading && !error && deferredSearch && filteredNotes.length !== notes.length && (
          <p className="text-sm text-gray-500 mb-4">
            Showing {filteredNotes.length} of {notes.length} notes
          </p>
        )}

        {showSkeleton ? (
          <NotesSkeleton />
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-gray-500 mb-4">Could not load notes.</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:scale-95 transition-transform"
            >
              Retry
            </button>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center py-12 bg-white/50 rounded-2xl border border-gray-200 border-dashed">
            <div className="text-4xl mb-4">📭</div>
            <h3 className="text-lg font-semibold text-gray-800">No notes found</h3>
            <p className="text-gray-500 mt-1">Try a different search term.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredNotes.map((file) => (
              <FileListItem
                key={file.id}
                file={file}
                onFileClick={handleFileClick}
                onDownload={handleDownload}
                onCopyLink={handleCopyLink}
                isRead={isRead(file.id)}
                onToggleRead={toggleRead}
              />
            ))}
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}