/**
 * Cleans raw extracted PDF text.
 * - Joins hyphenated line-breaks
 * - Merges lines that are part of the same paragraph
 * - Splits into paragraphs on blank lines
 * - Removes very short paragraphs (likely headers / footers / noise)
 */

function cleanText(rawText) {
  // Step 1 – Replace common PDF artifacts
  let text = rawText
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\t/g, ' ')              // Tabs to spaces
    .replace(/\u0000/g, '');          // Remove null bytes if any

  // Step 2 – Rejoin hyphenated words split across lines
  text = text.replace(/-\n(\w)/g, '$1');   // "contin-\nued" → "continued"

  // Step 3 – Split into lines and merge into paragraphs
  const lines = text.split('\n');
  const paragraphs = [];
  let current = '';

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (current) {
        paragraphs.push(current.trim());
        current = '';
      }
    } else {
      // If current line ends with a sentence-ending punctuation, we consider paragraph end.
      // Otherwise, join with a space.
      if (current && /[.!?]$/.test(current)) {
        paragraphs.push(current.trim());
        current = trimmed;
      } else {
        current += (current ? ' ' : '') + trimmed;
      }
    }
  }
  if (current) paragraphs.push(current.trim());

  // Step 4 – Remove very short or numeric-only paragraphs (likely page numbers, headers)
  const cleaned = paragraphs.filter(p => {
    const wordCount = p.split(/\s+/).length;
    return wordCount > 3 && !/^\d+$/.test(p);   // keep if more than 3 words and not just a number
  });

  return cleaned;
}

module.exports = { cleanText };