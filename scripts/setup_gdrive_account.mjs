import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });
import readline from 'readline';
import http from 'http';
import url from 'url';

const targetEmail = 'truthjoel7907@gmail.com';
const folderName = 'studyhub-notes';

async function main() {
  console.log('===========================================================');
  console.log('       STUDYHUB GOOGLE DRIVE OAUTH ONBOARDING TOOL        ');
  console.log('===========================================================');
  console.log(`Target Google Account: ${targetEmail}`);
  console.log(`Dedicated Storage Folder: ${folderName}\n`);

  if (!process.env.OAUTH_CLIENT_JSON) {
    console.error('Error: OAUTH_CLIENT_JSON not found in backend/.env');
    process.exit(1);
  }

  const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
  const { client_id, client_secret } = oauthCreds.installed || oauthCreds.web;
  // Use http://localhost as registered in Google Cloud Console
  const redirect_uri = 'http://localhost';

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id,
      redirect_uri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      login_hint: targetEmail
    }).toString();

  console.log('👉 STEP 1: Open this authorization URL in your browser:');
  console.log('-----------------------------------------------------------');
  console.log(authUrl);
  console.log('-----------------------------------------------------------\n');
  console.log(`Make sure to select and authorize account: ${targetEmail}`);
  console.log('\nAfter granting permission, Google will redirect to:');
  console.log('http://localhost/?code=4/0A...');
  console.log('(Even if the browser page says "This site cannot be reached", that is normal!)');
  console.log('👉 Copy the full redirected URL from your browser address bar and paste it below:\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Paste redirected URL or authorization code: ', async (input) => {
    rl.close();
    input = input.trim();
    if (!input) {
      console.log('No input provided. Exiting.');
      return;
    }

    let code = input;
    if (input.includes('code=')) {
      try {
        const parsed = new URL(input);
        code = parsed.searchParams.get('code') || input;
      } catch {
        const match = input.match(/code=([^&]+)/);
        if (match) code = decodeURIComponent(match[1]);
      }
    }

    console.log('\nExchanging authorization code for refresh token...');
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id,
          client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri
        })
      });

      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        console.error('Failed to exchange code:', tokenData);
        return;
      }

      const refreshToken = tokenData.refresh_token;
      const accessToken = tokenData.access_token;
      console.log('✅ Successfully obtained Refresh Token!');

      // Check account email
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const userData = await userRes.json();
      console.log(`Connected Account: ${userData.email} (${userData.name})`);

      // Check or create studyhub-notes folder
      console.log(`Searching for folder "${folderName}" in Drive...`);
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${folderName}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const folderData = await folderRes.json();

      let folderId = folderData.files?.[0]?.id;
      if (!folderId) {
        console.log(`Creating folder "${folderName}"...`);
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        const created = await createRes.json();
        folderId = created.id;
        console.log(`✅ Created folder "${folderName}" with ID: ${folderId}`);
      } else {
        console.log(`✅ Found existing folder "${folderName}" with ID: ${folderId}`);
      }

      // Update backend/.env
      const fs = await import('fs');
      let envContent = fs.readFileSync('backend/.env', 'utf8');

      if (folderId) {
        envContent = envContent.replace(/GOOGLE_DRIVE_FOLDER_ID=.*/, `GOOGLE_DRIVE_FOLDER_ID=${folderId}`);
      }
      if (refreshToken) {
        envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${refreshToken}`);
      }

      fs.writeFileSync('backend/.env', envContent, 'utf8');
      console.log('✅ Updated backend/.env successfully with new Google Drive credentials!');
      console.log('\n===========================================================');
      console.log('ALL FILE UPLOADS ARE NOW CONFIGURED TO GO TO GOOGLE DRIVE!');
      console.log(`Folder: ${folderName} (ID: ${folderId})`);
      console.log(`Account: ${userData.email}`);
      console.log('===========================================================');

    } catch (err) {
      console.error('Setup error:', err.message);
    }
  });
}

main();
