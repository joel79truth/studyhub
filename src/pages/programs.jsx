import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
  useTransition,
  memo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';

// ─── Simple in‑memory cache ──────────────────────────────
const notesCache = new Map(); // key: userId, value: { data, timestamp }

// ─── Custom Hooks ──────────────────────────────────────────

function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const fetchSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted.current) return;
        if (!session) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        setUser(session.user);
        const { data, error } = await supabase
          .from('profiles')
          .select('program, semester')
          .eq('id', session.user.id)
          .single();
        if (!mounted.current) return;
        if (error) throw error;
        setProfile(data || { program: '', semester: '' });
      } catch (err) {
        if (mounted.current) setError(err.message);
      } finally {
        if (mounted.current) setLoading(false);
      }
    };

    fetchSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') fetchSession();
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted.current = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  return { user, profile, loading, error };
}

// Notes hook with cache
function useNotes(user) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setLoading(false);
      return;
    }

    const userId = user.id;
    const cached = notesCache.get(userId);
    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // If cache exists and is fresh, use it immediately
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      setNotes(cached.data);
      setLoading(false);
      setIsStale(false);
    } else if (cached) {
      // Stale cache – show it but refetch in background
      setNotes(cached.data);
      setLoading(false);
      setIsStale(true);
    } else {
      // No cache – start loading
      setLoading(true);
    }

    let cancelled = false;
    const fetchNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('uploaded_at', { ascending: false });
        if (cancelled) return;
        if (error) throw error;
        const transformed = (data || []).map((n) => ({
          id: n.id,
          filename: n.filename,
          program: n.program,
          semester: n.semester,
          course: n.course_name,
          description: n.description || '',
          size: n.size || '',
          uploadDate: n.uploaded_at ? new Date(n.uploaded_at).toLocaleDateString() : '',
          url: n.url || '',
          filepath: n.filepath || '',
          storage_type: n.storage_type || 'supabase',
        }));
        // Update cache
        notesCache.set(userId, { data: transformed, timestamp: Date.now() });
        if (!cancelled) {
          setNotes(transformed);
          setLoading(false);
          setIsStale(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    // If cache is missing or stale, fetch
    if (!cached || isStale) {
      fetchNotes();
    }

    return () => { cancelled = true; };
  }, [user]);

  return { notes, loading, error, isStale };
}

// Read status hook (localStorage)
function useReadStatus() {
  const [readFiles, setReadFiles] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('readFiles') || '{}');
    } catch {
      return {};
    }
  });

  const toggleRead = useCallback((fileId) => {
    setReadFiles((prev) => {
      const next = { ...prev, [fileId]: !prev[fileId] };
      localStorage.setItem('readFiles', JSON.stringify(next));
      return next;
    });
  }, []);

  // Returns a boolean for a given fileId – stable reference
  const getIsRead = useCallback((fileId) => !!readFiles[fileId], [readFiles]);

  return { toggleRead, getIsRead };
}

// ─── Helpers ──────────────────────────────────────────────
const normalizeName = (name) => String(name || '').trim().toLowerCase();

const getNotePublicUrl = (note) => {
  if (note.storage_type === 'gdrive' && note.filepath) {
    return `https://drive.google.com/file/d/${note.filepath}/view`;
  }
  if (note.filepath && note.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(note.filepath);
    if (data?.publicUrl) {
      return data.publicUrl;
    }
  }
  if (note.url && (note.url.startsWith('http://') || note.url.startsWith('https://'))) {
    return note.url;
  }
  return null;
};

// ─── File Icon Component (SVG) ────────────────────────────
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

// ─── Skeleton Loader ──────────────────────────────────────
const SkeletonItem = () => (
  <div className="flex items-center gap-4 p-4 bg-white/60 rounded-xl mb-3 animate-pulse">
    <div className="w-10 h-10 bg-gray-200 rounded-lg" />
    <div className="flex-1">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="flex gap-2">
        <div className="h-3 bg-gray-200 rounded w-20" />
        <div className="h-3 bg-gray-200 rounded w-16" />
      </div>
    </div>
    <div className="w-8 h-8 bg-gray-200 rounded-full" />
  </div>
);

