const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pdfParse = require('pdf-parse');
const { convert } = require('pdf-poppler');
const Tesseract = require('tesseract.js');

// ============ CONFIG ============
const SUPABASE_URL = 'your-supabase-url';
const SUPABASE_SERVICE_KEY = 'your-service-role-key'; // Use service key for full access
const BUCKET_NAME = 'past_papers';

const supabase = createClient(SUPABASE_URL, SUPABASE_SUPABASE_SERVICE_KEY);
// ================================

/**
 * Clean extracted text: collapse spaces, normalize newlines, remove non‑printable chars.
 */
function cleanText(text) {
  if (!text) return '';
  // Replace 3+ newlines with at most two
  text = text.replace(/\n{3,}/g, '\n\n');
  // Collapse multiple spaces/tabs to single space
  text = text.replace(/[ \t]+/g, ' ');
  // Remove non‑printable characters except newline and tab
  text = text.replace(/[^\x20-\x7E\n\t]/g, '');
  return text.trim();
}

/**
 * Extract text from a PDF buffer.
 * Returns: { text, method } where method = 'text_pdf' or 'ocr'
 */
async function extractFromPdfBuffer(pdfBuffer) {
  // First, try text extraction (pdf-parse)
  try {
    const data = await pdfParse(pdfBuffer);
    const extracted = data.text || '';
    if (extracted.length > 100) {
      return { text: extracted, method: 'text_pdf' };
    }
  } catch (err) {
    console.warn('⚠️  Text extraction failed, falling back to OCR...');
  }

  // Fallback: OCR using pdf-poppler to convert to images + Tesseract.js
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ocr-'));
  const inputPdf = path.join(tempDir, 'input.pdf');
  fs.writeFileSync(inputPdf, pdfBuffer);

  try {
    // Convert PDF to images (one per page)
    const opts = {
      format: 'png',
      out_dir: tempDir,
      out_prefix: 'page',
      page: null, // all pages
    };
    await convert(inputPdf, opts);

    // Read all generated images
    const files = fs.readdirSync(tempDir).filter(f => f.startsWith('page-') && f.endsWith('.png'));
    let ocrText = '';
    for (const file of files) {
      const imagePath = path.join(tempDir, file);
      const imageBuffer = fs.readFileSync(imagePath);
      const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
        logger: m => {} // silence Tesseract logs
      });
      ocrText += text + '\n';
      fs.unlinkSync(imagePath); // clean up image
    }
    // Clean up the rest
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { text: ocrText, method: 'ocr' };
  } catch (err) {
    // Clean up on error
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`OCR processing failed: ${err.message}`);
  }
}

/**
 * Main processing function
 */
async function processAllPastPapers() {
  // Fetch all records (you can add .limit(5) for testing)
  const { data: papers, error } = await supabase
    .from('past_papers')
    .select('*');

  if (error) {
    console.error('❌ Error fetching past papers:', error);
    return;
  }

  console.log(`📄 Found ${papers.length} past papers to process.`);

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    const { id, file_name, program, course, semester, storage_path, file_url } = paper;
    console.log(`\n[${i+1}/${papers.length}] Processing: ${file_name}`);

    // Determine file path in bucket
    let filePath = storage_path;
    if (!filePath && file_url) {
      // Extract path from public URL if possible
      const match = file_url.match(/\/public\/[^?]+/);
      if (match) {
        filePath = match[0].replace('/public/', '');
      } else {
        // Fallback: use the whole URL (not ideal, but try)
        filePath = file_url;
      }
    }

    if (!filePath) {
      console.log(`  ❌ Skipping: no storage_path or file_url`);
      continue;
    }

    try {
      // Download file from Supabase Storage
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from(BUCKET_NAME)
        .download(filePath);

      if (downloadError) {
        console.log(`  ❌ Download error: ${downloadError.message}`);
        continue;
      }

      // Convert Blob/ArrayBuffer to Buffer
      const arrayBuffer = await fileData.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);

      // Extract text
      const { text, method } = await extractFromPdfBuffer(pdfBuffer);
      const cleaned = cleanText(text);

      // Insert into extracted_past_papers
      const { error: insertError } = await supabase
        .from('extracted_past_papers')
        .insert({
          past_paper_id: id,
          program,
          course,
          semester,
          file_name,
          extracted_text: cleaned,
          raw_ocr_output: text,      // keep original raw
          word_count: cleaned.split(/\s+/).length,
          extraction_method: method,
        });

      if (insertError) {
        console.log(`  ❌ Insert error: ${insertError.message}`);
      } else {
        console.log(`  ✅ Success – method: ${method}, words: ${cleaned.split(/\s+/).length}`);
      }

    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}`);
    }
  }

  console.log('\n🏁 Done.');
}

// Run
processAllPastPapers();