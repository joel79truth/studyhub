require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { cleanText } = require('./cleanText');
const { chunkText } = require('./chunkText');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_FILE_SIZE_MB = 20;
const MAX_LINE_LENGTH = 100_000;

async function processSingleFile(filePath, fileId) {
  console.log(`\n📦 Processing ${fileId} – ${path.basename(filePath)}`);

  // Already chunked?
  const { data: existing } = await supabase
    .from('note_chunks')
    .select('id')
    .eq('file_id', fileId)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log('   ↪️ Already chunked – skipping.');
    return;
  }

  // File size
  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);
  console.log(`   📏 File size: ${sizeMB.toFixed(2)} MB`);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    console.log('   ⚠️ Too large – skipped.');
    return;
  }

  // Read raw text
  let rawText;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error('   ❌ Read error:', err.message);
    return;
  }

  if (!rawText || rawText.trim().length < 10) {
    console.log('   ⚠️ Too little text – skipping.');
    return;
  }

  // Check for extremely long lines (safety)
  const lines = rawText.split('\n');
  if (lines.some(l => l.length > MAX_LINE_LENGTH)) {
    console.log('   ⚠️ File contains extremely long line – skipping.');
    return;
  }

  // Clean and chunk
  const paragraphs = cleanText(rawText);
  console.log(`   Cleaned → ${paragraphs.length} paragraphs.`);

  const chunks = chunkText(paragraphs);
  console.log(`   Chunked → ${chunks.length} chunks.`);

  if (chunks.length === 0) {
    console.log('   ⚠️ No chunks produced – skipping.');
    return;
  }

  // Insert in batches
  const BATCH_SIZE = 20;
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE).map(c => ({
      file_id: fileId,
      course_id: null,
      chunk_number: c.chunk_number,
      heading: c.heading,
      content: c.content,
      word_count: c.word_count,
    }));
    const { error } = await supabase.from('note_chunks').insert(batch);
    if (error) {
      console.error('   ❌ Insert error:', error.message);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`   ✅ Inserted ${inserted} / ${chunks.length} chunks.`);
}

// main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node processSingleFile.js <filePath> <fileId>');
  process.exit(1);
}
const [filePath, fileId] = args;

processSingleFile(filePath, fileId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });