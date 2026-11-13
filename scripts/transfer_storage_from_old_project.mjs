// scripts/transfer_storage_from_old_project.js
import { createClient } from '@supabase/supabase-js';

const OLD_URL = 'https://qosudbigoxwzbdqkdecz.supabase.co';
const OLD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3VkYmlnb3h3emJkcWtkZWN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Nzc0NTc0MywiZXhwIjoyMDczMzIxNzQzfQ.MGY3PdAKlF-j8Tnp_ttCnduiLFesCTPlFpFKD0jgEZQ';

const NEW_URL = 'https://hlxoojajdzsjietcwvop.supabase.co';
const NEW_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhseG9vamFqZHpzamlldGN3dm9wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5Mzc0ODAzOCwiZXhwIjoyMTA5MzI0MDM4fQ.gDkUuTe13EbQ1Mw3-kXK8ma_Iy_cMY4XKDNove-Dr0U';

const oldClient = createClient(OLD_URL, OLD_SERVICE_KEY);
const newClient = createClient(NEW_URL, NEW_SERVICE_KEY);

const BUCKETS = ['notes', 'past-paper', 'past-papers'];

async function listAllFiles(client, bucket, folder = '') {
  let allFiles = [];
  let page = 0;
  const limit = 100;

  while (true) {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      limit,
      offset: page * limit,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      console.error(`Error listing ${bucket}/${folder}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const item of data) {
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      // If item has no id, it's a folder (or metadata check)
      if (item.id === null || !item.metadata) {
        const subFiles = await listAllFiles(client, bucket, fullPath);
        allFiles = allFiles.concat(subFiles);
      } else {
        allFiles.push({ bucket, path: fullPath, size: item.metadata?.size });
      }
    }

    if (data.length < limit) break;
    page++;
  }

  return allFiles;
}

async function transferBucket(bucket) {
  console.log(`\n========================================`);
  console.log(`Scanning bucket: ${bucket} on old Supabase...`);
  console.log(`========================================`);

  const files = await listAllFiles(oldClient, bucket);
  console.log(`Found ${files.length} files in bucket '${bucket}'.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    process.stdout.write(`[${i + 1}/${files.length}] Transferring: ${file.path} ... `);

    try {
      // 1. Download from old bucket
      const { data: blob, error: downloadError } = await oldClient.storage
        .from(bucket)
        .download(file.path);

      if (downloadError) {
        console.log(`FAILED (download: ${downloadError.message})`);
        failCount++;
        continue;
      }

      // 2. Upload to new bucket
      const buffer = Buffer.from(await blob.arrayBuffer());
      const { error: uploadError } = await newClient.storage
        .from(bucket)
        .upload(file.path, buffer, {
          upsert: true,
          contentType: blob.type || 'application/octet-stream',
        });

      if (uploadError) {
        console.log(`FAILED (upload: ${uploadError.message})`);
        failCount++;
      } else {
        console.log(`OK (${(buffer.length / 1024).toFixed(1)} KB)`);
        successCount++;
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failCount++;
    }
  }

  console.log(`Finished ${bucket}: ${successCount} transferred, ${failCount} failed.`);
}

async function run() {
  console.log('Testing connectivity to old Supabase...');
  const { data: buckets, error: bErr } = await oldClient.storage.listBuckets();
  if (bErr) {
    console.error('Cannot access old Supabase storage yet:');
    console.error(bErr.message || bErr);
    console.log('\nPlease unlock / remove spend cap on the old Supabase project first.');
    process.exit(1);
  }

  console.log('Old Supabase storage is UNLOCKED! Starting transfer...\n');

  for (const bucket of BUCKETS) {
    await transferBucket(bucket);
  }

  console.log('\nAll buckets transferred successfully!');
}

run();
