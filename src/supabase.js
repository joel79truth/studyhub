import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qosudbigoxwzbdqkdecz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3NDU3NDMsImV4cCI6MjA3MzMyMTc0M30.B4ITihJkyALUSahDgGNgta6tivR7siBy7wM8KKb6JVQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
})