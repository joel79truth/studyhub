import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

const LECTURER_SECRET = "LUANAR-FACULTY-2026";

export default function Login() {
  const navigate = useNavigate();

  // ─── State ──────────────────────────────────────────────
  const [loginMode, setLoginMode] = useState('email'); // 'email' or 'phone'
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  const [program, setProgram] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');
  const [role, setRole] = useState('');
  const [lecturerCode, setLecturerCode] = useState('');
  const [programs, setPrograms] = useState([]);
  const [programsLoaded, setProgramsLoaded] = useState(false);
  const [programsLoading, setProgramsLoading] = useState(false);

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({
    program: false,
    semester: false,
    year: false,
    role: false,
    code: false,
  });

  // ─── Load programs from Supabase ──────────────────────
  const loadPrograms = async () => {
    if (programsLoaded || programsLoading) return;
    setProgramsLoading(true);
    try {
      const { data, error } = await supabase
        .from('programs')
        .select('id, name, campus, level')
        .order('name', { ascending: true });
      if (error) throw error;
      setPrograms(data || []);
      setProgramsLoaded(true);
    } catch (err) {
      console.error('Failed to load programs:', err);
      setError('Could not load programs. Please try again.');
    } finally {
      setProgramsLoading(false);
    }
  };

  // ─── Handle successful authentication ──────────────
  const handleAuthSuccess = async (user, extra = {}) => {
    setLoading(true);
    try {
      // Upsert into profiles table
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || null,
          ...extra,
        }, { onConflict: 'id' });

      if (upsertError) throw upsertError;

      // Fetch the complete profile
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data && data.program) {
        // Profile completed → navigate to dashboard
        localStorage.setItem('userDetails', JSON.stringify(data));
        navigate('/', { replace: true });
      } else {
        // Need to complete profile
        setShowProfileForm(true);
      }
    } catch (err) {
      setError('Auth success but profile check failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Email Sign‑In (auto‑register if missing) ──────
  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          const confirm = window.confirm(
            'No existing account found. Would you like to create a new account with this email?'
          );
          if (confirm) {
            const { data: signUpData, error: signUpError } =
              await supabase.auth.signUp({ email, password });
            if (signUpError) throw signUpError;
            await handleAuthSuccess(signUpData.user);
          } else {
            setError('Sign‑in cancelled.');
          }
        } else {
          throw error;
        }
      } else {
        await handleAuthSuccess(data.user);
      }
    } catch (err) {
      setError('Email sign‑in error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Google Sign‑In (uses custom scheme for native app) ──
 // ─── Google Sign‑In (native app) ──
const handleGoogleSignIn = async () => {
  setLoading(true);
  setError('');
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'com.studyhub.luanar://auth/callback',
      },
    });

    if (error) throw error;

    if (data?.url) {
      // Dynamically import the Browser plugin (native only)
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: data.url });
      } catch {
        // Fallback for web – open in new tab
        window.open(data.url, '_blank');
      }
    }
  } catch (err) {
    setError('Google sign‑in error: ' + err.message);
    setLoading(false);
  }
};
  // ─── Phone OTP Login ──────────────────────────────────
  const handleSendOtp = async () => {
    if (!phone) {
      setError('Enter phone number (e.g., 991234567)');
      return;
    }
    const fullPhone = '+265' + phone.replace(/^0+/, '');
    if (!/^\+265[0-9]{9}$/.test(fullPhone)) {
      setError('Use valid Malawi number: +265 followed by 9 digits');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
      });
      if (error) throw error;

      const code = window.prompt('Enter 6‑digit OTP sent to ' + fullPhone);
      if (code && code.length === 6) {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          phone: fullPhone,
          token: code,
          type: 'sms',
        });
        if (verifyError) throw verifyError;
        await handleAuthSuccess(data.user, { phone: fullPhone });
      } else {
        setError('Invalid OTP or cancelled');
      }
    } catch (err) {
      setError('Phone auth error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Profile Completion ─────────────────────────────
  const validateProfile = () => {
    const errors = { program: false, semester: false, year: false, role: false, code: false };
    let valid = true;
    if (!program) { errors.program = true; valid = false; }
    if (!semester) { errors.semester = true; valid = false; }
    if (!year) { errors.year = true; valid = false; }
    if (!role) { errors.role = true; valid = false; }
    if (role === 'Lecturer') {
      if (lecturerCode !== LECTURER_SECRET) {
        errors.code = true;
        valid = false;
      }
    }
    setFieldErrors(errors);
    return valid;
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!validateProfile()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Session expired. Please login again.');
      navigate('/login', { replace: true });   // go back to login
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          program,
          semester,
          year_of_study: year,
          role,
          profile_complete: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) throw error;

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      localStorage.setItem('userDetails', JSON.stringify(data));
      navigate('/', { replace: true });
    } catch (err) {
      setError('Profile completion error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Auth state listener ─────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const user = session?.user;
          if (user) {
            const { data, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .maybeSingle();

            if (data && data.program) {
              localStorage.setItem('userDetails', JSON.stringify(data));
              navigate('/', { replace: true });
            } else {
              setShowProfileForm(true);
            }
          }
        }
      }
    );

    // Check for existing session on mount
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const user = session.user;
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (data && data.program) {
          localStorage.setItem('userDetails', JSON.stringify(data));
          navigate('/', { replace: true });
        } else {
          setShowProfileForm(true);
        }
      }
    };
    checkSession();

    return () => {
      subscription?.unsubscribe();
    };
  }, [navigate]);

  // ─── Render profile form ─────────────────────────────
  if (showProfileForm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
        <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/50 transition-all animate-fade-up">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-800">✍️ Complete your profile</h2>
          <p className="text-sm text-center text-gray-500 mb-6">Just a few details to personalise your dashboard</p>

          <form onSubmit={handleProfileSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Programme of study <span className="text-red-500">*</span></label>
              <select
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                onFocus={loadPrograms}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.program ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              >
                <option value="">— Select programme —</option>
                {programsLoading && <option disabled>Loading…</option>}
                {programs.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} ({p.campus})
                  </option>
                ))}
              </select>
              {fieldErrors.program && <p className="text-red-500 text-xs mt-1">Program is required</p>}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Semester <span className="text-red-500">*</span></label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.semester ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              >
                <option value="">Select semester</option>
                {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Semester {s}</option>)}
              </select>
              {fieldErrors.semester && <p className="text-red-500 text-xs mt-1">Select your semester</p>}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Year of study</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.year ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              >
                <option value="">Select year</option>
                {[1,2,3,4].map(y => <option key={y} value={y}>Year {y}</option>)}
              </select>
              {fieldErrors.year && <p className="text-red-500 text-xs mt-1">Year is required</p>}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Role <span className="text-red-500">*</span></label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.role ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              >
                <option value="">Choose role</option>
                <option value="Student">Student</option>
                <option value="Lecturer">Lecturer</option>
              </select>
              {fieldErrors.role && <p className="text-red-500 text-xs mt-1">Role is mandatory</p>}
            </div>

            {role === 'Lecturer' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Lecturer authorization code</label>
                <input
                  type="password"
                  value={lecturerCode}
                  onChange={(e) => setLecturerCode(e.target.value)}
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.code ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  placeholder="Enter secure code"
                />
                {fieldErrors.code && <p className="text-red-500 text-xs mt-1">Invalid lecturer code</p>}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg"
            >
              {loading ? 'Saving…' : '🚀 Access Dashboard'}
            </button>
          </form>
          <div className="text-center text-xs text-gray-500 border-t border-gray-200 mt-6 pt-4">
            Your data helps us personalise study materials
          </div>
        </div>
      </div>
    );
  }

  // ─── Login form ──────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/50 transition-all animate-fade-up">
        {/* Logo / Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-800">StudyHub LUANAR</h2>
        <p className="text-sm text-center text-gray-500 mb-6">Smart access · lectures · materials</p>

        <div className="bg-blue-50 border-l-4 border-blue-500 rounded-xl p-3 text-sm text-blue-800 flex items-center gap-2 mb-6">
          <span>🔐</span> Use Google, email or phone to connect. Your academic hub awaits.
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-medium py-3 rounded-lg flex items-center justify-center gap-3 transition-all disabled:opacity-70 shadow-sm"
        >
          <svg width="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-4 my-5">
          <div className="flex-1 h-px bg-gray-200"></div>
          <span className="text-xs text-gray-400 font-medium">or</span>
          <div className="flex-1 h-px bg-gray-200"></div>
        </div>

        {loginMode === 'email' ? (
          <form onSubmit={handleEmailSignIn}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                placeholder="student@luanar.ac.mw"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg"
            >
              {loading ? 'Signing in…' : 'Sign in with Email'}
            </button>
            <p className="text-xs text-gray-500 mt-3 text-center">🔁 If account doesn't exist, we'll create it securely.</p>
          </form>
        ) : (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value="+265"
                  readOnly
                  className="w-20 px-3 py-2.5 border border-gray-300 rounded-lg bg-gray-100 text-center"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  placeholder="991234567"
                />
              </div>
            </div>
            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all disabled:opacity-70 shadow-lg"
            >
              {loading ? 'Sending…' : 'Send OTP via SMS'}
            </button>
          </div>
        )}

        <button
          onClick={() => setLoginMode(loginMode === 'email' ? 'phone' : 'email')}
          className="w-full mt-4 py-2.5 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors"
        >
          {loginMode === 'email' ? '📱 Use Phone Number instead' : '✉️ Use Email instead'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="text-center text-xs text-gray-500 border-t border-gray-200 mt-6 pt-4">
          © 2026 StudyHub — Lilongwe University of Agriculture and Natural Resources
        </div>
      </div>

      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up {
          animation: fade-up 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}