import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function ProtectedRoute({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false); // wait until first state known

  useEffect(() => {
    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      // Mark that we have received the first auth state event
      if (!authReady) setAuthReady(true);
    });

    // Also check initial session (may fire before the listener)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => subscription?.unsubscribe();
  }, []); // no dependency needed for authReady

  if (!authReady) {
    return <div>Loading...</div>; // or a spinner
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}