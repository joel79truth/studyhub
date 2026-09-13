// ═══════════════════════════════════════════════════════════════
//  StudyHub – AI Study Assistant  ·  Production  ·  UX-Fixed Edition
//  Backend: studyhub-router.js (mounted at /api/luna)
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import {
  X, Send, Maximize2, Minimize2, Menu, Plus, Trash2,
  MessageSquare, MoreHorizontal, Check, Copy, RefreshCw, Square, ChevronDown,
} from 'lucide-react'
import { BlockMath } from 'react-katex'
import 'katex/dist/katex.min.css'
import { supabase } from '../../supabase'
import { API_BASE_URL } from '../../lib/apiConfig'
import { renderInline } from "../../pages/math-fix"
import TutorMarkdown from '../common/TutorMarkdown'

const AI_ICON = '/Ai.png'
const ASSISTANT_NAME = 'StudyHub'

const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

const apiUrl = (path) =>
  path.startsWith('/api/') ? `${API_BASE_URL}${path}` : path

const C = {
  brand: '#4f46e5',
  brandB: '#3b82f6',
  surface: '#f8fafc',
  border: '#e8edf3',
  text: '#1e293b',
  muted: '#64748b',
  ink: '#0f172a',
  warn: '#b45309',
  warnBg: '#fffbeb',
  warnBdr: '#fde68a',
  errC: '#be123c',
  errBg: '#fff1f2',
  errBdr: '#fecdd3',
  highlight: 'rgba(79, 70, 229, 0.14)',
  good: '#16a34a',
  goodBg: '#f0fdf4',
  bad: '#dc2626',
  badBg: '#fef2f2',
}

const MODES = [
  { key: 'normal', label: 'Normal', emoji: '💬', desc: 'Quick, direct answers' },
  { key: 'teach', label: 'Teach me', emoji: '🧑‍🎓', desc: 'Deep explanations' },
  { key: 'exam', label: 'Exam mode', emoji: '📝', desc: 'Test your understanding' },
]

const STARTER_PROMPTS = [
  { label: 'Explain this simply', prompt: 'Explain this page like I am a complete beginner.' },
  { label: 'What should I remember?', prompt: 'What are the key things I should remember from this page?' },
  { label: 'Test me on this', prompt: 'Ask me one question to test my understanding of this page.' },
]

const INTENT_CHIPS = {
  definition:      ['Give an example', 'Test me'],
  explanation:     ['Explain simpler', 'Test me'],
  steps:           ['Show me an example', 'Test me'],
  comparison:      ['Give a memory tip', 'Test me'],
  guided_reasoning:['Show the next step', 'Check my answer'],
  quiz:            ['Another question'],
  concise:         ['Explain more'],
  reteach:         ['Give an example'],
  complex:         ['Summarise this', 'Test me'],
  general:         ['Explain simpler', 'Test me'],
}

const THINKING_LABEL = 'Thinking…'
const MAX_INPUT_HEIGHT = 120
const NEAR_BOTTOM_THRESHOLD = 120

async function* streamChat({ fileId, pageNumber, pageText, question, history, mode }, signal) {
  const token = await getAuthToken()
  if (!token) {
    yield { event: 'error', data: { message: 'Your session expired. Please sign in again.' } }
    return
  }

  let res
  try {
    res = await fetch(apiUrl('/api/luna/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal,
      body: JSON.stringify({ fileId, pageNumber, pageText, question, history, mode }),
    })
  } catch (err) {
    if (err.name === 'AbortError') return
    yield { event: 'error', data: { message: 'Could not reach StudyHub. Check your connection and try again.' } }
    return
  }

  if (!res.ok) {
    let message = 'Something went wrong. Please try again.'
    if (res.status === 429) message = 'You\u2019ve hit today\u2019s question limit for this document.'
    else if (res.status === 401) message = 'Your session expired. Please sign in again.'
    else {
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch { /* non-JSON error body */ }
    }
    yield { event: 'error', data: { message } }
    return
  }

  if (!res.body) {
    yield { event: 'error', data: { message: 'Streaming is not supported in this browser.' } }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sepIdx
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        if (!rawEvent.trim()) continue

        let eventName = 'message'
        let dataStr = ''
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
        }
        if (!dataStr) continue

        let data
        try { data = JSON.parse(dataStr) } catch { continue }
        yield { event: eventName, data }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError')
      yield { event: 'error', data: { message: 'Connection lost while StudyHub was responding.' } }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
}

function usePrefersReducedMotion() {
  const [pref, setPref] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const h = () => setPref(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return pref
}

const CHECK_RE = /\[\[CHECK\]\]\s*Q:\s*(.+?)\s*\nA:\s*(.+?)\s*\nB:\s*(.+?)\s*\nANSWER:\s*([AB])\s*\[\[\/CHECK\]\]/is

function extractCheck(content) {
  if (!content || !content.includes('[[CHECK]]')) return { text: content, check: null }
  const m = content.match(CHECK_RE)
  if (!m) return { text: content, check: null }
  const text = content.slice(0, m.index).trim()
  return {
    text,
    check: { question: m[1].trim(), optionA: m[2].trim(), optionB: m[3].trim(), answer: m[4].toUpperCase() },
  }
}

const MathFallback = memo(({ value }) => (
  <code style={{
    background: '#f1f5f9', padding: '1px 5px', borderRadius: 4,
    fontSize: 12.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
    letterSpacing: '-0.01em', color: '#7c3aed',
  }}>{value}</code>
))

const MathBlock = memo(({ tex }) => (
  <div style={{ overflowX: 'auto', margin: '4px 0', display: 'flex', justifyContent: 'center' }}>
    <BlockMath math={tex} errorColor={C.errC} renderError={() => <MathFallback value={tex} />} />
  </div>
))

const StudyHubMarkdown = memo(({ content, isStreaming = false }) => {
  if (!content) return null
  return <TutorMarkdown content={content} isStreaming={isStreaming} />
})

const Cursor = memo(({ rm }) => (
  <span style={{
    display: 'inline-block', width: 2, height: 14,
    background: C.brand, marginLeft: 2, borderRadius: 1,
    verticalAlign: 'middle',
    animation: rm ? 'none' : 'cursorBlink 0.75s step-end infinite',
  }} />
))

const MicroCheck = memo(({ check }) => {
  const [picked, setPicked] = useState(null)
  const correct = picked === check.answer

  const Option = ({ letter, label }) => {
    const isPicked = picked === letter
    const showState = picked !== null
    const isCorrectOption = letter === check.answer
    let bg = '#fff', border = C.border, color = C.text
    if (showState && isCorrectOption) { bg = C.goodBg; border = C.good; color = C.good }
    else if (showState && isPicked && !isCorrectOption) { bg = C.badBg; border = C.bad; color = C.bad }
    return (
      <button
        onClick={() => picked === null && setPicked(letter)}
        disabled={picked !== null}
        aria-pressed={isPicked}
        style={{
          textAlign: 'left', padding: '8px 12px', borderRadius: 10,
          border: `1.5px solid ${border}`, background: bg, color,
          fontSize: 13.5, fontWeight: 600, cursor: picked === null ? 'pointer' : 'default',
          width: '100%', touchAction: 'manipulation',
        }}
      >
        <strong>{letter}.</strong> {label}
      </button>
    )
  }

  return (
    <div style={{ background: C.surface, borderRadius: 12, padding: '11px 13px', marginTop: 8, border: `1px solid ${C.border}` }}>
      <p style={{ margin: '0 0 8px', fontSize: 10.5, fontWeight: 700, color: C.brand, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Quick check</p>
      <p style={{ margin: '0 0 9px', fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>{check.question}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Option letter="A" label={check.optionA} />
        <Option letter="B" label={check.optionB} />
      </div>
      <p aria-live="polite" style={{ margin: picked !== null ? '8px 0 0' : 0, fontSize: 12.5, fontWeight: 600, color: correct ? C.good : C.bad, minHeight: picked !== null ? undefined : 0 }}>
        {picked !== null ? (correct ? '✓ Correct' : `✗ Not quite — the answer is ${check.answer}.`) : ''}
      </p>
    </div>
  )
})

const LoadingDots = memo(({ rm }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 2px' }} role="status" aria-label="StudyHub is thinking">
    <div style={{ display: 'flex', gap: 5 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: C.brand,
          animation: rm ? 'none' : `dotWave 1.2s ease-in-out ${i * 0.15}s infinite`,
          opacity: rm ? 0.6 : 1,
        }} />
      ))}
    </div>
    <span style={{ fontSize: 12, color: C.muted }}>{THINKING_LABEL}</span>
  </div>
))

const FollowUpChip = memo(({ text, onSelect }) => {
  const [pressed, setPressed] = useState(false)
  return (
    <button onClick={() => onSelect(text)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        padding: '6px 12px', borderRadius: 20, border: `1px solid ${C.border}`,
        background: pressed ? '#e0e7ff' : C.surface,
        fontSize: 12.5, fontWeight: 600, color: '#4338ca', cursor: 'pointer',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform 0.1s cubic-bezier(0.34,1.56,0.64,1), background 0.1s ease',
        WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      }}>
      {text}
    </button>
  )
})

const CopyBtn = memo(({ text }) => {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  return (
    <button onClick={handle} title="Copy response" aria-label="Copy response" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 30, height: 30, background: 'none', border: 'none', cursor: 'pointer',
      color: copied ? C.good : C.muted, padding: 0, borderRadius: 8,
      transition: 'color 0.2s ease', touchAction: 'manipulation',
    }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
})

const RegenerateBtn = memo(({ onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} title="Regenerate response" aria-label="Regenerate response" style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, background: 'none', border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? '#cbd5e1' : C.muted, padding: 0, borderRadius: 8,
    transition: 'color 0.2s ease', touchAction: 'manipulation',
  }}>
    <RefreshCw size={13} />
  </button>
))

