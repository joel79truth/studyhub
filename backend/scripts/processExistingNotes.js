require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pdf = require('pdf-parse');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_BUCKET || 'notes';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Google OAuth2 setup
const oauthClientJson = JSON.parse(process.env.OAUTH_CLIENT_JSON);
const googleTokens = JSON.parse(process.env.GOOGLE_OAUTH_TOKENS);

const oauth2Client = new google.auth.OAuth2(
  oauthClientJson.web.client_id,
  oauthClientJson.web.client_secret,
  oauthClientJson.web.redirect_uris[0]
);
oauth2Client.setCredentials(googleTokens);

// Auto-refresh token before each request
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    // store new tokens in .env (optional – you can update .env manually)
    console.log('Google tokens refreshed; you may want to update GOOGLE_OAUTH_TOKENS in .env');
  }
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Directory for raw texts
const RAW_TEXT_DIR = path.join(__dirname, '..', 'extracted_texts');
if (!fs.existsSync(RAW_TEXT_DIR)) {
  fs.mkdirSync(RAW_TEXT_DIR, { recursive: true });
}

/**
 * Download a PDF from Google Drive using its file ID.
 * Returns a Buffer.
 */
async function downloadFromGoogleDrive(fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    const chunks = [];
    response.data
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

/**
 * Download a PDF from Supabase Storage using the file path.
 */
async function downloadFromSupabase(filePath) {
  const { data: blob, error } = await supabase
    .storage
    .from(bucketName)
    .download(filePath);

  if (error) throw new Error(`Supabase download error: ${error.message}`);
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processExistingNotes() {
  console.log('🔍 Fetching all PDF files from the database...');

  // Get all PDFs – also fetch storage_type and filepath
  const { data: allPdfs, error: fetchError } = await supabase
    .from('files')
    .select('id, filename, filepath, storage_type')
    .ilike('filename', '%.pdf');

  if (fetchError) {
    console.error('Failed to fetch files:', fetchError);
    return;
  }

  if (!allPdfs || allPdfs.length === 0) {
    console.log('No PDF files found.');
    return;
  }

  // Already processed file IDs
  const { data: completed, error: procError } = await supabase
    .from('file_processing')
    .select('file_id')
    .eq('status', 'completed');

  if (procError) {
    console.error('Failed to fetch processing status:', procError);
    return;
  }

  const completedIds = new Set((completed || []).map(r => r.file_id));
  const unprocessed = allPdfs.filter(f => !completedIds.has(f.id));

  console.log(`Found ${unprocessed.length} unprocessed PDF(s) out of ${allPdfs.length} total.`);

  for (const file of unprocessed) {
    console.log(`\n📄 Processing: ${file.filename} (${file.id})`);

    // Mark as processing
    await supabase
      .from('file_processing')
      .upsert({ file_id: file.id, status: 'processing', processed_at: null, error: null }, { onConflict: 'file_id' });

    try {
      let buffer;

      if (file.storage_type === 'gdrive') {
        // Google Drive file
        const driveId = file.filepath;   // filepath is the Google Drive file ID
        console.log(`   Downloading from Google Drive (${driveId})...`);
        buffer = await downloadFromGoogleDrive(driveId);
      } else {
        // Assume Supabase Storage (or other local storage via Supabase)
        console.log(`   Downloading from Supabase Storage (${file.filepath})...`);
        buffer = await downloadFromSupabase(file.filepath);
      }

      // Extract text with pdf-parse
      const pdfData = await pdf(buffer);
      const rawText = pdfData.text;

      console.log(`   Extracted ${rawText.length} characters.`);

      // Save raw text
      const textFilePath = path.join(RAW_TEXT_DIR, `${file.id}.txt`);
      fs.writeFileSync(textFilePath, rawText, 'utf8');

      // Mark completed
      await supabase
        .from('file_processing')
        .upsert({
          file_id: file.id,
          status: 'completed',
          processed_at: new Date().toISOString(),
          error: null
        }, { onConflict: 'file_id' });

      console.log(`   ✅ Saved to ${textFilePath}`);
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      await supabase
        .from('file_processing')
        .upsert({
          file_id: file.id,
          status: 'failed',
          processed_at: new Date().toISOString(),
          error: err.message
        }, { onConflict: 'file_id' });
    }
  }

  console.log('\n🎉 All unprocessed PDFs handled.');
}

processExistingNotes().catch(console.error);