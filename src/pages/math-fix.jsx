// math-fix.jsx
import { memo, useMemo } from 'react'
import { InlineMath, BlockMath } from 'react-katex'

// ---------------------------------------------------------------------------
// SANITIZATION HELPERS (OCR artifact removal)
// Strips zero-width characters, combining diacritics, and Cyrillic
// homoglyphs that occasionally slip in from OCR/AI extraction and would
// otherwise silently break KaTeX parsing (e.g. a Cyrillic "а" that LOOKS
// identical to Latin "a" but isn't a valid LaTeX command character).
// ---------------------------------------------------------------------------
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g
const COMBINING_RE = /[\u0300-\u036f]/g

const HOMOGLYPH_MAP = {
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i',
}

function sanitizeLatex(raw) {
  if (!raw) return raw
  let s = raw
    .replace(ZERO_WIDTH_RE, '')
    .replace(COMBINING_RE, '')
    .normalize('NFKC')
  s = s.replace(/[\u0400-\u04FF]/g, (ch) => HOMOGLYPH_MAP[ch] || ch)
  return s
}

// ---------------------------------------------------------------------------
// unescapeLatex — sanitize first, then collapse repeated backslashes.
// ---------------------------------------------------------------------------
function unescapeLatex(content) {
  if (!content) return content
  const cleaned = sanitizeLatex(String(content))
  return cleaned.replace(/\\+/g, '\\')
}

// ---------------------------------------------------------------------------
// wrapUndelimitedMacros
// ---------------------------------------------------------------------------
function wrapUndelimitedMacros(raw) {
  const runRe =
    /[0-9A-Za-z.,+\-*/=()°]*(?:\\[a-zA-Z]+(?:\{[^{}]*\})?|\^\{[^{}]*\}|_\{[^{}]*\})[0-9A-Za-z.,+\-*/=(){}°\\^_ ]*/g
  return raw
    .replace(runRe, (match) => {
      const trimmed = match.trim()
      return trimmed ? ` $${unescapeLatex(trimmed)}$ ` : match
    })
    .replace(/[ \t]+/g, ' ')
}

// ---------------------------------------------------------------------------
// splitDelimitedSegments — scans for $$...$$, \[...\], \(...\), $...$, `...`.
// ---------------------------------------------------------------------------
function splitDelimitedSegments(text) {
  const segments = []
  const len = text.length
  let i = 0
  let textStart = 0
  const flushText = (end) => {
    if (end > textStart) segments.push({ type: 'text', value: text.slice(textStart, end) })
  }
  while (i < len) {
    if (text.startsWith('$$', i)) {
      const close = text.indexOf('$$', i + 2)
      if (close === -1) { i++; continue }
      flushText(i)
      segments.push({ type: 'block', value: unescapeLatex(text.slice(i + 2, close).trim()) })
      i = close + 2; textStart = i; continue
    }
    if (text.startsWith('\\[', i)) {
      const close = text.indexOf('\\]', i + 2)
      if (close === -1) { i++; continue }
      flushText(i)
      segments.push({ type: 'block', value: unescapeLatex(text.slice(i + 2, close).trim()) })
      i = close + 2; textStart = i; continue
    }
    if (text.startsWith('\\(', i)) {
      const close = text.indexOf('\\)', i + 2)
      if (close === -1) { i++; continue }
      flushText(i)
      segments.push({ type: 'inline', value: unescapeLatex(text.slice(i + 2, close).trim()) })
      i = close + 2; textStart = i; continue
    }
    if (text[i] === '$') {
      const nl = text.indexOf('\n', i + 1)
      const searchEnd = nl === -1 ? len : nl
      const close = text.indexOf('$', i + 1)
      if (close === -1 || close > searchEnd) { i++; continue }
      const inner = text.slice(i + 1, close)
      if (!inner.trim() || /^[\d,.\s]+$/.test(inner)) { i++; continue }
      flushText(i)
      segments.push({ type: 'inline', value: unescapeLatex(inner.trim()) })
      i = close + 1; textStart = i; continue
    }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close === -1) { i++; continue }
      flushText(i)
      segments.push({ type: 'inline', value: text.slice(i + 1, close).trim() })
      i = close + 1; textStart = i; continue
    }
    i++
  }
  flushText(len)
  return segments
}

