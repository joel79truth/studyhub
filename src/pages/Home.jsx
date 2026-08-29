import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from 'react';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { useNavigate, Navigate } from 'react-router-dom';
import AiStudyAssistantCard from '../components/AiCard';
import Files from '../components/Files';
import { ensureConsistentSession } from '../lib/authGuard';

const DEV = import.meta.env.DEV;
const log = DEV ? console.log : () => {};

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

// ─── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_KEY = 'homeDashboardCache';

const readCache = () => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const writeCache = (partial) => {
  try {
    const prev = readCache() || {};
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...prev, ...partial }));
  } catch {}
};

// ─── Emotional design CSS — injected once, memo'd, never re-renders ───────────
const ANIM_CSS = `
  @keyframes ed-fade-up {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ed-pop {
    0%   { transform: scale(0.7); opacity: 0; }
    65%  { transform: scale(1.12); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes ed-glow-orange {
    0%, 100% { box-shadow: 0 0 0 0 rgba(251,146,60,0); }
    50%       { box-shadow: 0 0 18px 5px rgba(251,146,60,0.2); }
  }
  @keyframes ed-glow-blue {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
    50%       { box-shadow: 0 0 14px 4px rgba(99,102,241,0.18); }
  }
  @keyframes ed-flame {
    0%, 100% { transform: scale(1) rotate(-4deg); }
    50%       { transform: scale(1.25) rotate(4deg); }
  }
  @keyframes ed-progress {
    from { width: 0%; }
  }
  .ed-fade-up    { animation: ed-fade-up 0.4s ease-out both; }
  .ed-pop        { animation: ed-pop 0.55s cubic-bezier(.34,1.56,.64,1) both; }
  .ed-glow-orange{ animation: ed-glow-orange 2.5s ease-in-out infinite; }
  .ed-glow-blue  { animation: ed-glow-blue 3s ease-in-out infinite; }
  .ed-flame      { animation: ed-flame 1.4s ease-in-out infinite; }
  .ed-progress   { animation: ed-progress 1.2s ease-out both; }
`;

const StyleInjector = memo(() => <style>{ANIM_CSS}</style>);