// ─── Message bubble ─────────────────────────────────────────────
const MessageBubble = memo(({ msg, index, rm, onFollowUp, onRegenerate, isLastAssistant, isThinking }) => {
  const isUser = msg.role === 'user'
  const isStreaming = msg.isStreaming || false

  const { text: displayText, check } = useMemo(
    () => (isStreaming ? { text: msg.content, check: null } : extractCheck(msg.content)),
    [msg.content, isStreaming]
  )

  const chips = !isStreaming && isLastAssistant ? (INTENT_CHIPS[msg.intent] || []).slice(0, 2) : []

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      animation: rm ? 'none' : 'msgPop 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
      animationDelay: `${Math.min(index * 15, 80)}ms`,
      willChange: 'transform, opacity',
    }}>
      {isUser ? (
        <div style={{
          maxWidth: '78%',
          background: `linear-gradient(140deg, ${C.brand}, ${C.brandB})`,
          color: '#fff', borderRadius: '18px 18px 5px 18px',
          padding: '10px 15px', fontSize: 14.5, lineHeight: 1.6,
          boxShadow: '0 3px 14px rgba(79,70,229,.28)', letterSpacing: '0.01em',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      ) : (
        <div style={{ maxWidth: 'min(98%, 580px)', width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px 16px 16px 4px',
            padding: '13px 16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <StudyHubMarkdown content={displayText} isStreaming={isStreaming} />
            {isStreaming && <Cursor rm={rm} />}
            {check && <MicroCheck check={check} />}
          </div>

          {!isStreaming && chips.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {chips.map((c, i) => <FollowUpChip key={i} text={c} onSelect={onFollowUp} />)}
            </div>
          )}

          {!isStreaming && displayText && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 1 }}>
              <CopyBtn text={displayText} />
              {isLastAssistant && (
                <RegenerateBtn onClick={onRegenerate} disabled={isThinking} />
              )}
            </div>
          )}

          {msg.interrupted && (
            <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 0 2px' }}>— generation stopped</p>
          )}
        </div>
      )}
    </div>
  )
})

const EmptyState = memo(({ rm, onSelect }) => (
  <div style={{
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '0 24px',
    animation: rm ? 'none' : 'fadeSlideUp 0.35s cubic-bezier(0.22,1,0.36,1) both',
  }}>
    <img src={AI_ICON} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 6px 24px rgba(99,102,241,.18)' }} loading="lazy" />
    <p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: C.ink, textAlign: 'center' }}>Need help with this page?</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 280 }}>
      {STARTER_PROMPTS.map(s => (
        <button key={s.label} onClick={() => onSelect(s.prompt)} style={{
          padding: '9px 13px', borderRadius: 12, border: `1px solid ${C.border}`,
          background: C.surface, fontSize: 13, fontWeight: 600, color: '#4338ca',
          cursor: 'pointer', textAlign: 'left', touchAction: 'manipulation',
        }}>
          {s.label}
        </button>
      ))}
    </div>
  </div>
))