// ---------------------------------------------------------------------------
// parseMathSegments — undelimited-macro wrapping runs PER plain-text
// segment, after splitting on existing delimiters — not gated on whether
// the whole input has a $ anywhere in it.
// ---------------------------------------------------------------------------
export function parseMathSegments(rawInput) {
  if (!rawInput) return []
  const text = unescapeLatex(String(rawInput))
  const rawSegments = splitDelimitedSegments(text)

  const segments = []
  for (const seg of rawSegments) {
    if (seg.type !== 'text') { segments.push(seg); continue }
    if (/\\[a-zA-Z]+|[_^]\{/.test(seg.value)) {
      const wrapped = wrapUndelimitedMacros(seg.value)
      if (wrapped !== seg.value) {
        segments.push(...splitDelimitedSegments(wrapped))
        continue
      }
    }
    segments.push(seg)
  }
  return segments
}

function tidyPlainText(t) {
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
}

// ---------------------------------------------------------------------------
// mathRenderError — kept as a live diagnostic (fires only on actual KaTeX
// parse failures, not on every render), unlike the removed input/output
// tracing which logged on every single math span regardless of outcome.
// ---------------------------------------------------------------------------
export function mathRenderError(value) {
  return (err) => {
    console.warn('[KaTeX render failed]', { value, message: err?.message })
    return <code className="text-gray-600 bg-gray-100 rounded px-1 text-[0.85em]">{unescapeLatex(value)}</code>
  }
}

// ---------------------------------------------------------------------------
// MathText
// ---------------------------------------------------------------------------
export const MathText = memo(({ text, className = '' }) => {
  const segments = useMemo(() => parseMathSegments(text), [text])
  if (!segments.length) return null

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'block') {
          const safeMath = unescapeLatex(seg.value)
          return (
            <span key={i} className="block my-1 overflow-x-auto no-scrollbar">
              <BlockMath math={safeMath} errorColor="#e11d48" renderError={mathRenderError(seg.value)} strict={false} />
            </span>
          )
        }
        if (seg.type === 'inline') {
          const safeMath = unescapeLatex(seg.value)
          return <InlineMath key={i} math={safeMath} errorColor="#e11d48" renderError={mathRenderError(seg.value)} strict={false} />
        }
        return <span key={i} style={{ whiteSpace: 'pre-line' }}>{tidyPlainText(seg.value)}</span>
      })}
    </span>
  )
})

// ---------------------------------------------------------------------------
// renderSegments — the math/plain-text leaf renderer shared by both the
// bold and italic branches in renderInline below, so math renders
// correctly even when it appears inside **bold** or *italic* text.
// ---------------------------------------------------------------------------
function renderSegments(text, keyPrefix) {
  const segments = parseMathSegments(text)
  return segments.map((seg, si) => {
    const key = `${keyPrefix}-${si}`
    if (seg.type === 'block') {
      const safeMath = unescapeLatex(seg.value)
      return (
        <span key={key} className="block my-1 overflow-x-auto no-scrollbar">
          <BlockMath math={safeMath} errorColor="#e11d48" renderError={mathRenderError(seg.value)} strict={false} />
        </span>
      )
    }
    if (seg.type === 'inline') {
      const safeMath = unescapeLatex(seg.value)
      return <InlineMath key={key} math={safeMath} errorColor="#e11d48" renderError={mathRenderError(seg.value)} strict={false} />
    }
    return <span key={key}>{seg.value}</span>
  })
}

// ---------------------------------------------------------------------------
// renderInline — bold, italic, and math. Bold is split out first; within
// each non-bold piece, italic is split out next; math is resolved last,
// inside every resulting leaf (including inside bold/italic text).
// ---------------------------------------------------------------------------
export function renderInline(text, keyPrefix) {
  const boldRe = /\*\*([^*]+)\*\*/g
  const pieces = []
  let last = 0
  let m
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) pieces.push({ bold: false, value: text.slice(last, m.index) })
    pieces.push({ bold: true, value: m[1] })
    last = boldRe.lastIndex
  }
  if (last < text.length) pieces.push({ bold: false, value: text.slice(last) })

  const italicRe = /(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)|(?<!_)_(?!_)([^_\n]+?)_(?!_)/g

  const nodes = []
  pieces.forEach((piece, pi) => {
    if (piece.bold) {
      nodes.push(
        <strong key={`${keyPrefix}-b${pi}`} className="font-bold text-gray-900">
          {renderSegments(piece.value, `${keyPrefix}-b${pi}`)}
        </strong>
      )
      return
    }
    italicRe.lastIndex = 0
    let iLast = 0, im
    const italicPieces = []
    while ((im = italicRe.exec(piece.value)) !== null) {
      if (im.index > iLast) italicPieces.push({ italic: false, value: piece.value.slice(iLast, im.index) })
      italicPieces.push({ italic: true, value: im[1] ?? im[2] })
      iLast = italicRe.lastIndex
    }
    if (iLast < piece.value.length) italicPieces.push({ italic: false, value: piece.value.slice(iLast) })

    italicPieces.forEach((ip, ii) => {
      const segKey = `${keyPrefix}-${pi}-${ii}`
      if (ip.italic) nodes.push(<em key={segKey}>{renderSegments(ip.value, segKey)}</em>)
      else nodes.push(...renderSegments(ip.value, segKey))
    })
  })
  return nodes
}