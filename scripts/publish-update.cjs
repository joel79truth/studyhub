#!/usr/bin/env node
/**
 * StudyHub Update Publishing Script
 *
 * Usage:
 *   node scripts/publish-update.cjs <path-to-apk> <version-name> <version-code> "<release-notes>" [--force] [--min-code=N]
 *
 * Example:
 *   node scripts/publish-update.cjs android/app/build/outputs/apk/release/app-release.apk 1.2.0 3 "Improved quiz engine, faster search, and bug fixes"
 *
 * Requirements:
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY in .env or environment
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Load .env
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      if (key && vals.length) {
        process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  });
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qosudbigoxwzbdqkdecz.supabase.co";
// Must use service role key for uploading to storage & modifying app_updates
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error('\n❌ ERROR: SUPABASE_SERVICE_ROLE_KEY is required to publish updates.');
  console.error('Add SUPABASE_SERVICE_ROLE_KEY=your_key to your .env file or environment variables.');
  console.error('You can find this in your Supabase Dashboard: Project Settings -> API -> service_role key.\n');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log(`
StudyHub LUANAR - Release Publisher
===================================
Usage:
  node scripts/publish-update.cjs <apk-path> <version-name> <version-code> <release-notes> [options]

Arguments:
  <apk-path>       Path to the signed release APK file
  <version-name>   Version string (e.g. "1.2.0")
  <version-code>   Integer versionCode matching build.gradle (e.g. 3)
  <release-notes>  Release notes / changelog

Options:
  --force          Mark this update as mandatory (cannot be dismissed)
  --min-code=N     Minimum supported version code (earlier versions forced to update)
  --bucket=NAME    Storage bucket name (default: "app-updates")

Example:
  node scripts/publish-update.cjs android/app/build/outputs/apk/release/app-release.apk 1.2.0 3 "Speed improvements and new past papers"
`);
  process.exit(0);
}

const apkPathArg = args[0];
const versionName = args[1];
const versionCode = parseInt(args[2], 10);
const releaseNotes = args[3];

if (isNaN(versionCode)) {
  console.error('❌ Error: version-code must be an integer.');
  process.exit(1);
}

const isForce = args.includes('--force');
const minCodeArg = args.find((a) => a.startsWith('--min-code='));
const minVersionCode = minCodeArg ? parseInt(minCodeArg.split('=')[1], 10) : 1;
const bucketArg = args.find((a) => a.startsWith('--bucket='));
const bucketName = bucketArg ? bucketArg.split('=')[1] : 'app-updates';

const resolvedApkPath = path.resolve(process.cwd(), apkPathArg);
if (!fs.existsSync(resolvedApkPath)) {
  console.error(`❌ Error: APK file not found at: ${resolvedApkPath}`);
  process.exit(1);
}

async function run() {
  console.log('\n🚀 Publishing StudyHub Update...');
  console.log(`- Version Name: ${versionName}`);
  console.log(`- Version Code: ${versionCode}`);
  console.log(`- Force Update: ${isForce}`);
  console.log(`- Min Version Code: ${minVersionCode}`);

  const fileBuffer = fs.readFileSync(resolvedApkPath);
  const fileSize = fileBuffer.length;
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  console.log(`- File Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`- SHA-256: ${sha256}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const storageFileName = `studyhub-v${versionName}.apk`;
  console.log(`\n⏳ Uploading APK to Supabase Storage bucket "${bucketName}" as "${storageFileName}"...`);

  const axios = require('axios');
  const https = require('https');
  const uploadUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucketName}/${storageFileName}`;
  const httpsAgent = new https.Agent({ keepAlive: true, timeout: 600000 });
  
  let uploaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`⏳ Upload attempt ${attempt}/3 starting stream...`);
      const stream = fs.createReadStream(resolvedApkPath);
      await axios.post(uploadUrl, stream, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': fileSize,
          'x-upsert': 'true',
        },
        httpsAgent,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            process.stdout.write(`\r[Upload] ${pct}% (${(progressEvent.loaded / (1024 * 1024)).toFixed(1)} MB / ${(progressEvent.total / (1024 * 1024)).toFixed(1)} MB)`);
          }
        },
      });
      uploaded = true;
      console.log('\n✅ APK uploaded successfully via Supabase Storage REST endpoint.');
      break;
    } catch (err) {
      console.log('');
      const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`❌ Upload attempt ${attempt} failed: ${errMsg}`);
      if (attempt === 3) {
        console.error('All upload attempts exhausted.');
        process.exit(1);
      }
      console.log('Retrying in 2 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log('\n⏳ Registering update in "app_updates" table...');
  const { data, error: dbError } = await supabase
    .from('app_updates')
    .upsert(
      {
        version_name: versionName,
        version_code: versionCode,
        apk_path: storageFileName,
        apk_size_bytes: fileSize,
        sha256: sha256,
        release_notes: releaseNotes,
        min_version_code: minVersionCode,
        force_update: isForce,
        is_active: true,
      },
      { onConflict: 'version_code' }
    )
    .select()
    .single();

  if (dbError) {
    console.error('❌ Failed to insert record into app_updates table:', dbError.message);
    process.exit(1);
  }

  console.log(`\n🎉 SUCCESS! StudyHub v${versionName} (build ${versionCode}) is now live!`);
  console.log(`Record ID: ${data.id}`);
  console.log('Students will automatically be notified or prompted based on your settings.\n');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
