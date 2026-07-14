import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, File, FileImage, Download, Trash2, X,
  FolderOpen, Calendar, ChevronLeft, MoreVertical,
  Share2, Search
} from 'lucide-react';
import { BottomNav } from "../components/BottomNav";
import { supabase } from '../supabase';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const normalizeName = (name) => String(name || '').trim().toLowerCase();

const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return mb.toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SUB‑COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Course Card (without progress ring) ──────────────────
const CourseCard = ({ course, fileCount, lastOpened, onClick }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-blue-400"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-800 truncate">{course}</h4>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FileText size={12} /> {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
            {lastOpened && (
              <span className="flex items-center gap-1">
                <Calendar size={12} /> Last opened {lastOpened}
              </span>
            )}
          </div>
        </div>
        {/* Simple badge – no percentage circle */}
        <div className="w-10 h-10 flex-shrink-0 ml-2 flex items-center justify-center bg-gray-100 rounded-full text-gray-600 text-xs font-medium">
          {fileCount}
        </div>
      </div>
    </motion.div>
  );
};

// ─── File Row with three‑dot menu (no swipe) ─────────────
const FileRow = ({ file, onOpen, onDownload, onShare, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  // Determine icon
  const ext = file.filename?.split('.').pop()?.toLowerCase() || '';
  let Icon = File;
  let iconColor = 'text-gray-400';
  if (['pdf'].includes(ext)) { Icon = FileText; iconColor = 'text-red-500'; }
  else if (['doc', 'docx'].includes(ext)) { Icon = FileText; iconColor = 'text-blue-500'; }
  else if (['ppt', 'pptx'].includes(ext)) { Icon = FileText; iconColor = 'text-orange-500'; }
  else if (['jpg','jpeg','png','gif'].includes(ext)) { Icon = FileImage; iconColor = 'text-purple-500'; }

  return (
    <div className="relative flex items-center gap-3 p-3 bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(file)}>
        <p className="text-sm font-medium text-gray-800 truncate">{file.filename || 'Untitled'}</p>
        <p className="text-xs text-gray-500 truncate">{file.course || 'No course'}</p>
      </div>
      <div className="text-xs text-gray-400 whitespace-nowrap mr-2">
        {formatFileSize(file.size)}
      </div>
      {/* Three‑dot menu */}
      <div className="relative">
        <button
          className="p-1 rounded-full hover:bg-gray-200 transition-colors"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
        >
          <MoreVertical size={18} className="text-gray-500" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
            <button
              className="w-full px-4 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={(e) => { e.stopPropagation(); onDownload(file); setMenuOpen(false); }}
            >
              <Download size={16} /> Download
            </button>
            <button
              className="w-full px-4 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={(e) => { e.stopPropagation(); onShare(file); setMenuOpen(false); }}
            >
              <Share2 size={16} /> Share
            </button>
            <button
              className="w-full px-4 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2 text-red-600"
              onClick={(e) => { e.stopPropagation(); onDelete(file); setMenuOpen(false); }}
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Slide‑over Preview Modal (unchanged) ────────────────
const FilePreviewModal = ({ file, isOpen, onClose }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (file && isOpen) {
      const saved = localStorage.getItem(`scroll_${file.id}`);
      if (saved && scrollRef.current) {
        scrollRef.current.scrollTop = parseFloat(saved);
      }
    }
  }, [file, isOpen]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current && file) {
      localStorage.setItem(`scroll_${file.id}`, String(scrollRef.current.scrollTop));
    }
  }, [file]);

  if (!isOpen || !file) return null;

  const contentUrl = file.url || (file.filepath
    ? supabase.storage.from('notes').getPublicUrl(file.filepath).data.publicUrl
    : null);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-medium truncate text-gray-800">{file.filename}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 bg-gray-50"
        >
          {contentUrl ? (
            file.filename?.match(/\.(pdf|txt|md)$/i) ? (
              <iframe src={contentUrl} className="w-full h-[calc(100vh-140px)] border-0 rounded-lg" title={file.filename} />
            ) : (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">Preview not available for this file type.</p>
                <button
                  onClick={() => window.open(contentUrl, '_blank')}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Open in new tab
                </button>
              </div>
            )
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No preview available</p>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN PROGRAMS COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Programs() {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────
  const [notes, setNotes] = useState([]);
  const [userProgram, setUserProgram] = useState('');
  const [userSemester, setUserSemester] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // View states
  const [viewMode, setViewMode] = useState('courses'); // 'courses' | 'files' | 'allPrograms'
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previousView, setPreviousView] = useState('courses'); // to know where to go back
  const [isAllProgramsFileView, setIsAllProgramsFileView] = useState(false);

  // Optimistic UI: read status (optional, kept for potential use)
  const [readStatus, setReadStatus] = useState(() => {
    return JSON.parse(localStorage.getItem('readFiles') || '{}');
  });

  // Preview modal
  const [previewFile, setPreviewFile] = useState(null);

  // Cache key
  const NOTES_CACHE_KEY = 'programs_notes_cache';

  // ── Load cached notes on mount ──────────────────────────
  useEffect(() => {
    const cached = localStorage.getItem(NOTES_CACHE_KEY);
    if (cached) {
      try { setNotes(JSON.parse(cached)); } catch (e) {}
    }
  }, []);

  // ── Fetch user profile ──────────────────────────────────
  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setIsLoggedIn(false);
          setLoading(false);
          return;
        }
        setIsLoggedIn(true);

        const cachedProgram = localStorage.getItem('userProgram');
        const cachedSemester = localStorage.getItem('userSemester');
        if (cachedProgram && cachedSemester) {
          setUserProgram(cachedProgram);
          setUserSemester(cachedSemester);
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('program, semester')
          .eq('id', session.user.id)
          .single();

        if (!error && profile) {
          setUserProgram(profile.program || '');
          setUserSemester(profile.semester || '');
          localStorage.setItem('userProgram', profile.program || '');
          localStorage.setItem('userSemester', profile.semester || '');
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') fetchProfile();
      if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        setUserProgram('');
        setUserSemester('');
        localStorage.removeItem('userProgram');
        localStorage.removeItem('userSemester');
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  // ── Load notes from Supabase ────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;

    const loadNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('uploaded_at', { ascending: false });

        if (error) throw error;

        const transformed = (data || []).map((n) => ({
          id: n.id,
          filename: n.filename,
          program: n.program,
          semester: n.semester,
          course: n.course_name,
          description: n.description || '',
          size: n.size || 0,
          uploadDate: n.uploaded_at ? new Date(n.uploaded_at).toLocaleDateString() : '',
          url: n.url || '',
          filepath: n.filepath || '',
        }));

        setNotes(transformed);
        localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(transformed));
      } catch (err) {
        console.error('Failed to load notes:', err);
      }
    };

    loadNotes();
  }, [isLoggedIn]);

  // ── Derived data ────────────────────────────────────────
  const userNotes = useMemo(() => {
    if (!userProgram || !userSemester) return [];
    return notes.filter((n) => {
      const progMatch = normalizeName(n.program).includes(normalizeName(userProgram));
      const semMatch = normalizeName(n.semester).includes(normalizeName(userSemester));
      return progMatch && semMatch;
    });
  }, [notes, userProgram, userSemester]);

  const courses = useMemo(() => {
    const courseSet = new Set();
    userNotes.forEach((n) => {
      if (n.course) courseSet.add(String(n.course).trim());
    });
    return Array.from(courseSet).sort();
  }, [userNotes]);

  // Files for the selected course – source depends on where we came from
  const courseFiles = useMemo(() => {
    if (!selectedCourse) return [];
    const sourceNotes = isAllProgramsFileView ? notes : userNotes;
    return sourceNotes.filter((n) => normalizeName(n.course) === normalizeName(selectedCourse));
  }, [selectedCourse, isAllProgramsFileView, notes, userNotes]);

  const allPrograms = useMemo(() => {
    const progSet = new Set();
    notes.forEach((n) => {
      if (n.program) progSet.add(String(n.program).trim());
    });
    return Array.from(progSet).sort();
  }, [notes]);

  const filteredPrograms = useMemo(() => {
    if (!searchQuery) return allPrograms;
    return allPrograms.filter((p) => normalizeName(p).includes(normalizeName(searchQuery)));
  }, [allPrograms, searchQuery]);

  // ── Handlers ──────────────────────────────────────────────
  const handleCourseClick = (course) => {
    setSelectedCourse(course);
    setIsAllProgramsFileView(false);
    setPreviousView('courses');
    setViewMode('files');
  };

  const handleProgramClickFromAll = (program) => {
    setSelectedCourse(program);
    setIsAllProgramsFileView(true);
    setPreviousView('allPrograms');
    setViewMode('files');
  };

  const handleBackFromFiles = () => {
    setViewMode(previousView);
    setSelectedCourse(null);
    setIsAllProgramsFileView(false);
  };

  const handleToggleView = () => {
    if (viewMode === 'allPrograms') {
      setViewMode('courses');
      setSearchQuery('');
    } else {
      setViewMode('allPrograms');
      setSelectedCourse(null);
    }
  };

  // ── File actions ──────────────────────────────────────────
  const getFileUrl = (file) => {
    return file.url || (file.filepath
      ? supabase.storage.from('notes').getPublicUrl(file.filepath).data.publicUrl
      : null);
  };

  const handleFileOpen = (file) => {
    setPreviewFile(file);
  };

  const handleDownload = async (file) => {
    const url = getFileUrl(file);
    if (!url) {
      alert('No downloadable link.');
      return;
    }
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = file.filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      window.open(url, '_blank');
    }
  };

  const handleShare = (file) => {
    const url = getFileUrl(file);
    if (url) {
      navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    } else {
      alert('No link available to share.');
    }
  };

  const handleDelete = (file) => {
    // Optimistic delete (local only)
    const previousNotes = [...notes];
    const updatedNotes = notes.filter(n => n.id !== file.id);
    setNotes(updatedNotes);
    localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(updatedNotes));
    // (If you need server sync, add Supabase delete call here with rollback)
  };

  // ── Skeleton Loader ──────────────────────────────────────
  const renderSkeletons = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2 mt-2"></div>
            </div>
            <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
          </div>
        </div>
      ))}
    </div>
  );

  // ──────────────────────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────────────────────
  if (loading && !notes.length) {
    return (
      <div className="h-screen bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0">
        <div className="px-4 py-4">
          {renderSkeletons()}
        </div>
        <BottomNav />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">🔒 Please log in to see your courses.</p>
          <button
            onClick={() => navigate('/login')}
            className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
          >
            Go to Login
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">

      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Hide logo + title when in "Browse All" view */}
          {viewMode !== 'allPrograms' && (
            <>
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
              </div>
              <h1 className="text-lg font-medium">
                <span className="text-gray-800">Study</span>
                <span className="text-blue-600">Hub</span>
              </h1>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {viewMode === 'allPrograms' && (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search programs..."
                className="pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 sm:w-48 text-gray-800"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <button
            onClick={handleToggleView}
            className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-sm"
          >
            {viewMode === 'allPrograms' ? '← My Courses' : 'Browse All'}
          </button>
        </div>
      </header>

      {/* ===== CONTENT ===== */}
      <div className="px-4 py-4 max-w-6xl mx-auto">
        {viewMode === 'allPrograms' ? (
          // ─── ALL PROGRAMS VIEW ────────────────────────
          <div>
            {filteredPrograms.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                📚 No programs found. {searchQuery && 'Try a different search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPrograms.map((program) => {
                  const count = notes.filter((n) => n.program === program).length;
                  return (
                    <div
                      key={program}
                      className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-all cursor-pointer hover:border-blue-500 flex items-center justify-between"
                      onClick={() => handleProgramClickFromAll(program)}
                    >
                      <span className="font-medium text-gray-800">{program}</span>
                      <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {count} note{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : viewMode === 'files' ? (
          // ─── FILES VIEW ──────────────────────────────────
          <>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleBackFromFiles}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <ChevronLeft size={18} /> Back
              </button>
              <span className="text-lg font-semibold text-gray-800">{selectedCourse}</span>
              <span className="text-sm text-gray-500">({courseFiles.length} files)</span>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              {courseFiles.length > 0 ? (
                courseFiles.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    onOpen={handleFileOpen}
                    onDownload={handleDownload}
                    onShare={handleShare}
                    onDelete={handleDelete}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">No files for this course.</div>
              )}
            </div>
          </>
        ) : (
          // ─── COURSES VIEW ────────────────────────────────
          <>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Your Courses</h2>
              <p className="text-sm text-gray-500">Select a course to see its files</p>
            </div>
            {!userProgram || !userSemester ? (
              <div className="text-center py-8 text-gray-500">
                <p>👤 Please set your program and semester in profile settings.</p>
                <button
                  onClick={() => navigate('/profile')}
                  className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
                >
                  Go to Profile
                </button>
              </div>
            ) : courses.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>📭 No courses found for {userProgram} · {userSemester}.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses.map((course) => {
                  const courseFiles = userNotes.filter(n => normalizeName(n.course) === normalizeName(course));
                  const fileCount = courseFiles.length;
                  const lastOpened = courseFiles.reduce((latest, f) => {
                    const d = new Date(f.uploadDate);
                    return d > latest ? d : latest;
                  }, new Date(0)).toLocaleDateString();

                  return (
                    <CourseCard
                      key={course}
                      course={course}
                      fileCount={fileCount}
                      lastOpened={lastOpened}
                      onClick={() => handleCourseClick(course)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== PREVIEW MODAL ===== */}
      <FilePreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
      />

      <BottomNav />
    </div>
  );
}