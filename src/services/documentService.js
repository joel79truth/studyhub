import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';

/**
 * Fetch the pages of a document.
 * @param {string} fileId - ID of the file in the database
 * @param {string} fileType - 'pdf' or 'pptx'
 * @param {string} url - public URL of the file
 * @returns {Promise<Array>} array of page objects { page_num, heading, body, bullets, note }
 */
export async function fetchDocumentPages(fileId, fileType, url) {
  // 1. Try to get already parsed pages from a 'document_pages' table
  const { data, error } = await supabase
    .from('document_pages')
    .select('page_num, heading, body, bullets, note')
    .eq('file_id', fileId)
    .order('page_num', { ascending: true });

  if (!error && data && data.length > 0) {
    return data;
  }

  // 2. If not found, call a backend parser (replace with your actual endpoint)
  try {
    const response = await fetch(`${API_BASE_URL}/api/parse-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, fileType, url }),
    });
    if (!response.ok) throw new Error('Parsing failed');
    const pages = await response.json();
    // Optionally store the parsed pages in Supabase for future use
    await storeParsedPages(fileId, pages);
    return pages;
  } catch (err) {
    console.error('Error parsing document:', err);
    // Fallback: return a single page with the filename as heading
    return [{
      page_num: 1,
      heading: filename || 'Document',
      body: 'Unable to extract content from this file. Please try downloading it.',
      bullets: [],
      note: 'We are working on supporting more file types.'
    }];
  }
}

// Helper to store pages (optional)
async function storeParsedPages(fileId, pages) {
  const pagesToInsert = pages.map(p => ({
    file_id: fileId,
    page_num: p.page_num,
    heading: p.heading || '',
    body: p.body || '',
    bullets: p.bullets || [],
    note: p.note || '',
  }));
  await supabase.from('document_pages').upsert(pagesToInsert, { onConflict: 'file_id, page_num' });
}