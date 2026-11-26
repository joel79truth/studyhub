import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { supabase } from '../supabase';
import { ensureConsistentSession } from '../lib/authGuard';
import { API_BASE_URL } from '../lib/apiConfig';
import SemesterDial from '../components/SemesterDial';
import {
  GraduationCap,
  BookOpen,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  UserCheck,
  Search,
  ChevronDown,
  Sparkles,
  Calendar,
  Layers,
  ShieldCheck,
  Check,
  Lock,
} from 'lucide-react';
import appLogo from '/images/luanar7.png';

// Fallback list of LUANAR university programmes
const FALLBACK_PROGRAMS = [
  { id: 'prog-basics', name: 'Basics', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-agribus', name: 'BSc Agribusiness Management', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-agron', name: 'BSc Agronomy', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-agrecon', name: 'BSc Agricultural Economics', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-agredu', name: 'BSc Agricultural Education', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-animsci', name: 'BSc Animal Science', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-biotech', name: 'BSc Biotechnology', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-comsci', name: 'BSc Computer Science', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-commdev', name: 'BSc Community Development', campus: 'NRC', level: 'Undergraduate' },
  { id: 'prog-envsci', name: 'BSc Environmental Science & Technology', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-foodsci', name: 'BSc Food Science & Technology', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-forestry', name: 'BSc Forestry', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-hort', name: 'BSc Horticulture', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-irrig', name: 'BSc Irrigation Engineering', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-nutri', name: 'BSc Nutrition & Dietetics', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-soilsci', name: 'BSc Soil Science', campus: 'Bunda', level: 'Undergraduate' },
  { id: 'prog-vetmed', name: 'BSc Veterinary Medicine', campus: 'Bunda', level: 'Undergraduate' },
];

function isBasicsRequired(yearNum, semNum) {
  return Number(yearNum) === 1 && (Number(semNum) === 1 || Number(semNum) === 2);
}

function findBasicsEntry(list) {
  return (list || []).find((p) => /^basics$/i.test((p.name || '').trim())) || { id: 'prog-basics', name: 'Basics' };
}