const OptionsMenu = memo(({ mode, onModeChange, isFullscreen, onToggleFullscreen, rm }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointer = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} className="cir"
        aria-label="More options" aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={16} color="#64748b" />
      </button>
      {open && (
        <div role="menu" aria-label="Assistant options" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: '#fff', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,.12)', border: '1px solid #f1f5f9',
          minWidth: 200, zIndex: 90, overflow: 'hidden',
          animation: rm ? 'none' : 'dropdownIn 0.16s cubic-bezier(0.34,1.56,0.64,1) both',
        }}>
          <div style={{ padding: '9px 13px 4px', fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Mode</div>
          {MODES.map(m => (
            <button key={m.key} role="menuitemradio" aria-checked={mode === m.key}
              onClick={() => { onModeChange(m.key); setOpen(false); btnRef.current?.focus() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 13px',
                border: 'none', background: mode === m.key ? '#f8faff' : '#fff', cursor: 'pointer', textAlign: 'left',
              }}>
              <span style={{ fontSize: 15 }}>{m.emoji}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{m.label}</span>
              {mode === m.key && <Check size={13} color={C.brand} />}
            </button>
          ))}
          <div style={{ borderTop: '1px solid #f1f5f9' }} />
          <button role="menuitem" onClick={() => { onToggleFullscreen(); setOpen(false); btnRef.current?.focus() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 13px',
              border: 'none', background: '#fff', cursor: 'pointer', textAlign: 'left',
            }}>
            {isFullscreen ? <Minimize2 size={14} color="#64748b" /> : <Maximize2 size={14} color="#64748b" />}
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{isFullscreen ? 'Minimise' : 'Expand'}</span>
          </button>
        </div>
      )}
    </div>
  )
})

