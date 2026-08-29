// ============================================================
// Programs.jsx – server-side filtered queries, lazy "browse all",
// no skeleton flashes on navigation. Course grid now personalizes
// (continue badge), supports search, and uses color-coded cards;
// file rows flag recent uploads.
// ============================================================
import React, {
  useState, useEffect, useMemo, useCallback, useRef,
  useLayoutEffect, useTransition, memo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { useQuery } from '@tanstack/react-query';

// ─── Helpers ──────────────────────────────────────────────
const normalizeName = (name) => String(name || '').trim().toLowerCase();

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

// Soft color-coded tints for course cards (Tip 4) — same hue family
// as the existing blue/indigo theme, just varied so cards read as
// distinct categories at a glance instead of one uniform block.
const COURSE_PALETTE = [
  { bg: 'bg-indigo-50', text: 'text-indigo-600', hoverBg: 'group-hover:bg-indigo-600', border: 'border-indigo-100' },
  { bg: 'bg-blue-50',   text: 'text-blue-600',   hoverBg: 'group-hover:bg-blue-600',   border: 'border-blue-100' },
  { bg: 'bg-teal-50',   text: 'text-teal-600',   hoverBg: 'group-hover:bg-teal-600',   border: 'border-teal-100' },
  { bg: 'bg-purple-50', text: 'text-purple-600', hoverBg: 'group-hover:bg-purple-600', border: 'border-purple-100' },
  { bg: 'bg-cyan-50',   text: 'text-cyan-600',   hoverBg: 'group-hover:bg-cyan-600',   border: 'border-cyan-100' },
  { bg: 'bg-amber-50',  text: 'text-amber-600',  hoverBg: 'group-hover:bg-amber-600',  border: 'border-amber-100' },
];

const isRecent = (isoString, days = 3) => {
  if (!isoString) return false;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return false;
  return (Date.now() - then) / (1000 * 60 * 60 * 24) <= days;
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

// ─── File Icon ──────────────────────────────────────────────
const FileIcon = memo(({ filename }) => {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
  let icon = '📄';
  let color = 'text-gray-600';
  if (ext === 'pdf') { icon = '📕'; color = 'text-red-500'; }
  else if (['doc', 'docx'].includes(ext)) { icon = '📘'; color = 'text-blue-600'; }
  else if (['ppt', 'pptx'].includes(ext)) { icon = '📙'; color = 'text-orange-600'; }
  else if (['xls', 'xlsx'].includes(ext)) { icon = '📗'; color = 'text-green-600'; }
  else if (['zip', 'rar', '7z'].includes(ext)) { icon = '📦'; color = 'text-yellow-600'; }
  return <span className={`text-xl ${color}`}>{icon}</span>;
});

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
    setMenuOpen(prev => !prev);
  };

  const handleAction = (e, action) => {
    e.stopPropagation();
    action(file.id);
    setMenuOpen(false);
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    onDownload(file);
    setMenuOpen(false);
  };
  const handleCopyLink = (e) => {
    e.stopPropagation();
    onCopyLink(file);
    setMenuOpen(false);
  };

  // Tip 3: a small status cue (like an order's "just placed" flag) instead
  // of every file looking identical regardless of how fresh it is.
  const fresh = isRecent(file.uploadedAtRaw);

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
        <div className="flex items-center gap-2 min-w-0">
          <p className={`text-[15px] font-semibold truncate transition-colors ${isRead ? 'text-gray-400 line-through' : 'text-gray-800 group-hover:text-blue-600'}`}>
            {file.filename || 'Untitled'}
          </p>
          {fresh && !isRead && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 bg-green-100 text-green-600 rounded-md">NEW</span>
          )}
        </div>
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
            <button className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3" onClick={handleDownload} role="menuitem">
              ⬇️ Download
            </button>
            <button className="w-full px-4 py-2.5 text-sm text-left hover:bg-blue-50 flex items-center gap-3" onClick={handleCopyLink} role="menuitem">
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
const CoursesView = memo(({
  courses, courseCounts, userProgram, userSemester, onCourseClick, onBrowseAll,
  totalCourseCount, courseQuery, onCourseQueryChange, lastViewedCourse,
}) => {
  const navigate = useNavigate();

  if (!userProgram || !userSemester) {
    return (
      <div className="text-center py-12 px-4 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">👤</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Profile Incomplete</h3>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">Please set your program and semester in your profile.</p>
        <button
          onClick={() => navigate('/profile')}
          className="px-6 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 active:scale-95 transition-transform"
        >
          Go to Profile Settings
        </button>
      </div>
    );
  }

  if (totalCourseCount === 0) {
    return (
      <div className="text-center py-16 bg-white/50 rounded-2xl border border-gray-200 border-dashed">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-lg font-semibold text-gray-800">No courses found</h3>
        <p className="text-gray-500 mt-1">
          We couldn't find courses for <strong>{userProgram}</strong> ({userSemester}).
        </p>
        <button
          onClick={onBrowseAll}
          className="mt-6 px-5 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 active:scale-95 transition-transform"
        >
          Browse All Programs
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Tip 2: smarter search — only shown once the list is long enough to
          need it, filters locally, no network round-trip. */}
      {totalCourseCount > 6 && (
        <div className="relative mb-5 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search your courses..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-300"
            value={courseQuery}
            onChange={(e) => onCourseQueryChange(e.target.value)}
            aria-label="Search your courses"
          />
        </div>
      )}

      {courses.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No courses match "{courseQuery}"</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((course, i) => {
            const count = courseCounts[course] || 0;
            const palette = COURSE_PALETTE[i % COURSE_PALETTE.length];
            const isContinue = normalizeName(course) === normalizeName(lastViewedCourse || '');
            return (
              <div
                key={course}
                className={`group bg-white border rounded-xl p-3.5 hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between min-h-[100px] relative overflow-hidden ${isContinue ? 'border-blue-300' : 'border-gray-200 hover:border-indigo-300'}`}
                onClick={() => onCourseClick(course)}
              >
                <div className="relative z-10">
                  <div className={`w-8 h-8 ${palette.bg} ${palette.text} rounded-lg flex items-center justify-center mb-3 border ${palette.border} ${palette.hoverBg} group-hover:text-white transition-colors text-sm`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800 text-sm leading-tight line-clamp-2">{course}</h3>
                    {isContinue && (
                      <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-md">CONTINUE</span>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-2.5 relative z-10">
                  <span className="text-xs font-medium text-gray-500">📄 {count} {count === 1 ? 'file' : 'files'}</span>
                  <div className={`${palette.text} opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const FilesView = memo(({ course, files, onBack, fileActions, readFiles }) => (
  <div>
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div>
        <button onClick={onBack} className="text-sm font-semibold text-blue-600 hover:text-blue-800 active:scale-95 flex items-center gap-1.5 mb-3 px-3 py-1.5 -ml-3 rounded-lg hover:bg-blue-50 transition-transform">
          ← Back to courses
        </button>
        <h2 className="text-2xl font-bold text-gray-900">{course}</h2>
        <p className="text-sm text-gray-500 mt-1">🟢 {files.length} {files.length === 1 ? 'file' : 'files'}</p>
      </div>
    </div>
    {files.length > 0 ? (
      files.map((file) => (
        <FileListItem
          key={file.id}
          file={file}
          {...fileActions}
          isRead={!!readFiles[file.id]}
        />
      ))
    ) : (
      <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-lg font-semibold text-gray-800">No files yet</h3>
      </div>
    )}
  </div>
));

const AllProgramsView = memo(({ programs, programCounts, isLoading, onProgramClick, searchQuery }) => (
  <div>
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-gray-900">All Programs</h2>
      <p className="text-gray-500 mt-1">Explore materials across all disciplines.</p>
    </div>

    {isLoading ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white/80 border border-gray-200 rounded-2xl p-5 h-[104px] animate-pulse" />
        ))}
      </div>
    ) : programs.length === 0 ? (
      <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed">
        <div className="text-4xl mb-4">📚</div>
        <h3 className="text-lg font-semibold text-gray-800">No programs found</h3>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {programs.map((program) => {
          const count = programCounts[program] || 0;
          return (
            <div
              key={program}
              className="group bg-white/80 border border-gray-200 rounded-2xl p-5 hover:shadow-xl hover:-translate-y-1 hover:border-blue-200 active:scale-[0.98] transition-all cursor-pointer"
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

// ─── Skeleton ──────────────────────────────────────────────
const CoursesSkeleton = () => (
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
);

// ─── Query functions (module scope — stable references, no re-creation) ──
const fetchProfile = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('program, semester')
    .eq('id', session.user.id)
    .single();
  if (error) throw error;
  return data || { program: '', semester: '' };
};

const mapNote = (n) => ({
  id: n.id,
  filename: n.filename,
  program: n.program,
  semester: n.semester,
  course: n.course_name,
  size: n.size || '',
  uploadDate: n.uploaded_at ? new Date(n.uploaded_at).toLocaleDateString() : '',
  uploadedAtRaw: n.uploaded_at || null,
  url: n.url || '',
  filepath: n.filepath || '',
  storage_type: n.storage_type || 'supabase',
});

// Fetches ONLY the current user's program+semester notes — this is the
// query that runs on every page load, so it stays small no matter how
// large the overall notes table grows.
const fetchUserNotes = async (program, semester) => {
  const { data, error } = await supabase
    .from('notes')
    .select('id, filename, program, semester, course_name, size, uploaded_at, url, filepath, storage_type')
    .ilike('program', `%${program}%`)
    .eq('semester', semester)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapNote);
};

// Fetches only program names + counts — used exclusively by the "Browse
// All" view, and only loaded when that view is actually opened.
const fetchProgramCounts = async () => {
  const { data, error } = await supabase.from('notes').select('program');
  if (error) throw error;
  const counts = {};
  (data || []).forEach((row) => {
    const key = String(row.program || '').trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};

// ─── Main Component ──────────────────────────────────────
export default function Programs() {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  // ── UI State (read synchronously so there's no flash between views) ──
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
  const initialUiState = useMemo(getInitialState, []);

  const [viewMode, setViewMode] = useState(initialUiState.viewMode);
  const [selectedCourse, setSelectedCourse] = useState(initialUiState.selectedCourse);
  const [searchQuery, setSearchQuery] = useState(initialUiState.searchQuery);
  const [courseQuery, setCourseQuery] = useState('');
  const [toast, setToast] = useState(null);

  // Tip 1: remembers the last course the user opened, so the grid can
  // surface a "Continue" cue for a returning user instead of treating
  // every visit identically. Pure localStorage read/write — no network.
  const [lastViewedCourse, setLastViewedCourse] = useState(() => {
    try { return localStorage.getItem('lastViewedCourse') || null; } catch { return null; }
  });

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode, selectedCourse, searchQuery }));
  }, [viewMode, selectedCourse, searchQuery]);

  // ── React Query: profile ──
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: () => {
      try {
        const cached = sessionStorage.getItem('profileCache');
        return cached ? JSON.parse(cached) : undefined;
      } catch { return undefined; }
    },
  });

  useEffect(() => {
    if (profile) {
      try { sessionStorage.setItem('profileCache', JSON.stringify(profile)); } catch {}
    }
  }, [profile]);

  const userProgram = profile?.program || '';
  const userSemester = profile?.semester || '';

  // ── React Query: user's own notes only (small, fast, server-filtered) ──
  const {
    data: userNotes = [],
    isLoading: notesLoading,
  } = useQuery({
    queryKey: ['userNotes', userProgram, userSemester],
    queryFn: () => fetchUserNotes(userProgram, userSemester),
    enabled: !!userProgram && !!userSemester,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: () => {
      try {
        const cached = sessionStorage.getItem('userNotesCache');
        if (!cached) return undefined;
        const parsed = JSON.parse(cached);
        if (parsed.program === userProgram && parsed.semester === userSemester) {
          return parsed.data;
        }
      } catch {}
      return undefined;
    },
  });

  useEffect(() => {
    if (!userProgram || !userSemester) return;
    try {
      sessionStorage.setItem('userNotesCache', JSON.stringify({
        program: userProgram, semester: userSemester, data: userNotes,
      }));
    } catch {}
  }, [userNotes, userProgram, userSemester]);

  // ── React Query: program counts — LAZY, only fetched when "Browse All"
  // is actually opened, and cached so switching back and forth is instant ──
  const {
    data: programCounts = {},
    isLoading: programCountsLoading,
  } = useQuery({
    queryKey: ['programCounts'],
    queryFn: fetchProgramCounts,
    enabled: viewMode === 'allPrograms',
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // ── Read status ──
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

  // ── Derived data ──
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

  const filteredCourses = useMemo(() => {
    if (!courseQuery.trim()) return courses;
    const q = normalizeName(courseQuery);
    return courses.filter((c) => normalizeName(c).includes(q));
  }, [courses, courseQuery]);

  const allProgramNames = useMemo(
    () => Object.keys(programCounts).sort(),
    [programCounts]
  );

  const filteredPrograms = useMemo(() => {
    if (!searchQuery) return allProgramNames;
    const q = normalizeName(searchQuery);
    return allProgramNames.filter((p) => normalizeName(p).includes(q));
  }, [allProgramNames, searchQuery]);

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
    try { localStorage.setItem('lastViewedCourse', course); } catch {}
    setLastViewedCourse(course);
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

  const handleFileClick = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) {
      setToast('File URL not available.');
      return;
    }
    navigate('/viewer', {
      state: {
        fileId: file.id,
        filename: file.filename || 'Document',
        url,
        context: { course: file.course, semester: file.semester, program: file.program }
      },
    });
  }, [navigate]);

  const handleDownload = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) { setToast('No downloadable link.'); return; }
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
    if (!url) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => setToast('Link copied!'))
        .catch(() => prompt('Copy this link:', url));
    } else {
      prompt('Copy this link:', url);
    }
  }, []);

  const fileActions = useMemo(() => ({
    onFileClick: handleFileClick,
    onDownload: handleDownload,
    onCopyLink: handleCopyLink,
    onToggleRead: toggleRead,
  }), [handleFileClick, handleDownload, handleCopyLink, toggleRead]);

  const courseFiles = useMemo(() => {
    if (!selectedCourse) return [];
    return userNotes.filter((n) => normalizeName(n.course) === normalizeName(selectedCourse));
  }, [userNotes, selectedCourse]);

  // Skeleton only for a genuine cold start with no cached data
  const showSkeleton = (profileLoading && !profile) || (notesLoading && !userNotes.length && !!userProgram);
  const isDataReady = !showSkeleton;

  // ── Render ──
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 via-gray-50 to-purple-50">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/60 shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center overflow-hidden shadow-sm border border-blue-700/20">
            <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center">
            <span className="text-gray-800">Study</span><span className="text-blue-600">Notes</span>
            {isPending && (
              <span className="ml-2 inline-block w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse will-change-transform" />
            )}
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

      <main
        ref={scrollRef}
        onScroll={saveScroll}
        className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8"
        style={{ paddingBottom: '80px' }}
      >
        {!isDataReady ? (
          <CoursesSkeleton />
        ) : !profile ? (
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm mx-auto text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Access Restricted</h2>
            <p className="text-sm text-gray-500 mb-6">Please log in to view your courses.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-xl active:scale-95 transition-transform"
            >
              Go to Login
            </button>
          </div>
        ) : viewMode === 'allPrograms' ? (
          <AllProgramsView
            programs={filteredPrograms}
            programCounts={programCounts}
            isLoading={programCountsLoading && allProgramNames.length === 0}
            onProgramClick={handleProgramClick}
            searchQuery={searchQuery}
          />
        ) : viewMode === 'files' ? (
          <FilesView
            course={selectedCourse}
            files={courseFiles}
            onBack={handleBackToCourses}
            fileActions={fileActions}
            readFiles={readFiles}
          />
        ) : (
          <CoursesView
            courses={filteredCourses}
            courseCounts={courseCounts}
            totalCourseCount={courses.length}
            courseQuery={courseQuery}
            onCourseQueryChange={setCourseQuery}
            lastViewedCourse={lastViewedCourse}
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
      </main>

      <BottomNav className="flex-shrink-0" />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}