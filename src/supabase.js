import { createClient } from '@supabase/supabase-js';

// Try to load Capacitor Preferences – only works in a Capacitor environment
let CapacitorPreferences = null;
try {
  const { Preferences } = require('@capacitor/preferences');
  CapacitorPreferences = Preferences;
} catch {
  // Not running inside Capacitor (web / development)
}

// Adapter that uses Capacitor Preferences on native, and localStorage on web
const storageAdapter = {
  getItem: async (key) => {
    if (CapacitorPreferences) {
      const { value } = await CapacitorPreferences.get({ key });
      return value || null;
    }
    return localStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (CapacitorPreferences) {
      await CapacitorPreferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  },
  removeItem: async (key) => {
    if (CapacitorPreferences) {
      await CapacitorPreferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  },
};

const supabaseUrl = "https://qosudbigoxwzbdqkdecz.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: storageAdapter,
    autoRefreshToken: true,
    persistSession: true,
  }
});