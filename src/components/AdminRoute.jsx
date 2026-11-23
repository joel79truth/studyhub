import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';

const AdminRoute = ({ children }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let user = session?.user;
        if (!user) {
          const { data: userData } = await supabase.auth.getUser();
          user = userData?.user;
        }

        if (!user) {
          if (isMounted) navigate('/login', { replace: true });
          return;
        }

        // Check auth user metadata
        const metaAdmin = Boolean(
          user.app_metadata?.role === 'admin' ||
          user.user_metadata?.role === 'admin' ||
          user.user_metadata?.is_admin === true
        );

        if (metaAdmin) {
          if (isMounted) {
            setIsAdmin(true);
            setLoading(false);
          }
          return;
        }

        // Check profiles table with maybeSingle to prevent PGRST116 errors
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, role, admin')
          .eq('id', user.id)
          .maybeSingle();

        const hasAdminRole = Boolean(
          profile?.is_admin === true ||
          String(profile?.role || '').toLowerCase() === 'admin' ||
          profile?.admin === true
        );

        if (hasAdminRole) {
          if (isMounted) {
            setIsAdmin(true);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            // Gracefully redirect students to the student Notes Upload page
            navigate('/upload', { replace: true, state: { adminDenied: true } });
          }
        }
      } catch (err) {
        console.error('AdminRoute check error:', err);
        if (isMounted) navigate('/upload', { replace: true, state: { adminDenied: true } });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    check();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Checking admin access...</p>
        </div>
      </div>
    );
  }

  return isAdmin ? children : null;
};

export default AdminRoute;