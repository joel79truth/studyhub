import dotenv from 'dotenv';
dotenv.config();

console.log('1. Loaded env. Refresh token length:', process.env.GOOGLE_REFRESH_TOKEN ? process.env.GOOGLE_REFRESH_TOKEN.length : 0);

async function test() {
  const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
  const { client_id, client_secret } = oauthCreds.installed || oauthCreds.web;
  
  console.log('2. Requesting access token from oauth2.googleapis.com...');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: controller.signal
  });
  clearTimeout(timeout);

  console.log('3. Token response status:', res.status);
  const data = await res.json();
  if (data.error) {
    console.error('Token error:', data);
    return;
  }
  const accessToken = data.access_token;
  console.log('4. Got access token! Querying Drive about/user...');

  const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const aboutData = await aboutRes.json();
  console.log('5. Drive user info:', JSON.stringify(aboutData, null, 2));

  console.log('6. Querying folders...');
  const folderRes = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const foldersData = await folderRes.json();
  console.log('7. Folders found:', JSON.stringify(foldersData.files, null, 2));

  // Check if studyhub-notes folder exists
  let targetFolder = foldersData.files?.find(f => f.name.toLowerCase() === 'studyhub-notes');
  if (targetFolder) {
    console.log('FOUND studyhub-notes folder! ID:', targetFolder.id);
  } else {
    console.log('Creating studyhub-notes folder...');
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'studyhub-notes',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const createdData = await createRes.json();
    console.log('Created studyhub-notes folder! ID:', createdData.id);
  }
}

test().catch(err => console.error('Error:', err));