// ─── File List Item ───────────────────────────────────────
const FileListItem = memo(({ file, onFileClick, onDownload, onCopyLink, onToggleRead, isRead }) => {
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
    <div className="group relative flex items-center gap-4 p-4 bg-white/60 backdrop-blur-sm border border-gray-100 rounded-xl hover:bg-white hover:shadow-sm hover:border-blue-100 transition-all mb-3">
      <div className="w-10 h-10 flex-shrink-0 bg-blue-50/50 rounded-lg flex items-center justify-center shadow-sm border border-blue-100/50">
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
          {file.uploadDate && (
            <span className="text-xs text-gray-400">📅 {file.uploadDate}</span>
          )}
        </div>
      </button>

      <div className="relative">
        <button
          ref={buttonRef}
          className={`p-2 rounded-lg transition-colors ${menuOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
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
            className="absolute right-0 mt-2 w-48 bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 py-1.5 z-30"
            role="menu"
          >
            <button
              className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3"
              onClick={(e) => handleAction(e, onDownload)}
              role="menuitem"
            >
              ⬇️ Download
            </button>
            <button
              className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3"
              onClick={(e) => handleAction(e, onCopyLink)}
              role="menuitem"
            >
              🔗 Copy Link
            </button>
            <div className="h-px bg-gray-100 my-1 mx-2" />
            <button
              className={`w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 ${isRead ? 'hover:bg-orange-50' : 'hover:bg-green-50'}`}
              onClick={(e) => handleAction(e, onToggleRead)}
              role="menuitem"
            >
              {isRead ? 'Start Quiz' : 'Quiz'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── View Components ──────────────────────────────────────

const CoursesView = memo(({ courses, courseCounts, userProgram, userSemester, onCourseClick, onBrowseAll }) => {
  const navigate = useNavigate();

  if (!userProgram || !userSemester) {
    return (
      <div className="text-center py-12 px-4 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-gray-200">
        <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">👤</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Profile Incomplete</h3>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">Please set your program and semester in your profile.</p>
        <button
          onClick={() => navigate('/profile')}
          className="px-6 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800"
        >
          Go to Profile Settings
        </button>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="text-center py-16 bg-white/50 backdrop-blur-sm rounded-2xl border border-gray-200 border-dashed">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-lg font-semibold text-gray-800">No courses found</h3>
        <p className="text-gray-500 mt-1">
          We couldn't find courses for <strong>{userProgram}</strong> ({userSemester}).
        </p>
        <button
          onClick={onBrowseAll}
          className="mt-6 px-5 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
        >
          Browse All Programs
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {courses.map((course) => {
        const count = courseCounts[course] || 0;
        return (
          <div
            key={course}
            className="group bg-white border border-gray-200 rounded-xl p-3.5 hover:shadow-lg hover:-translate-y-0.5 hover:border-indigo-300 transition-all cursor-pointer flex flex-col justify-between min-h-[100px] relative overflow-hidden"
            onClick={() => onCourseClick(course)}
          >
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500 pointer-events-none" />
            <div className="relative z-10">
              <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center mb-3 border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors text-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-800 text-sm leading-tight line-clamp-2">{course}</h3>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-2.5 relative z-10">
              <span className="text-xs font-medium text-gray-500">📄 {count} {count === 1 ? 'file' : 'files'}</span>
              <div className="text-indigo-500 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const FilesView = memo(({ course, files, onBack, fileActions, isReadMap }) => (
  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div>
        <button onClick={onBack} className="text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1.5 mb-3 px-3 py-1.5 -ml-3 rounded-lg hover:bg-blue-50">
          ← Back to courses
        </button>
        <h2 className="text-2xl font-bold text-gray-900">{course}</h2>
        <p className="text-sm text-gray-500 mt-1">🟢 {files.length} {files.length === 1 ? 'file' : 'files'}</p>
      </div>
    </div>
    {files.length > 0 ? (
      files.map((file, idx) => (
        <div key={file.id} style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }} className="animate-in fade-in slide-in-from-bottom-2">
          <FileListItem
            file={file}
            {...fileActions}
            isRead={isReadMap[file.id] || false}
          />
        </div>
      ))
    ) : (
      <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-lg font-semibold text-gray-800">No files yet</h3>
      </div>
    )}
  </div>
));

const AllProgramsView = memo(({ programs, notes, onProgramClick, searchQuery, onSearchChange }) => (
  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-gray-900">All Programs</h2>
      <p className="text-gray-500 mt-1">Explore materials across all disciplines.</p>
    </div>

    {programs.length === 0 ? (
      <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed">
        <div className="text-4xl mb-4">📚</div>
        <h3 className="text-lg font-semibold text-gray-800">No programs found</h3>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {programs.map((program) => {
          const count = notes.filter((n) => n.program === program).length;
          return (
            <div
              key={program}
              className="group bg-white/80 border border-gray-200 rounded-2xl p-5 hover:shadow-xl hover:-translate-y-1 hover:border-blue-200 transition-all cursor-pointer"
              onClick={() => onProgramClick(program)}
            >
              <h3 className="font-semibold text-gray-800 text-lg line-clamp-2">{program}</h3>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                  {count} {count === 1 ? 'Resource' : 'Resources'}
                </span>
                <span className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
));

// ─── Main Component ──────────────────────────────────────
export default function Programs() {
  const navigate = useNavigate();

  const { user, profile, loading: authLoading, error: authError } = useAuth();
  const { notes, loading: notesLoading, error: notesError, isStale } = useNotes(user);
  const { toggleRead, getIsRead } = useReadStatus();

  const userProgram = profile?.program || '';
  const userSemester = profile?.semester || '';

  const userNotes = useMemo(() => {
    if (!userProgram || !userSemester) return [];
    return notes.filter((n) => {
      const progMatch = normalizeName(n.program).includes(normalizeName(userProgram));
      const semMatch = normalizeName(n.semester) === normalizeName(userSemester);
      return progMatch && semMatch;
    });
  }, [notes, userProgram, userSemester]);

  const courses = useMemo(() => {
    const courseSet = new Set();
    userNotes.forEach((n) => n.course && courseSet.add(String(n.course).trim()));
    return Array.from(courseSet).sort();
  }, [userNotes]);

  const courseCounts = useMemo(() => {
    const counts = {};
    userNotes.forEach((n) => {
      if (n.course) {
        const key = String(n.course).trim();
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    return counts;
  }, [userNotes]);

  const allPrograms = useMemo(() => {
    const progSet = new Set();
    notes.forEach((n) => n.program && progSet.add(String(n.program).trim()));
    return Array.from(progSet).sort();
  }, [notes]);

  // ── UI State ──
  const STORAGE_KEY = 'programs_page_state';
  const getInitialState = () => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (['courses', 'files', 'allPrograms'].includes(parsed.viewMode)) {
          return parsed;
        }
      }
    } catch {}
    return { viewMode: 'courses', selectedCourse: null, searchQuery: '' };
  };

  const [viewMode, setViewMode] = useState(getInitialState().viewMode);
  const [selectedCourse, setSelectedCourse] = useState(getInitialState().selectedCourse);
  const [searchQuery, setSearchQuery] = useState(getInitialState().searchQuery);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode, selectedCourse, searchQuery }));
  }, [viewMode, selectedCourse, searchQuery]);

  // ── Scroll restoration ──
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    const savedScroll = sessionStorage.getItem('programs_scroll');
    if (savedScroll && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  const saveScroll = useCallback(() => {
    if (scrollRef.current) {
      sessionStorage.setItem('programs_scroll', String(scrollRef.current.scrollTop));
    }
  }, []);

  // ── Handlers ──
  const handleCourseClick = useCallback((course) => {
    startTransition(() => {
      setSelectedCourse(course);
      setViewMode('files');
    });
  }, []);

  const handleBackToCourses = useCallback(() => {
    startTransition(() => {
      setViewMode('courses');
      setSelectedCourse(null);
    });
  }, []);

  const handleToggleView = useCallback(() => {
    startTransition(() => {
      if (viewMode === 'allPrograms') {
        setViewMode('courses');
        setSearchQuery('');
      } else {
        setViewMode('allPrograms');
        setSelectedCourse(null);
      }
    });
  }, [viewMode]);

  const handleProgramClick = useCallback((program) => {
    navigate(`/program-detail?program=${encodeURIComponent(program)}`);
  }, [navigate]);

  // ─── File actions ───
 // Programs.jsx – inside component
const handleFileClick = useCallback((file) => {
  const url = getNotePublicUrl(file);
  if (!url) {
    alert('File URL not available.');
    return;
  }
  // Detect file type from extension
  const ext = file.filename.split('.').pop().toLowerCase();
  const fileType = ['pdf'].includes(ext) ? 'pdf' :
                   ['ppt', 'pptx'].includes(ext) ? 'pptx' : 'unknown';

  navigate('/viewer', {
    state: {
      fileId: file.id,
      filename: file.filename || 'Document',
      url,
      fileType,
      // optionally pass context for Luna
      context: {
        course: file.course,
        semester: file.semester,
        program: file.program,
      }
    },
  });
}, [navigate]);

  const handleDownload = useCallback(async (file) => {
    const url = getNotePublicUrl(file);
    if (!url) { alert('No downloadable link.'); return; }
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleCopyLink = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url)
          .then(() => alert('Link copied!'))
          .catch(() => prompt('Copy this link:', url));
      } else {
        prompt('Copy this link:', url);
      }
    }
  }, []);

  // Stable fileActions – does not depend on isRead
  const fileActions = useMemo(() => ({
    onFileClick: handleFileClick,
    onDownload: handleDownload,
    onCopyLink: handleCopyLink,
    onToggleRead: toggleRead,
  }), [handleFileClick, handleDownload, handleCopyLink, toggleRead]);

  // Compute isRead map for files in current view
  const isReadMap = useMemo(() => {
    const map = {};
    if (viewMode === 'files' && selectedCourse) {
      const files = userNotes.filter((n) => normalizeName(n.course) === normalizeName(selectedCourse));
      files.forEach((f) => { map[f.id] = getIsRead(f.id); });
    }
    return map;
  }, [viewMode, selectedCourse, userNotes, getIsRead]);

  const courseFiles = useMemo(() => {
    if (!selectedCourse) return [];
    return userNotes.filter((n) => normalizeName(n.course) === normalizeName(selectedCourse));
  }, [userNotes, selectedCourse]);

  const filteredPrograms = useMemo(() => {
    if (!searchQuery) return allPrograms;
    return allPrograms.filter((p) => normalizeName(p).includes(normalizeName(searchQuery)));
  }, [allPrograms, searchQuery]);

  // ── Determine if we should show skeletons ──
  const showSkeletons = authLoading || (notesLoading && !isStale && notes.length === 0);
  const showError = authError || notesError;

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 via-gray-50 to-purple-50">
      {/* Header – fixed top */}
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/60 shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center overflow-hidden shadow-sm border border-blue-700/20">
            <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
            <span className="text-white font-bold text-sm absolute"></span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-gray-800">Study</span><span className="text-blue-600">Notes</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {viewMode === 'allPrograms' && (
            <div className="relative hidden xs:block">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search programs..."
                className="pl-9 pr-4 py-2 bg-gray-100/80 border-transparent focus:bg-white border focus:border-blue-300 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 w-40 sm:w-64"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search programs"
              />
            </div>
          )}
          <button
            onClick={handleToggleView}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all active:scale-95 ${
              viewMode === 'allPrograms'
                ? 'bg-gray-800 text-white hover:bg-gray-900 shadow-md'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/20'
            }`}
          >
            {viewMode === 'allPrograms' ? 'My Courses' : 'Browse All'}
          </button>
        </div>
      </header>

      {/* Main scrollable content */}
      <main
        ref={scrollRef}
        onScroll={saveScroll}
        className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8"
        style={{ paddingBottom: '80px' }} // space for BottomNav
      >
        {showError ? (
          <div className="bg-white/80 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-sm mx-auto text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">⚠️</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-6">{authError || notesError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-xl"
            >
              Retry
            </button>
          </div>
        ) : showSkeletons ? (
          // Skeleton loaders
          <div>
            <div className="h-8 w-48 bg-gray-200 rounded mb-6 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl p-3.5 h-[100px] animate-pulse">
                  <div className="w-8 h-8 bg-gray-200 rounded-lg mb-3" />
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="mt-3 h-3 bg-gray-200 rounded w-1/4" />
                </div>
              ))}
            </div>
          </div>
        ) : !user ? (
          <div className="bg-white/80 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-sm mx-auto text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Access Restricted</h2>
            <p className="text-sm text-gray-500 mb-6">Please log in to view your courses.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-xl"
            >
              Go to Login
            </button>
          </div>
        ) : (
          // Actual content
          <>
            {viewMode === 'allPrograms' ? (
              <AllProgramsView
                programs={filteredPrograms}
                notes={notes}
                onProgramClick={handleProgramClick}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            ) : viewMode === 'files' ? (
              <FilesView
                course={selectedCourse}
                files={courseFiles}
                onBack={handleBackToCourses}
                fileActions={fileActions}
                isReadMap={isReadMap}
              />
            ) : (
              <CoursesView
                courses={courses}
                courseCounts={courseCounts}
                userProgram={userProgram}
                userSemester={userSemester}
                onCourseClick={handleCourseClick}
                onBrowseAll={() => {
                  startTransition(() => {
                    setViewMode('allPrograms');
                    setSelectedCourse(null);
                  });
                }}
              />
            )}
          </>
        )}
      </main>

      {/* BottomNav – always fixed at bottom */}
      <BottomNav className="flex-shrink-0" />
    </div>
  );
}