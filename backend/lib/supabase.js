import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://hlxoojajdzsjietcwvop.supabase.co";

const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhseG9vamFqZHpzamlldGN3dm9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NDgwMzgsImV4cCI6MjEwOTMyNDAzOH0.N0jwEpYYgzavW7kbYPIfTgDGSID-11a3qiDDxwxaqPE"; 

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
