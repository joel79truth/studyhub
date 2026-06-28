const fs = require('fs');

const SUPABASE_URL = 'https://qosudbigoxwzbdqkdecz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ';   // ← new key

const raw = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
const firebaseUsers = Array.isArray(raw) ? raw : raw.users;
if (!firebaseUsers || !Array.isArray(firebaseUsers)) {
  console.error('Invalid users.json');
  process.exit(1);
}

async function userExists(email) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) return false;
  const users = await res.json();
  return users.length > 0;
}

async function createUser(fbUser) {
  const isPasswordUser = fbUser.providerUserInfo.some(p => p.providerId === 'password');

  const payload = {
    email: fbUser.email,
    email_confirm: true,
    user_metadata: {
      full_name: fbUser.displayName || '',
      old_firebase_uid: fbUser.uid,       // ← THIS IS THE KEY
    },
  };

  if (isPasswordUser) {
    payload.password = Math.random().toString(36).slice(-12) + 'A1b!';
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ Failed to create ${fbUser.email}: ${data.message}`);
    return null;
  }
  console.log(`✅ Created ${fbUser.email} (ID: ${data.id})`);
  return data.id;
}

async function sendReset(email) {
  await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
}

async function migrate() {
  for (const user of firebaseUsers) {
    if (!user.email) continue;
    const exists = await userExists(user.email);
    if (exists) {
      console.log(`⏭️ Already exists: ${user.email}`);
      continue;
    }
    const newId = await createUser(user);
    if (newId && user.providerUserInfo.some(p => p.providerId === 'password')) {
      await sendReset(user.email);
      console.log(`   📧 Password reset sent to ${user.email}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('🎉 Auth migration complete!');
}

migrate();