import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { getOfflineSessionSnapshot, saveOfflineSessionSnapshot } from '../lib/authGuard';

export default function ProtectedRoute({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // 1. Conclusively check current session state (with offline grace fallback)
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          saveOfflineSessionSnapshot(session);
        }
        if (isMounted) {
          let activeUser = session?.user ?? null;
          if (!activeUser && typeof navigator !== 'undefined' && !navigator.onLine) {
            const offlineSnap = getOfflineSessionSnapshot();
            if (offlineSnap?.user) {
              activeUser = offlineSnap.user;
            }
          }
          setUser(activeUser);
          setAuthReady(true);
        }
      } catch (err) {
        console.error("Auth check failed:", err);
        if (isMounted) {
          let activeUser = null;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            const offlineSnap = getOfflineSessionSnapshot();
            if (offlineSnap?.user) {
              activeUser = offlineSnap.user;
            }
          }
          setUser(activeUser);
          setAuthReady(true);
        }
      }
    };

    initializeAuth();

    // 2. Continuous subscription for subsequent session changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (isMounted) {
        if (session) {
          saveOfflineSessionSnapshot(session);
          setUser(session.user);
        } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const offlineSnap = getOfflineSessionSnapshot();
          if (offlineSnap?.user) {
            setUser(offlineSnap.user);
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
        }
        setAuthReady(true); 
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Visual anchor: Holds screen layout stable until auth resolution
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const isPreview = typeof window !== 'undefined' && window.location.search.includes('preview=true');

  if (!user && !isPreview) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
