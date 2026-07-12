import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from "../components/BottomNav";
import { supabase } from '../supabase';

// ─── Safe normalizer ────────────────────────────────────────
const normalizeName = (name) => String(name || '').trim().toLowerCase();

// Merge similar program names (for "all" view) – unchanged
const mergeSimilarPrograms = (notes) => {
  const mergedCounts = {};
  notes.forEach((n) => {
    if (!n.program) return;
    const cleaned = String(n.program)
      .toLowerCase()
      .replace(/\b(in|of|and|the|at|on|for|by|to)\b/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const existingKey = Object.keys(mergedCounts).find((k) => {
      const kClean = String(k)
        .toLowerCase()
        .replace(/\b(in|of|and|the|at|on|for|by|to)\b/g, '')
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return kClean === cleaned;
    });
    if (existingKey) mergedCounts[existingKey]++;
    else mergedCounts[String(n.program).trim()] = 1;
  });
  return mergedCounts;
};

// ─── Main Component ────────────────────────────────────────
export default function Programs() {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────
  const [notes, setNotes] = useState([]);        // renamed from 'files'
  const [programs, setPrograms] = useState([]);
  const [programCounts, setProgramCounts] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('personal');
  const [selectedCourse, setSelectedCourse] = useState(null);

  // User profile
  const [userProgram, setUserProgram] = useState('');
  const [userSemester, setUserSemester] = useState('');
  const [loadingUser, setLoadingUser] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Courses fetched from Supabase (still used for course list)
  const [coursesFromDb, setCoursesFromDb] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(false);

  // ── Fetch user profile & courses (unchanged) ────────────
  useEffect(() => {
    const fetchUserProfileAndCourses = async () => {
      setLoadingUser(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setIsLoggedIn(false);
          setLoadingUser(false);
          return;
        }
        setIsLoggedIn(true);

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('program, semester')
          .eq('id', session.user.id)
          .single();

        if (profileError) throw profileError;

        if (profile) {
          setUserProgram(profile.program || '');
          setUserSemester(profile.semester || '');
          localStorage.setItem('userProgram', profile.program || '');
          localStorage.setItem('userSemester', profile.semester || '');

          if (profile.program) {
            setLoadingCourses(true);
            const { data: programData, error: programError } = await supabase
              .from('programs')
              .select('id')
              .eq('name', profile.program)
              .single();

            if (programError) {
              console.warn('Program not found:', programError);
              setCoursesFromDb([]);
            } else {
              const programId = programData.id;
              let query = supabase
                .from('courses')
                .select('course_name')
                .eq('program_id', programId)
                .order('course_name', { ascending: true });

              // Only filter by semester if the column exists
              if (profile.semester) {
                query = query.eq('semester', profile.semester);
              }

              const { data: courses, error: coursesError } = await query;
              if (coursesError) {
                console.warn('Failed to fetch courses:', coursesError);
                setCoursesFromDb([]);
              } else {
                setCoursesFromDb(courses.map(c => c.course_name));
              }
            }
            setLoadingCourses(false);
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
        setUserProgram(localStorage.getItem('userProgram') || '');
        setUserSemester(localStorage.getItem('userSemester') || '');
      } finally {
        setLoadingUser(false);
      }
    };

    fetchUserProfileAndCourses();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        fetchUserProfileAndCourses();
      }
      if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        setUserProgram('');
        setUserSemester('');
        setCoursesFromDb([]);
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  // ── Load notes from Supabase (replaces /api/metadata) ──
  useEffect(() => {
    const loadNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('uploaded_at', { ascending: false });

        if (error) throw error;

        // Transform to match the shape expected by the rest of the component
        const transformed = (data || []).map((n) => ({
          id: n.id,
          filename: n.filename,
          program: n.program,
          semester: n.semester,          // now text
          course: n.course_name,          // map to 'course' for rendering
          description: n.description || '',
          size: n.size || '',
          uploadDate: n.uploaded_at ? new Date(n.uploaded_at).toLocaleDateString() : '',
          url: n.url || '',
          filepath: n.filepath || '',
        }));

        setNotes(transformed);

        // Compute programs and counts from the notes
        const counts = mergeSimilarPrograms(transformed);
        setProgramCounts(counts);
        setPrograms(Object.keys(counts));
      } catch (err) {
        console.error('Failed to load notes:', err);
        setNotes([]);
        setPrograms([]);
        setProgramCounts({});
      }
    };

    loadNotes();
  }, []);

  // ── Derived data (using 'notes' instead of 'files') ──
  // Notes for the user's program & semester
  const userNotes = useMemo(() => {
    if (!userProgram || !userSemester) return [];
    return notes.filter((n) => {
      const progMatch = normalizeName(n.program).includes(normalizeName(userProgram));
      const semMatch = normalizeName(n.semester).includes(normalizeName(userSemester));
      return progMatch && semMatch;
    });
  }, [notes, userProgram, userSemester]);

  // Courses to display: prefer from DB, fallback to derived from notes
  const courses = useMemo(() => {
    if (coursesFromDb.length > 0) return coursesFromDb;
    const courseSet = new Set();
    userNotes.forEach((n) => {
      if (n.course) courseSet.add(String(n.course).trim());
    });
    return Array.from(courseSet).sort();
  }, [coursesFromDb, userNotes]);

  // Notes for the selected course
  const courseNotes = useMemo(() => {
    if (!selectedCourse) return [];
    return userNotes.filter((n) => normalizeName(n.course) === normalizeName(selectedCourse));
  }, [userNotes, selectedCourse]);

  // Filtered programs for "all" view
  const filteredPrograms = useMemo(() => {
    if (!searchQuery) return programs;
    return programs.filter((p) => normalizeName(p).includes(normalizeName(searchQuery)));
  }, [programs, searchQuery]);

  // ── Handlers (unchanged) ──────────────────────────────────
  const handleProgramClick = (program) => {
    const currentCount = programCounts[program] || 0;
    const seen = JSON.parse(localStorage.getItem('programSeen') || '{}');
    seen[program] = currentCount;
    localStorage.setItem('programSeen', JSON.stringify(seen));
    navigate(`/program-detail?program=${encodeURIComponent(program)}`);
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === 'personal' ? 'all' : 'personal'));
    setSelectedCourse(null);
    setSearchQuery('');
  };

  const handleCourseClick = (course) => setSelectedCourse(course);
  const handleBackToCourses = () => setSelectedCourse(null);

  // ── Render note card helper ──────────────────────────────
  const renderNoteCard = (note) => {
    const ext = String(note.filename || '').split('.').pop()?.toLowerCase() || '';
    let icon = '📄';
    let iconClass = 'bg-blue-100 text-blue-600';
    if (['pdf'].includes(ext)) { icon = '📕'; iconClass = 'bg-red-100 text-red-600'; }
    else if (['doc', 'docx'].includes(ext)) { icon = '📘'; iconClass = 'bg-blue-100 text-blue-600'; }
    else if (['ppt', 'pptx'].includes(ext)) { icon = '📙'; iconClass = 'bg-orange-100 text-orange-600'; }
    else if (['xls', 'xlsx'].includes(ext)) { icon = '📗'; iconClass = 'bg-green-100 text-green-600'; }
    else if (['zip', 'rar'].includes(ext)) { icon = '📦'; iconClass = 'bg-gray-100 text-gray-600'; }

    return (
      <div
        key={note.id || note.filename + note.uploadDate}
        className="bg-card border border-border rounded-xl p-4 hover:shadow-lg transition-all cursor-pointer hover:border-blue-400 flex flex-col"
        onClick={() => {
          if (note.program) {
            navigate(`/program-detail?program=${encodeURIComponent(note.program)}`);
          }
        }}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${iconClass}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground truncate" title={note.filename}>
              {note.filename || 'Untitled'}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
              <span>{note.course || 'No course'}</span>
              {note.size && <span>· {note.size}</span>}
            </div>
          </div>
        </div>
        {note.description && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{note.description}</p>
        )}
        <div className="mt-3 text-xs text-muted-foreground flex items-center justify-between">
          <span>{note.program || 'Unknown program'}</span>
          <span>{note.uploadDate || ''}</span>
        </div>
      </div>
    );
  };

  // ─── Main Render (unchanged except for loading message) ──
  if (loadingUser || loadingCourses) {
    return (
      <div className="h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading your courses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">
      
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
              <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-xl font-bold text-black">
              {viewMode === 'personal' ? 'My Courses' : 'All Programs'}
            </h1>
          </div>
          {viewMode === 'personal' && userProgram && userSemester && (
            <span className="text-sm text-muted-foreground bg-white/70 px-3 py-1 rounded-full border border-border">
              {userProgram} · {userSemester}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {viewMode === 'all' && (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search programs..."
                className="pl-8 pr-3 py-1.5 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 sm:w-48"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <button
            onClick={toggleViewMode}
            className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-sm"
          >
            {viewMode === 'personal' ? 'Browse all programs' : 'Back to my courses'}
          </button>
        </div>
      </header>

      {/* ===== CONTENT ===== */}
      <div className="px-4 py-4">
        {!isLoggedIn ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg">🔒 Please log in to see your courses.</p>
            <button
              onClick={() => navigate('/login')}
              className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600"
            >
              Go to Login
            </button>
          </div>
        ) : viewMode === 'personal' ? (
          // ─── Personal View ──────────────────────────────
          <>
            {!userProgram || !userSemester ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg">👤 Please set your program and semester in profile settings.</p>
                <button
                  onClick={() => navigate('/profile')}
                  className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600"
                >
                  Go to Profile
                </button>
              </div>
            ) : userNotes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg">📭 No courses or notes found for {userProgram} · {userSemester}.</p>
                <p className="text-sm">Check back later or browse all programs.</p>
              </div>
            ) : selectedCourse ? (
              // ── Show notes for selected course ──────────
              <>
                <div className="flex items-center gap-3 mb-4">
                  <button
                    onClick={handleBackToCourses}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    ← Back to courses
                  </button>
                  <span className="text-lg font-semibold text-foreground">{selectedCourse}</span>
                  <span className="text-sm text-muted-foreground">({courseNotes.length} notes)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {courseNotes.length > 0 ? (
                    courseNotes.map((note) => renderNoteCard(note))
                  ) : (
                    <div className="col-span-full text-center py-8 text-muted-foreground">
                      No notes available for this course yet.
                    </div>
                  )}
                </div>
              </>
            ) : (
              // ── Show course list ────────────────────────
              <>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-foreground">Your Courses</h2>
                  <p className="text-sm text-muted-foreground">Select a course to see its notes</p>
                </div>
                {courses.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No courses found for your program.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {courses.map((course) => {
                      const count = userNotes.filter((n) => normalizeName(n.course) === normalizeName(course)).length;
                      return (
                        <div
                          key={course}
                          className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all cursor-pointer hover:border-blue-500 flex items-center justify-between"
                          onClick={() => handleCourseClick(course)}
                        >
                          <span className="font-medium text-foreground">{course}</span>
                          <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-full">
                            {count} note{count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          // ─── All Programs View ──────────────────────────
          <div>
            {filteredPrograms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                📚 No programs found. {searchQuery && 'Try a different search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPrograms.map((p) => {
                  const seenData = JSON.parse(localStorage.getItem('programSeen') || '{}');
                  const lastSeen = seenData[p] || 0;
                  const unread = Math.max(0, (programCounts[p] || 0) - lastSeen);
                  return (
                    <div
                      key={p}
                      className="bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-all cursor-pointer hover:border-blue-500"
                      onClick={() => handleProgramClick(p)}
                    >
                      <span className="font-medium text-foreground">{p}</span>
                      {unread > 0 && (
                        <span className="bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded-full">
                          {unread}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}