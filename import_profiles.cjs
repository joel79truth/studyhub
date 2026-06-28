const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://qosudbigoxwzbdqkdecz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const profiles = JSON.parse(fs.readFileSync('./firestore_profiles.json', 'utf8'));

// Load Firebase auth users (contains localId + email)
const raw = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
const firebaseUsers = Array.isArray(raw) ? raw : raw.users;

// Build Firebase UID → email map (using localId)
const firebaseUidToEmail = new Map();
for (const user of firebaseUsers) {
  if (user.email && user.localId) {                     // <-- THE FIX: localId
    firebaseUidToEmail.set(user.localId, user.email);
  }
}
console.log(`📧 Loaded ${firebaseUidToEmail.size} Firebase UID → email mappings.`);

// Fetch all Supabase users and build email → Supabase UUID map
async function buildEmailToUuidMap() {
  const map = new Map();
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!res.ok) {
      const err = await res.json();
      console.error(`❌ Failed to fetch users (page ${page}): ${res.status} - ${err.message}`);
      throw new Error('Auth fetch failed');
    }

    const data = await res.json();
    const users = data.users || data;

    if (!users || !users.length) {
      hasMore = false;
    } else {
      for (const user of users) {
        if (user.email) {
          map.set(user.email, user.id);
        }
      }
      page++;
    }
  }
  return map;
}

async function importProfiles() {
  console.log('🔍 Building email → Supabase UUID map...');
  const emailToUuid = await buildEmailToUuidMap();
  console.log(`✅ Mapped ${emailToUuid.size} Supabase emails.`);

  let inserted = 0;
  for (const profile of profiles) {
    const firebaseUid = profile.id;   // this is the old Firebase localId

    // Step 1: find email from Firebase UID
    const email = firebaseUidToEmail.get(firebaseUid);

    if (!email) {
      console.log(`⚠️ No email found for Firebase UID ${firebaseUid}, skipping.`);
      continue;
    }

    // Step 2: find Supabase UUID from email
    const newId = emailToUuid.get(email);

    if (!newId) {
      console.log(`⚠️ No Supabase user for email ${email} (Firebase UID ${firebaseUid}), skipping.`);
      continue;
    }

    const row = {
      id: newId,
      program: profile.program || null,
      semester: profile.semester || null,
      email: profile.email || email,
      name: profile.name || profile.displayName || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('profiles')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.error(`❌ Failed for ${firebaseUid}: ${error.message}`);
    } else {
      console.log(`✅ Inserted profile for ${firebaseUid} (${email})`);
      inserted++;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`🎉 Profile migration complete. ${inserted} profiles inserted.`);
}

importProfiles();