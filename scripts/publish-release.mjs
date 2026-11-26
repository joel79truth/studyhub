// scripts/publish-release.mjs
// Publishes the latest APK to Supabase Storage and Google Drive, and upserts app_updates.
// Usage: node scripts/publish-release.mjs

import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });
import { setGlobalDispatcher, Agent } from 'undici';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Extend undici timeouts for large APK uploads
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 600000 },
    headersTimeout: 600000,
    bodyTimeout: 600000,
  })
);

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const BUCKET = 'app-updates';
const VERSION_CODE = 24;
const VERSION_NAME = '1.4.1';
const APK_STORAGE_PATH = `studyhub-v${VERSION_NAME}-build${VERSION_CODE}.apk`;
const APK_LOCAL_PATH = resolve(
  __dirname,
  '../android/app/build/outputs/apk/release/app-release.apk'
);
const RELEASE_NOTES =
  'StudyHub v1.4.1 (build 24) - Direct Lecturer Role & Admin Verification, unified Student setup directly on login page (no home modal), and direct access to notes upload without redundant password prompt.';

// ── Main ─────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`\n📦  Reading APK: ${APK_LOCAL_PATH}`);
  const apkBuffer = readFileSync(APK_LOCAL_PATH);
  const apkSizeBytes = statSync(APK_LOCAL_PATH).size;
  const sha256 = createHash('sha256').update(apkBuffer).digest('hex');

  console.log(`    Size  : ${(apkSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`    SHA256: ${sha256}`);

  // ── 1. Upload APK to Google Drive ─────────────────────────────────────────
  let driveWebLink = null;
  let driveDownloadUrl = null;
  if (process.env.GOOGLE_REFRESH_TOKEN && process.env.OAUTH_CLIENT_JSON) {
    try {
      console.log('\n☁️   Uploading copy to Google Drive…');
      const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
      const { client_id, client_secret } = oauthCreds.installed || oauthCreds.web;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id,
          client_secret,
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
          grant_type: 'refresh_token',
        }),
      });
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      if (accessToken) {
        const boundary = 'foo_bar_baz';
        const metadata = {
          name: `studyhub-v${VERSION_NAME}-build${VERSION_CODE}.apk`,
          parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : undefined,
        };

        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const multipartBody = Buffer.concat([
          Buffer.from(
            delimiter +
              'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
              JSON.stringify(metadata) +
              delimiter +
              'Content-Type: application/vnd.android.package-archive\r\n\r\n'
          ),
          apkBuffer,
          Buffer.from(closeDelimiter),
        ]);

        const driveUploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
          }
        );

        const driveData = await driveUploadRes.json();
        if (driveData.id) {
          console.log('✅  Google Drive upload successful! File ID:', driveData.id);
          driveWebLink = driveData.webViewLink || driveData.webContentLink;
          driveDownloadUrl = `https://drive.google.com/uc?export=download&id=${driveData.id}`;

          // Make it readable to anyone with the link
          try {
            await fetch(`https://www.googleapis.com/drive/v3/files/${driveData.id}/permissions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ role: 'reader', type: 'anyone' }),
            });
            console.log('✅  Google Drive sharing permission set to public reader.');
          } catch (permErr) {
            console.warn('⚠️  Could not set public permissions on Drive file:', permErr.message);
          }
        }
      }
    } catch (gErr) {
      console.warn('⚠️  Google Drive upload warning:', gErr.message);
    }
  }

  // ── 2. Upload APK to Supabase Storage ─────────────────────────────────────
  let supabasePublicUrl = null;
  console.log(`\n☁️   Uploading to Supabase Storage (${BUCKET}/${APK_STORAGE_PATH})…`);
  try {
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(APK_STORAGE_PATH, apkBuffer, {
        contentType: 'application/vnd.android.package-archive',
        upsert: true,
      });

    if (uploadError) {
      console.warn('⚠️  Supabase Storage upload warning:', uploadError.message);
    } else {
      console.log('✅  Supabase Storage upload successful:', uploadData?.path ?? APK_STORAGE_PATH);
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(APK_STORAGE_PATH);
      supabasePublicUrl = publicUrlData?.publicUrl;
      console.log(`🔗  Supabase Public URL: ${supabasePublicUrl}`);
    }
  } catch (sbErr) {
    console.warn('⚠️  Supabase upload exception:', sbErr.message);
  }

  // Determine final APK download URL (prefer direct Supabase Storage URL so Android doesn't get Drive's virus scan HTML warning page)
  const finalApkUrl = supabasePublicUrl || driveDownloadUrl;
  if (!finalApkUrl) {
    console.error('❌  Neither Supabase Storage nor Google Drive produced a download URL.');
    process.exit(1);
  }

  console.log(`\n🎯  Active Download URL: ${finalApkUrl}`);

  // ── 3. Deactivate all previous entries in app_updates ─────────────────────
  console.log('\n🔄  Deactivating previous app_updates entries…');
  const { error: deactivateError } = await supabase
    .from('app_updates')
    .update({ is_active: false })
    .neq('version_code', VERSION_CODE);

  if (deactivateError) {
    console.warn('⚠️   Could not deactivate old entries:', deactivateError.message);
  } else {
    console.log('✅  Previous entries deactivated.');
  }

  // ── 4. Upsert new row in app_updates ──────────────────────────────────────
  console.log(`\n📝  Upserting app_updates row for v${VERSION_NAME} (build ${VERSION_CODE})…`);

  const { data: upsertData, error: upsertError } = await supabase
    .from('app_updates')
    .upsert(
      {
        version_code: VERSION_CODE,
        version_name: VERSION_NAME,
        is_active: true,
        force_update: false,
        min_version_code: 1,
        apk_path: finalApkUrl,
        apk_size_bytes: apkSizeBytes,
        sha256,
        release_notes: RELEASE_NOTES,
      },
      { onConflict: 'version_code' }
    )
    .select();

  if (upsertError) {
    console.error('❌  Upsert failed:', upsertError.message);
    process.exit(1);
  }
  console.log('✅  app_updates row saved:', upsertData);

  console.log('\n============================================================');
  console.log(`🎉  RELEASE v${VERSION_NAME} (build ${VERSION_CODE}) PUBLISHED SUCCESSFULLY!`);
  console.log(`📥  Active APK Download URL:`);
  console.log(`    ${finalApkUrl}`);
  if (driveWebLink) {
    console.log(`📥  Google Drive Web Link:`);
    console.log(`    ${driveWebLink}`);
  }
  if (supabasePublicUrl) {
    console.log(`📥  Supabase Storage URL:`);
    console.log(`    ${supabasePublicUrl}`);
  }
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
