require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { cleanText } = require('./cleanText');
const { chunkText } = require('./chunkText');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const RAW_TEXT_DIR = path.join(__dirname, '..', 'extracted_texts');
const MAX_FILE_SIZE_MB = 20;   // skip anything over 20 MB

function bytesToMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function processFile(filePath, fileId) {
  // Already chunked?
  const { data: existing } = await supabase
    .from('note_chunks')
    .select('id')
    .eq('file_id', fileId)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(`   ↪️ Already chunked.`);
    return;
  }

  // File size
  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);
  console.log(`   📏 File size: ${sizeMB.toFixed(1)} MB`);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    console.log(`   ⚠️ Too large – skipped.`);
    return;
  }

  // Read text
  const rawText = fs.readFileSync(filePath, 'utf8');
  if (!rawText || rawText.trim().length < 10) {
    console.log(`   ⚠️ Too little text (scanned PDF).`);
    return;
  }

  // Clean
  const paragraphs = cleanText(rawText);
  console.log(`   Cleaned → ${paragraphs.length} paragraphs.`);

  // Chunk
  const chunks = chunkText(paragraphs);
  console.log(`   Chunked → ${chunks.length} chunks.`);

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
      summary: null,
      keywords: null,
      word_count: c.word_count,
      page_start: c.page_start,
      page_end: c.page_end,
    }));
    const { error } = await supabase.from('note_chunks').insert(batch);
    if (error) {
      console.error(`   ❌ Insert error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`   ✅ Inserted ${inserted} chunks.`);
}

async function processAllPdfs() {
  const files = fs.readdirSync(RAW_TEXT_DIR).filter(f => f.endsWith('.txt'));
  console.log(`Found ${files.length} raw text files.`);

  for (const file of files) {
    const fileId = path.basename(file, '.txt');
    const filePath = path.join(RAW_TEXT_DIR, file);
    console.log(`\n📦 ${fileId} (${file})`);
    try {
      await processFile(filePath, fileId);
    } catch (err) {
      console.error(`   ❌ Unhandled error:`, err.message);
    }
    // Optional: log memory
    const mem = process.memoryUsage();
    console.log(`   💾 Heap used: ${(mem.heapUsed / 1024 / 1024).toFixed(0)} MB`);
  }
  console.log('\n🎉 Done.');
}

processAllPdfs().catch(console.error);