// ─── Static icons (hoisted — fresh JSX prop defeats memo) ────────────────────
const ExamIconSvg = (
  <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
  </svg>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────────
const DashboardSkeleton = memo(() => (
  <div className="px-4 lg:px-6 space-y-4 lg:space-y-6 animate-pulse">
    <div className="bg-card border border-border/50 rounded-2xl p-6 h-32 flex items-center justify-center">
      <div className="w-full max-w-md h-6 bg-gray-200 rounded-full" />
    </div>
    <div className="grid grid-cols-2 gap-3 lg:gap-4">
      {[1, 2].map(i => (
        <div key={i} className="bg-card border border-border/50 rounded-xl p-3 h-24">
          <div className="flex items-center justify-between mb-1">
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-8 w-8 bg-gray-200 rounded-lg" />
          </div>
          <div className="h-6 w-12 bg-gray-200 rounded mt-2" />
          <div className="h-3 w-20 bg-gray-200 rounded mt-1" />
        </div>
      ))}
    </div>
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-40 bg-gray-200 rounded" />
        <div className="h-4 w-16 bg-gray-200 rounded" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-4 p-4 bg-card border border-border/50 rounded-xl">
            <div className="w-10 h-10 bg-gray-200 rounded-lg" />
            <div className="flex-1">
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
              <div className="h-3 w-1/2 bg-gray-200 rounded mt-2" />
            </div>
            <div className="w-8 h-8 bg-gray-200 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  </div>
));

// ─── Streak Card — emotional feedback loop (Duolingo principle) ───────────────
// key={streak} on the value div re-triggers ed-pop whenever streak updates,
// giving the user an instant rewarding confirmation moment.
const StreakCard = memo(({ streak }) => {
  const isHot = streak >= 7;
  const isMilestone = streak > 0 && streak % 7 === 0;
  const daysToNext = streak > 0 ? (isMilestone ? 7 : 7 - (streak % 7)) : 7;

  return (
    <div className={`relative bg-card border rounded-xl p-3 transition-all duration-200 active:scale-95 hover:-translate-y-0.5 overflow-hidden ${
      isHot ? 'border-orange-300/70 ed-glow-orange' : 'border-border/50'
    }`}>
      {isHot && (
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-red-50/20 pointer-events-none" />
      )}
      <div className="relative flex items-center justify-between mb-1">
        <h3 className="text-xs font-medium text-muted-foreground">Learning Streak</h3>
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500 to-red-500">
          <span className="block text-sm leading-none ed-flame">🔥</span>
        </div>
      </div>
      <div key={streak} className="relative text-xl font-bold text-foreground ed-pop">
        {streak} days
      </div>
      {isMilestone ? (
        <p className="text-[10px] font-semibold text-orange-500 animate-pulse">🎉 Milestone reached!</p>
      ) : streak > 0 ? (
        <p className="text-[10px] text-muted-foreground">{daysToNext} day{daysToNext !== 1 ? 's' : ''} to next milestone</p>
      ) : (
        <p className="text-[10px] text-muted-foreground">Start your streak today</p>
      )}
    </div>
  );
});

// ─── Exam Countdown Card — with animated progress bar (Revolut principle) ─────
const ExamCountdownCard = memo(({ daysLeft, daysDelta }) => {
  const SEMESTER_DAYS = 120;
  const progress = daysLeft > 0
    ? Math.max(4, Math.min(96, ((SEMESTER_DAYS - daysLeft) / SEMESTER_DAYS) * 100))
    : 100;
  const isUrgent = daysLeft > 0 && daysLeft <= 14;
  const isClose  = daysLeft > 0 && daysLeft <= 30;

  return (
    <div className={`bg-card border rounded-xl p-3 transition-all duration-200 active:scale-95 hover:-translate-y-0.5 overflow-hidden ${
      isUrgent ? 'border-blue-400/60 ed-glow-blue' : 'border-border/50'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-medium text-muted-foreground">Days Until Exams</h3>
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
          {ExamIconSvg}
        </div>
      </div>
      <div key={daysLeft} className="text-xl font-bold text-foreground ed-pop">{daysLeft}</div>
      {daysDelta && <p className="text-[10px] text-muted-foreground mb-2">{daysDelta}</p>}
      {daysLeft > 0 && (
        <div className="h-1 bg-border/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ed-progress ${
              isClose
                ? 'bg-gradient-to-r from-blue-500 to-purple-500'
                : 'bg-gradient-to-r from-blue-400 to-cyan-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
});

// ─── Main Home Component ──────────────────────────────────────────────────────
const Home = () => {
  const navigate = useNavigate();
  const initialCache = useMemo(readCache, []);

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [userData, setUserData] = useState(initialCache?.userData ?? null);
  const [loading, setLoading] = useState(!initialCache?.userData);
  const [streak, setStreak] = useState(initialCache?.streak ?? 0);
  const [daysLeft, setDaysLeft] = useState(initialCache?.daysLeft ?? 0);
  const [daysDelta, setDaysDelta] = useState(initialCache?.daysDelta ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollContainerRef = useRef(null);

  const [showProfileForm, setShowProfileForm] = useState(false);
  const [program, setProgram] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');
  const [role, setRole] = useState('');
  const [lecturerCode, setLecturerCode] = useState('');
  const [programs, setPrograms] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({ program: false, semester: false, year: false, role: false, code: false });
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  // Surfaces a persistent, visible error banner in the profile form instead of
  // relying solely on a blocking alert() — alerts can be dismissed instantly
  // on mobile and the reason for the failure gets lost.
  const [profileError, setProfileError] = useState('');

  const fetchRequestId = useRef(0);
  const lastFetchedUserId = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const LECTURER_SECRET = import.meta.env.VITE_LECTURER_SECRET || "LUANAR-FACULTY-2026";

  const loadPrograms = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('programs').select('id, name, campus, level').order('name', { ascending: true });
      if (error) throw error;
      setPrograms(data || []);
    } catch (err) { console.error('Failed to load programs:', err); }
  }, []);

  useEffect(() => {
    if (showProfileForm && programs.length === 0) loadPrograms();
  }, [showProfileForm, programs.length, loadPrograms]);

  const calculateExamCountdown = useCallback(() => {
    const examDate = new Date(2026, 5, 17);
    const now = new Date();
    const diffDays = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
    let delta = '';
    if (diffDays > 0) { setDaysLeft(diffDays); delta = 'days left until exams'; }
    else if (diffDays === 0) { setDaysLeft(0); delta = 'Exams start today!'; }
    else { setDaysLeft(0); delta = 'Exams are over'; }
    setDaysDelta(delta);
    return { diffDays, delta };
  }, []);

  const loadUserProfile = useCallback(async (authUser) => {
    const currentRequestId = ++fetchRequestId.current;
    lastFetchedUserId.current = authUser.id;
    try {
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (error) throw error;
      if (currentRequestId !== fetchRequestId.current) return;

      if (!profile) {
        setShowProfileForm(true);
        setUserData({ displayName: authUser.user_metadata?.full_name || authUser.email, email: authUser.email });
        setLoading(false);
        return;
      }

      const hasProgram = profile.program && profile.program.trim().length > 0;
      const hasSemester = profile.semester > 0 && profile.semester <= 8;
      const hasYear = profile.year_of_study > 0 && profile.year_of_study <= 4;
      const hasRole = profile.role === 'Student' || profile.role === 'Lecturer';
      // NOTE: previously this omitted `hasRole`, so a row missing `role`
      // could still be treated as "complete" and skip the profile form.
      const isComplete = hasProgram && hasSemester && hasYear && hasRole;

      if (!isComplete) {
        setShowProfileForm(true);
        setUserData({ displayName: authUser.user_metadata?.full_name || authUser.email, email: authUser.email, program: profile.program || '', semester: profile.semester ?? '', year: profile.year_of_study ?? '', role: profile.role || '' });
        setProgram(profile.program || '');
        setSemester(profile.semester ?? '');
        setYear(profile.year_of_study ?? '');
        setRole(profile.role || '');
        setLoading(false);
        return;
      }

      setShowProfileForm(false);
      const nextUserData = { displayName: authUser.user_metadata?.full_name || authUser.email, email: authUser.email, program: profile.program, semester: profile.semester, year: profile.year_of_study, role: profile.role };
      setUserData(nextUserData);

      const today = new Date().toDateString();
      const lastActive = profile.last_active ? new Date(profile.last_active).toDateString() : null;
      let newStreak = profile.streak || 0;
      const wasAlreadyActiveToday = lastActive === today;
      if (!wasAlreadyActiveToday) {
        newStreak = lastActive === new Date(Date.now() - 86400000).toDateString() ? newStreak + 1 : 1;
        supabase.from('profiles').upsert({ id: authUser.id, streak: newStreak, last_active: new Date().toISOString() })
          .then(({ error: upsertErr }) => { if (upsertErr) console.error('Streak update failed:', upsertErr); });
      }
      setStreak(newStreak);
      const { diffDays, delta } = calculateExamCountdown();
      writeCache({ userData: nextUserData, streak: newStreak, daysLeft: diffDays, daysDelta: delta });
      setLoading(false);
    } catch (err) {
      // A 406/permission-shaped error here almost always means the SELECT
      // RLS policy on `profiles` isn't matching this user (or the JWT going
      // out with this request is stale/expired) rather than "no profile yet".
      // We still fall back to the form so the user isn't stuck on a blank
      // screen, but we log loudly so it isn't confused with the true
      // "brand-new user, no row" case.
      console.error('Error loading profile (check RLS policy / auth token):', err);
      setShowProfileForm(true);
      setLoading(false);
    }
  }, [calculateExamCountdown]);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        const isNewUser = lastFetchedUserId.current !== session.user.id;
        if (isNewUser || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          if (isNewUser || !userData) {
            // On mobile especially, `session` from this callback can be a
            // cached/in-memory value that's momentarily out of sync with what
            // the underlying fetch client will actually send as the bearer
            // token. Forcing a getSession() read here makes sure we only
            // query RLS-protected tables once the client confirms it has a
            // live session — this is what was causing 406/403s on phone
            // while the same code worked fine on PC.
            (async () => {
              // Validate the session is internally consistent (user.id
              // matches the access_token's `sub` claim) BEFORE trusting it
              // for any RLS-protected query. A corrupted session — where
              // these two disagree — causes every write to silently 403
              // with "row-level security policy" even though the UI looks
              // signed in as the right user. See authGuard.js for details.
              const ok = await ensureConsistentSession();
              if (!mounted) return;
              if (!ok) {
                // Session was corrupted and has been cleared. Treat as
                // logged out rather than firing doomed RLS-blocked requests.
                setUser(null);
                setUserData(null);
                setShowProfileForm(false);
                sessionStorage.removeItem(CACHE_KEY);
                lastFetchedUserId.current = null;
                setLoading(false);
                return;
              }

              const { data: { session: liveSession } } = await supabase.auth.getSession();
              if (!mounted) return;
              if (liveSession?.user) {
                loadUserProfile(liveSession.user);
              } else {
                // Session claimed to exist in the event but isn't actually
                // live — treat as logged out rather than firing a doomed
                // RLS-blocked request.
                setLoading(false);
              }
            })();
          }
        }
      } else if (event === 'SIGNED_OUT' || !session) {
        setUser(null); setUserData(null); setShowProfileForm(false);
        sessionStorage.removeItem(CACHE_KEY); lastFetchedUserId.current = null; setLoading(false);
      }
      setAuthReady(true);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUserProfile]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => { setIsScrolled(container.scrollTop > 50); ticking = false; });
        ticking = true;
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const getPersonalizedDescription = useMemo(() => {
    if (daysLeft > 0 && daysLeft <= 30) return `⚡ ${daysLeft} days until exams – let's crush it!`;
    if (streak > 0 && streak % 7 === 0) return `🔥 ${streak}‑day streak! You're unstoppable!`;
    if (daysLeft > 30) return "🎯 How to get a 3.7 GPA this semester?";
    const messages = ["Ask anything. Get answers.", "💪 Crush your goals today!", "📚 Every question answered.", "🚀 You've got this!"];
    return messages[(streak + daysLeft) % messages.length];
  }, [daysLeft, streak]);

  const displayName = user?.email?.split('@')[0] || userData?.displayName || 'User';
  const initials = useMemo(() => {
    const names = displayName.trim().split(' ');
    return (names.length === 1 ? names[0][0] : names[0][0] + names[names.length - 1][0]).toUpperCase();
  }, [displayName]);

  // Time-of-day greeting — warm, human first impression, with a streak/exam-
  // aware subtext so the welcome moment reacts to what's actually happening
  // for this user right now (the "feels alive, not generic" principle).
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const timeGreeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

    let subtext = 'Continue your learning journey';
    if (streak >= 3) subtext = `🔥 ${streak}-day streak — keep it going`;
    else if (daysLeft > 0 && daysLeft <= 7) subtext = `⚡ ${daysLeft} days to exams — stay sharp`;

    return { timeGreeting, subtext };
  }, [streak, daysLeft]);

  const handleNavigation = useCallback((path) => navigate(path), [navigate]);

  const handleProfileSubmit = useCallback(async (e) => {
    e.preventDefault();
    setProfileError('');
    setFieldErrors({ program: false, semester: false, year: false, role: false, code: false });
    const errors = { program: false, semester: false, year: false, role: false, code: false };
    let valid = true;
    if (!program || program.trim().length === 0) { errors.program = true; valid = false; }
    const semesterNum = parseInt(semester, 10);
    if (isNaN(semesterNum) || semesterNum < 1 || semesterNum > 8) { errors.semester = true; valid = false; }
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1 || yearNum > 4) { errors.year = true; valid = false; }
    if (!role) { errors.role = true; valid = false; }
    if (role === 'Lecturer' && lecturerCode !== LECTURER_SECRET) { errors.code = true; valid = false; }
    if (!valid) { setFieldErrors(errors); return; }
    setProfileSubmitting(true);
    try {
      // Guard against submitting with a dead/expired/corrupted session.
      // ensureConsistentSession() catches the case where user.id and the
      // access_token's sub claim have diverged (which previously produced
      // a 42501 RLS violation even though liveSession.user looked valid).
      const ok = await ensureConsistentSession();
      if (!ok) {
        throw new Error('Your session was invalid and has been cleared — please sign in again.');
      }

      const { data: { session: liveSession } } = await supabase.auth.getSession();
      if (!liveSession?.user) {
        throw new Error('Your session expired — please sign in again.');
      }

      const updateData = { id: liveSession.user.id, program: program.trim(), semester: semesterNum, year_of_study: yearNum, role, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('profiles').upsert(updateData, { onConflict: 'id' }).select();
      if (error) throw error;
      setShowProfileForm(false);
      setUserData(prev => ({ ...prev, program: updateData.program, semester: updateData.semester, year: updateData.year_of_study, role: updateData.role }));
      await loadUserProfile(liveSession.user);
    } catch (err) {
      console.error('Profile update error:', err);
      // RLS violations surface here as `err.message` containing
      // "row-level security policy" — show that verbatim so it's obvious
      // this is a policy problem, not a form-validation problem.
      setProfileError(err.message || 'Failed to save profile. Please try again.');
      if (err.message?.includes('session was invalid') || err.message?.includes('session expired')) {
        navigate('/login', { replace: true });
      }
    } finally {
      setProfileSubmitting(false);
    }
  }, [program, semester, year, role, lecturerCode, LECTURER_SECRET, loadUserProfile, navigate]);

  const handleFileClick = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) { alert('File URL not available.'); return; }
    navigate('/viewer', { state: { url, filename: file.filename || 'Document' } });
  }, [navigate]);

  // ─── Cold-start skeleton ───────────────────────────────────────────────────
  if (!authReady && loading) {
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <StyleInjector />
        <div className="flex-shrink-0 sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 rounded-lg animate-pulse" />
              <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4">
          <DashboardSkeleton />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (authReady && !user && !loading) return <Navigate to="/login" replace />;

  // ─── Profile form — polished first impression (Revolut principle) ──────────
  if (showProfileForm) {
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <StyleInjector />
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-white/50 overflow-hidden ed-fade-up">
            {/* Rich gradient header — communicates quality on first impression */}
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 px-6 py-5 text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <span className="text-2xl">✍️</span>
              </div>
              <h2 className="text-xl font-bold text-white">Complete your profile</h2>
              <p className="text-sm text-white/80 mt-1">Just a few details to personalise your dashboard</p>
            </div>
            <div className="p-6">
              {profileError && (
                <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700" role="alert">
                  {profileError}
                </div>
              )}
              <form onSubmit={handleProfileSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Programme of study <span className="text-red-500">*</span></label>
                  <select value={program} onChange={(e) => setProgram(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.program ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">— Select programme —</option>
                    {programs.map((p) => (<option key={p.id} value={p.name}>{p.name} ({p.campus})</option>))}
                  </select>
                  {fieldErrors.program && <p className="text-red-500 text-xs mt-1" role="alert">Program is required</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester <span className="text-red-500">*</span></label>
                  <select value={semester} onChange={(e) => setSemester(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.semester ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Select semester</option>
                    {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Semester {s}</option>)}
                  </select>
                  {fieldErrors.semester && <p className="text-red-500 text-xs mt-1" role="alert">Select a valid semester (1–8)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year of study <span className="text-red-500">*</span></label>
                  <select value={year} onChange={(e) => setYear(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.year ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Select year</option>
                    {[1,2,3,4].map(y => <option key={y} value={y}>Year {y}</option>)}
                  </select>
                  {fieldErrors.year && <p className="text-red-500 text-xs mt-1" role="alert">Select a valid year (1–4)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role <span className="text-red-500">*</span></label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.role ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Choose role</option>
                    <option value="Student">Student</option>
                    <option value="Lecturer">Lecturer</option>
                  </select>
                  {fieldErrors.role && <p className="text-red-500 text-xs mt-1" role="alert">Role is mandatory</p>}
                </div>
                {role === 'Lecturer' && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lecturer authorization code</label>
                    <input type="password" value={lecturerCode} onChange={(e) => setLecturerCode(e.target.value)}
                      className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.code ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      placeholder="Enter secure code" />
                    {fieldErrors.code && <p className="text-red-500 text-xs mt-1" role="alert">Invalid lecturer code</p>}
                  </div>
                )}
                <button type="submit" disabled={profileSubmitting}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all active:scale-[0.98] disabled:opacity-70">
                  {profileSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Saving…
                    </span>
                  ) : '🚀 Access Dashboard'}
                </button>
              </form>
            </div>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // ==================== MAIN DASHBOARD ====================
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50 overflow-hidden">
      <StyleInjector />

      {/* MOBILE HEADER */}
      <div className="lg:hidden flex-shrink-0 sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border">
        <div className="flex items-center justify-between py-3 px-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 -ml-2 hover:bg-accent active:scale-90 rounded-md transition-transform" aria-label="Toggle menu">
              <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden">
                <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" loading="eager" />
              </div>
              <h1 className="text-lg font-medium">
                <span className="text-black">StudyHub</span>
                <span className="text-green-700"> LUANAR</span>
              </h1>
            </div>
          </div>
          <button onClick={() => handleNavigation('/profile')} className="flex flex-col items-center p-2 -mr-2 active:scale-90 transition-transform">
            <img src={localStorage.getItem('userProfilePic') || "https://cdn-icons-png.flaticon.com/512/847/847969.png"} alt="Profile" className="w-8 h-8 rounded-full border-2 border-blue-500" loading="eager" />
            <span className="text-xs font-semibold text-blue-500 mt-0.5">You</span>
          </button>
        </div>

        {/* Time-of-day greeting — pure black text, tighter tracking, reacts to streak/exam proximity */}
        <div className={`bg-gradient-to-br from-blue-50/80 to-purple-50/80 transition-[opacity,max-height,padding] duration-200 ${
          isScrolled ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-20 p-3'
        }`}>
          <div className="text-center space-y-0.5 ed-fade-up">
            <h2 className="text-sm font-medium tracking-tight text-black">
              {greeting.timeGreeting}, <span className="font-semibold">{displayName}</span> 👋
            </h2>
            <p className="text-xs text-black/70">{greeting.subtext}</p>
          </div>
        </div>
      </div>

      {/* DESKTOP HEADER */}
      <div className="hidden lg:block flex-shrink-0 px-6 py-6 space-y-4 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-left space-y-1 ed-fade-up">
          <h1 className="text-2xl font-medium tracking-tight text-black">
            {greeting.timeGreeting}, <span className="font-semibold">{displayName}</span> 👋
          </h1>
          <p className="text-sm text-black/70">{greeting.subtext} 🚀</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search courses, instructors, or topics..."
              className="w-full pl-10 pr-4 py-2.5 bg-card/50 border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-foreground placeholder:text-muted-foreground text-sm transition-shadow"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-card/50 border border-border/50 rounded-lg hover:bg-accent active:scale-95 transition-transform text-foreground text-sm">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/>
            </svg>
            Filter
          </button>
        </div>
      </div>

      {/* SCROLLABLE MAIN CONTENT */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 lg:px-6 pb-4 space-y-4 lg:space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* AI card — staggered fade-up entrance */}
        <div className="ed-fade-up" style={{ animationDelay: '0.05s' }}>
          <AiStudyAssistantCard onAskClick={() => navigate('/AiChat')} description={getPersonalizedDescription} />
        </div>

        {/* Stats — emotional feedback cards with glow & micro-interactions */}
        <div className="grid grid-cols-2 gap-3 lg:gap-4 ed-fade-up" style={{ animationDelay: '0.1s' }}>
          <ExamCountdownCard daysLeft={daysLeft} daysDelta={daysDelta} />
          <StreakCard streak={streak} />
        </div>

        {/* Files section — staggered entrance */}
        <div className="space-y-4 ed-fade-up" style={{ animationDelay: '0.15s' }}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium text-foreground">Recently Uploaded</h2>
              <button onClick={() => handleNavigation('/my_courses')} className="text-xs font-medium text-blue-600 hover:text-blue-700 active:scale-95 transition-transform">
                View All
              </button>
            </div>
            <Files searchQuery={debouncedSearch} limit={6} onFileClick={handleFileClick} profile={userData} />
          </div>
        </div>
        <div className="h-4 lg:h-8" />
      </div>

      <BottomNav />

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />
      )}

      <div className={`lg:hidden fixed top-0 left-0 h-full w-64 bg-white border-r border-border transform transition-transform duration-200 ease-out will-change-transform z-50 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-end p-4">
          <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-accent active:scale-90 rounded-md transition-transform" aria-label="Close menu">
            <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m18 6-12 12"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
        <div className="px-6 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-medium">{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{userData?.role || 'Student'}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-6">
          <ul className="space-y-2">
            {[
              { path: '/upload', label: 'Upload Notes', primary: true, icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>) },
              { path: '/course', label: 'My Courses', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/></svg>) },
              { path: '/timetable', label: 'Timetable', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>) },
              { path: '/request', label: 'Request Notes', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21,13.89 7,23 12,20 17,23 15.79,13.88"/></svg>) },
              { path: '/profile', label: 'Profile', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>) },
              { path: '/settings', label: 'Settings', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15-.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>) },
            ].map(({ path, label, icon, primary }) => (
              <li key={path}>
                <button onClick={() => { handleNavigation(path); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 active:scale-95 text-left ${
                    primary
                      ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 hover:shadow-md'
                      : 'hover:bg-accent text-foreground/80'
                  }`}>
                  {icon}{label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="p-6">
          <div className="h-px bg-border mb-4" />
          <div className="text-xs text-muted-foreground text-center">© 2024 EduApp. All rights reserved.</div>
        </div>
      </div>
    </div>
  );
};

export default Home;