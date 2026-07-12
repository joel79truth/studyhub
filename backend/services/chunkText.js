/**
 * Splits an array of clean paragraphs into overlapping chunks.
 * Processes paragraph by paragraph to avoid large intermediate arrays.
 *
 * @param {string[]} paragraphs – cleaned text paragraphs
 * @param {Object} options
 * @param {number} options.chunkSize – target words per chunk (default 500)
 * @param {number} options.overlap – words overlap between consecutive chunks (default 50)
 * @returns {Array} chunks – each with { chunk_number, heading, content, word_count }
 */
function chunkText(paragraphs, options = {}) {
  const chunkSize = options.chunkSize || 500;
  const overlap = options.overlap || 50;

  if (!paragraphs || paragraphs.length === 0) return [];

  const chunks = [];
  let chunkNumber = 0;

  // Flatten all paragraphs into a single array of words – BUT we'll stream them
  // We still need to access words sequentially. To avoid a giant array, we'll
  // iterate through paragraphs and yield words one by one using a generator.
  function* wordGenerator() {
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(w => w.length > 0);
      for (const w of words) {
        yield w;
      }
    }
  }

  const gen = wordGenerator();
  let buffer = [];               // current chunk words
  let overlapBuffer = [];        // words to carry over to next chunk

  // Fill initial buffer
  for (const word of gen) {
    buffer.push(word);
    if (buffer.length >= chunkSize) break;
  }

  while (buffer.length > 0) {
    const content = buffer.join(' ');

    // Simple heading: first 80 chars of content
    const heading = content.length > 80 ? content.substring(0, 80).trim() + '…' : content;

    chunks.push({
      chunk_number: ++chunkNumber,
      heading,
      content,
      word_count: buffer.length,
      page_start: null,
      page_end: null,
    });

    // Prepare overlap: keep last `overlap` words from current buffer
    if (overlap > 0 && buffer.length > overlap) {
      overlapBuffer = buffer.slice(-overlap);
    } else {
      overlapBuffer = buffer.slice(); // if buffer is smaller than overlap, keep all (but will break soon)
    }

    // Build next buffer starting with overlap words
    buffer = [...overlapBuffer];
    // Add new words until we reach chunkSize or exhaust generator
    for (const word of gen) {
      buffer.push(word);
      if (buffer.length >= chunkSize) break;
    }

    // If no new words were added (buffer didn't grow or is same as overlap), we're done
    if (buffer.length <= overlapBuffer.length) break;
  }

  return chunks;
}

module.exports = { chunkText };