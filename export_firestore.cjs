const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function exportUsers() {
  const snapshot = await db.collection('users').get();
  const profiles = [];
  snapshot.forEach(doc => {
    profiles.push({ id: doc.id, ...doc.data() });
  });
  fs.writeFileSync('firestore_profiles.json', JSON.stringify(profiles, null, 2));
  console.log(`✅ Exported ${profiles.length} profiles.`);
  process.exit(0);
}

exportUsers();