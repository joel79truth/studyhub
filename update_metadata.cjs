const fs = require('fs');

const SUPABASE_URL = 'https://qosudbigoxwzbdqkdecz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ';

// 1. Load Firebase users (localId → email)
const raw = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
const firebaseUsers = Array.isArray(raw) ? raw : raw.users;
console.log(`🔹 Firebase users loaded: ${firebaseUsers.length}`);

const uidToEmail = new Map();
for (const u of firebaseUsers) {
  if (u.email && u.localId) uidToEmail.set(u.localId, u.email);
}
console.log(`🔹 Mapped ${uidToEmail.size} Firebase UIDs to emails`);

// 2. Fetch all Supabase users (email → Supabase UUID)
async function getSupabaseUsers() {
  const emailToUuid = new Map();
  let page = 1, perPage = 100, hasMore = true;
  while (hasMore) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const data = await res.json();
    const users = data.users || data;
    if (!users || !users.length) hasMore = false;
    else {
      for (const user of users) {
        if (user.email) emailToUuid.set(user.email, user.id);
      }
      page++;
    }
  }
  return emailToUuid;
}

// 3. Update each Supabase user's metadata with old_firebase_uid (using localId)
async function updateMetadata() {
  const emailToUuid = await getSupabaseUsers();
  console.log(`🔹 Supabase users fetched: ${emailToUuid.size}`);

  let updated = 0;
  for (const [firebaseUid, email] of uidToEmail.entries()) {
    const supabaseId = emailToUuid.get(email);
    if (!supabaseId) {
      console.log(`⚠️ No Supabase user for ${email}, skipping.`);
      continue;
    }

    // Get current metadata, merge
    const resGet = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${supabaseId}`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const userData = await resGet.json();
    const currentMeta = userData.user_metadata || {};
    const updatedMeta = { ...currentMeta, old_firebase_uid: firebaseUid };

    const resPut = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${supabaseId}`, {
      method: 'PUT',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_metadata: updatedMeta }),
    });

    if (resPut.ok) {
      console.log(`✅ Updated metadata for ${email} (Firebase UID: ${firebaseUid})`);
      updated++;
    } else {
      const err = await resPut.json();
      console.error(`❌ Failed to update ${email}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`🎉 Done. Updated ${updated} users.`);
}

updateMetadata();