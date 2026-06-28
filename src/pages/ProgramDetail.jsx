import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

// ─── Helpers ────────────────────────────────────────────────────────────

const normalize = (t) => (t || '').trim().toLowerCase();

const getExt = (filename) => {
  if (!filename) return '';
  const ext = filename.split('.').pop().toLowerCase();
  return ext.length <= 5 ? ext : '';
};

// Real SVG icons for PDF and PowerPoint
const PDF_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16v16H4V4z" stroke="#e74c3c" />
    <path d="M8 8h8v2H8V8zm0 4h6v2H8v-2zm0 4h4v2H8v-2z" fill="#e74c3c" />
    <text x="12" y="20" fontSize="8" fill="#e74c3c" textAnchor="middle">PDF</text>
  </svg>
);

const PPT_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="4" width="16" height="16" rx="2" stroke="#d35400" />
    <path d="M8 8h8v2H8V8zm0 4h6v2H8v-2zm0 4h4v2H8v-2z" fill="#d35400" />
    <circle cx="16" cy="8" r="2" fill="#d35400" />
  </svg>
);

const getIcon = (filename) => {
  const ext = getExt(filename);
  if (ext === 'pdf') return PDF_ICON;
  if (['ppt', 'pptx'].includes(ext)) return PPT_ICON;
  // Other icons (emojis for simplicity)
  const map = {
    doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', txt: '📄', rtf: '📄',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
    zip: '📦', rar: '📦', '7z': '📦', mp4: '🎬', mp3: '🎵'
  };
  return map[ext] || '📄';
};

const fmtSize = (bytes) => {
  if (!bytes || bytes <= 0) return null;
  const s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), s.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + s[i];
};

