import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { supabase } from '../supabase';

export default function Login() {
  const navigate = useNavigate();
  const [loginMode, setLoginMode] = useState('email');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  // Email sign‑in
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
          const confirm = window.confirm('No account found. Create a new one?');
          if (confirm) {
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
            if (signUpError) throw signUpError;
            navigate('/', { replace: true });
          } else {
            setError('Sign‑in cancelled.');
          }
        } else {
          throw error;
        }
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError('Email sign‑in error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Google sign‑in
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

      if (isCapacitor) {
        const result = await SocialLogin.login({
          provider: 'google',
          options: {
            clientId: '985257842533-l24cit0aloaqociulgcp2ghd36kgf2oc.apps.googleusercontent.com',
          },
        });

        if (result?.result?.token) {
          const { data, error: supabaseError } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            idToken: result.result.token,
          });
          if (supabaseError) throw supabaseError;
          navigate('/', { replace: true });
        } else {
          throw new Error('Native token acquisition failed or was cancelled.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
      }
    } catch (err) {
      console.error('Google sign-in error:', err);
      setError('Google sign-in error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Phone OTP
  const handleSendOtp = async () => {
    if (!phone) { setError('Enter phone number'); return; }
    const fullPhone = '+265' + phone.replace(/^0+/, '');
    if (!/^\+265[0-9]{9}$/.test(fullPhone)) { setError('Invalid Malawi number'); return; }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
      if (error) throw error;
      const code = window.prompt('Enter 6‑digit OTP sent to ' + fullPhone);
      if (code && code.length === 6) {
        const { error: verifyError } = await supabase.auth.verifyOtp({ phone: fullPhone, token: code, type: 'sms' });
        if (verifyError) throw verifyError;
        navigate('/', { replace: true });
      } else {
        setError('Invalid OTP or cancelled');
      }
    } catch (err) {
      setError('Phone auth error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Session listener
  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && isMounted) navigate('/', { replace: true });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user && isMounted) {
        navigate('/', { replace: true });
      }
    });
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/50">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-800">StudyHub LUANAR</h2>
        <p className="text-sm text-center text-gray-500 mb-6">Smart access · lectures · materials</p>

        {error && (
          <div className="mb-4 p-3 text-xs bg-red-50 text-red-600 rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <button onClick={handleGoogleSignIn} disabled={loading}
          className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-medium py-3 rounded-lg flex items-center justify-center gap-3 transition-all disabled:opacity-70 shadow-sm mb-6">
          <svg width="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          {loading ? 'Processing...' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-4 my-5">
          <div className="flex-1 h-px bg-gray-200"></div>
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200"></div>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
          <button
            type="button"
            onClick={() => setLoginMode('email')}
            className={`flex-1 text-xs py-2 font-medium rounded-md transition-all ${loginMode === 'email' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Email Access
          </button>
          <button
            type="button"
            onClick={() => setLoginMode('phone')}
            className={`flex-1 text-xs py-2 font-medium rounded-md transition-all ${loginMode === 'phone' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Phone OTP
          </button>
        </div>

        {loginMode === 'email' ? (
          <form onSubmit={handleEmailSignIn}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition" placeholder="student@luanar.ac.mw" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all disabled:opacity-70">
              {loading ? 'Signing in…' : 'Sign in with Email'}
            </button>
          </form>
        ) : (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
              <div className="flex gap-2">
                <input type="text" value="+265" readOnly className="w-20 px-3 py-2.5 border border-gray-300 rounded-lg bg-gray-100 text-center" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition" placeholder="991234567" />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">A 6‑digit code will be sent via SMS.</p>
            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all disabled:opacity-70"
            >
              {loading ? 'Sending OTP…' : 'Send OTP'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}