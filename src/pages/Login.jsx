import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { supabase } from '../supabase';
import appLogo from '/images/luanar7.png'; // adjust path if needed

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ─── Initialize SocialLogin once (only on native) ───
  useEffect(() => {
    const isCapacitor = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    if (isCapacitor) {
      SocialLogin.initialize({
        google: {
          webClientId: '985257842533-buh0i8r3jb1gtu1rbod1lql940ckn0hk.apps.googleusercontent.com',
          // add iOSClientId if needed
        }
      }).catch(e => console.error('SocialLogin init error:', e));
    }
  }, []);

  // ─── Google Sign‑In handler ─────────────────────────
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      const isCapacitor = window.Capacitor?.isNativePlatform?.();

      if (isCapacitor) {
        // Native: get ID token via SocialLogin
        const result = await SocialLogin.login({
          provider: 'google',
          options: { scopes: ['profile', 'email'] }
        });

        // Extract ID token from any known response shape
        let idToken =
          result.idToken ||
          result.credential?.idToken ||
          result.result?.idToken ||
          result.result?.credential?.idToken;

        if (!idToken) {
          throw new Error('Google sign‑in did not return an ID token');
        }

        const { error: supabaseError } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (supabaseError) throw supabaseError;
        navigate('/', { replace: true });
      } else {
        // Web: redirect-based OAuth
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
      }
    } catch (err) {
      console.error('Google sign‑in error:', err);
      setError('Sign‑in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Session listener – auto‑navigate if already logged in ───
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session?.user) navigate('/', { replace: true });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted && (event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) {
        navigate('/', { replace: true });
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [navigate]);

  // ─── UI ────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/60">
        {/* Logo – same 64x64 container */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md">
            <img
              src={appLogo}
              alt="LUANAR StudyHub"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Title & subtitle */}
        <h2 className="text-2xl font-bold text-center text-gray-800">StudyHub LUANAR</h2>
        <p className="text-sm text-center text-gray-500 mt-1 mb-8">
          Smart access · lectures · materials
        </p>

        {/* Error alert */}
        {error && (
          <div className="mb-5 p-3 text-sm bg-red-50 text-red-600 rounded-lg border border-red-100 text-center">
            {error}
          </div>
        )}

        {/* Google Sign‑In Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-60 shadow-sm active:scale-[0.98]"
        >
          {/* Google icon – inline SVG keeps it fast & self‑contained */}
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span className="text-sm font-medium">
            {loading ? 'Signing in…' : 'Continue with Google'}
          </span>
        </button>
      </div>
    </div>
  );
}