import { supabase } from '../supabase';

export const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};