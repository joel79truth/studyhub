// utils/normalizer.js

/**
 * Applies a set of rules to a string to fix common LaTeX/unit/chemistry errors.
 * It only modifies text outside of math mode ($...$ or $$...$$) for safety.
 */
function normalizeLaTeX(str) {
  if (!str || typeof str !== 'string') return str;

  // Split the string into alternating plain-text and math segments.
  // We'll use a regex that captures both $...$ and $$...$$.
  // The regex below matches either $$...$$ or $...$, and we'll rebuild the string.
  const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^$\r\n]*?\$)/g;
  let parts = [];
  let lastIndex = 0;
  let match;
  while ((match = mathRegex.exec(str)) !== null) {
    // Plain text before this math block
    const plain = str.slice(lastIndex, match.index);
    parts.push({ type: 'text', content: plain });
    // Math block
    parts.push({ type: 'math', content: match[0] });
    lastIndex = mathRegex.lastIndex;
  }
  // Remaining plain text after last math block
  const tail = str.slice(lastIndex);
  parts.push({ type: 'text', content: tail });

  // Apply transformations only to text segments
  const transformedParts = parts.map(part => {
    if (part.type === 'text') {
      return fixPlainText(part.content);
    }
    return part.content; // leave math unchanged
  });

  return transformedParts.join('');
}

function fixPlainText(text) {
  // 1. Fix common unit mistakes from Gemini (e.g., \text{textm/s} or \textm/s)
  text = text.replace(/\\text\s*\{\s*text([^}]*)\}/g, (match, inner) => {
    // e.g., \text{textm/s} -> \mathrm{m/s}
    return `\\mathrm{${inner}}`;
  });
  text = text.replace(/\\textm\/s/g, '\\mathrm{m\\,s^{-1}}');
  text = text.replace(/\\textm\s/g, '\\mathrm{m}');
  text = text.replace(/\\texts/g, '\\mathrm{s}');
  text = text.replace(/\\textkg/g, '\\mathrm{kg}');
  text = text.replace(/\\textN/g, '\\mathrm{N}');
  text = text.replace(/\\textJ/g, '\\mathrm{J}');
  // Add more as needed

  // 2. Convert simple unit expressions like "m/s" to proper LaTeX (if not already)
  // We'll use a regex for common physical units: m/s, km/h, kg/m^3 etc.
  // Replace plain "m/s" that is not inside math. We'll do a safe approach:
  text = text.replace(/(?<![a-zA-Z\\])(m)\/(s)(?![a-zA-Z])/g, '\\mathrm{m\\,s^{-1}}');
  text = text.replace(/(?<![a-zA-Z\\])(km)\/(h)(?![a-zA-Z])/g, '\\mathrm{km\\,h^{-1}}');
  text = text.replace(/(?<![a-zA-Z\\])(kg)\/(m\^?3)/g, '\\mathrm{kg\\,m^{-3}}');

  // 3. Fix Greek letters (Unicode → LaTeX command)
  const greekMap = {
    'α': '\\alpha',
    'β': '\\beta',
    'γ': '\\gamma',
    'δ': '\\delta',
    'ε': '\\varepsilon',
    'θ': '\\theta',
    'λ': '\\lambda',
    'μ': '\\mu',
    'ρ': '\\rho',
    'σ': '\\sigma',
    'Δ': '\\Delta',
    'Ω': '\\Omega',
    'π': '\\pi',
    'Σ': '\\Sigma',
    'φ': '\\phi'
  };
  for (const [char, latex] of Object.entries(greekMap)) {
    text = text.split(char).join(latex);
  }

  // 4. Simple chemical formula subscript correction
  // Only apply to plain text: e.g., H2O -> H$_2$O
  // We'll match a capital letter followed by lowercase? and then digits.
  text = text.replace(/(\b[A-Z][a-z]?)(\d+)/g, (match, element, digits) => {
    // Avoid breaking if already inside $ (but we're in plain text, so safe)
    return `${element}$_{${digits}}$`;
  });

  // 5. Fix obvious missing backslashes (e.g., "text{...}" without backslash)
  // This is tricky, but Gemini sometimes outputs "text{...}" alone.
  text = text.replace(/(?<!\\)text\{/g, '\\text{');

  // 6. Remove double backslashes that can appear as artifacts
  text = text.replace(/\\\\/g, '\\');

  return text;
}

/**
 * Normalize an entire question object's relevant fields.
 */
function normalizeQuestion(q) {
  if (q.question) q.question = normalizeLaTeX(q.question);
  if (q.answer) q.answer = normalizeLaTeX(q.answer);
  if (q.option_a) q.option_a = normalizeLaTeX(q.option_a);
  if (q.option_b) q.option_b = normalizeLaTeX(q.option_b);
  if (q.option_c) q.option_c = normalizeLaTeX(q.option_c);
  if (q.option_d) q.option_d = normalizeLaTeX(q.option_d);
  return q;
}

module.exports = { normalizeLaTeX, normalizeQuestion };