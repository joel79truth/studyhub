import React, { memo, useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  Check,
  Copy,
  Lightbulb,
  AlertTriangle,
  Info,
  CheckCircle2,
  BookOpen,
  Calculator,
} from 'lucide-react';

// ─── Delimiter & LaTeX Sanitization ──────────────────────────────────────────
function sanitizeForMath(raw, isStreaming = false) {
  if (!raw) return '';
  let text = String(raw);

  // 1. Normalize LaTeX display \[ ... \] and inline \( ... \) delimiters
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `\n\n$$\n${inner.trim()}\n$$\n\n`);
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner.trim()}$`);

  // 2. Normalize multiple backslashes (e.g. \\\\frac -> \frac) that sometimes slip from JSON escaping
  text = text.replace(/\\\\([a-zA-Z]+)/g, '\\$1');

  // 3. Protect unescaped currency symbols like "$50" or "$1,000" from triggering math parsing
  text = text.replace(/(^|\s)\$(\d+(?:[.,]\d+)?)(?=\s|$|[,.!?])/g, '$1\\$$$2');

  // 4. If actively streaming, auto-balance unclosed delimiters so KaTeX doesn't break mid-stream
  if (isStreaming) {
    // Check block $$
    const blockMatches = text.match(/\$\$/g);
    if (blockMatches && blockMatches.length % 2 !== 0) {
      text += '\n$$';
    } else {
      // Check inline $
      const inlineMatches = text.match(/(?<!\$)\$(?!\$)/g);
      if (inlineMatches && inlineMatches.length % 2 !== 0) {
        text += '$';
      }
    }
  }

  return text;
}

// ─── Callout Detection ───────────────────────────────────────────────────────
const CALLOUT_TYPES = {
  TIP: {
    label: 'Pro Tip',
    icon: Lightbulb,
    border: 'border-amber-400/80',
    bg: 'bg-amber-50',
    text: 'text-black',
    badge: 'bg-amber-100 text-amber-900',
  },
  NOTE: {
    label: 'Key Concept',
    icon: Info,
    border: 'border-blue-400/80',
    bg: 'bg-blue-50',
    text: 'text-black',
    badge: 'bg-blue-100 text-blue-900',
  },
  WARNING: {
    label: 'Common Exam Trap',
    icon: AlertTriangle,
    border: 'border-rose-400/80',
    bg: 'bg-rose-50',
    text: 'text-black',
    badge: 'bg-rose-100 text-rose-900',
  },
  IMPORTANT: {
    label: 'Important Rule',
    icon: AlertTriangle,
    border: 'border-amber-500/80',
    bg: 'bg-amber-50',
    text: 'text-black',
    badge: 'bg-amber-100 text-amber-900',
  },
  EXAMPLE: {
    label: 'Worked Example',
    icon: BookOpen,
    border: 'border-indigo-400/80',
    bg: 'bg-indigo-50',
    text: 'text-black',
    badge: 'bg-indigo-100 text-indigo-900',
  },
  FORMULA: {
    label: 'Governing Formula',
    icon: Calculator,
    border: 'border-purple-400/80',
    bg: 'bg-purple-50',
    text: 'text-black',
    badge: 'bg-purple-100 text-purple-900',
  },
  ANSWER: {
    label: 'Final Answer',
    icon: CheckCircle2,
    border: 'border-emerald-400/80',
    bg: 'bg-emerald-50',
    text: 'text-black',
    badge: 'bg-emerald-100 text-emerald-900',
  },
};

function getCalloutMeta(firstLine) {
  if (!firstLine || typeof firstLine !== 'string') return null;
  const match = firstLine.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION|EXAMPLE|FORMULA|ANSWER)\]/i);
  if (match) {
    const key = match[1].toUpperCase();
    const type = key === 'CAUTION' ? 'WARNING' : key;
    return { type, meta: CALLOUT_TYPES[type] || CALLOUT_TYPES.NOTE, cleanFirstLine: firstLine.replace(/^\[!.*?\]\s*/, '') };
  }

  // Emoji-based fallbacks
  if (/^💡\s*(tip|pro-tip|note)?/i.test(firstLine)) {
    return { type: 'TIP', meta: CALLOUT_TYPES.TIP, cleanFirstLine: firstLine.replace(/^💡\s*(tip|pro-tip|note)?:?\s*/i, '') };
  }
  if (/^⚠️\s*(warning|caution|pitfall|trap)?/i.test(firstLine)) {
    return { type: 'WARNING', meta: CALLOUT_TYPES.WARNING, cleanFirstLine: firstLine.replace(/^⚠️\s*(warning|caution|pitfall|trap)?:?\s*/i, '') };
  }
  if (/^🎯\s*(formula|key formula)?/i.test(firstLine)) {
    return { type: 'FORMULA', meta: CALLOUT_TYPES.FORMULA, cleanFirstLine: firstLine.replace(/^🎯\s*(formula|key formula)?:?\s*/i, '') };
  }
  if (/^✅\s*(final answer|answer)?/i.test(firstLine)) {
    return { type: 'ANSWER', meta: CALLOUT_TYPES.ANSWER, cleanFirstLine: firstLine.replace(/^✅\s*(final answer|answer)?:?\s*/i, '') };
  }

  return null;
}

// ─── Code Block with Copy ───────────────────────────────────────────────────
const CodeBlock = memo(({ language, children }) => {
  const [copied, setCopied] = useState(false);
  const codeContent = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback or silent ignore
    }
  }, [codeContent]);

  return (
    <div className="code-block-container my-4 rounded-xl border border-slate-700/60 bg-slate-900 text-slate-100 overflow-hidden shadow-sm" style={{ colorScheme: 'dark' }}>
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950/70 border-b border-slate-800 text-xs text-slate-400 font-mono select-none">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Copy code"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-[11px] font-sans font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-sans">Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto text-[13.5px] leading-relaxed font-mono">
        <code style={{ color: '#f1f5f9' }}>{children}</code>
      </div>
    </div>
  );
});

// ─── Tutor Markdown Main Component ──────────────────────────────────────────
const TutorMarkdown = memo(({ content, isStreaming = false, className = '' }) => {
  const processed = useMemo(
    () => sanitizeForMath(content, isStreaming),
    [content, isStreaming]
  );

  const customComponents = useMemo(() => ({
    // Code & Inline Code
    code({ node, inline, className: codeClassName, children, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      if (!inline && (match || String(children).includes('\n'))) {
        return (
          <CodeBlock language={match ? match[1] : ''}>
            {children}
          </CodeBlock>
        );
      }
      return (
        <code
          className="px-1.5 py-0.5 rounded-md bg-slate-100 text-black font-mono text-[0.88em] font-medium border border-slate-200"
          style={{ color: '#000000', backgroundColor: '#f1f5f9' }}
          {...props}
        >
          {children}
        </code>
      );
    },

    // Blockquote & Pedagogical Callouts
    blockquote({ node, children, ...props }) {
      // Look for callout tag in first text node
      let rawText = '';
      try {
        const firstP = node.children?.find(c => c.tagName === 'p');
        if (firstP && firstP.children?.[0]?.value) {
          rawText = firstP.children[0].value;
        }
      } catch {}

      const callout = getCalloutMeta(rawText);
      if (callout) {
        const { meta } = callout;
        const Icon = meta.icon;
        return (
          <div className={`my-4 p-4 rounded-xl border ${meta.border} ${meta.bg} shadow-xs text-black transition-all`} style={{ color: '#000000', colorScheme: 'light' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`p-1 rounded-md ${meta.badge}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-black" style={{ color: '#000000' }}>
                {meta.label}
              </span>
            </div>
            <div className="text-[14.5px] leading-relaxed text-black" style={{ color: '#000000' }}>
              {children}
            </div>
          </div>
        );
      }

      return (
        <blockquote
          className="my-3.5 pl-4 border-l-3 border-indigo-500 text-black italic bg-indigo-50/40 py-1.5 rounded-r-lg"
          style={{ color: '#000000', colorScheme: 'light' }}
          {...props}
        >
          {children}
        </blockquote>
      );
    },

    // Headings
    h1: ({ node, ...props }) => (
      <h1 className="text-xl font-bold text-black mt-6 mb-2 tracking-tight flex items-center gap-2" style={{ color: '#000000' }} {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg font-bold text-black mt-5 mb-2 tracking-tight" style={{ color: '#000000' }} {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-base font-semibold text-black mt-4 mb-1.5" style={{ color: '#000000' }} {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 className="text-sm font-semibold text-black mt-3 mb-1" style={{ color: '#000000' }} {...props} />
    ),
    h5: ({ node, ...props }) => (
      <h5 className="text-sm font-medium text-black mt-2 mb-1" style={{ color: '#000000' }} {...props} />
    ),
    h6: ({ node, ...props }) => (
      <h6 className="text-xs font-medium text-black mt-2 mb-1" style={{ color: '#000000' }} {...props} />
    ),

    // Paragraphs with comfortable reading rhythm (pure solid black)
    p: ({ node, ...props }) => (
      <p className="my-2 text-[15px] leading-[1.72] text-black break-words font-normal" style={{ color: '#000000' }} {...props} />
    ),

    // Lists
    ul: ({ node, ...props }) => (
      <ul className="my-2.5 pl-5 space-y-1.5 list-disc marker:text-black text-[15px] leading-relaxed text-black" style={{ color: '#000000' }} {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="my-2.5 pl-5 space-y-2 list-decimal marker:font-semibold marker:text-black text-[15px] leading-relaxed text-black" style={{ color: '#000000' }} {...props} />
    ),
    li: ({ node, ...props }) => (
      <li className="pl-1 text-black" style={{ color: '#000000' }} {...props} />
    ),
    strong: ({ node, ...props }) => (
      <strong className="font-bold text-black" style={{ color: '#000000' }} {...props} />
    ),
    em: ({ node, ...props }) => (
      <em className="italic text-black" style={{ color: '#000000' }} {...props} />
    ),

    // Tables
    table: ({ node, ...props }) => (
      <div className="my-4 w-full overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
        <table className="w-full text-left text-sm border-collapse text-black" style={{ color: '#000000' }} {...props} />
      </div>
    ),
    thead: ({ node, ...props }) => (
      <thead className="bg-slate-50 text-black font-semibold border-b border-slate-200" style={{ color: '#000000' }} {...props} />
    ),
    tbody: ({ node, ...props }) => (
      <tbody className="divide-y divide-slate-100 text-black" style={{ color: '#000000' }} {...props} />
    ),
    tr: ({ node, ...props }) => (
      <tr className="hover:bg-slate-50/50 transition-colors" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider text-black" style={{ color: '#000000' }} {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="px-3.5 py-2.5 text-[14px] text-black" style={{ color: '#000000' }} {...props} />
    ),

    // Horizontal Rule
    hr: ({ node, ...props }) => (
      <hr className="my-5 border-0 border-t border-slate-200" {...props} />
    ),

    // Links
    a: ({ node, ...props }) => (
      <a
        className="text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-3 transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),

    // Math display equation wrapper
    span: ({ node, className: spanClass, children, ...props }) => {
      if (spanClass?.includes('katex-display')) {
        return (
          <span className="block my-3 py-2 px-3 rounded-xl bg-slate-50/90 border border-slate-200/80 overflow-x-auto no-scrollbar text-center shadow-xs" style={{ color: '#000000' }}>
            <span className={spanClass} style={{ color: '#000000' }} {...props}>
              {children}
            </span>
          </span>
        );
      }
      return <span className={spanClass} style={{ color: '#000000' }} {...props}>{children}</span>;
    },
  }), []);

  return (
    <div className={`tutor-markdown text-black ${className}`} style={{ color: '#000000', colorScheme: 'light' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, errorColor: '#e11d48' }]]}
        components={customComponents}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

TutorMarkdown.displayName = 'TutorMarkdown';

export default TutorMarkdown;