const SendButton = memo(({ onClick, disabled }) => (
  <button onClick={() => { if (!disabled) onClick() }} disabled={disabled} aria-label="Send message"
    style={{
      width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
      background: disabled ? '#e2e8f0' : `linear-gradient(135deg,${C.brand},${C.brandB})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: disabled ? 'none' : '0 3px 12px rgba(79,70,229,.35)',
      touchAction: 'manipulation',
    }}>
    <Send size={14} color={disabled ? '#9ca3af' : '#fff'} />
  </button>
))

const StopButton = memo(({ onClick }) => (
  <button onClick={onClick} title="Stop generating" aria-label="Stop generating" style={{
    width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
    background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 0 0 1.5px #fecaca inset', touchAction: 'manipulation',
  }}>
    <Square size={12} color="#ef4444" fill="#ef4444" />
  </button>
))

const JumpToLatestBtn = memo(({ onClick }) => (
  <button onClick={onClick} aria-label="Jump to latest message" style={{
    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 12px', borderRadius: 20, border: `1px solid ${C.border}`,
    background: '#fff', color: C.brand, fontSize: 12, fontWeight: 700,
    boxShadow: '0 4px 16px rgba(0,0,0,.12)', cursor: 'pointer', zIndex: 20,
    touchAction: 'manipulation',
  }}>
    <ChevronDown size={13} /> New messages
  </button>
))

const ConvItem = memo(({ conv, isActive, onSelect, onDelete }) => {
  const [pressed, setPressed] = useState(false)
  return (
    <div
      role="button" tabIndex={0} aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
        background: isActive ? '#eef2ff' : pressed ? '#f1f5f9' : 'transparent',
        color: isActive ? '#4338ca' : C.text, fontWeight: isActive ? 600 : 400, fontSize: 14,
        userSelect: 'none', touchAction: 'manipulation',
      }}>
      <MessageSquare size={15} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden="true" />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.title}</span>
      <button onClick={e => { e.stopPropagation(); onDelete(conv.id) }} aria-label={`Delete "${conv.title}"`}
        style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', touchAction: 'manipulation' }}>
        <Trash2 size={13} />
      </button>
    </div>
  )
})

const Sidebar = memo(({ convs, currentId, onSelect, onNew, onDelete, isOpen, onClose }) => {
  const closeBtnRef = useRef(null)
  const newBtnRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    newBtnRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <>
      {isOpen && (
        <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 65, animation: 'fadeIn 0.15s ease both' }} />
      )}
      <div
        role="dialog" aria-modal="true" aria-label="Chat history" aria-hidden={!isOpen}
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 'min(82vw,300px)', background: '#fff',
          borderRight: '1px solid #f1f5f9', zIndex: 70,
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.22,1,0.36,1)',
          display: 'flex', flexDirection: 'column',
          boxShadow: isOpen ? '4px 0 32px rgba(0,0,0,.1)' : 'none',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 16px 12px', borderBottom: '1px solid #f1f5f9' }}>
          <h2 style={{ flex: 1, fontSize: 17, fontWeight: 700, margin: 0, color: C.ink }}>Chats</h2>
          <button ref={newBtnRef} onClick={onNew} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: `linear-gradient(135deg,${C.brand},${C.brandB})`, color: '#fff',
            border: 'none', borderRadius: 20, padding: '6px 14px',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
          }}><Plus size={14} /> New</button>
          <button ref={closeBtnRef} onClick={onClose} aria-label="Close chat history" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={15} color="#64748b" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {convs.length === 0 && <p style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 24 }}>No chats yet</p>}
          {convs.map(conv => (
            <ConvItem key={conv.id} conv={conv} isActive={conv.id === currentId}
              onSelect={() => onSelect(conv.id)} onDelete={onDelete} />
          ))}
        </div>
      </div>
    </>
  )
})

// ─── CSS ─────────────────────────────────────────────────────────
// FIX: font-family now correctly lists only 'Inter' (the name Google Fonts
// actually serves). 'InterVariable' and 'Inter var' are self-hosted package
// names — the browser skipped them every time and fell through to 'Inter'
// anyway, so those two entries were dead weight and semantically wrong.
const CSS = `
  @keyframes panelRise   { from { transform: translateY(36%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeSlideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes msgPop      { from { transform: translateY(7px) scale(0.96); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
  @keyframes cursorBlink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
  @keyframes dotWave     { 0%,80%,100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-4px); opacity: 1; } }
  @keyframes fadeIn      { from { opacity: 0; } to { opacity: 1; } }
  @keyframes dropdownIn  { from { transform: translateY(-6px) scale(0.96); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
  @keyframes errorShake  { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }

  .studyhub-panel {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    display: flex; flex-direction: column;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-optical-sizing: auto;
    letter-spacing: -0.011em;
    animation: panelRise 0.25s cubic-bezier(0.25,1,0.5,1) both;
    background: #fff;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .studyhub-drag {
    width: 36px; height: 4px; border-radius: 3px;
    background: #e2e8f0; margin: 10px auto 0;
    flex-shrink: 0; cursor: pointer; touch-action: none;
  }
  .studyhub-header {
    display: flex; align-items: center; padding: 10px 14px 11px;
    border-bottom: 1px solid #f1f5f9;
    flex-shrink: 0; gap: 8px;
    background: #fff; border-radius: 22px 22px 0 0;
    min-height: 56px;
  }
  .cir {
    width: 34px; height: 34px; border-radius: 50%; border: none;
    background: #f1f5f9; display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .cir:hover  { background: #e2e8f0; }
  .studyhub-messages {
    flex: 1; overflow-y: auto; overflow-x: hidden; position: relative;
    padding: 14px; display: flex; flex-direction: column; gap: 12px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
    background: #fff;
  }
  .studyhub-messages::-webkit-scrollbar { display: none; }
  .studyhub-input-row {
    padding: 7px 12px; border-top: 1px solid #f1f5f9; flex-shrink: 0;
    display: flex; align-items: flex-end; gap: 7px;
    padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
    background: #fff;
  }
  .studyhub-pill {
    flex: 1; display: flex; align-items: flex-end; gap: 8px;
    background: #f1f5f9; border-radius: 22px; padding: 7px 7px 7px 15px;
    transition: box-shadow 0.15s ease, background 0.12s ease;
  }
  .studyhub-pill:focus-within { background: #fff; box-shadow: 0 0 0 2.5px rgba(99,102,241,.22); }
  .studyhub-inp {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: max(16px, 14px); line-height: 1.45; color: #111; min-width: 0;
    font-family: inherit; -webkit-appearance: none;
    resize: none; max-height: ${MAX_INPUT_HEIGHT}px; overflow-y: auto;
    padding: 5px 0;
  }
  .studyhub-inp::placeholder { color: #8a94a6; }
  .err-banner {
    padding: 10px 13px; background: #fff1f2; border-radius: 11px; border: 1px solid #fecdd3;
    color: #be123c; font-size: 13.5px; line-height: 1.5;
    animation: errorShake 0.35s ease both;
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
  }
  button:focus-visible,
  [role="button"]:focus-visible,
  textarea:focus-visible {
    outline: 2px solid ${C.brand};
    outline-offset: 2px;
  }
`

let nextId = 1
const freshConv = () => ({ id: nextId++, title: 'New Chat', messages: [] })

export default function App({
  fileId = null,
  pageNumber = null,
  pageText = '',
  onClose = null
}) {
  useEffect(() => {
    const font = document.getElementById('studyhub-inter-font')
    if (font) return
    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'
    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'
    const stylesheet = document.createElement('link')
    stylesheet.id = 'studyhub-inter-font'
    stylesheet.rel = 'stylesheet'
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap'
    document.head.appendChild(preconnect1)
    document.head.appendChild(preconnect2)
    document.head.appendChild(stylesheet)
  }, [])

  const rm = usePrefersReducedMotion()

  const [convs, setConvs] = useState(() => [freshConv()])
  const [currentId, setCurrentId] = useState(() => convs[0].id)
  const [mode, setMode] = useState('normal')
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [streamingMsg, setStreamingMsg] = useState(null)
  const [error, setError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [showJump, setShowJump] = useState(false)

  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const abortRef = useRef(null)
  const blocksRef = useRef([])
  const frameRef = useRef(null)
  const doneRef = useRef(false)
  const lastMsgRef = useRef('')
  const lastHistoryRef = useRef([])
  const panelRef = useRef(null)
  const finalMessageAddedRef = useRef(false)
  const currentIntentRef = useRef('general')
  const isNearBottomRef = useRef(true)

  const currentConv = convs.find(c => c.id === currentId) || convs[0]
  const messages = currentConv?.messages || []
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--)
      if (messages[i].role === 'assistant') return i
    return -1
  }, [messages])

  const resetStream = useCallback(() => {
    if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null }
    blocksRef.current = []
    doneRef.current = false
  }, [])

  const clearStreamingMsg = useCallback(() => {
    setStreamingMsg(null)
    finalMessageAddedRef.current = false
  }, [])

  const handleClose = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    resetStream()
    clearStreamingMsg()
    setIsThinking(false)
    if (typeof onClose === 'function') onClose()
    else setIsVisible(false)
    window.dispatchEvent(new CustomEvent('studyhub-close'))
  }, [onClose, resetStream, clearStreamingMsg])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (isFullscreen) { setIsFullscreen(false); return }
      if (sidebarOpen) { setSidebarOpen(false); return }
      handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isFullscreen, sidebarOpen, handleClose])

  const scrollBottom = useCallback((smooth = false) => {
    const el = containerRef.current
    if (!el) return
    if (smooth && !rm) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    else el.scrollTop = el.scrollHeight
    isNearBottomRef.current = true
    setShowJump(false)
  }, [rm])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
    isNearBottomRef.current = near
    setShowJump(!near)
  }, [])

  useEffect(() => {
    if (isNearBottomRef.current) requestAnimationFrame(() => scrollBottom(false))
  }, [messages, isThinking, scrollBottom])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (input === '' && inputRef.current) inputRef.current.style.height = 'auto'
  }, [input])

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [])

  const startRenderer = useCallback(() => {
    if (frameRef.current) return
    let lastUpdate = 0
    const tick = (timestamp) => {
      if (timestamp - lastUpdate > 50) {
        if (blocksRef.current.length > 0) {
          setStreamingMsg(prev => prev ? { ...prev, content: blocksRef.current.map(b => b.content).join('') } : prev)
          if (isNearBottomRef.current) {
            const el = containerRef.current
            if (el) el.scrollTop = el.scrollHeight
          }
        }
        lastUpdate = timestamp
      }
      if (doneRef.current) { frameRef.current = null; return }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    resetStream()
    clearStreamingMsg()
  }, [resetStream, clearStreamingMsg])

  const addMessage = useCallback((convId, msg) => {
    setConvs(prev => prev.map(c => {
      if (c.id !== convId) return c
      const msgs = [...c.messages, msg]
      const title = c.title === 'New Chat' && msg.role === 'user'
        ? msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : '')
        : c.title
      return { ...c, title, messages: msgs }
    }))
  }, [])

  const runAssistant = useCallback(async (question, history) => {
    setError(null)
    resetStream()
    clearStreamingMsg()
    setIsThinking(true)
    lastMsgRef.current = question
    lastHistoryRef.current = history
    finalMessageAddedRef.current = false

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreamingMsg({ role: 'assistant', content: '', isStreaming: true })

    try {
      for await (const { event, data } of streamChat(
        { fileId, pageNumber: pageNumber != null ? pageNumber : 0, pageText, question, history, mode },
        ctrl.signal
      )) {
        if (ctrl.signal.aborted) break
        if (event === 'meta') {
          currentIntentRef.current = data.intent || 'general'
        } else if (event === 'block_start') {
          blocksRef.current.push({ content: '' })
          startRenderer()
        } else if (event === 'token') {
          const idx = blocksRef.current.length - 1
          if (idx >= 0) blocksRef.current[idx] = { content: blocksRef.current[idx].content + data.content }
        } else if (event === 'done') {
          doneRef.current = true
        } else if (event === 'error') {
          setError(data.message || 'Something went wrong.')
          doneRef.current = true
        }
      }

      if (!ctrl.signal.aborted && blocksRef.current.length > 0 && !finalMessageAddedRef.current) {
        finalMessageAddedRef.current = true
        addMessage(currentId, {
          id: Date.now(), role: 'assistant',
          content: blocksRef.current.map(b => b.content).join(''),
          intent: currentIntentRef.current,
          isStreaming: false,
        })
        clearStreamingMsg()
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      resetStream()
      setIsThinking(false)
      abortRef.current = null
      if (!finalMessageAddedRef.current) clearStreamingMsg()
    }
  }, [currentId, mode, fileId, pageNumber, pageText, addMessage, resetStream, startRenderer, clearStreamingMsg])

  const handleSend = useCallback((text) => {
    const msg = (text || input).trim()
    if (!msg || isThinking) return
    if (!fileId) {
      setError('No document is open — StudyHub needs a document to answer questions about.')
      return
    }
    setInput('')
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    addMessage(currentId, { id: Date.now(), role: 'user', content: msg })
    runAssistant(msg, history)
  }, [input, isThinking, fileId, messages, currentId, addMessage, runAssistant])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    const finalContent = blocksRef.current.map(b => b.content).join('')
    if (finalContent && !finalMessageAddedRef.current) {
      finalMessageAddedRef.current = true
      addMessage(currentId, {
        id: Date.now(), role: 'assistant', content: finalContent,
        intent: currentIntentRef.current, isStreaming: false, interrupted: true,
      })
      clearStreamingMsg()
    }
    resetStream()
    setIsThinking(false)
  }, [currentId, addMessage, resetStream, clearStreamingMsg])

  const handleRetry = useCallback(() => {
    if (!lastMsgRef.current || isThinking) return
    runAssistant(lastMsgRef.current, lastHistoryRef.current)
  }, [isThinking, runAssistant])

  const handleRegenerate = useCallback(() => {
    if (isThinking) return
    const msgs = currentConv?.messages || []
    if (!msgs.length || msgs[msgs.length - 1].role !== 'assistant') return
    const withoutLast = msgs.slice(0, -1)
    const lastUser = withoutLast[withoutLast.length - 1]
    if (!lastUser || lastUser.role !== 'user') return
    const history = withoutLast.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
    setConvs(prev => prev.map(c => c.id === currentId ? { ...c, messages: withoutLast } : c))
    runAssistant(lastUser.content, history)
  }, [isThinking, currentConv, currentId, runAssistant])

  const handleNewConv = useCallback(() => {
    const c = freshConv()
    setConvs(p => [...p, c])
    setCurrentId(c.id)
    setSidebarOpen(false)
  }, [])

  const handleDeleteConv = useCallback((id) => {
    setConvs(p => {
      const next = p.filter(c => c.id !== id)
      if (next.length === 0) {
        const fresh = freshConv()
        setCurrentId(fresh.id)
        return [fresh]
      }
      if (id === currentId) setCurrentId(next[0].id)
      return next
    })
  }, [currentId])

  if (!isVisible) return null

  const panelStyle = isFullscreen
    ? { top: 0, height: '100dvh', borderRadius: 0, boxShadow: 'none' }
    : { top: 'auto', height: 'clamp(340px, 60dvh, 75dvh)', borderRadius: '22px 22px 0 0', boxShadow: '0 -8px 48px rgba(0,0,0,.12)' }

  const displayMessages = [...messages]
  if (isThinking && streamingMsg && !finalMessageAddedRef.current) {
    displayMessages.push({ ...streamingMsg, id: 'streaming' })
  }

  return (
    <>
      <style>{CSS}</style>

      <Sidebar
        convs={convs} currentId={currentId}
        onSelect={id => { setCurrentId(id); setSidebarOpen(false) }}
        onNew={handleNewConv}
        onDelete={handleDeleteConv}
        isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />

      <div ref={panelRef} className="studyhub-panel" style={panelStyle} role="dialog" aria-label={`${ASSISTANT_NAME} assistant`}>
        {!isFullscreen && <div className="studyhub-drag" aria-hidden="true" />}

        <div className="studyhub-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <button onClick={() => setSidebarOpen(true)} className="cir" aria-label="Open chat history" aria-haspopup="dialog" aria-expanded={sidebarOpen}>
              <Menu size={16} color="#64748b" />
            </button>
            <img src={AI_ICON} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} loading="lazy" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ASSISTANT_NAME}
              </div>
              {isThinking
                ? <div style={{ fontSize: 10.5, color: C.brand, marginTop: 1 }}>{THINKING_LABEL}</div>
                : <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{currentConv?.title || 'New Chat'}</div>
              }
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <OptionsMenu
              mode={mode} onModeChange={setMode}
              isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen(f => !f)}
              rm={rm}
            />
            <button onClick={handleClose} className="cir" aria-label="Close assistant" title="Close" style={{ background: '#fef2f2' }}>
              <X size={16} color="#ef4444" />
            </button>
          </div>
        </div>

        <div className="studyhub-messages" ref={containerRef} onScroll={handleScroll} role="log" aria-live="polite">
          {messages.length === 0 && !isThinking && !error && (
            <EmptyState rm={rm} onSelect={p => handleSend(p)} />
          )}

          {error && (
            <div className="err-banner" role="alert" aria-live="assertive">
              <span>{error}</span>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <button onClick={handleRetry} style={{ background: 'none', border: 'none', color: C.errC, fontWeight: 600, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <RefreshCw size={11} /> Retry
                </button>
                <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: C.errC, fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
              </div>
            </div>
          )}

          {displayMessages.map((msg, i) => (
            <MessageBubble
              key={msg.id || i}
              msg={msg}
              index={i}
              rm={rm}
              onFollowUp={handleSend}
              onRegenerate={handleRegenerate}
              isThinking={isThinking}
              isLastAssistant={msg.role === 'assistant' && (msg.isStreaming || i === lastAssistantIdx)}
            />
          ))}

          {isThinking && !(streamingMsg?.content?.length > 0) && <LoadingDots rm={rm} />}

          {showJump && messages.length > 0 && (
            <JumpToLatestBtn onClick={() => scrollBottom(true)} />
          )}
        </div>

        <div className="studyhub-input-row">
          <div className="studyhub-pill">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask about this page…"
              aria-label="Message StudyHub"
              className="studyhub-inp"
              rows={1}
              autoComplete="off" autoCorrect="on" spellCheck enterKeyHint="send"
            />
            {isThinking
              ? <StopButton onClick={handleStop} />
              : <SendButton onClick={() => handleSend()} disabled={!input.trim()} />}
          </div>
        </div>
      </div>
    </>
  )
}