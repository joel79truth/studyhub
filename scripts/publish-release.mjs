// scripts/publish-release.mjs
// Publishes the latest APK to Supabase Storage and upserts a row in app_updates.
// Usage: node scripts/publish-release.mjs

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://qosudbigoxwzbdqkdecz.supabase.co';
const SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ';

const BUCKET = 'app-updates';
const VERSION_CODE = 19;
const VERSION_NAME = '1.3.6';
const APK_STORAGE_PATH = `studyhub-v${VERSION_NAME}-build${VERSION_CODE}.apk`;
const APK_LOCAL_PATH = resolve(
  __dirname,
  '../android/app/build/outputs/apk/release/app-release.apk'
);
const RELEASE_NOTES =
  'Fixed PDF "Actual Paper" view crashing on older Android devices. Quiz and Notes pages now load correctly. Added Share StudyHub button to sidebar.';

// ── Main ─────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`\n📦  Reading APK: ${APK_LOCAL_PATH}`);
  const apkBuffer = readFileSync(APK_LOCAL_PATH);
  const apkSizeBytes = statSync(APK_LOCAL_PATH).size;
  const sha256 = createHash('sha256').update(apkBuffer).digest('hex');

  console.log(`    Size  : ${(apkSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`    SHA256: ${sha256}`);

  // ── 1. Upload APK ────────────────────────────────────────────────────────
  console.log(`\n☁️   Uploading to Supabase Storage (${BUCKET}/${APK_STORAGE_PATH})…`);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(APK_STORAGE_PATH, apkBuffer, {
      contentType: 'application/vnd.android.package-archive',
      upsert: true,
    });

  if (uploadError) {
    console.error('❌  Upload failed:', uploadError.message);
    process.exit(1);
  }
  console.log('✅  Upload successful:', uploadData?.path ?? APK_STORAGE_PATH);

  // ── 2. Get public URL ────────────────────────────────────────────────────
  const { data: publicUrlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(APK_STORAGE_PATH);

  const publicUrl = publicUrlData?.publicUrl;
  if (!publicUrl) {
    console.error('❌  Could not get public URL. Make sure the bucket is public.');
    process.exit(1);
  }
  console.log(`🔗  Public URL: ${publicUrl}`);

  // ── 3. Deactivate all previous entries ──────────────────────────────────
  console.log('\n🔄  Deactivating previous app_updates entries…');
  const { error: deactivateError } = await supabase
    .from('app_updates')
    .update({ is_active: false })
    .neq('version_code', VERSION_CODE);

  if (deactivateError) {
    console.warn('⚠️   Could not deactivate old entries:', deactivateError.message);
    // Non-fatal — continue
  } else {
    console.log('✅  Previous entries deactivated.');
  }

  // ── 4. Upsert new row ────────────────────────────────────────────────────
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
        apk_path: publicUrl,
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

  console.log('✅  app_updates row upserted successfully!');
  console.log('    Row:', JSON.stringify(upsertData?.[0] ?? {}, null, 2));
  console.log('\n🎉  Release v' + VERSION_NAME + ' (build ' + VERSION_CODE + ') published!');
  console.log('    Users on older builds will see an update prompt on next launch.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