function resolveEffectiveProgram(rawProg, yearNum, semNum) {
  if (isBasicsRequired(yearNum, semNum)) {
    return 'Basics';
  }
  return (rawProg || '').trim() || 'Basics';
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [rolePath, setRolePath] = useState(
    location.state?.defaultRole || (location.search.includes('role=lecturer') ? 'lecturer' : 'student')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Current active session user if already signed in
  const [currentUser, setCurrentUser] = useState(null);

  // ── Lecturer specific state ──
  const [lecturerPassword, setLecturerPassword] = useState('');
  const [lecturerName, setLecturerName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ── Student specific academic state ──
  const [programsList, setProgramsList] = useState(FALLBACK_PROGRAMS);
  const [studentYear, setStudentYear] = useState(1);
  const [studentSemester, setStudentSemester] = useState(1);
  const [studentProgram, setStudentProgram] = useState(() => {
    // Enforce Year 1 Sem 1 -> Basics even on initial mount
    if (isBasicsRequired(1, 1)) return 'Basics';
    return localStorage.getItem('studyhub_upload_program_name') || 'Basics';
  });
  const [studentProgramId, setStudentProgramId] = useState(() => {
    if (isBasicsRequired(1, 1)) return 'prog-basics';
    return localStorage.getItem('studyhub_upload_program_id') || '';
  });

  // Remember non-Basics degree choice if user temporarily toggles Year 1 Sem 1/2
  const preferredDegreeRef = useRef(null);

  // Program search & dropdown state
  const [programSearch, setProgramSearch] = useState('');
  const [isProgramDropdownOpen, setIsProgramDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const basicsLocked = isBasicsRequired(studentYear, studentSemester);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsProgramDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // ─── Initialize SocialLogin once (only on native) ───
  useEffect(() => {
    const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    if (isCapacitor) {
      SocialLogin.initialize({
        google: {
          webClientId: '985257842533-buh0i8r3jb1gtu1rbod1lql940ckn0hk.apps.googleusercontent.com',
        }
      }).catch((e) => console.error('SocialLogin init error:', e));
    }
  }, []);

  // ─── Load Programs from database ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error: progErr } = await supabase
          .from('programs')
          .select('id, name, campus, level')
          .order('name');
        if (!progErr && data && data.length > 0 && mounted) {
          const basicsEntry = data.find((p) => /^basics$/i.test(p.name));
          const otherEntries = data.filter((p) => !/^basics$/i.test(p.name));
          const sorted = basicsEntry ? [basicsEntry, ...otherEntries] : data;
          setProgramsList(sorted);
          if (basicsEntry) {
            setStudentProgramId((prevId) => (prevId === 'prog-basics' ? basicsEntry.id : prevId));
          }
        }
      } catch {
        // Keeps fallback list safely
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ─── Programmatic Year / Semester / Program Handlers ───
  const applyAcademicChange = useCallback(
    (nextYear, nextSem) => {
      const mustBasics = isBasicsRequired(nextYear, nextSem);
      if (mustBasics) {
        if (studentProgram && !/^basics$/i.test(studentProgram.trim())) {
          preferredDegreeRef.current = { name: studentProgram, id: studentProgramId };
        }
        const basicsEntry = findBasicsEntry(programsList);
        setStudentProgram(basicsEntry.name);
        setStudentProgramId(basicsEntry.id);
        setIsProgramDropdownOpen(false);
      } else if (/^basics$/i.test((studentProgram || '').trim()) && preferredDegreeRef.current) {
        setStudentProgram(preferredDegreeRef.current.name);
        setStudentProgramId(preferredDegreeRef.current.id);
      }
    },
    [programsList, studentProgram, studentProgramId]
  );

  const handleYearSelect = useCallback(
    (yr) => {
      setStudentYear(yr);
      applyAcademicChange(yr, studentSemester);
      setError('');
    },
    [studentSemester, applyAcademicChange]
  );

  const handleSemesterSelect = useCallback(
    (sem) => {
      const clamped = Math.min(8, Math.max(1, Number(sem) || 1));
      setStudentSemester(clamped);
      applyAcademicChange(studentYear, clamped);
      setError('');
    },
    [studentYear, applyAcademicChange]
  );

  const handleProgramSelect = useCallback(
    (prog) => {
      if (isBasicsRequired(studentYear, studentSemester)) {
        const basicsEntry = findBasicsEntry(programsList);
        setStudentProgram(basicsEntry.name);
        setStudentProgramId(basicsEntry.id);
        setIsProgramDropdownOpen(false);
        setProgramSearch('');
        return;
      }
      setStudentProgram(prog.name);
      setStudentProgramId(prog.id || '');
      if (!/^basics$/i.test(prog.name)) {
        preferredDegreeRef.current = { name: prog.name, id: prog.id || '' };
      } else {
        preferredDegreeRef.current = null;
      }
      setIsProgramDropdownOpen(false);
      setProgramSearch('');
      setError('');
    },
    [studentYear, studentSemester, programsList]
  );

  // ─── Check existing session and pending setups ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session?.user) {
        setCurrentUser(session.user);
        const metaRole = String(
          session.user.app_metadata?.role ||
          session.user.user_metadata?.role ||
          ''
        ).toLowerCase();
        const metaAdmin = Boolean(
          session.user.user_metadata?.is_admin ||
          session.user.app_metadata?.is_admin ||
          session.user.user_metadata?.admin
        );

        // Complete pending student OAuth setup if redirected back to /login
        const pendingProg = localStorage.getItem('studyhub_pending_program');
        const pendingYear = localStorage.getItem('studyhub_pending_year');
        const pendingSem = localStorage.getItem('studyhub_pending_semester');

        if (pendingProg && (metaRole === 'student' || !metaRole)) {
          const yrNum = parseInt(pendingYear, 10) || 1;
          const semNum = parseInt(pendingSem, 10) || 1;
          const effectiveProg = resolveEffectiveProgram(pendingProg, yrNum, semNum);
          await supabase.from('profiles').upsert({
            id: session.user.id,
            program: effectiveProg,
            year_of_study: yrNum,
            semester: semNum,
            role: 'Student',
            profile_complete: true,
            email: session.user.email,
            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Student',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' }).catch(() => {});

          localStorage.removeItem('studyhub_pending_program');
          localStorage.removeItem('studyhub_pending_program_id');
          localStorage.removeItem('studyhub_pending_year');
          localStorage.removeItem('studyhub_pending_semester');
          navigate('/', { replace: true });
          return;
        }

        // Preserve existing lecturer immediate landing on upload page
        if (metaRole === 'lecturer' || metaRole === 'admin' || metaAdmin) {
          navigate('/upload', { replace: true });
        }
      }
    })();
    return () => { mounted = false; };
  }, [navigate]);

  // Filtered programs for search
  const filteredPrograms = useMemo(() => {
    if (!programSearch.trim()) return programsList;
    const q = programSearch.toLowerCase();
    return programsList.filter(
      (p) => p.name.toLowerCase().includes(q) || p.campus?.toLowerCase().includes(q)
    );
  }, [programsList, programSearch]);

  // ─── Helper: Perform Google Sign-in and return user ───
  const executeGoogleSignIn = async ({ effectiveProgram, effectiveProgramId } = {}) => {
    const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

    if (isCapacitor) {
      const result = await SocialLogin.login({
        provider: 'google',
        options: {
          scopes: ['profile', 'email'],
          filterByAuthorizedAccounts: false,
        }
      });

      const idToken =
        result.idToken ||
        result.credential?.idToken ||
        result.result?.idToken ||
        result.result?.credential?.idToken;

      if (!idToken) {
        throw new Error('Google sign-in did not return an ID token');
      }

      const { data: authData, error: sbError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (sbError) throw sbError;
      return authData.user;
    } else {
      if (rolePath === 'student' && effectiveProgram) {
        localStorage.setItem('studyhub_pending_program', effectiveProgram);
        if (effectiveProgramId) {
          localStorage.setItem('studyhub_pending_program_id', String(effectiveProgramId));
        }
        localStorage.setItem('studyhub_pending_year', String(studentYear));
        localStorage.setItem('studyhub_pending_semester', String(studentSemester));
      }

      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (oauthErr) throw oauthErr;
      return null;
    }
  };

  // ─── Student Sign-In Handler ───
  const handleStudentSignIn = async () => {
    const yearNum = Math.min(4, Math.max(1, Number(studentYear) || 1));
    const semNum = Math.min(8, Math.max(1, Number(studentSemester) || 1));
    const basicsEntry = findBasicsEntry(programsList);

    // Programmatic validation & Basics enforcement
    const effectiveProgram = isBasicsRequired(yearNum, semNum)
      ? basicsEntry.name
      : (studentProgram || '').trim();
    const effectiveProgramId = isBasicsRequired(yearNum, semNum)
      ? basicsEntry.id
      : (programsList.find((p) => p.name.toLowerCase() === effectiveProgram.toLowerCase())?.id || studentProgramId);

    if (!effectiveProgram) {
      setError('Please select your programme of study to continue.');
      return;
    }

    // Keep state synchronized with enforced effective selection
    if (effectiveProgram !== studentProgram) setStudentProgram(effectiveProgram);
    if (String(effectiveProgramId) !== String(studentProgramId)) setStudentProgramId(effectiveProgramId);

    setLoading(true);
    setError('');

    try {
      let targetUser = currentUser;
      if (!targetUser) {
        targetUser = await executeGoogleSignIn({ effectiveProgram, effectiveProgramId });
        if (!targetUser) {
          // Web OAuth will redirect the page
          return;
        }
      }

      const studentName = targetUser.user_metadata?.full_name || targetUser.email?.split('@')[0] || 'Student';

      // 1. Save complete academic profile to database
      await supabase.from('profiles').upsert({
        id: targetUser.id,
        email: targetUser.email,
        name: studentName,
        program: effectiveProgram,
        program_id: effectiveProgramId || undefined,
        semester: semNum,
        year_of_study: yearNum,
        role: 'Student',
        is_admin: false,
        admin: false,
        profile_complete: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' }).catch((e) => console.warn('profiles upsert error:', e));

      // 2. Update auth user metadata
      await supabase.auth.updateUser({
        data: {
          role: 'Student',
          program: effectiveProgram,
          semester: semNum,
          year: yearNum,
          profile_complete: true,
        }
      }).catch(() => {});

      // 3. Pre-seed local cache so Home renders immediately
      localStorage.setItem('studyhub_upload_program_name', effectiveProgram);
      if (effectiveProgramId) localStorage.setItem('studyhub_upload_program_id', String(effectiveProgramId));
      localStorage.setItem('studyhub_upload_semester', String(semNum));
      localStorage.setItem('studyhub_user_role', 'Student');
      localStorage.setItem('homeDashboardCache', JSON.stringify({
        userData: {
          displayName: studentName,
          email: targetUser.email,
          program: effectiveProgram,
          semester: semNum,
          year: yearNum,
          role: 'Student',
        },
        updatedAt: Date.now(),
      }));

      await ensureConsistentSession();
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Student sign-in error:', err?.message || 'Sign-in failed');
      setError(err.message || 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Lecturer Path: Server Password Verification + Account Selection ───
  const handleLecturerAuthAndSelectEmail = async (forceNewAccount = false) => {
    const trimmedPassword = lecturerPassword.trim();
    if (!trimmedPassword) {
      setError('Please enter your lecturer access password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Verify credentials exclusively on the backend (zero hardcoded secrets in frontend)
      const { data: { session: preSession } } = await supabase.auth.getSession();
      const preHeaders = { 'Content-Type': 'application/json' };
      if (preSession?.access_token && !forceNewAccount) {
        preHeaders['Authorization'] = `Bearer ${preSession.access_token}`;
      }

      let verifyRes;
      try {
        verifyRes = await fetch(`${API_BASE_URL}/api/auth/lecturer-verify`, {
          method: 'POST',
          headers: preHeaders,
          body: JSON.stringify({
            password: trimmedPassword,
            name: lecturerName.trim() || undefined,
            verifyOnly: true,
          }),
        });
      } catch {
        throw new Error('Unable to reach the verification server. Please check your internet connection and try again.');
      }

      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        throw new Error(
          verifyData.error ||
          verifyData.message ||
          'Incorrect lecturer access password. Please check your department credentials and try again.'
        );
      }

      const verificationGrant = verifyData.verificationGrant || null;

      // 2. Select Google Email or use existing
      let targetUser = currentUser;

      if (!targetUser || forceNewAccount) {
        const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
        if (!isCapacitor && verificationGrant) {
          // Store only opaque short-lived grant (NEVER the password) across Web OAuth redirect
          try {
            localStorage.setItem('studyhub_pending_lecturer', JSON.stringify({
              grant: verificationGrant,
              name: lecturerName.trim() || '',
              ts: Date.now(),
            }));
            } catch { /* ignore storage error */ }
        }

        targetUser = await executeGoogleSignIn();
        if (!targetUser) {
          // On web, signInWithOAuth redirects the page
          return;
        }
      }

      // 3. Upgrade user in database & auth metadata
      const displayName =
        lecturerName.trim() ||
        targetUser.user_metadata?.full_name ||
        targetUser.email?.split('@')[0] ||
        'Lecturer';

      const { error: upsertErr } = await supabase.from('profiles').upsert({
        id: targetUser.id,
        role: 'lecturer',
        is_admin: true,
        admin: true,
        name: displayName,
        email: targetUser.email,
        profile_complete: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (upsertErr) {
        console.warn('profiles upsert warning:', upsertErr.message);
      }

      await supabase.auth.updateUser({
        data: {
          role: 'lecturer',
          is_admin: true,
          admin: true,
          full_name: displayName,
          contributor_unlocked: true,
        }
      }).catch(() => {});

      localStorage.setItem('studyhub_lecturer_unlocked', 'true');
      localStorage.setItem('studyhub_user_role', 'lecturer');
      localStorage.setItem('studyhub_is_admin', 'true');

      // 4. Confirm with backend using active Bearer token
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${API_BASE_URL}/api/auth/lecturer-verify`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            password: trimmedPassword,
            verificationGrant: verificationGrant || undefined,
            name: displayName,
          }),
        }).catch(() => {});
      }

      setLecturerPassword('');
      await ensureConsistentSession();
      // Preserve immediate landing on Upload portal
      navigate('/admin/upload', { replace: true });
    } catch (err) {
      console.error('Lecturer verification error:', err?.message || 'Verification failed');
      setError(err.message || 'Failed to authenticate lecturer access. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Authoritative preview state
  const effectivePreview = useMemo(() => {
    return resolveEffectiveProgram(studentProgram, studentYear, studentSemester);
  }, [studentProgram, studentYear, studentSemester]);

  return (
    <div className="min-h-[100dvh] w-full flex flex-col justify-start sm:justify-center items-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-3 sm:p-5 overflow-y-auto overflow-x-hidden">
      {/* Decorative ambient glowing backdrops */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="my-auto relative w-full max-w-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl p-4 sm:p-7 shadow-2xl border border-white/40 dark:border-slate-800">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-5">
          <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden shadow-lg ring-4 ring-blue-500/20 mb-2.5">
            <img
              src={appLogo}
              alt="LUANAR StudyHub"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/60 dark:border-blue-800/60 px-3 py-1 rounded-full text-[11px] font-bold text-blue-700 dark:text-blue-300 mb-1.5">
            <Sparkles size={12} className="text-blue-500" />
            <span>LUANAR Academic Repository</span>
          </div>
          <h1 className="m-0 text-2xl sm:text-3xl font-black text-center text-slate-900 dark:text-white tracking-tight">
            StudyHub LUANAR
          </h1>
          <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Lecture notes · past examination papers · smart quizzes
          </p>
        </div>

        {/* Path Selector Tabs: Student vs Lecturer */}
        <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl mb-5 shadow-inner border border-slate-200/50 dark:border-slate-700/50">
          <button
            type="button"
            onClick={() => { setRolePath('student'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all select-none min-h-[42px] ${
              rolePath === 'student'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <GraduationCap size={17} strokeWidth={2.2} />
            <span>Student Portal</span>
          </button>

          <button
            type="button"
            onClick={() => { setRolePath('lecturer'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all select-none min-h-[42px] ${
              rolePath === 'lecturer'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen size={17} strokeWidth={2.2} />
            <span>Lecturer Portal</span>
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div role="alert" className="mb-4 p-3 text-xs bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-2xl border border-rose-200 dark:border-rose-900 flex items-start gap-2">
            <span className="text-rose-500 font-bold mt-0.5">⚠️</span>
            <div className="flex-1 font-semibold leading-relaxed">{error}</div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* PATH 1: STUDENT LOGIN                                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {rolePath === 'student' && (
          <div className="space-y-4">
            {/* 1. Programme Selection (clean searchable dropdown, no cluttered chip list above) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Layers size={13} className="text-blue-600" />
                  <span>Programme of Study</span>
                  <span className="text-rose-500">*</span>
                </label>
                {basicsLocked ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-bold">
                    <Lock size={10} />
                    <span>Auto-set · Year 1</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                    {programsList.length} Available
                  </span>
                )}
              </div>

              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  disabled={basicsLocked}
                  onClick={() => !basicsLocked && setIsProgramDropdownOpen((o) => !o)}
                  aria-expanded={isProgramDropdownOpen}
                  aria-label="Programme of study"
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left text-sm font-semibold border transition-all min-h-[46px] ${
                    basicsLocked
                      ? 'bg-amber-50/70 dark:bg-slate-800/70 border-amber-300/80 dark:border-slate-700 text-slate-900 dark:text-slate-100 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer'
                  }`}
                >
                  <div className="truncate flex items-center gap-2 min-w-0">
                    <GraduationCap size={16} className="text-blue-600 flex-shrink-0" />
                    <span className="truncate">{effectivePreview || 'Select your programme'}</span>
                  </div>
                  {!basicsLocked && (
                    <ChevronDown
                      size={16}
                      className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isProgramDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  )}
                </button>

                {basicsLocked && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/90 font-medium mt-1">
                    Year 1 (Semesters 1 &amp; 2) automatically uses the <strong>Basics</strong> curriculum.
                  </p>
                )}

                {isProgramDropdownOpen && !basicsLocked && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-50 p-2 max-h-60 overflow-hidden flex flex-col">
                    <div className="relative mb-2">
                      <Search size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={programSearch}
                        onChange={(e) => setProgramSearch(e.target.value)}
                        placeholder="Search degree e.g. Agronomy, Computer..."
                        className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>

                    <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                      {filteredPrograms.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-4">No matching programme found.</p>
                      ) : (
                        filteredPrograms.map((prog) => {
                          const isSelected = studentProgram === prog.name;
                          return (
                            <button
                              key={prog.id || prog.name}
                              type="button"
                              onClick={() => handleProgramSelect(prog)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-semibold transition-colors ${
                                isSelected
                                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <div className="truncate min-w-0">
                                <p className="truncate">{prog.name}</p>
                                {prog.campus && (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                    {prog.campus} Campus
                                  </span>
                                )}
                              </div>
                              {isSelected && <Check size={14} className="text-blue-600 flex-shrink-0 ml-2" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Year of Study */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Calendar size={13} className="text-blue-600" />
                <span>Year of Study</span>
                <span className="text-rose-500">*</span>
              </label>

              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                {[
                  { yr: 1, label: 'Year 1', desc: 'Freshman' },
                  { yr: 2, label: 'Year 2', desc: 'Sophomore' },
                  { yr: 3, label: 'Year 3', desc: 'Junior' },
                  { yr: 4, label: 'Year 4', desc: 'Finalist' },
                ].map(({ yr, label, desc }) => {
                  const isSelected = studentYear === yr;
                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => handleYearSelect(yr)}
                      className={`relative flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl border transition-all select-none min-h-[54px] ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                          : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-300'
                      }`}
                    >
                      <span className="text-xs sm:text-sm font-black leading-tight">{label}</span>
                      <span className={`text-[10px] font-medium mt-0.5 ${isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'}`}>
                        {desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Semester Selection (Alarm-Clock Rotary Dial 1–8) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Calendar size={13} className="text-blue-600" />
                  <span>Semester</span>
                  <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                  Semester {studentSemester} of 8
                </span>
              </div>

              <SemesterDial value={studentSemester} onChange={handleSemesterSelect} accent="blue" />
            </div>

            {/* 4. Live Student Identity Preview Card */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-3.5 sm:p-4 shadow-lg border border-indigo-900/50 relative overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 flex-shrink-0">
                    <GraduationCap size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest">
                      Personalized Setup
                    </p>
                    <p className="text-xs font-bold text-white truncate">
                      {effectivePreview}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="bg-blue-500/30 text-blue-200 text-[10px] font-extrabold px-2 py-0.5 rounded-md border border-blue-400/20">
                    Yr {studentYear}
                  </span>
                  <span className="bg-indigo-500/30 text-indigo-200 text-[10px] font-extrabold px-2 py-0.5 rounded-md border border-indigo-400/20">
                    Sem {studentSemester}
                  </span>
                </div>
              </div>

              {basicsLocked ? (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-start gap-1.5 text-[11px] text-blue-200/90 leading-tight">
                  <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Basics Auto-Applied:</strong> Foundational Year 1 courses and past exams ready.
                  </span>
                </div>
              ) : (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-1.5 text-[11px] text-emerald-300">
                  <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                  <span>Targeted lecture notes and past exams ready.</span>
                </div>
              )}
            </div>

            {currentUser && (
              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck size={16} className="text-emerald-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">Logged In As</p>
                    <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{currentUser.email}</p>
                  </div>
                </div>
                <span className="text-emerald-600 font-bold text-[11px] bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md flex-shrink-0">
                  Active
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleStudentSignIn}
              disabled={loading || !effectivePreview}
              className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-3.5 px-4 rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-blue-600/25 text-sm min-h-[48px]"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Setting up your dashboard...</span>
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="bg-white rounded-full p-0.5 flex-shrink-0">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span className="truncate">
                    {currentUser ? 'Save & Enter StudyHub' : 'Continue with Google'}
                  </span>
                  <ArrowRight size={16} className="flex-shrink-0" />
                </>
              )}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* PATH 2: LECTURER LOGIN                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {rolePath === 'lecturer' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLecturerAuthAndSelectEmail(false);
            }}
            className="space-y-4"
            noValidate
          >
            <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded-2xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={17} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <span className="text-xs font-black text-indigo-950 dark:text-indigo-200 uppercase tracking-wider">
                  Faculty Contributor Access
                </span>
              </div>
              <p className="text-[11px] text-indigo-800 dark:text-indigo-300 leading-relaxed font-medium">
                Enter your department access password to verify your account and land straight on the upload portal.
              </p>
            </div>

            {currentUser && (
              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck size={16} className="text-emerald-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">Selected Account</p>
                    <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{currentUser.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLecturerAuthAndSelectEmail(true)}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold text-[11px] whitespace-nowrap flex-shrink-0"
                >
                  Change Email
                </button>
              </div>
            )}

            <div>
              <label
                htmlFor="lecturer-password-input"
                className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Lecturer Access Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="lecturer-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={lecturerPassword}
                  onChange={(e) => setLecturerPassword(e.target.value)}
                  onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full px-3.5 py-3 pr-11 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="lecturer-name-input"
                className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Lecturer Name / Department <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                id="lecturer-name-input"
                type="text"
                value={lecturerName}
                onChange={(e) => setLecturerName(e.target.value)}
                onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                placeholder="e.g. Dr. Banda (Agricultural Engineering)"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !lecturerPassword.trim()}
              className="w-full flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed text-sm mt-2 min-h-[48px]"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : currentUser ? (
                <>
                  <span>Verify &amp; Open Upload Portal</span>
                  <ArrowRight size={16} />
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flex-shrink-0">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity="0.9"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity="0.8"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity="0.9"/>
                  </svg>
                  <span className="truncate">Verify &amp; Select Google Email</span>
                  <ArrowRight size={16} className="flex-shrink-0" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer info */}
        <div className="mt-6 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center text-center">
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
            <span>LUANAR Student &amp; Lecturer Secure Portal</span>
          </p>
        </div>
      </div>
    </div>
  );
}
