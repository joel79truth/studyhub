import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { supabase } from '../supabase';
import { ensureConsistentSession } from '../lib/authGuard';
import { API_BASE_URL } from '../lib/apiConfig';
import { GraduationCap, BookOpen, KeyRound, ArrowRight, Eye, EyeOff, CheckCircle2, Mail, UserCheck } from 'lucide-react';
import appLogo from '/images/luanar7.png';

// Normalized helper to verify authorized lecturer passwords
function isAuthorizedLecturerPassword(input) {
  const norm = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm === 'studyhublecturer2026' || norm === 'studyhublecturer2025';
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

  // Lecturer specific state
  const [lecturerPassword, setLecturerPassword] = useState('');
  const [lecturerName, setLecturerName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ─── Initialize SocialLogin once (only on native) ───
  useEffect(() => {
    const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    if (isCapacitor) {
      SocialLogin.initialize({
        google: {
          webClientId: '985257842533-buh0i8r3jb1gtu1rbod1lql940ckn0hk.apps.googleusercontent.com',
        }
      }).catch(e => console.error('SocialLogin init error:', e));
    }
  }, []);

  // ─── Check existing session on mount ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session?.user) {
        setCurrentUser(session.user);
        const metaRole = session.user.app_metadata?.role || session.user.user_metadata?.role || '';
        // If already a lecturer or admin, auto-navigate to /upload
        if (metaRole === 'lecturer' || metaRole === 'admin') {
          navigate('/upload', { replace: true });
        }
      }
    })();
    return () => { mounted = false; };
  }, [navigate]);

  // ─── Helper: Perform Google Sign-in and return user ───
  const executeGoogleSignIn = async () => {
    const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

    if (isCapacitor) {
      const result = await SocialLogin.login({
        provider: 'google',
        options: {
          scopes: ['profile', 'email'],
          filterByAuthorizedAccounts: false, // forces Android to display account picker
        }
      });

      const idToken =
        result.idToken ||
        result.credential?.idToken ||
        result.result?.idToken ||
        result.result?.credential?.idToken;

      if (!idToken) {
        throw new Error('Google sign‑in did not return an ID token');
      }

      const { data: authData, error: sbError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (sbError) throw sbError;
      return authData.user;
    } else {
      // Web OAuth flow
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (oauthErr) throw oauthErr;
      return null;
    }
  };

  // ─── Google Sign‑In handler (Student path) ──────────
  const handleStudentGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      const user = await executeGoogleSignIn();
      if (user) {
        const ok = await ensureConsistentSession();
        if (!ok) {
          throw new Error('Sign-in produced an invalid session. Please try again.');
        }
        navigate('/', { replace: true });
      }
    } catch (err) {
      console.error('Google sign‑in error:', err);
      setError(err.message || 'Sign‑in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Lecturer Path: Password Verify + Select Email Handler ──────────
  const handleLecturerAuthAndSelectEmail = async (forceNewAccount = false) => {
    if (!lecturerPassword.trim()) {
      setError('Please enter the lecturer access password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Password Verification (Local normalized check + Backend verify)
      const cleanKey = String(lecturerPassword).toLowerCase().replace(/[^a-z0-9]/g, '');
      const isMatch = isAuthorizedLecturerPassword(cleanKey);

      // Also attempt backend verification if available
      let backendValidated = false;
      try {
        const verifyRes = await fetch(`${API_BASE_URL}/api/auth/lecturer-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: lecturerPassword.trim(),
            name: lecturerName.trim() || undefined,
          }),
        });
        if (verifyRes.ok) backendValidated = true;
      } catch (_) {}

      if (!isMatch && !backendValidated) {
        throw new Error('Incorrect lecturer access password. Please check your department credentials and try again.');
      }

      // 2. Select Google Email or use existing
      let targetUser = currentUser;

      if (!targetUser || forceNewAccount) {
        // If switching account or not yet signed in, prompt Google Account Picker
        targetUser = await executeGoogleSignIn();
        if (!targetUser) {
          // On web, signInWithOAuth redirects the whole page
          return;
        }
      }

      // 3. Upgrade user to Lecturer role in Supabase
      const displayName = lecturerName.trim() || targetUser.user_metadata?.full_name || targetUser.email?.split('@')[0] || 'Lecturer';
      
      await supabase.from('profiles').upsert({
        id: targetUser.id,
        role: 'lecturer',
        name: displayName,
        email: targetUser.email,
      }, { onConflict: 'id' }).catch((e) => console.warn('profiles upsert warning:', e));

      await supabase.auth.updateUser({
        data: { role: 'lecturer', full_name: displayName, contributor_unlocked: true }
      }).catch(() => {});

      // Persist local contributor flags
      localStorage.setItem('studyhub_lecturer_unlocked', 'true');
      localStorage.setItem('studyhub_user_role', 'lecturer');

      // Inform backend of the upgraded token if possible
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        fetch(`${API_BASE_URL}/api/auth/lecturer-verify`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            password: lecturerPassword.trim(),
            name: displayName,
          }),
        }).catch(() => {});
      }

      await ensureConsistentSession();
      navigate('/upload', { replace: true });
    } catch (err) {
      console.error('Lecturer verification error:', err);
      setError(err.message || 'Failed to authenticate lecturer access. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50/40 to-purple-50 p-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-2xl border border-white/80 transition-all duration-300">
        
        {/* Brand Header */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg ring-4 ring-blue-500/10">
            <img
              src={appLogo}
              alt="LUANAR StudyHub"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <h1 className="text-2xl font-black text-center text-slate-800 tracking-tight">
          StudyHub LUANAR
        </h1>
        <p className="text-xs text-center text-slate-500 mt-1 mb-6 font-medium">
          Academic materials · past papers · resources
        </p>

        {/* Path Selector Tabs: Student vs Lecturer */}
        <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100/90 rounded-2xl mb-6 shadow-inner">
          <button
            type="button"
            onClick={() => { setRolePath('student'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 select-none ${
              rolePath === 'student'
                ? 'bg-white text-blue-600 shadow-md scale-[1.01]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <GraduationCap size={16} strokeWidth={2.2} />
            <span>Student</span>
          </button>
          
          <button
            type="button"
            onClick={() => { setRolePath('lecturer'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 select-none ${
              rolePath === 'lecturer'
                ? 'bg-white text-indigo-600 shadow-md scale-[1.01]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <BookOpen size={16} strokeWidth={2.2} />
            <span>Lecturer</span>
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 p-3.5 text-xs bg-rose-50 text-rose-700 rounded-xl border border-rose-200/80 flex items-start gap-2.5 animate-fadeIn">
            <span className="text-rose-500 mt-0.5 font-bold">⚠️</span>
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}

        {/* PATH 1: STUDENT LOGIN */}
        {rolePath === 'student' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-4 text-center">
              <p className="text-xs text-blue-900 font-semibold leading-relaxed">
                Welcome, Student! Sign in with your university Google account to access all lectures, past papers, exam prep & study companion tools.
              </p>
            </div>

            <button
              type="button"
              onClick={handleStudentGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 disabled:opacity-60 shadow-sm active:scale-[0.98]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-sm font-semibold">
                {loading ? 'Connecting...' : 'Continue with Google'}
              </span>
            </button>
          </div>
        )}

        {/* PATH 2: LECTURER LOGIN */}
        {rolePath === 'lecturer' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <KeyRound size={16} className="text-indigo-600 flex-shrink-0" />
                <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                  Contributor Authorization
                </span>
              </div>
              <p className="text-[11px] text-indigo-800 leading-relaxed font-medium">
                Enter your department password, then select your university Google account to unlock high-speed uploading for lecture notes, past exams & tutorials.
              </p>
            </div>

            {/* If user is already logged in with Google */}
            {currentUser && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 truncate">
                  <UserCheck size={16} className="text-emerald-600 flex-shrink-0" />
                  <div className="truncate">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">Selected Account</p>
                    <p className="font-bold text-slate-800 truncate">{currentUser.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLecturerAuthAndSelectEmail(true)}
                  className="text-indigo-600 hover:text-indigo-800 font-bold text-[11px] underline ml-2 whitespace-nowrap"
                >
                  Change Email
                </button>
              </div>
            )}

            {/* Password input */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Lecturer Access Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={lecturerPassword}
                  onChange={(e) => setLecturerPassword(e.target.value)}
                  placeholder="e.g. studyhub lecturer 2026"
                  autoComplete="current-password"
                  className="w-full px-3.5 py-3 pr-11 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all font-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Optional name */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Lecturer Name / Department <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                value={lecturerName}
                onChange={(e) => setLecturerName(e.target.value)}
                placeholder="e.g. Dr. Joel (Agricultural Engineering)"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all"
              />
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              onClick={() => handleLecturerAuthAndSelectEmail(false)}
              disabled={loading || !lecturerPassword.trim()}
              className="w-full flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-200 shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm mt-3"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : currentUser ? (
                <>
                  <span>Unlock Contributor Portal ({currentUser.email?.split('@')[0]})</span>
                  <ArrowRight size={16} />
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity="0.9"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity="0.8"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity="0.9"/>
                  </svg>
                  <span>Select Google Email to Continue</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        )}

        {/* Footer info */}
        <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-center text-center">
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 size={13} className="text-emerald-500" />
            <span>Academic repository</span>
          </p>
        </div>

      </div>
    </div>
  );
}
