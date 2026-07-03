import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';

// Adapter using the official Capacitor Preferences API (secure on device)
const NativePreferencesAdapter = {
  getItem: async (key) => {
    const { value } = await Preferences.get({ key });
    return value || null;
  },
  setItem: async (key, value) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key) => {
    await Preferences.remove({ key });
  }
};

const supabaseUrl = "https://qosudbigoxwzbdqkdecz.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: NativePreferencesAdapter,
    autoRefreshToken: true,
    persistSession: true,
  }
});