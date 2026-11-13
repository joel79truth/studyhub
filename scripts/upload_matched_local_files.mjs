// scripts/upload_matched_local_files.mjs
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const NEW_URL = 'https://hlxoojajdzsjietcwvop.supabase.co';
const NEW_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhseG9vamFqZHpzamlldGN3dm9wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5Mzc0ODAzOCwiZXhwIjoyMTA5MzI0MDM4fQ.gDkUuTe13EbQ1Mw3-kXK8ma_Iy_cMY4XKDNove-Dr0U';

const supabase = createClient(NEW_URL, NEW_SERVICE_KEY);

const data = JSON.parse(fs.readFileSync('migration_data/matched_uploads.json', 'utf8'));
const notes = data.noteMatches || [];
const papers = data.paperMatches || [];

console.log(`Checking and uploading: ${notes.length} notes, ${papers.length} papers.`);

async function isAlreadyUploaded(bucket, storagePath) {
  try {
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    const url = `${NEW_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function uploadFile(bucket, storagePath, localPath) {
  if (!fs.existsSync(localPath)) {
    console.log(`  [SKIP] Local file not found: ${localPath}`);
    return false;
  }

  // Check if already in bucket
  const exists = await isAlreadyUploaded(bucket, storagePath);
  if (exists) {
    console.log(`  [ALREADY EXISTS] ${bucket}/${storagePath}`);
    return true;
  }

  try {
    const fileBuffer = fs.readFileSync(localPath);
    const contentType = localPath.endsWith('.pdf') ? 'application/pdf'
      : localPath.endsWith('.pptx') ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : localPath.endsWith('.jpg') || localPath.endsWith('.jpeg') ? 'image/jpeg'
      : 'application/octet-stream';

    const { error } = await supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
      upsert: true,
      contentType,
    });

    if (error) {
      console.log(`  [FAIL] ${storagePath}: ${error.message}`);
      return false;
    }
    console.log(`  [UPLOADED OK] ${bucket}/${storagePath} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err) {
    console.log(`  [ERR] ${storagePath}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('\n--- CHECKING & UPLOADING NOTES ---');
  let noteSuccess = 0;
  for (const n of notes) {
    const ok = await uploadFile('notes', n.filepath, n.localPath);
    if (ok) noteSuccess++;
  }

  console.log('\n--- CHECKING & UPLOADING PAST PAPERS ---');
  let paperSuccess = 0;
  for (const p of papers) {
    const ok = await uploadFile('past-paper', p.storagePath, p.localPath);
    if (ok) {
      paperSuccess++;
      await uploadFile('past-papers', p.storagePath, p.localPath);
    }
  }

  console.log(`\nSummary: ${noteSuccess}/${notes.length} notes ready, ${paperSuccess}/${papers.length} papers ready.`);
}

main();
