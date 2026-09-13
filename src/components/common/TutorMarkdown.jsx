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
    border: 'border-amber-400/60 dark:border-amber-500/50',
    bg: 'bg-amber-50/80 dark:bg-amber-950/20',
    text: 'text-amber-900 dark:text-amber-200',
    badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  },
  NOTE: {
    label: 'Key Concept',
    icon: Info,
    border: 'border-blue-400/60 dark:border-blue-500/50',
    bg: 'bg-blue-50/80 dark:bg-blue-950/20',
    text: 'text-blue-900 dark:text-blue-200',
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  },
  WARNING: {
    label: 'Common Exam Trap',
    icon: AlertTriangle,
    border: 'border-rose-400/60 dark:border-rose-500/50',
    bg: 'bg-rose-50/80 dark:bg-rose-950/20',
    text: 'text-rose-900 dark:text-rose-200',
    badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300',
  },
  IMPORTANT: {
    label: 'Important Rule',
    icon: AlertTriangle,
    border: 'border-amber-500/60 dark:border-amber-500/50',
    bg: 'bg-amber-50/80 dark:bg-amber-950/20',
    text: 'text-amber-900 dark:text-amber-200',
    badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  },
  EXAMPLE: {
    label: 'Worked Example',
    icon: BookOpen,
    border: 'border-indigo-400/60 dark:border-indigo-500/50',
    bg: 'bg-indigo-50/80 dark:bg-indigo-950/20',
    text: 'text-indigo-900 dark:text-indigo-200',
    badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300',
  },
  FORMULA: {
    label: 'Governing Formula',
    icon: Calculator,
    border: 'border-purple-400/60 dark:border-purple-500/50',
    bg: 'bg-purple-50/80 dark:bg-purple-950/20',
    text: 'text-purple-900 dark:text-purple-200',
    badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300',
  },
  ANSWER: {
    label: 'Final Answer',
    icon: CheckCircle2,
    border: 'border-emerald-400/60 dark:border-emerald-500/50',
    bg: 'bg-emerald-50/80 dark:bg-emerald-950/20',
    text: 'text-emerald-900 dark:text-emerald-200',
    badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
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
    <div className="my-4 rounded-xl border border-slate-700/60 bg-slate-900 text-slate-100 overflow-hidden shadow-sm">
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
        <code>{children}</code>
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
          className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-mono text-[0.88em] font-medium border border-slate-200/80 dark:border-slate-700/60"
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
          <div className={`my-4 p-4 rounded-xl border ${meta.border} ${meta.bg} shadow-xs transition-all`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`p-1 rounded-md ${meta.badge}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className={`text-xs font-bold uppercase tracking-wider ${meta.text}`}>
                {meta.label}
              </span>
            </div>
            <div className={`text-[14.5px] leading-relaxed ${meta.text}`}>
              {children}
            </div>
          </div>
        );
      }

      return (
        <blockquote
          className="my-3.5 pl-4 border-l-3 border-indigo-400/80 text-slate-700 dark:text-slate-300 italic bg-indigo-50/30 dark:bg-indigo-950/10 py-1.5 rounded-r-lg"
          {...props}
        >
          {children}
        </blockquote>
      );
    },

    // Headings
    h1: ({ node, ...props }) => (
      <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-6 mb-2 tracking-tight flex items-center gap-2" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-5 mb-2 tracking-tight" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1.5" {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-3 mb-1" {...props} />
    ),

    // Paragraphs with comfortable reading rhythm
    p: ({ node, ...props }) => (
      <p className="my-2 text-[15px] leading-[1.72] text-slate-800 dark:text-slate-200 break-words" {...props} />
    ),

    // Lists
    ul: ({ node, ...props }) => (
      <ul className="my-2.5 pl-5 space-y-1.5 list-disc marker:text-indigo-500 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="my-2.5 pl-5 space-y-2 list-decimal marker:font-semibold marker:text-indigo-600 dark:marker:text-indigo-400 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200" {...props} />
    ),
    li: ({ node, ...props }) => (
      <li className="pl-1" {...props} />
    ),

    // Tables
    table: ({ node, ...props }) => (
      <div className="my-4 w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <table className="w-full text-left text-sm border-collapse" {...props} />
      </div>
    ),
    thead: ({ node, ...props }) => (
      <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-700" {...props} />
    ),
    tbody: ({ node, ...props }) => (
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300" {...props} />
    ),
    tr: ({ node, ...props }) => (
      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400" {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="px-3.5 py-2.5 text-[14px]" {...props} />
    ),

    // Horizontal Rule
    hr: ({ node, ...props }) => (
      <hr className="my-5 border-0 border-t border-slate-200 dark:border-slate-800" {...props} />
    ),

    // Links
    a: ({ node, ...props }) => (
      <a
        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium underline underline-offset-3 transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),

    // Math display equation wrapper
    span: ({ node, className: spanClass, children, ...props }) => {
      if (spanClass?.includes('katex-display')) {
        return (
          <span className="block my-3 py-2 px-3 rounded-xl bg-slate-50/90 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 overflow-x-auto no-scrollbar text-center shadow-xs">
            <span className={spanClass} {...props}>
              {children}
            </span>
          </span>
        );
      }
      return <span className={spanClass} {...props}>{children}</span>;
    },
  }), []);

  return (
    <div className={`tutor-markdown ${className}`}>
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