const fmtDate = (ds) => {
  if (!ds) return null;
  try {
    const d = new Date(ds);
    if (isNaN(d)) return null;
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    if (diff < 30) return `${Math.floor(diff / 7)} week${diff < 14 ? '' : 's'} ago`;
    if (diff < 365) return `${Math.floor(diff / 30)} month${diff < 60 ? '' : 's'} ago`;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return null; }
};

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── Toast system ──────────────────────────────────────────────────────

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all cursor-pointer flex items-center gap-2 ${
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

// ─── Main Component ──────────────────────────────────────────────────

export default function ProgramDetail() {
  const { program: programParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const query = new URLSearchParams(location.search);
  const programName = programParam || query.get('program') || '';

  // ── State ──
  const [allNotes, setAllNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalUrl, setModalUrl] = useState('');
  const [modalFileName, setModalFileName] = useState('');

  const retryCount = useRef(0);
  const MAX_RETRIES = 3;

  // ── Load notes ──
  const loadNotes = useCallback(async () => {
    if (!programName) {
      navigate('/programs');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/metadata', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const files = Array.isArray(data) ? data : (data.files || []);
      const filtered = files.filter(f => {
        if (!f.program) return false;
        return normalize(f.program) === normalize(programName) ||
               normalize(f.program).includes(normalize(programName));
      });
      setAllNotes(filtered);
      retryCount.current = 0;
    } catch (err) {
      console.error(err);
      if (retryCount.current < MAX_RETRIES) {
        retryCount.current++;
        const delay = retryCount.current * 1500;
        addToast(`Connection error — retrying in ${delay/1000}s… (${retryCount.current}/${MAX_RETRIES})`, 'error');
        setTimeout(loadNotes, delay);
      } else {
        setError('Could not load notes after multiple attempts.');
        addToast('Failed to load notes after multiple attempts.', 'error', 5000);
      }
    } finally {
      setLoading(false);
    }
  }, [programName, navigate]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // ── Search filtering with useMemo for performance ──
  const filteredNotes = useMemo(() => {
    const q = normalize(searchQuery);
    return allNotes.filter(note => {
      const course = normalize(note.course || note.courseName || note.subject || '');
      const name = normalize(note.fileName || note.name || '');
      return !q || course.includes(q) || name.includes(q);
    });
  }, [searchQuery, allNotes]);

  // ── Stats ──
  const stats = useMemo(() => {
    const courses = new Set(
      filteredNotes.map(n => n.course || n.courseName || n.subject || '').filter(Boolean)
    );
    return { total: filteredNotes.length, courses: courses.size };
  }, [filteredNotes]);

  // ── Toast helpers ──
  const addToast = (message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // ── Modal ──
  const openModal = (url, name) => {
    if (!url) {
      addToast('Preview not available for this file.', 'info');
      return;
    }
    setModalUrl(url);
    setModalFileName(name || 'File preview');
    setModalOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalUrl('');
    setModalFileName('');
    document.body.style.overflow = '';
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && modalOpen) closeModal();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modalOpen]);

  // ── Render ──
  if (!programName) return <div>Redirecting...</div>;

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">

      {/* ─── Back Button ─── */}
      <button
        className="fixed top-4 left-4 z-40 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm border border-border shadow-md hover:bg-white hover:shadow-lg transition-all flex items-center justify-center text-xl font-medium text-foreground"
        onClick={() => navigate('/programs')}
        aria-label="Back to Programs"
      >
        ←
      </button>

      {/* ─── Thin Header (no profile) ─── */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-black">Notes</h1>
          <p className="text-xs text-muted-foreground">{programName}</p>
        </div>
        {/* Profile button removed */}
      </header>

      {/* ─── Main Content ─── */}
      <main className="px-4 py-4 space-y-4">

        {/* Stats Row */}
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="bg-white/70 px-3 py-1 rounded-full shadow-sm">📄 {stats.total} notes</span>
          <span className="bg-white/70 px-3 py-1 rounded-full shadow-sm">📚 {stats.courses} courses</span>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <span>🤝</span> Real Lecture notes
        </div>

        {/* Search Bar */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search by course name…"
            className="w-full pl-10 pr-10 py-2 bg-card/50 backdrop-blur-sm border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-foreground placeholder:text-muted-foreground text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search notes by course name"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Results count */}
        {!loading && !error && filteredNotes.length !== allNotes.length && (
          <p className="text-sm text-muted-foreground">
            Showing {filteredNotes.length} of {allNotes.length} notes
          </p>
        )}

        {/* Notes Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            // Skeletons
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-full"></div>
                  <div className="flex-1 h-4 bg-muted rounded"></div>
                </div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
                <div className="flex gap-2">
                  <div className="h-8 bg-muted rounded flex-1"></div>
                  <div className="h-8 bg-muted rounded flex-1"></div>
                </div>
              </div>
            ))
          ) : error ? (
            <div className="col-span-full text-center py-12">
              <div className="text-4xl mb-4">⚠️</div>
              <p className="text-muted-foreground">Could not load notes.<br />Please check your connection and try again.</p>
              <button
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                onClick={loadNotes}
              >
                ↺ Retry
              </button>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <div className="text-4xl mb-4">📭</div>
              <p className="text-muted-foreground">No notes found.<br />Try a different search term.</p>
            </div>
          ) : (
            filteredNotes.map((note) => {
              const fileName = note.fileName || note.filename || note.name || note.title || 'Untitled';
              const fileUrl = note.fileUrl || note.url || note.fileURL || note.link || note.downloadUrl || '';
              const course = note.course || note.courseName || note.subject || '';
              const semester = note.semester || note.sem || note.semesterName || ''; // Semester field
              const uploader = note.uploadedBy || note.uploader || note.uploaderName || note.author || '';
              const uploadDate = note.uploadedAt || note.uploadDate || note.createdAt || note.date || '';
              const fileSize = note.fileSize || note.size || 0;
              const ext = getExt(fileName).toUpperCase();
              const dateStr = fmtDate(uploadDate);
              const sizeStr = fmtSize(fileSize);
              const hasUrl = !!fileUrl;

              return (
                <article key={note.id || fileName + Math.random()} className="bg-card border border-border rounded-xl p-4 hover:shadow-lg transition-all hover:-translate-y-1 flex flex-col">
                  <div className="flex items-start gap-3 mb-2">
                    <span className="text-2xl" aria-hidden="true">{getIcon(fileName)}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{esc(fileName)}</h3>
                      {ext && <span className="inline-block ml-2 px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground">{esc(ext)}</span>}
                    </div>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground flex-1">
                    {course && <div className="flex items-center gap-1"><span>📚</span><span className="truncate">{esc(course)}</span></div>}
                    {semester && <div className="flex items-center gap-1"><span>semester:</span><span>{esc(semester)}</span></div>}
                    {uploader && <div className="flex items-center gap-1"><span>👤</span><span className="truncate">{esc(uploader)}</span></div>}
                    {dateStr && <div className="flex items-center gap-1"><span>🗓</span><time>{esc(dateStr)}</time></div>}
                    {sizeStr && <div className="flex items-center gap-1"><span>💾</span><span>{esc(sizeStr)}</span></div>}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    <button
                      className="flex-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition flex items-center justify-center gap-1"
                      onClick={() => openModal(fileUrl, fileName)}
                      aria-label={`View ${fileName}`}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      View
                    </button>
                    <a
                      className={`flex-1 px-3 py-1.5 text-sm text-center rounded-lg transition flex items-center justify-center gap-1 ${
                        hasUrl ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                      href={hasUrl ? fileUrl : '#'}
                      download={fileName}
                      onClick={(e) => {
                        if (!hasUrl) {
                          e.preventDefault();
                          addToast('Download not available for this file.', 'info');
                        } else {
                          addToast(`Downloading "${fileName}"…`, 'success');
                        }
                      }}
                      aria-label={`Download ${fileName}`}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </a>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </main>

      {/* ─── Modal ─── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeModal}>
          <div className="bg-card rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-medium text-foreground truncate">{modalFileName}</h3>
              <button className="p-1 hover:bg-accent rounded-md transition" onClick={closeModal} aria-label="Close modal">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-2">
              <iframe
                src={modalUrl}
                className="w-full h-full min-h-[400px] rounded-lg"
                title="File viewer"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast Container ─── */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* ─── Scroll to Top ─── */}
      <button
        className={`fixed bottom-20 right-4 z-40 w-10 h-10 rounded-full bg-white shadow-lg border border-border hover:bg-accent transition-all flex items-center justify-center text-xl ${
          typeof window !== 'undefined' && window.scrollY > 400 ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Scroll to top"
      >
        ↑
      </button>

    </div>
  );
}