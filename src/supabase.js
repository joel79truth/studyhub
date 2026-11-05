// supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://hlxoojajdzsjietcwvop.supabase.co";
// ✅ Use the ANON key (role: 'anon') – NOT the service_role key
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhseG9vamFqZHpzamlldGN3dm9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NDgwMzgsImV4cCI6MjEwOTMyNDAzOH0.N0jwEpYYgzavW7kbYPIfTgDGSID-11a3qiDDxwxaqPE";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});