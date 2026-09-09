import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView, setAnalyticsUser } from '../lib/analytics';
import { supabase } from '../supabase';

export default function AnalyticsTracker() {
  const location = useLocation();

  // Track page view on every route change in React Router
  useEffect(() => {
    const fullPath = location.pathname + location.search;
    trackPageView(fullPath, document.title);
  }, [location]);

  // Set user properties once authenticated
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('profiles')
          .select('program, semester, year_of_study, role')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (profile) {
              setAnalyticsUser(session.user.id, {
                program: profile.program,
                semester: profile.semester,
                year: profile.year_of_study,
                role: profile.role,
              });
            }
          });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        supabase
          .from('profiles')
          .select('program, semester, year_of_study, role')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (profile) {
              setAnalyticsUser(session.user.id, {
                program: profile.program,
                semester: profile.semester,
                year: profile.year_of_study,
                role: profile.role,
              });
            }
          });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
