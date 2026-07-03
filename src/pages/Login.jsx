import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

const LECTURER_SECRET = "LUANAR-FACULTY-2026";

export default function Login() {
  const navigate = useNavigate();

  // ── Handle OAuth code returned from deep link (Capacitor only) ──
  useEffect(() => {
    const code = window.__OAUTH_CODE__;
    if (code) {
      window.__OAUTH_CODE__ = null;
      (async () => {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('OAuth exchange error:', error.message);
          navigate('/login', { replace: true });
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await handleAuthSuccess(user);
          } else {
            navigate('/login', { replace: true });
          }
        }
      })();
    }
  }, [navigate]);

  const [loginMode, setLoginMode] = useState('email');
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
    program: false, semester: false, year: false, role: false, code: false,
  });

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

  const handleAuthSuccess = async (user, extra = {}) => {
    setLoading(true);
    try {
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || null,
          ...extra,
        }, { onConflict: 'id' });
      if (upsertError) throw upsertError;

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      if (data && data.program) {
        localStorage.setItem('userDetails', JSON.stringify(data));
        navigate('/', { replace: true });
      } else {
        setShowProfileForm(true);
      }
    } catch (err) {
      setError('Auth success but profile check failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          const confirm = window.confirm('No existing account found. Would you like to create a new account?');
          if (confirm) {
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
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

  // ─── Google Sign‑In ──
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      // Detect if we are running inside Capacitor (native)
      let isCapacitor = false;
      try {
        const { Capacitor } = await import('@capacitor/core');
        isCapacitor = Capacitor.isNativePlatform();
      } catch {
        // Not inside Capacitor → web
      }

      const options = {};
      if (isCapacitor) {
        options.redirectTo = 'com.studyhub.luanar://auth/callback';
      }
      // On web, we don't set redirectTo – Supabase will use a popup and handle the exchange

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options,
      });

      if (error) throw error;

      // If we have a URL (happens when using deep link or redirect flow), open it
      if (data?.url) {
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url: data.url });
        } catch {
          // Fallback for web – Supabase will already have opened a popup automatically if no redirectTo
          // If it's a deep link URL (Capacitor) but we're on web, it won't work. That case is avoided.
        }
      }
      // If data.url is not present, the popup has opened automatically and the auth listener will handle success
    } catch (err) {
      setError('Google sign‑in error: ' + err.message);
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!phone) { setError('Enter phone number (e.g., 991234567)'); return; }
    const fullPhone = '+265' + phone.replace(/^0+/, '');
    if (!/^\+265[0-9]{9}$/.test(fullPhone)) { setError('Use valid Malawi number: +265 followed by 9 digits'); return; }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
      if (error) throw error;
      const code = window.prompt('Enter 6‑digit OTP sent to ' + fullPhone);
      if (code && code.length === 6) {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          phone: fullPhone, token: code, type: 'sms',
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

  const validateProfile = () => {
    const errors = { program: false, semester: false, year: false, role: false, code: false };
    let valid = true;
    if (!program) { errors.program = true; valid = false; }
    if (!semester) { errors.semester = true; valid = false; }
    if (!year) { errors.year = true; valid = false; }
    if (!role) { errors.role = true; valid = false; }
    if (role === 'Lecturer' && lecturerCode !== LECTURER_SECRET) { errors.code = true; valid = false; }
    setFieldErrors(errors);
    return valid;
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!validateProfile()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Session expired. Please login again.'); navigate('/login', { replace: true }); return; }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id, program, semester, year_of_study: year, role,
          profile_complete: true, updated_at: new Date().toISOString(),
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
    return () => subscription?.unsubscribe();
  }, [navigate]);

  // ... (profile form and login form identical to your previous version, unchanged)
  // (You can keep the UI code as before – I'll omit it here for brevity.)
  // Make sure you include the profile form and login form JSX from your previous file.
  // The crucial change is only in handleGoogleSignIn above.
}