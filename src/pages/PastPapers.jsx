// PastPapers.jsx – v19 (AI panel fixes)
//
// Changes from v18:
//  AI PANEL CORRECTNESS
//  - FIXED RACE CONDITION: useAiStream.run() now aborts any in-flight stream
//    before starting a new one. Previously, switching actions (Explain →
//    Solve) or sending a new chat message while a prior stream was still
//    running left the OLD fetch's onToken callbacks writing into the NEW,
//    just-reset `blocks` array — tokens from two different requests could
//    interleave into one answer. controllerRef.current is now aborted at
//    the top of run(), before the reset.
//  - Added a distinct 'stopped' stream status (separate from 'done'), so a
//    manually stopped answer is visibly marked as cut off rather than
//    looking indistinguishable from a completed one. All status checks that
//    used to gate on 'done' | 'error' (regenerate button, caching completed
//    results, appending a chat turn) now also accept 'stopped'.
//
//  AI PANEL UX
//  - Explain/Solve and chat panes now auto-scroll to the streaming content
//    as tokens arrive (bottomRef + scrollIntoView), instead of leaving new
//    content to land below the fold with no signal anything is happening.
//  - Every finished AI answer now has a Copy button (CopyButton), since
//    "copy this explanation/formula" is a core use case here.
//  - Streaming AiBlocks now carry aria-live="polite" + role="status" so
//    screen-reader users get the answer as it streams, not just at the end.
//  - Chat turns now have their own "Regenerate" action, matching the
//    Explain/Solve pattern — previously only Explain/Solve could be retried.
//  - Unified the assistant's displayed name behind a single AI_NAME
//    constant ("StudyHub") — ThinkingIndicator used to default to "Luna is
//    thinking" while the composer and empty-chat state said "StudyHub",
//    which read as two different assistants.
//
// (v14–v18 changes retained below for reference)
//  v18 removed a duplicate top-level `renderInline` (import + local
//  definition co-existing — a hard SyntaxError) and a call to two already-
//  deleted helpers (`isolateBlockMath`/`normalizeMathDelimiters`) inside
//  AiBlock. All math/delimiter handling now lives once, inside
//  renderInline -> parseMathSegments in math-fix.jsx.
//
//  RESPONSE STRUCTURE / READABILITY
//  - MarkdownLite paragraph rhythm widened again (space-y-4 → space-y-5) and
//    line-height nudged up (leading-relaxed/1.625 → leading-[1.7]).
//  - Headings are no longer one flat style. ##, ###, #### each get their own
//    size/weight/color (HEADING_STYLE) so they read as an actual hierarchy.
//  - Inline bold (**term**) bumped from font-semibold to font-bold.
//
//  TYPOGRAPHY
//  - Collapsed the AI panel to a consistent 3-step type scale (16 / 13–14 / 11px).
//  - Equation blocks now match body size (was text-sm).
//  - Informational gray text bumped from gray-400 → gray-500/600 for WCAG AA.
//  - MathFallback no longer renders in alarming red.
//
//  DISCOVERABILITY
//  - Swipe-only question navigation: one-time text hint, faint edge chevrons,
//    keyboard arrow support.
//
//  USER CONTROL
//  - "Mark Done" offers a dismissible "Next question →" action instead of
//    force-navigating after a timeout.
//
//  PERFORMANCE / DATA COST
//  - The Explain stream no longer auto-fires on a detected slow/metered
//    connection; shows a manual "Generate explanation" tap-target instead.
//  - ed-cursor and ThinkingIndicator's dots respect reduced-motion.
//
//  HIERARCHY
//  - Mark Done is the visually primary action; Save and Report are
//    secondary/ghost.

import {
  useState, useEffect, useCallback, useMemo, useRef,
  useDeferredValue, useTransition, memo, createContext, useContext,
} from 'react'
import { supabase } from '../supabase'
import { BottomNav } from '../components/BottomNav'
import { useQuery } from '@tanstack/react-query'
import { InlineMath, BlockMath } from 'react-katex'
import 'katex/dist/katex.min.css'
import {
  FileText, Target, Flame, Lightbulb, PenLine, RefreshCcw,
  Bookmark, BookmarkCheck, CheckCircle2, MessageCircle,
  Sparkles, Flag, ShieldAlert, StopCircle, RotateCcw, CheckCheck,
  Trophy, Search, Inbox, Frown, WifiOff, X, Send,
  Maximize2, Minimize2, ArrowLeft, ChevronRight, ChevronLeft,
  GraduationCap, BookOpen, AlarmClock, Quote, TrendingUp, CircleDot,
  Tag, ArrowRight, Image as ImageIcon, MessageCircleQuestion,
} from 'lucide-react'
import GoogleLensIcon from '../components/GoogleLensIcon'
import { MathText, renderInline, mathRenderError } from './math-fix'
import TutorMarkdown from '../components/common/TutorMarkdown'
import ActualPaperView from '../components/ActualPaperView'
import { API_BASE_URL } from '../lib/apiConfig'
import { trackPaperViewed, trackSearch } from '../lib/analytics'

// ── API layer ─────────────────────────────────────────────────
const API_BASE = API_BASE_URL

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}
async function apiGet(path) {
  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
async function apiPostJson(path, body) {
  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
async function streamAiAction(path, body, handlers, signal) {
  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const errData = await res.json().catch(() => ({}))
    handlers.onError?.(errData.error || `Request failed (${res.status})`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      if (!part.trim()) continue
      let event = 'message', dataStr = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
      }
      let data = {}
      try { data = dataStr ? JSON.parse(dataStr) : {} } catch { data = {} }
      if (event === 'meta') handlers.onMeta?.(data)
      else if (event === 'block_start') handlers.onBlockStart?.(data)
      else if (event === 'token') handlers.onToken?.(data)
      else if (event === 'block_end') handlers.onBlockEnd?.(data)
      else if (event === 'done') handlers.onDone?.()
      else if (event === 'error') handlers.onError?.(data.message)
    }
  }
}

async function fetchExamFocus(courseId) {
  if (!courseId) return { topics: [] }
  return apiGet(`/api/exam/focus?courseId=${encodeURIComponent(courseId)}`)
}
async function fetchLastMinute(courseId) {
  if (!courseId) return { questions: [], topics: [] }
  return apiGet(`/api/exam/last-minute?courseId=${encodeURIComponent(courseId)}&limit=30`)
}
async function fetchSavedQuestionIds() {
  try { const { savedQuestionIds } = await apiGet('/api/exam/saved-questions'); return savedQuestionIds || [] }
  catch { return null }
}
async function saveQuestionOnServer(q) {
  return apiPostJson('/api/exam/saved-questions', { questionId: q.id, paperId: q.paperId || null })
}
async function unsaveQuestionOnServer(questionId) {
  return apiPostJson('/api/exam/saved-questions/remove', { questionId })
}
async function flagQuestionOnServer(questionId, reason) {
  return apiPostJson('/api/exam/questions/flag', { questionId, reason })
}
async function markQuestionReviewedOnServer(questionId) {
  return apiPostJson('/api/exam/questions/mark-reviewed', { questionId })
}

// ── Offline sync ──────────────────────────────────────────────
const SYNC_QUEUE_KEY = 'sh_sync_queue_v1'
function loadSyncQueue() {
  try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]') } catch { return [] }
}
function saveSyncQueueToStorage(q) {
  try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q)) } catch {}
}
function enqueueSync(item) {
  const q = loadSyncQueue(); q.push({ ...item, ts: Date.now() }); saveSyncQueueToStorage(q)
}
async function flushSyncQueue() {
  const q = loadSyncQueue(); if (!q.length) return
  const remaining = []
  for (const item of q) {
    try {
      if (item.type === 'save') await saveQuestionOnServer({ id: item.questionId, paperId: item.paperId })
      else if (item.type === 'unsave') await unsaveQuestionOnServer(item.questionId)
      else if (item.type === 'flag') await flagQuestionOnServer(item.questionId, item.reason)
      else if (item.type === 'reviewed') await markQuestionReviewedOnServer(item.questionId)
    } catch { remaining.push(item) }
  }
  saveSyncQueueToStorage(remaining)
}
async function writeWithOfflineFallback(fn, queueItem) {
  try { await fn() } catch { enqueueSync(queueItem) }
}

// ── Data layer ────────────────────────────────────────────────
async function fetchUserAcademicProfile(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('program, year_of_study, semester')
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    program: data?.program ?? null,
    year: data?.year_of_study != null ? Number(data.year_of_study) : null,
    semester: data?.semester != null ? Number(data.semester) : null,
  }
}
async function fetchProgramIdByName(programName) {
  if (!programName) return null
  const { data, error } = await supabase.from('programs').select('id').eq('name', programName).single()
  if (error) throw error; return data?.id ?? null
}
async function fetchAllPrograms() {
  const { data, error } = await supabase.from('programs').select('*').order('name')
  if (error) throw error; return data || []
}
async function fetchCoursesForProgram(programId, year = null, semester = null) {
  if (!programId) return []
  let query = supabase.from('courses').select('*').eq('program_id', programId)
  if (semester != null && !isNaN(semester)) {
    query = query.eq('semester', semester)
  }
  if (year != null && !isNaN(year)) {
    query = query.eq('year', year)
  }
  const { data, error } = await query
    .order('year', { ascending: true }).order('semester', { ascending: true })
  if (error) throw error; return data || []
}
async function fetchQuestionsForCourseIds(courseIds) {
  if (!courseIds?.length) return []
  const cacheKey = 'sh_cq_' + [...courseIds].sort().join('_')
  try {
    const { data, error } = await supabase
      .from('past_papers')
      .select('*, courses ( id, course_code, course_name, semester, year, program_id )')
      .in('course_id', courseIds).order('created_at', { ascending: false })
    if (error) throw error
    if (data?.length) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data))
        // Group by paper_id and cache individual papers for instant 0ms access
        const byPaper = {}
        data.forEach(r => {
          if (r.paper_id) {
            if (!byPaper[r.paper_id]) byPaper[r.paper_id] = []
            byPaper[r.paper_id].push(r)
          }
        })
        Object.entries(byPaper).forEach(([pid, rows]) => {
          localStorage.setItem('sh_pq_' + pid, JSON.stringify(rows))
        })
      } catch {}
    }
    return data || []
  } catch (err) {
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch {}
    throw err
  }
}

async function fetchQuestionsForPaper(paperId) {
  if (!paperId) return []
  const cacheKey = 'sh_pq_' + paperId
  try {
    const { data, error } = await supabase
      .from('past_papers').select('*').eq('paper_id', paperId).order('created_at', { ascending: true })
    if (error) throw error
    if (data?.length) {
      try { localStorage.setItem(cacheKey, JSON.stringify(data)) } catch {}
    }
    return data || []
  } catch (err) {
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch {}
    throw err
  }
}

function groupQuestionsIntoPapers(rows) {
  const byPaper = {}
  for (const row of rows) {
    const key = row.paper_id
    if (!byPaper[key]) {
      byPaper[key] = {
        paperId: key, courseId: row.course_id,
        courseName: row.courses?.course_name || row.course || 'Unknown course',
        courseCode: row.courses?.course_code || null,
        year: row.year, extractedAt: row.created_at,
        questionCount: 0, totalMarks: 0, topics: new Set(),
        pastPaperId: row.past_paper_id || null,
      }
    }
    const p = byPaper[key]
    p.questionCount += 1
    if (typeof row.marks === 'number') p.totalMarks += row.marks
    if (row.topic) p.topics.add(row.topic)
    if (p.year == null && row.year != null) p.year = row.year
    if (!p.pastPaperId && row.past_paper_id) p.pastPaperId = row.past_paper_id
  }
  return Object.values(byPaper).map(p => ({ ...p, topics: [...p.topics] }))
}
function groupPapersByCourse(papers) {
  const groups = {}
  for (const p of papers) {
    const key = p.courseId
    if (!groups[key]) groups[key] = { courseId: key, courseName: p.courseName, courseCode: p.courseCode, papers: [] }
    groups[key].papers.push(p)
  }
  return groups
}
function sortPapersRecentFirst(papers) {
  return [...papers].sort((a, b) =>
    (b.year || 0) - (a.year || 0) || new Date(b.extractedAt || 0) - new Date(a.extractedAt || 0)
  )
}
function naturalQuestionSort(a, b) {
  const na = parseInt(String(a.number ?? '').match(/\d+/)?.[0] ?? '9999', 10)
  const nb = parseInt(String(b.number ?? '').match(/\d+/)?.[0] ?? '9999', 10)
  return na - nb
}
function extractLeadingNumber(text) {
  const m = text.match(/^\s*Question\s+(\d{1,2})\s*[:.)]?\s*/i) || text.match(/^\s*(\d{1,2})\s*[.)]\s+/)
  if (!m) return null
  return { number: m[1], rest: text.slice(m[0].length).trim() }
}
function normalizeDbQuestion(row, idx) {
  const rawQuestion = String(row.question || '').trim()
  const leading = row.question_number ? null : extractLeadingNumber(rawQuestion)
  return {
    id: row.id, paperId: row.paper_id || null,
    number: row.question_number || leading?.number || String(idx + 1),
    marks: typeof row.marks === 'number' ? row.marks : null,
    text: leading ? leading.rest : rawQuestion,
    topic: row.topic || 'General', year: row.year || null,
    questionType: row.question_type || 'structured',
    options: [
      { key: 'A', text: row.option_a }, { key: 'B', text: row.option_b },
      { key: 'C', text: row.option_c }, { key: 'D', text: row.option_d },
    ].filter(o => o.text && o.text.trim()).map(o => ({ ...o, text: String(o.text).trim() })),
    answer: row.answer || '', explanation: row.explanation || '',
    imageUrl: row.image_url || null, needsReview: !!row.needs_review,
  }
}

// ── AI assistant identity ──────────────────────────────────────
// FIX: single source of truth for the assistant's display name. Previously
// ThinkingIndicator defaulted to "Luna is thinking" while the chat composer
// placeholder and empty-state copy said "StudyHub" — two names for one
// assistant reads as a bug, not a feature. Everything below reads from here.
const AI_NAME = 'StudyHub'

// ── Reduced motion / low-data mode ─────────────────────────────
// This single signal now drives THREE things, not just animation:
//   1) whether entrance/celebration animations play
//   2) whether the streaming caret + thinking dots animate
//   3) whether the Explain stream auto-fires when a question opens
// A slow/metered connection should not silently spend data the user didn't ask to spend.
const MotionContext = createContext(false)
function useReducedMotion() { return useContext(MotionContext) }
function useMotionPreference() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const conn = navigator.connection
    const evaluate = () => {
      const prefersReduced = !!mq?.matches
      const slowConn = !!conn && (conn.saveData || ['slow-2g', '2g'].includes(conn.effectiveType))
      setReduce(prefersReduced || slowConn)
    }
    evaluate()
    mq?.addEventListener?.('change', evaluate)
    conn?.addEventListener?.('change', evaluate)
    return () => { mq?.removeEventListener?.('change', evaluate); conn?.removeEventListener?.('change', evaluate) }
  }, [])
  return reduce
}

// ── Animation CSS ─────────────────────────────────────────────
const ANIM_CSS = `
  @keyframes ed-fade-up {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ed-slide-up {
    from { opacity: 0; transform: translateY(100%); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ed-pop-in {
    from { opacity: 0; transform: scale(0.95); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes ed-blink {
    0%, 50%  { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
  @keyframes ed-thinking-dot {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.35; }
    40%           { transform: scale(1);   opacity: 1; }
  }
  @keyframes ed-done-pop {
    0%   { transform: scale(0.8); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes ed-hint-fade {
    0%   { opacity: 0; transform: translateY(6px); }
    12%  { opacity: 1; transform: translateY(0); }
    88%  { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-6px); }
  }
  .ed-fade-up  { animation: ed-fade-up  0.28s ease-out both; }
  .ed-slide-up { animation: ed-slide-up 0.32s cubic-bezier(.34,1.2,.64,1) both; }
  .ed-pop-in   { animation: ed-pop-in   0.18s ease-out both; }
  .ed-done-pop { animation: ed-done-pop 0.3s cubic-bezier(.34,1.4,.64,1) both; }
  .ed-cursor {
    display: inline-block; width: 2px; height: 1em;
    background: currentColor; margin-left: 2px; vertical-align: text-bottom;
    animation: ed-blink 0.9s steps(1) infinite;
  }
  .ed-cursor-static { display: inline-block; width: 2px; height: 1em; background: currentColor; margin-left: 2px; vertical-align: text-bottom; opacity: 0.6; }
  .ed-thinking-dot { animation: ed-thinking-dot 1.1s ease-in-out infinite; }
  .ed-swipe-hint { animation: ed-hint-fade 2.6s ease-in-out both; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  h1, h2, h3, .font-display { font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif; font-display: swap; }

/* Sage AI Response */
.ai-response {
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont,
               "Segoe UI", sans-serif;

  font-size: 18px;
  line-height: 1.6;
  font-weight: 400;

  letter-spacing: -0.01em;
  color: #1f2937;
}

/* Main headings */
.ai-response h1 {
  font-size: 25px;
  line-height: 1.25;
  font-weight: 700;
  margin: 24px 0 12px;
}

/* Section headings */
.ai-response h2 {
  font-size: 20px;
  line-height: 1.3;
  font-weight: 700;
  margin: 22px 0 10px;
}

/* Smaller sections */
.ai-response h3 {
  font-size: 17px;
  line-height: 1.4;
  font-weight: 650;
  margin: 18px 0 8px;
}

/* Paragraphs */
.ai-response p {
  margin: 0 0 14px;
}

/* Lists */
.ai-response ul,
.ai-response ol {
  padding-left: 22px;
  margin: 8px 0 16px;
}

.ai-response li {
  margin-bottom: 7px;
}

/* Bold text */
.ai-response strong {
  font-weight: 650;
}

/* Code */
.ai-response code {
  font-size: 14px;
}

/* Math */
.ai-response .katex {
  font-size: 1.05em;
}


`

function TrendIcon({ trend, className = 'w-3.5 h-3.5' }) {
  if (trend === 'high') return <Flame className={`${className} text-orange-500`} />
  if (trend === 'medium') return <TrendingUp className={`${className} text-amber-500`} />
  return <CircleDot className={`${className} text-emerald-500`} />
}
const PRIORITY_STYLE = {
  critical:  { badge: 'bg-rose-100 text-rose-700',   dot: 'bg-rose-500',   label: 'Critical' },
  important: { badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400',  label: 'Important' },
  review:    { badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400',   label: 'Review' },
}

// ── Shared components ─────────────────────────────────────────
const SkeletonCard = memo(() => (
  <div className="bg-white border border-indigo-100 rounded-2xl p-4 space-y-3 animate-pulse">
    <div className="h-4 bg-indigo-50 rounded-lg w-3/4" />
    <div className="h-3 bg-indigo-50 rounded-lg w-1/3" />
    <div className="h-3 bg-indigo-50 rounded-lg w-1/2" />
  </div>
))
const EmptyState = memo(({ label, sub, isSearch, action }) => (
  <div className="col-span-full text-center py-20 ed-fade-up">
    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-300">
      {isSearch ? <Search className="w-7 h-7" /> : <Inbox className="w-7 h-7" />}
    </div>
    <p className="font-semibold text-gray-800 text-base font-display">{label}</p>
    <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
      {sub || (isSearch ? 'Try a different word — course name, code, or topic.' : 'Content is added regularly. Check back soon.')}
    </p>
    {action && (
      <button onClick={action.onClick} className="mt-5 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 active:scale-95 transition-all shadow-md shadow-indigo-200">
        {action.label}
      </button>
    )}
  </div>
))
const ErrorState = memo(({ onRetry, message }) => (
  <div className="col-span-full text-center py-20 ed-fade-up">
    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-400">
      <Frown className="w-7 h-7" />
    </div>
    <p className="font-semibold text-gray-800 font-display">Something went wrong</p>
    <p className="text-sm text-gray-500 mt-1.5 mb-5">{message || "Couldn't load this. Check your connection."}</p>
    <button onClick={onRetry} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 active:scale-95 transition-all shadow-md shadow-indigo-200">
      Try again
    </button>
  </div>
))
const OfflineToast = memo(({ visible, pendingCount = 0 }) => {
  if (!visible) return null
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 ed-pop-in pointer-events-none">
      <div className="flex items-center gap-2 bg-amber-500 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-xl shadow-amber-200">
        <WifiOff className="w-4 h-4" />
        <span>
          {pendingCount > 0
            ? `Offline — ${pendingCount} change${pendingCount > 1 ? 's' : ''} will sync when back`
            : "You're offline — some content may be out of date"}
        </span>
      </div>
    </div>
  )
})
const MilestoneToast = memo(({ visible, message }) => {
  if (!visible) return null
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 ed-pop-in pointer-events-none">
      <div className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-xl shadow-indigo-200">
        <Trophy className="w-4 h-4 text-yellow-300" />
        <span>{message}</span>
      </div>
    </div>
  )
})

// Dismissible action toast — used for "Marked done — Next question →".
// Replaces the old forced-timeout auto-advance: the user decides when to move on.
const ActionToast = memo(({ visible, message, actionLabel, onAction, onDismiss }) => {
  if (!visible) return null
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 ed-pop-in">
      <div className="flex items-center gap-3 bg-gray-900 text-white text-sm font-medium pl-4 pr-2 py-2 rounded-full shadow-xl">
        <span className="flex items-center gap-1.5">
          <CheckCheck className="w-4 h-4 text-emerald-400" /> {message}
        </span>
        {actionLabel && (
          <button
            onClick={onAction}
            className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 font-semibold h-8 px-2.5 rounded-full hover:bg-white/10 active:scale-95 transition-all"
          >
            {actionLabel} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onDismiss} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all flex-shrink-0" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
})

// ── Card components ───────────────────────────────────────────
const ProgramCard = memo(({ program, onClick, delay = 0 }) => {
  const rm = useReducedMotion()
  return (
    <div
      className={`group bg-white border border-indigo-100 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-100 hover:-translate-y-0.5 transition-all will-change-transform ${rm ? '' : 'ed-fade-up'}`}
      style={rm ? undefined : { animationDelay: `${delay}ms` }}
      onClick={onClick}
    >
      <div className="w-12 h-12 bg-gradient-to-br from-indigo-50 to-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <GraduationCap className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-800 truncate font-display">{program.name}</h3>
        {program.campus && <p className="text-sm text-gray-500">{program.campus}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  )
})
const CourseCard = memo(({ course, onClick, delay = 0 }) => {
  const rm = useReducedMotion()
  return (
    <div
      className={`group bg-white border border-indigo-100 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-100 hover:-translate-y-0.5 transition-all will-change-transform ${rm ? '' : 'ed-fade-up'}`}
      style={rm ? undefined : { animationDelay: `${delay}ms` }}
      onClick={onClick}
    >
      <div className="w-12 h-12 bg-gradient-to-br from-indigo-50 to-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <BookOpen className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-800 truncate font-display">{course.course_name}</h3>
        <p className="text-sm text-gray-500">{course.course_code} · Year {course.year}, Sem {course.semester}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  )
})
const CourseThumbnailCard = memo(({ courseName, courseCode, paperCount, onClick, delay = 0 }) => {
  const rm = useReducedMotion()
  return (
    <div
      className={`group bg-white border border-indigo-100 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-100 hover:-translate-y-0.5 transition-all will-change-transform ${rm ? '' : 'ed-fade-up'}`}
      style={rm ? undefined : { animationDelay: `${delay}ms` }}
      onClick={onClick}
    >
      <div className="relative w-14 h-14 flex-shrink-0">
        <div className="absolute inset-0 bg-indigo-100 rounded-xl rotate-6 group-hover:rotate-3 transition-transform" />
        <div className="absolute inset-0 bg-indigo-50 rounded-xl -rotate-3 group-hover:-rotate-6 transition-transform" />
        <div className="absolute inset-0 bg-white border border-indigo-200 rounded-xl flex flex-col justify-center gap-1.5 px-2.5">
          <div className="h-1.5 bg-indigo-300 rounded-full w-full" />
          <div className="h-1.5 bg-indigo-200 rounded-full w-3/4" />
          <div className="h-1.5 bg-indigo-200 rounded-full w-1/2" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-800 truncate font-display">{courseName}</h3>
        <p className="text-sm text-gray-500">{courseCode ? `${courseCode} · ` : ''}{paperCount} {paperCount === 1 ? 'paper' : 'papers'}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  )
})

// ── Paper Toolbar with Year Switcher & Format Toggle ───────────
const PaperToolbar = memo(({ papers, currentPaperId, onSelect, viewFormat = 'extracted', onFormatChange }) => {
  return (
    <div className="px-4 sm:px-8 pt-2 pb-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
      {/* Paper year chips (if multiple papers) - compact height & concise labels */}
      {papers.length > 1 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {papers.map((p) => (
            <button
              key={p.paperId}
              onClick={() => onSelect(p)}
              className={`flex-shrink-0 px-2.5 h-7 rounded-lg text-[11px] font-bold whitespace-nowrap border transition-all active:scale-95 ${
                p.paperId === currentPaperId
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'
              }`}
              title={`${p.year || 'Paper'} (${p.questionCount} Qs)`}
            >
              {p.year || 'Paper'}
            </button>
          ))}
        </div>
      ) : <div />}

      {/* Segmented Control: Extracted Text vs Actual Paper Image */}
      {onFormatChange && (
        <div className="inline-flex p-0.5 bg-slate-100 rounded-xl border border-slate-200/80 self-start sm:self-auto flex-shrink-0">
          <button
            onClick={() => onFormatChange('extracted')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewFormat === 'extracted'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            aria-label="View Extracted Text"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Extracted Text</span>
          </button>

          <button
            onClick={() => onFormatChange('actual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewFormat === 'actual'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            aria-label="View Actual Paper Image"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Actual Paper</span>
          </button>
        </div>
      )}
    </div>
  )
})

// ── Study mode bar ─────────────────────────────────────────────
const STUDY_MODES = [
  { id: 'papers',      icon: FileText, label: 'Papers' },
  { id: 'exam-focus',  icon: Target,   label: 'Exam Focus' },
  { id: 'last-minute', icon: Flame,    label: 'Last-Minute' },
]
const StudyModeBar = memo(({ activeMode, onChange }) => (
  <div className="flex gap-2 px-4 pt-2 pb-2 overflow-x-auto no-scrollbar border-t border-gray-100">
    {STUDY_MODES.map((m) => {
      const Icon = m.icon; const active = activeMode === m.id
      return (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`flex items-center gap-1.5 px-3.5 h-9 rounded-full transition-all duration-150 active:scale-95 flex-shrink-0 whitespace-nowrap ${
            active
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="text-sm font-semibold">{m.label}</span>
        </button>
      )
    })}
  </div>
))

// ── Exam focus panel ───────────────────────────────────────────
const ExamFocusPanel = memo(({ courseId, onOpenSampleQuestion }) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['examFocus', courseId],
    queryFn: () => fetchExamFocus(courseId),
    enabled: !!courseId, staleTime: 5 * 60 * 1000,
  })
  const topics = data?.topics || []
  const sorted = useMemo(() => [...topics].sort((a, b) => b.appearances - a.appearances), [topics])
  const highPriority = sorted.filter(t => t.trend === 'high')
  if (isLoading) return <div className="px-4 pt-2 space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
  if (error) return <ErrorState onRetry={() => refetch()} message={error.message} />
  if (!sorted.length) return (
    <div className="px-4 py-20 text-center ed-fade-up">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-400"><Target className="w-7 h-7" /></div>
      <p className="font-semibold text-gray-800 text-base font-display">Not enough data yet</p>
      <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto leading-relaxed">Once more past papers are extracted, recurring topics will appear here.</p>
    </div>
  )
  return (
    <div className="px-4 space-y-5 ed-fade-up">
      {highPriority.length > 0 && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-2">High historical frequency</p>
          <div className="space-y-1.5">
            {highPriority.map((t, i) => (
              <div key={t.topic} className="flex items-center gap-2 text-base text-gray-900 font-semibold">
                <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                {t.topic}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-3">Based on {sorted[0]?.total || 1} paper(s). Frequency does not guarantee future appearance.</p>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">All topics</p>
        <div className="space-y-3">
          {sorted.map((t, i) => (
            <div key={t.topic} className="bg-white border border-gray-100 rounded-xl p-3.5 ed-fade-up" style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <TrendIcon trend={t.trend} />
                    <span className="font-bold text-gray-900 text-base font-display">{t.topic}</span>
                  </div>
                  <p className="text-sm text-gray-600 font-medium mt-0.5">{t.appearances}/{t.total} papers · {t.typicalMarks} marks</p>
                </div>
                {t.sampleQuestions?.[0] && (
                  <button onClick={() => onOpenSampleQuestion(t.sampleQuestions[0])} className="text-sm font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 active:scale-95 px-2.5 py-1 rounded-lg transition-all whitespace-nowrap flex-shrink-0 min-h-[36px]">
                    Practice →
                  </button>
                )}
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2.5">
                <div className={`h-full rounded-full transition-all duration-500 ${t.trend === 'high' ? 'bg-orange-400' : t.trend === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min(100, (t.appearances / t.total) * 100)}%` }} />
              </div>
              {t.sampleQuestions?.length > 0 && (
                <div className="space-y-2 border-t border-gray-50 pt-2.5">
                  {t.sampleQuestions.slice(0, 2).map((q) => (
                    <button key={q.id} onClick={() => onOpenSampleQuestion(q)} className="w-full text-left text-sm text-gray-800 font-medium hover:text-indigo-600 transition-colors flex items-start gap-2 group active:scale-[0.99] min-h-[36px]">
                      <Quote className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 flex-shrink-0 mt-0.5" />
                      <span className="line-clamp-2 leading-relaxed">
                        <MathText text={q.text} />
                        {q.marks != null && <span className="text-gray-600 font-normal"> · {q.marks} marks</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

// ── Last-minute panel ─────────────────────────────────────────
const LastMinutePanel = memo(({ courseId, onOpenQuestion }) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lastMinute', courseId],
    queryFn: () => fetchLastMinute(courseId),
    enabled: !!courseId, staleTime: 5 * 60 * 1000,
  })
  const questions = data?.questions || []
  const grouped = useMemo(() => {
    const n = questions.length
    const withPriority = questions.map((q, i) => ({
      ...q, priority: i < n / 3 ? 'critical' : i < (2 * n) / 3 ? 'important' : 'review',
    }))
    const byTopic = {}
    for (const q of withPriority) {
      if (!byTopic[q.topic]) {
        byTopic[q.topic] = { topic: q.topic, trend: q.trend, appearances: q.appearances, total: q.totalPapers, questions: [], bestPriority: q.priority }
      }
      byTopic[q.topic].questions.push(q)
    }
    const rank = { critical: 0, important: 1, review: 2 }
    return Object.values(byTopic).sort((a, b) => rank[a.bestPriority] - rank[b.bestPriority])
  }, [questions])
  if (isLoading) return <div className="px-4 pt-2 space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
  if (error) return <ErrorState onRetry={() => refetch()} message={error.message} />
  if (!grouped.length) return (
    <div className="px-4 py-20 text-center ed-fade-up">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-400"><Flame className="w-7 h-7" /></div>
      <p className="font-semibold text-gray-800 text-base font-display">Nothing to cram yet</p>
      <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto leading-relaxed">Once questions with marks are extracted, the highest-value ones land here.</p>
    </div>
  )
  return (
    <div className="px-4 space-y-4 ed-fade-up">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0"><AlarmClock className="w-5 h-5" /></div>
        <div>
          <p className="font-bold text-amber-800 text-sm font-display">Last-Minute Mode</p>
          <p className="text-xs text-amber-700 mt-0.5">High-frequency topics × biggest marks — sorted by priority</p>
        </div>
      </div>
      {grouped.map((item, i) => {
        const ps = PRIORITY_STYLE[item.bestPriority]
        return (
          <div key={item.topic} className="bg-white border border-gray-100 rounded-xl overflow-hidden ed-fade-up" style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}>
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ps.dot}`} />
                <span className="font-bold text-gray-900 text-base font-display">{item.topic}</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ps.badge}`}>{ps.label}</span>
            </div>
            <p className="text-sm text-gray-600 font-medium px-4 pb-3 flex items-center gap-1">
              <TrendIcon trend={item.trend} className="w-3.5 h-3.5" /> {item.appearances}/{item.total} papers
            </p>
            <div className="border-t border-gray-50 px-4 py-2 flex flex-wrap gap-2">
              {item.questions.map(q => (
                <button
                  key={q.id}
                  onClick={() => onOpenQuestion(q, questions)}
                  className={`text-sm px-3 h-9 rounded-lg border font-semibold transition-all active:scale-95 ${PRIORITY_STYLE[q.priority]?.badge || 'bg-gray-50 text-gray-600 border-gray-200'} border-transparent hover:opacity-80`}
                >
                  Q{q.number || '?'} · {q.marks}m
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
})

// ── MarkdownLite — consistent type scale, real heading hierarchy, and real
// math typesetting via KaTeX. renderInline / mathRenderError below come
// from math-fix.jsx — this is the ONLY place that math-handling logic
// lives now. ─────────────────────────────────────────────────
// 16px for anything meant to be READ (body, equations, question text) — never smaller.
// 13-14px reserved for secondary metadata. 11px floor for badges only.
const EQUATION_RE = /^[=∫Σ√±≈≤≥≠→⇒αβγθπμρλΔΩ]|[=:]\s*[\d(√∫Σ±]|[+\-×÷\/]\s*[\d(]/

// Heading styles by markdown level — each level needs its own visual weight/size/color
// so ##, ###, #### actually read as a hierarchy instead of three identical bold lines.
const HEADING_STYLE = {
  2: 'text-xl font-bold text-indigo-700',      // 20px
  3: 'text-lg font-bold text-gray-900',        // 18px
  4: 'text-base font-semibold text-gray-700',  // 16px
}

function MarkdownLite({ text, isStreaming = false }) {
  return <TutorMarkdown content={text} isStreaming={isStreaming} />
}

// FIX: extracted copy-to-clipboard control, used on every finished AI answer.
// Study content (explanations, worked solutions, formulas) is exactly the
// kind of text people want to paste into their own notes — the panel
// previously offered no way to do that short of manual text selection.
const CopyButton = memo(({ text }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail (permissions, insecure context) — fail silently,
      // the button just won't show the "Copied" confirmation.
    }
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-indigo-600 transition-colors active:scale-95 h-8 px-1"
      aria-label="Copy this answer"
    >
      {copied
        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        : <span className="w-3 h-3 inline-block border-2 border-current rounded-sm" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
})

// AiBlock: streaming caret respects reduced-motion — a blinking cursor is pure
// decoration once we know the device/connection prefers calm UI.
// v18: no more useMemo/normalizeMathDelimiters/isolateBlockMath here — that
// entire cleanup step lived in this file twice over (once here, once inside
// the old local renderInline) and disagreed with itself. `content` now goes
// straight into MarkdownLite; every bit of delimiter handling happens once,
// inside renderInline -> parseMathSegments (math-fix.jsx), at render time.
// v19: added aria-live for screen readers while streaming, a "stopped before
// finishing" notice when the stream was manually cut off, and a Copy button
// once the block has settled content and isn't actively streaming.
const AiBlock = memo(({ content, streaming, stopped = false }) => {
  const rm = useReducedMotion()
  return (
    <div aria-live={streaming ? 'polite' : 'off'} role="status" className="w-full">
      <TutorMarkdown content={content} isStreaming={streaming} />
      {streaming && <span className={rm ? 'ed-cursor-static' : 'ed-cursor'} />}
      {stopped && !streaming && (
        <p className="text-xs text-amber-600 italic mt-2">— generation stopped before finishing —</p>
      )}
      {!streaming && content.trim().length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
          <CopyButton text={content} />
        </div>
      )}
    </div>
  )
})

// Simple Thinking... text line (no bouncing dots animation)
const ThinkingIndicator = memo(({ label = 'Thinking...' }) => {
  return (
    <div className="text-xs text-slate-400 font-medium py-2" aria-live="polite">
      {label}
    </div>
  )
})

// ── AI stream hook ─────────────────────────────────────────────
// v19: FIX for the cross-request race — run() now aborts any in-flight
// controller BEFORE resetting state and starting the new fetch. Previously,
// controllerRef.current was simply overwritten, so the old stream's
// onToken/onBlockEnd callbacks kept firing after a new action or chat
// message reset `blocks` — tokens from two different requests could
// interleave into a single displayed answer. Also added a 'stopped' status,
// distinct from 'done', so a manually-interrupted answer can be marked as
// cut off in the UI instead of looking complete.
function useAiStream() {
  const [blocks, setBlocks] = useState([])
  const [status, setStatus] = useState('idle') // idle | thinking | streaming | done | error | stopped
  const [errorMsg, setErrorMsg] = useState(null)
  const controllerRef = useRef(null)

  const run = useCallback(async (path, body) => {
    // FIX: abort whatever was previously in flight before touching state,
    // so its callbacks can never write into the response we're about to start.
    controllerRef.current?.abort()

    setBlocks([]); setErrorMsg(null); setStatus('thinking')
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      await streamAiAction(path, body, {
        onBlockStart: () => { setStatus('streaming'); setBlocks(prev => [...prev, { content: '', streaming: true }]) },
        onToken: ({ content }) => {
          setBlocks(prev => {
            if (!prev.length) return prev
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + content }
            return next
          })
        },
        onBlockEnd: () => {
          setBlocks(prev => {
            if (!prev.length) return prev
            const next = [...prev]
            next[next.length - 1] = { ...next[next.length - 1], streaming: false }
            return next
          })
        },
        onDone: () => setStatus('done'),
        onError: (msg) => { setErrorMsg(msg || 'Something went wrong'); setStatus('error') },
      }, controller.signal)
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorMsg(err.message || 'Something went wrong'); setStatus('error')
    }
  }, [])

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    setBlocks(prev => prev.map(b => ({ ...b, streaming: false })))
    // FIX: 'stopped' instead of collapsing into 'done' — lets the UI show
    // "stopped before finishing" rather than implying a complete answer.
    setStatus(prev => (prev === 'thinking' || prev === 'streaming' ? 'stopped' : prev))
  }, [])

  return { blocks, status, errorMsg, run, stop }
}

// ── Swipe navigation hook ─────────────────────────────────────
// Passive touch listeners — does not block scrolling, works on cheap devices
function useSwipeNav(onPrev, onNext, hasPrev, hasNext) {
  const startX = useRef(null)
  const startY = useRef(null)

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current
    // Only trigger on horizontal swipes (not vertical scrolls)
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) { startX.current = null; return }
    if (dx > 0 && hasPrev) onPrev()
    if (dx < 0 && hasNext) onNext()
    startX.current = null
  }, [onPrev, onNext, hasPrev, hasNext])

  return { onTouchStart, onTouchEnd }
}

// One-time hint teaching the swipe gesture. Norman's signifier problem: swipe has
// zero visual affordance on its own, so a first-time user has no way to discover it.
// We teach it once (persisted in localStorage), then get out of the way permanently.
const SWIPE_HINT_KEY = 'sh_swipe_hint_seen_v1'
function useSwipeHintOnce(enabled) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let seen = false
    try { seen = localStorage.getItem(SWIPE_HINT_KEY) === '1' } catch {}
    if (seen) return
    setShow(true)
    const t = setTimeout(() => {
      setShow(false)
      try { localStorage.setItem(SWIPE_HINT_KEY, '1') } catch {}
    }, 2600)
    return () => clearTimeout(t)
  }, [enabled])
  return show
}


// ── Dot position indicator (replaces Prev/Next bar) ──────────
const DotIndicator = memo(({ questionList, currentId }) => {
  if (!questionList || questionList.length <= 1) return null
  const max = 7 // cap dots at 7 to avoid overflow on tiny screens
  const total = questionList.length
  const currentIdx = questionList.findIndex(q => q.id === currentId)
  // If more than max, show a text counter instead
  if (total > max) return (
    <div className="flex items-center justify-center py-2 border-t border-gray-100 bg-gray-50/60">
      <p className="text-xs text-gray-500 font-medium">{currentIdx + 1} of {total} · swipe to navigate</p>
    </div>
  )
  return (
    <div className="flex items-center justify-center gap-1.5 py-2.5 border-t border-gray-100 bg-gray-50/60">
      {questionList.map((q) => (
        <span
          key={q.id}
          className={`rounded-full transition-all duration-200 ${
            q.id === currentId ? 'w-4 h-1.5 bg-indigo-500' : 'w-1.5 h-1.5 bg-gray-200'
          }`}
        />
      ))}
    </div>
  )
})

// Faint edge chevrons — a low-weight, persistent signifier that there's more content
// this way. Deliberately subtle so they don't reintroduce the old button bar's visual
// weight, but present so the swipe affordance isn't invisible after the hint fades.
const SwipeEdgeChevron = memo(({ side, visible, onClick }) => {
  if (!visible) return null
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous question' : 'Next question'}
      className={`hidden sm:flex absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-1.5' : 'right-1.5'}
                  w-8 h-8 items-center justify-center rounded-full bg-white/90 border border-gray-200
                  text-gray-400 hover:text-indigo-600 hover:border-indigo-300 shadow-sm
                  opacity-40 hover:opacity-100 active:scale-90 transition-all z-10`}
    >
      {side === 'left' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    </button>
  )
})

// ── Student Message Bubble (Clean, compact, brand green tint, 40px thumbnail chip, 6-line clamp) ──
const StudentBubble = memo(({ message, pageNumber, thumbnailUrl }) => {
  const [expanded, setExpanded] = useState(false)
  const isLong = (message?.length || 0) > 250 || (message?.match(/\n/g) || []).length > 5

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] w-fit px-3 py-2 text-[14px] leading-[1.4] rounded-[12px] bg-blue-50 border border-blue-200 text-blue-950 shadow-none">
        {pageNumber != null && (
          <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-blue-200/80">
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt={`Page ${pageNumber}`} className="w-10 h-10 object-cover rounded-md border border-blue-200 flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-md bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                P.{pageNumber}
              </div>
            )}
            <span className="text-xs font-semibold text-blue-600">Page {pageNumber}</span>
          </div>
        )}
        <div className={!expanded && isLong ? 'line-clamp-6' : ''}>
          {message}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="mt-1 text-xs font-semibold text-blue-600 underline hover:text-blue-950 cursor-pointer"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
})

// ── Action sheet content ──────────────────────────────────────
function ActionSheetContent({
  question, isSaved, onToggleSave, isFlagged, onFlag,
  isOnline, aiCache, isReviewed, onMarkReviewed,
  hasPrev, hasNext, onPrev, onNext, questionList,
  paperContext,
}) {
  const cached = aiCache.get(question.id)
  const [runningAction, setRunningAction] = useState(null)
  const { blocks: liveBlocks, status: liveStatus, errorMsg: liveError, run, stop } = useAiStream()

  const [conversation, setConversation] = useState(cached?.conversation || [])
  const [pendingMessage, setPendingMessage] = useState(null)
  const [pendingPageNumber, setPendingPageNumber] = useState(null)
  const [pendingThumbnailUrl, setPendingThumbnailUrl] = useState(null)
  const [chatInput, setChatInput] = useState('')

  const showSwipeHint = useSwipeHintOnce(!paperContext && (questionList?.length ?? 0) > 1)
  const bottomRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const isAtBottomRef = useRef(true)

  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 60
  }, [])

  useEffect(() => {
    aiCache.set(question.id, { conversation })
  }, [question.id, conversation, aiCache])

  useEffect(() => () => { stop() }, [stop])

  // Commit completed/stopped chat turn into conversation history
  useEffect(() => {
    if ((liveStatus === 'done' || liveStatus === 'error' || liveStatus === 'stopped') && pendingMessage !== null && runningAction === 'chat') {
      setConversation(prev => [...prev, {
        id: `${Date.now()}-${prev.length}`,
        message: pendingMessage,
        pageNumber: pendingPageNumber,
        thumbnailUrl: pendingThumbnailUrl,
        blocks: liveBlocks,
        stopped: liveStatus === 'stopped',
      }])
      setPendingMessage(null)
      setPendingPageNumber(null)
      setPendingThumbnailUrl(null)
      setRunningAction(null)
    }
  }, [liveStatus, liveBlocks, pendingMessage, pendingPageNumber, pendingThumbnailUrl, runningAction])

  // Smart auto-scroll: scroll toward newly streamed tokens unless user has scrolled up to read
  useEffect(() => {
    if ((liveStatus === 'streaming' || liveStatus === 'thinking') && isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [liveBlocks, liveStatus])

  // Keyboard navigation for desktop users
  useEffect(() => {
    if (paperContext) return
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      if (e.key === 'ArrowRight' && hasNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onPrev, onNext, paperContext])

  const questionPayload = useMemo(() => ({
    id: question.id, paperId: question.paperId || null,
    course: question.course || null, text: question.text,
    marks: question.marks, topic: question.topic,
  }), [question])

  const composerBusy = runningAction === 'chat' && (liveStatus === 'thinking' || liveStatus === 'streaming')

  const sendMessage = useCallback((msg) => {
    const defaultPrompt = paperContext ? 'Explain what this page asks and how to approach each question.' : 'Explain this question.'
    const trimmed = (typeof msg === 'string' && msg.trim()) || (paperContext ? defaultPrompt : '')
    if (!trimmed || composerBusy) return
    setChatInput('')
    setPendingMessage(trimmed)
    setPendingPageNumber(paperContext?.pageNumber || null)
    setPendingThumbnailUrl(paperContext?.thumbnailUrl || null)
    setRunningAction('chat')

    const payload = paperContext
      ? {
          mode: 'page_image',
          paperId: question.paperId || paperContext.paperId,
          pageNumber: paperContext.pageNumber || 1,
          question: trimmed,
          imageBase64: paperContext.imageBase64 || null,
          fileUrl: paperContext.fileUrl || null,
          action: 'ask',
          message: trimmed,
        }
      : {
          action: 'ask',
          mode: 'text',
          question: questionPayload,
          message: trimmed,
        }

    run('/api/exam/question-action/stream', payload)
  }, [composerBusy, paperContext, question, questionPayload, run])

  const regenerateChatTurn = (message) => {
    sendMessage(message)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (paperContext && !chatInput.trim()) {
      sendMessage('')
    } else {
      sendMessage(chatInput)
    }
  }

  const errorBanner = (msg, onRetry) => (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700 ed-pop-in mt-4">
      <p className="font-semibold mb-1 flex items-center gap-1.5">
        {!isOnline && <WifiOff className="w-4 h-4" />}
        {!isOnline ? "You're offline" : "Couldn't get a response"}
      </p>
      <p className="text-xs opacity-80 mb-2">{!isOnline ? 'Reconnect and try again.' : (msg || 'Something went wrong.')}</p>
      <button onClick={onRetry} className="text-xs font-semibold text-rose-700 underline active:scale-95 min-h-[36px]">Try again</button>
    </div>
  )

  const quickStartSuggestions = paperContext
    ? [
        `Explain what Page ${paperContext.pageNumber || 1} asks and how to approach it`,
        `Solve Question 1 on Page ${paperContext.pageNumber || 1} step-by-step`,
        'Give me key tips to answer these questions',
      ]
    : [
        'Explain this question',
        'Help me solve it step-by-step',
        'Give me a hint',
      ]

  return (
    <>
      {/* Scrollable message list (Part C: flex: 1, min-height: 0, touch-scrolling, contain) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar relative"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Swipe hint */}
        {showSwipeHint && (
          <div className="sticky top-0 z-10 flex justify-center pt-2 pointer-events-none">
            <span className="ed-swipe-hint bg-gray-900/85 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg">
              ← Swipe to move between questions →
            </span>
          </div>
        )}

        {/* Edge chevrons */}
        {!paperContext && <SwipeEdgeChevron side="left" visible={hasPrev} onClick={onPrev} />}
        {!paperContext && <SwipeEdgeChevron side="right" visible={hasNext} onClick={onNext} />}

        {/* Top Context Card */}
        <div className="px-5 pt-3 pb-3 border-b border-gray-100 bg-slate-50/50 flex-shrink-0">
          {paperContext ? (
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-12 h-14 sm:w-14 sm:h-16 rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm flex items-center justify-center">
                {paperContext.thumbnailUrl ? (
                  <img
                    src={paperContext.thumbnailUrl}
                    alt={paperContext.paperTitle}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FileText className="w-6 h-6 text-indigo-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-block text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wider mb-1">
                  Page {paperContext.pageNumber || 1} of {paperContext.numPages || 1}
                </span>
                <h3 className="text-sm font-bold text-gray-800 leading-snug line-clamp-2">
                  {paperContext.paperTitle}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Exam scan context active
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Question {question.number || ''}
                </span>
                {question.marks != null && (
                  <span className="text-xs text-gray-500 font-medium">{question.marks} marks</span>
                )}
              </div>
              <p className="text-sm text-gray-800 leading-relaxed line-clamp-3">
                <MathText text={question.text} />
              </p>
              <div className="flex items-center justify-between mt-2.5 gap-2 flex-wrap">
                {question.topic ? (
                  <span className="text-[11px] text-gray-600 font-semibold flex items-center gap-1">
                    <Tag className="w-3 h-3 text-indigo-500" /> {question.topic}
                  </span>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    onClick={onToggleSave}
                    className={`flex items-center gap-1.5 text-xs font-semibold h-7 px-2.5 rounded-full border transition-all active:scale-95 ${
                      isSaved
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-200 hover:text-indigo-600'
                    }`}
                  >
                    {isSaved ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                    <span>{isSaved ? 'Saved' : 'Save'}</span>
                  </button>
                  <button
                    onClick={onFlag}
                    disabled={isFlagged}
                    className={`flex items-center gap-1.5 text-xs font-medium h-7 px-2 rounded-full transition-all active:scale-95 ${
                      isFlagged ? 'text-gray-400 cursor-default' : 'text-gray-500 hover:text-rose-500'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    <span>{isFlagged ? 'Reported' : 'Report'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat turns area */}
        <div className="px-5 py-4">
          {/* Empty state: clean, one short line, no big illustration */}
          {conversation.length === 0 && pendingMessage === null && (
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-slate-600 mb-4">
                {paperContext ? `Ask about Page ${paperContext.pageNumber || 1}` : 'Ask about this question'}
              </p>
              <div className="space-y-2 max-w-md mx-auto">
                {quickStartSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="w-full text-left px-3.5 py-2.5 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-xl text-xs sm:text-sm text-slate-700 hover:text-blue-600 font-medium transition-all active:scale-[0.99] flex items-center justify-between group"
                  >
                    <span>{suggestion}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Past turns */}
          {conversation.map((turn) => (
            <div key={turn.id} className="space-y-2 mb-5">
              <StudentBubble
                message={turn.message}
                pageNumber={turn.pageNumber}
                thumbnailUrl={turn.thumbnailUrl}
              />
              <div className="text-[15px] leading-relaxed text-slate-800">
                {turn.blocks.map((b, i) => (
                  <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}>
                    <AiBlock content={b.content} streaming={false} stopped={!!turn.stopped} />
                  </div>
                ))}
                <button
                  onClick={() => regenerateChatTurn(turn.message)}
                  disabled={composerBusy}
                  className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-blue-600 transition-colors active:scale-95 h-8 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                </button>
              </div>
            </div>
          ))}

          {/* Live stream turn */}
          {pendingMessage !== null && (
            <div className="space-y-2 mb-5">
              <StudentBubble
                message={pendingMessage}
                pageNumber={pendingPageNumber}
                thumbnailUrl={pendingThumbnailUrl}
              />
              <div className="text-[15px] leading-relaxed text-slate-800">
                {liveBlocks.map((b, i) => (
                  <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}>
                    <AiBlock content={b.content} streaming={b.streaming} stopped={liveStatus === 'stopped'} />
                  </div>
                ))}
                {liveStatus === 'thinking' && <ThinkingIndicator />}
                {liveStatus === 'error' && errorBanner(liveError, () => regenerateChatTurn(pendingMessage))}
              </div>
            </div>
          )}

          {composerBusy && (
            <button
              onClick={stop}
              className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors active:scale-95 h-9 cursor-pointer"
            >
              <StopCircle className="w-3.5 h-3.5" /> Stop generating
            </button>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Dot position indicator */}
      {!paperContext && <DotIndicator questionList={questionList} currentId={question.id} />}

      {/* Pinned chat composer (fixed bottom input bar) */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 border-t border-gray-100 px-3.5 py-2.5 flex items-center gap-2 bg-white pb-safe">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder={paperContext ? `Ask about Page ${paperContext.pageNumber || 1}… (Enter to explain)` : 'Ask anything about this question…'}
          disabled={composerBusy}
          className="flex-1 text-sm sm:text-base border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 transition-all"
        />
        {composerBusy ? (
          <button
            type="button"
            onClick={stop}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 active:scale-95 transition-all cursor-pointer"
            title="Stop generating"
          >
            <StopCircle className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!paperContext && !chatInput.trim()}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title={paperContext && !chatInput.trim() ? "Explain this page" : "Send message"}
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </form>
    </>
  )
}

// ── Action sheet wrapper ──────────────────────────────────────
const ActionSheet = memo(({
  question, questionList, onClose,
  savedIds, onToggleSave, flaggedIds, onFlag,
  isOnline, aiCache, reviewedIds, onMarkReviewed, onNavigate,
  paperContext,
}) => {
  const [sheetSize, setSheetSize] = useState('half')
  useEffect(() => { setSheetSize('half') }, [question?.id])
  useEffect(() => {
    if (!question) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [question, onClose])

  if (!question) return null

  const isFull = sheetSize === 'full'
  const currentIndex = questionList?.findIndex(q => q.id === question.id) ?? -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < (questionList?.length ?? 0) - 1

  return (
    <>
      {/* On desktop (Edge Copilot sidebar style), overlay is hidden so user can read paper unimpeded */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90] lg:hidden" onClick={onClose} />
      <div
        className={`fixed z-[100] transition-all duration-300 ease-out ${
          isFull
            ? 'inset-0 lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[680px]'
            : 'bottom-0 left-0 right-0 ed-slide-up lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[460px] xl:w-[500px]'
        }`}
      >
        <div
          className={`bg-white shadow-2xl overflow-hidden flex flex-col w-full h-full border-slate-200 ${
            isFull
              ? 'h-[100dvh] rounded-none'
              : 'rounded-t-2xl sm:rounded-2xl lg:rounded-none h-[100dvh] sm:h-[88dvh] lg:h-full max-h-[100dvh] max-w-lg lg:max-w-none mx-auto lg:border-l'
          }`}
        >
          {/* Edge Copilot style header */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2 flex-shrink-0 border-b border-gray-100 bg-slate-50/70">
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 active:scale-90 transition-all cursor-pointer"
                title="Close AI Assistant"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                <MessageCircleQuestion className="w-4 h-4 text-blue-600" />
                <span>{paperContext ? 'Paper AI Assistant' : 'AI Assistant'}</span>
              </div>
            </div>

            <div className="w-10 h-1 bg-gray-200 rounded-full lg:hidden" />

            <button
              onClick={() => setSheetSize(isFull ? 'half' : 'full')}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200/70 hover:text-gray-700 active:scale-90 transition-all cursor-pointer"
              title={isFull ? 'Standard width' : 'Expand panel'}
            >
              {isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>

          <ActionSheetContent
            key={question.id}
            question={question}
            isSaved={savedIds?.has(question.id)}
            onToggleSave={() => onToggleSave(question)}
            isFlagged={flaggedIds?.has(question.id)}
            onFlag={() => onFlag(question)}
            isOnline={isOnline}
            aiCache={aiCache}
            isReviewed={reviewedIds?.has(question.id)}
            onMarkReviewed={() => onMarkReviewed(question)}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={() => hasPrev && onNavigate(questionList[currentIndex - 1])}
            onNext={() => hasNext && onNavigate(questionList[currentIndex + 1])}
            questionList={questionList}
            paperContext={paperContext}
          />
        </div>
      </div>
    </>
  )
})

// ── Paper question rendering ──────────────────────────────────
function mainNumberOf(raw) { const m = String(raw ?? '').match(/\d+/); return m ? m[0] : String(raw ?? '?') }
function subLetterOf(raw) { const m = String(raw ?? '').match(/[a-zA-Z]+$/); return m ? m[0].toLowerCase() : null }

function groupQuestionsForPaper(questions) {
  const order = []; const byMain = new Map()
  questions.forEach((q) => {
    const main = mainNumberOf(q.number)
    if (!byMain.has(main)) { const group = { number: main, items: [] }; byMain.set(main, group); order.push(group) }
    byMain.get(main).items.push(q)
  })
  return order
}
function parseInlineSubParts(text) {
  if (!text) return null
  const markerRe = /(?:^|\n)\s*\(?([a-h])[.)]\s+/gi
  const matches = [...text.matchAll(markerRe)]
  if (matches.length < 2) return null
  const stem = text.slice(0, matches[0].index).trim()
  if (!stem) return null
  const items = matches.map((m, i) => {
    const start = m.index + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    return { letter: m[1].toLowerCase(), text: text.slice(start, end).trim() }
  })
  return { stem, items }
}
function extractLeadingStem(text) {
  if (!text) return null
  const m = text.match(/^([^:\n]{8,140}:)\s*([\s\S]+)$/)
  if (!m) return null
  const [, stem, rest] = m
  if (!rest.trim()) return null
  return { stem: stem.trim(), rest: rest.trim() }
}

const BookmarkBtn = memo(({ isSaved, onToggle }) => (
  <button
    onClick={(e) => {
      e.stopPropagation()
      onToggle()
    }}
    className="w-8 h-8 flex items-center justify-center rounded-lg transition-all active:scale-90 hover:bg-slate-100 text-slate-400 hover:text-indigo-600"
    title={isSaved ? 'Remove from saved' : 'Save for revision'}
    aria-label={isSaved ? 'Remove from saved' : 'Save for revision'}
  >
    {isSaved
      ? <BookmarkCheck className="w-4 h-4 text-indigo-600 fill-indigo-100" />
      : <Bookmark className="w-4 h-4 text-slate-300 hover:text-indigo-500" />}
  </button>
))

// content-visibility: auto defers paint for off-screen question blocks — key perf win on slow devices
const PaperSubItem = memo(({ label, text, marks, imageUrl, indent, onAskAi, isSaved, onToggleSave, needsReview, altLabel }) => (
  <div
    onClick={onAskAi}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAskAi(); } }}
    className={`group/sub cursor-pointer rounded-xl p-2.5 -mx-2 transition-all hover:bg-slate-50/80 active:bg-slate-100/80 ${indent ? 'pl-4' : ''}`}
    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
  >
    <div>
      <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed">
        {label && <span className="font-semibold text-gray-600 mr-1.5">{label}.</span>}
        <MathText text={text} />
      </p>
      {marks != null && (
        <span className="inline-block mt-1 text-xs font-semibold text-slate-400">
          ({marks} marks)
        </span>
      )}
    </div>

    {imageUrl && (
      <div className="mt-2 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
        <img src={imageUrl} alt={`Figure for question ${altLabel}`} className="w-full h-auto object-contain" loading="lazy" />
      </div>
    )}

    {/* Bottom action row: Save & Ask AI */}
    <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
        className={`flex items-center gap-1.5 text-xs font-semibold h-7 px-2.5 rounded-lg border transition-all active:scale-95 ${
          isSaved
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'
        }`}
        title={isSaved ? 'Remove from saved' : 'Save for revision'}
      >
        {isSaved ? <BookmarkCheck className="w-3.5 h-3.5 text-indigo-600" /> : <Bookmark className="w-3.5 h-3.5 text-slate-400" />}
        <span>{isSaved ? 'Saved' : 'Save'}</span>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onAskAi(); }}
        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50/80 hover:bg-blue-100 border border-blue-100 h-7 px-2.5 rounded-lg transition-all active:scale-95"
        title="Ask about this question"
      >
        <GoogleLensIcon size={14} className="text-blue-600" />
        <span>Ask</span>
      </button>
    </div>
  </div>
))

const PaperQuestionBlock = memo(({ group, onOpenQuestion, savedIds, onToggleSave, delay = 0 }) => {
  const rm = useReducedMotion()
  const hasSubParts = group.items.length > 1
  const singleQuestion = group.items[0]
  const inline = !hasSubParts ? parseInlineSubParts(singleQuestion?.text) : null
  const leadingStem = hasSubParts ? extractLeadingStem(group.items[0]?.text) : null

  return (
    <div
      className={rm ? '' : 'ed-fade-up'}
      style={{ ...(rm ? undefined : { animationDelay: `${delay}ms` }), contentVisibility: 'auto', containIntrinsicSize: '0 160px' }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="font-bold text-gray-800 text-lg font-display">Question {group.number}:</p>
      </div>

      {inline ? (
        <div
          onClick={() => onOpenQuestion(singleQuestion)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQuestion(singleQuestion); } }}
          className="group/q cursor-pointer rounded-xl p-2.5 -mx-2 transition-all hover:bg-slate-50/80 active:bg-slate-100/80"
        >
          <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed"><MathText text={inline.stem} /></p>
          {singleQuestion.marks != null && <p className="text-xs font-semibold text-slate-400 mt-0.5">({singleQuestion.marks} marks)</p>}
          <div className="mt-2 space-y-2.5 pl-4">
            {inline.items.map((it) => (
              <p key={it.letter} className="text-base sm:text-[17px] text-gray-800 leading-relaxed">
                <span className="font-semibold text-gray-600 mr-1.5">{it.letter}.</span>
                <MathText text={it.text} />
              </p>
            ))}
          </div>
          {singleQuestion.imageUrl && (
            <div className="mt-2 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
              <img src={singleQuestion.imageUrl} alt={`Figure for Q${group.number}`} className="w-full h-auto object-contain" loading="lazy" />
            </div>
          )}

          {/* Bottom action row for inline question */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSave(singleQuestion); }}
              className={`flex items-center gap-1.5 text-xs font-semibold h-7 px-2.5 rounded-lg border transition-all active:scale-95 ${
                savedIds?.has(singleQuestion.id)
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'
              }`}
              title={savedIds?.has(singleQuestion.id) ? 'Remove from saved' : 'Save for revision'}
            >
              {savedIds?.has(singleQuestion.id) ? <BookmarkCheck className="w-3.5 h-3.5 text-indigo-600" /> : <Bookmark className="w-3.5 h-3.5 text-slate-400" />}
              <span>{savedIds?.has(singleQuestion.id) ? 'Saved' : 'Save'}</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onOpenQuestion(singleQuestion); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50/80 hover:bg-blue-100 border border-blue-100 h-7 px-2.5 rounded-lg transition-all active:scale-95"
              title="Ask AI about this question"
            >
              <GoogleLensIcon className="w-3.5 h-3.5 text-blue-600" />
              <span>Ask AI</span>
            </button>
          </div>
        </div>
      ) : (
        <div>
          {leadingStem && <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed mb-3"><MathText text={leadingStem.stem} /></p>}
          <div className="space-y-1">
            {group.items.map((q, i) => {
              const label = subLetterOf(q.number) || (hasSubParts ? String.fromCharCode(97 + i) : null)
              const displayText = (leadingStem && i === 0) ? leadingStem.rest : q.text
              return (
                <PaperSubItem
                  key={q.id} label={label} text={displayText} marks={q.marks} imageUrl={q.imageUrl}
                  indent={hasSubParts} onAskAi={() => onOpenQuestion(q)}
                  isSaved={savedIds?.has(q.id)} onToggleSave={() => onToggleSave(q)}
                  needsReview={q.needsReview} altLabel={`${group.number}${label || ''}`}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})

// ── Question list view ────────────────────────────────────────
const GROUP_PAGE_SIZE = 5

const QuestionListView = memo(({ paper, onOpenQuestion, savedIds, reviewedIds, onToggleSave }) => {
  const { data: rawRows = [], isLoading, error, refetch } = useQuery({
    queryKey: ['paperQuestions', paper?.paperId],
    queryFn: () => fetchQuestionsForPaper(paper?.paperId),
    initialData: () => {
      try {
        const cached = localStorage.getItem('sh_pq_' + paper?.paperId)
        return cached ? JSON.parse(cached) : undefined
      } catch { return undefined }
    },
    enabled: !!paper?.paperId, staleTime: 10 * 60 * 1000,
  })
  const questions = useMemo(() => rawRows.map(normalizeDbQuestion).sort(naturalQuestionSort), [rawRows])
  const groups = useMemo(() => groupQuestionsForPaper(questions), [questions])
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE)
  useEffect(() => { setVisibleGroupCount(GROUP_PAGE_SIZE) }, [paper?.paperId])

  if (isLoading) return <div className="px-4 pt-2 space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
  if (error) return <ErrorState onRetry={() => refetch()} message={error.message} />
  if (!questions.length) return (
    <div className="px-4 py-20 text-center ed-fade-up">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-300"><FileText className="w-7 h-7" /></div>
      <p className="font-semibold text-gray-800 text-base font-display">No extracted questions yet</p>
      <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto leading-relaxed">This paper hasn't been processed yet. Check back soon.</p>
    </div>
  )
  const visibleGroups = groups.slice(0, visibleGroupCount)
  const hasMore = visibleGroupCount < groups.length
  return (
    <div className="pb-4">
      <div className="bg-white border-t border-b border-gray-100 px-4 sm:px-8 py-5 sm:py-6 w-full mt-1">
        <div className="divide-y divide-gray-100 max-w-3xl mx-auto">
          {visibleGroups.map((group, i) => (
            <div key={group.number} className={i === 0 ? 'pb-6' : 'py-6'}>
              <PaperQuestionBlock
                group={group}
                onOpenQuestion={(q) => onOpenQuestion(q, questions)}
                savedIds={savedIds}
                onToggleSave={onToggleSave}
                delay={Math.min(i * 40, 200)}
              />
            </div>
          ))}
        </div>
        {!hasMore && (
          <p className="text-center text-[11px] font-semibold tracking-wider text-gray-400 uppercase pt-6 max-w-3xl mx-auto">
            — End of Question Paper —
          </p>
        )}
      </div>
      {hasMore && (
        <div className="flex justify-center px-4 pt-4">
          <button
            onClick={() => setVisibleGroupCount(c => c + GROUP_PAGE_SIZE)}
            className="px-5 h-11 bg-white border border-indigo-200 text-indigo-600 text-sm font-semibold rounded-xl hover:bg-indigo-50 active:scale-95 transition-all shadow-sm"
          >
            Show more ({groups.length - visibleGroupCount} left)
          </button>
        </div>
      )}
    </div>
  )
})

// ── Saved questions view ──────────────────────────────────────
const SavedQuestionsView = memo(({ savedIds, allQuestionRows, onOpenQuestion, onToggleSave, reviewedIds }) => {
  const savedQuestions = useMemo(() => {
    if (!savedIds?.size) return []
    return allQuestionRows.filter(r => savedIds.has(r.id)).map((r, i) => normalizeDbQuestion(r, i))
  }, [savedIds, allQuestionRows])
  if (!savedQuestions.length) return (
    <EmptyState label="No saved questions yet" sub="Tap the bookmark icon on any question to add it here for quick revision." />
  )
  return (
    <div className="px-4 space-y-3 pb-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{savedQuestions.length} saved question{savedQuestions.length !== 1 ? 's' : ''}</p>
      {savedQuestions.map((q) => (
        <div key={q.id} className="bg-white border border-indigo-100 rounded-xl p-4 ed-fade-up">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">{q.topic}</span>
                {q.marks != null && <span className="text-xs text-gray-500">{q.marks} marks</span>}
                {reviewedIds?.has(q.id) && (
                  <span className="text-xs text-emerald-500 font-semibold flex items-center gap-0.5"><CheckCheck className="w-3 h-3" /> Done</span>
                )}
              </div>
              {/* font-normal for saved question text, body reading size */}
              <p className="text-base text-gray-800 leading-relaxed line-clamp-3"><MathText text={q.text} /></p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <BookmarkBtn isSaved onToggle={() => onToggleSave(q)} />
              <button onClick={() => onOpenQuestion(q, savedQuestions)} className="flex items-center gap-1 px-2.5 h-9 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-90 transition-all text-xs font-semibold whitespace-nowrap">
                <GoogleLensIcon size={14} className="text-blue-600" /> Ask
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})

// ── Main component ────────────────────────────────────────────
export default function PastPapers() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const reduceMotion = useMotionPreference()
  const [, startTransition] = useTransition()

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setUser(data?.session?.user ?? null); setAuthLoading(false) }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null); setAuthLoading(false)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  const [currentView, setCurrentView] = useState(() => {
    try { return sessionStorage.getItem('ppView') || 'my-courses' } catch { return 'my-courses' }
  })
  const [browsingAll, setBrowsingAll] = useState(false)
  const [currentProgram, setCurrentProgram] = useState(null)
  const [currentCourse, setCurrentCourse] = useState(null)
  const [currentPaper, setCurrentPaper] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('ppCurrentPaper') || 'null') } catch { return null }
  })
  const [studyMode, setStudyMode] = useState('papers')
  const [paperViewFormat, setPaperViewFormat] = useState('extracted') // 'extracted' | 'actual'
  const [showSaved, setShowSaved] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearch = useDeferredValue(searchQuery)

  const [savedQuestionIds, setSavedQuestionIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('savedQuestions') || '[]')) } catch { return new Set() }
  })
  const [reviewedIds, setReviewedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('reviewedQuestions') || '[]')) } catch { return new Set() }
  })
  const [flaggedIds, setFlaggedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('flaggedQuestions') || '[]')) } catch { return new Set() }
  })

  const [activeEntry, setActiveEntry] = useState(null)
  const aiCacheMapRef = useRef(new Map())
  const aiCache = useMemo(() => ({
    get: (id) => aiCacheMapRef.current.get(id),
    set: (id, patch) => {
      const prev = aiCacheMapRef.current.get(id) || {}
      aiCacheMapRef.current.set(id, { ...prev, ...patch })
    },
  }), [])

  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showOfflineToast, setShowOfflineToast] = useState(false)
  const [pendingSyncCount, setPendingSyncCount] = useState(() => loadSyncQueue().length)

  const [milestoneMsg, setMilestoneMsg] = useState(null)
  const milestoneTimer = useRef(null)
  const showMilestone = useCallback((msg) => {
    clearTimeout(milestoneTimer.current)
    setMilestoneMsg(msg)
    milestoneTimer.current = setTimeout(() => setMilestoneMsg(null), 3500)
  }, [])

  // Analytics tracking: paper viewed
  useEffect(() => {
    if (currentPaper?.paperId) {
      trackPaperViewed({
        id: currentPaper.paperId,
        title: `${currentPaper.courseName || ''} (${currentPaper.year || ''})`,
        course: currentPaper.courseName,
        program: currentProgram?.name || myProgramName,
      })
    }
  }, [currentPaper?.paperId])

  // Analytics tracking: search queries
  useEffect(() => {
    if (deferredSearch && deferredSearch.trim().length >= 3) {
      trackSearch({ query: deferredSearch.trim(), section: 'past_papers' })
    }
  }, [deferredSearch])

  const isImmersiveRef = useRef(false)
  const [isImmersive, setIsImmersive] = useState(false)
  const lastScrollY = useRef(0)
  const scrollAccumulator = useRef(0)
  const scrollContainerRef = useRef(null)

  const handleScroll = useCallback((e) => {
    if (currentView !== 'questions') {
      if (isImmersiveRef.current) {
        isImmersiveRef.current = false
        setIsImmersive(false)
      }
      return
    }

    const currentY = e.currentTarget.scrollTop
    const diff = currentY - lastScrollY.current

    // Always restore chrome when near the top
    if (currentY <= 60) {
      if (isImmersiveRef.current) {
        isImmersiveRef.current = false
        setIsImmersive(false)
      }
      scrollAccumulator.current = 0
      lastScrollY.current = currentY
      return
    }

    if (diff > 0) {
      // Deliberate downward scroll
      scrollAccumulator.current = Math.max(0, scrollAccumulator.current) + diff
      if (scrollAccumulator.current > 40 && !isImmersiveRef.current) {
        isImmersiveRef.current = true
        setIsImmersive(true)
        scrollAccumulator.current = 0
      }
    } else if (diff < 0) {
      // Deliberate upward scroll
      scrollAccumulator.current = Math.min(0, scrollAccumulator.current) + diff
      if (scrollAccumulator.current < -25 && isImmersiveRef.current) {
        isImmersiveRef.current = false
        setIsImmersive(false)
        scrollAccumulator.current = 0
      }
    }

    lastScrollY.current = currentY
  }, [currentView])

  useEffect(() => {
    if (currentView !== 'questions') {
      isImmersiveRef.current = false
      setIsImmersive(false)
    }
  }, [currentView])

  // Queries
  const { data: myAcademicProfile } = useQuery({
    queryKey: ['myAcademicProfile', user?.id],
    queryFn: () => fetchUserAcademicProfile(user?.id),
    enabled: !!user?.id,
  })
  const myProgramName = myAcademicProfile?.program
  const myYear = myAcademicProfile?.year
  const mySemester = myAcademicProfile?.semester

  const { data: myProgramId } = useQuery({
    queryKey: ['myProgramId', myProgramName],
    queryFn: () => fetchProgramIdByName(myProgramName),
    enabled: !!myProgramName,
  })

  const { data: myCourses = [], isLoading: myCoursesLoading } = useQuery({
    queryKey: ['myCourses', myProgramId, myYear, mySemester],
    queryFn: async () => {
      // Fetch courses strictly matching user's current semester and year
      const courses = await fetchCoursesForProgram(myProgramId, myYear, mySemester)
      // Fallback to semester-only if year was unassigned in courses table
      if (!courses.length && myYear != null && mySemester != null) {
        const semOnly = await fetchCoursesForProgram(myProgramId, null, mySemester)
        if (semOnly.length) return semOnly
      }
      return courses
    },
    enabled: !!myProgramId,
  })
  const myCourseIds = useMemo(() => myCourses.map(c => c.id), [myCourses])
  const myCoursesResolving =
    (!!user?.id && myAcademicProfile === undefined) ||
    (!!myProgramName && myProgramId === undefined) ||
    (!!myProgramId && myCoursesLoading)

  const { data: myQuestionRows = [], isLoading: myPapersLoading, error: myPapersError, refetch: refetchMyPapers } = useQuery({
    queryKey: ['myQuestions', myCourseIds],
    queryFn: () => fetchQuestionsForCourseIds(myCourseIds),
    initialData: () => {
      if (!myCourseIds.length) return undefined
      try {
        const cached = localStorage.getItem('sh_cq_' + [...myCourseIds].sort().join('_'))
        return cached ? JSON.parse(cached) : undefined
      } catch { return undefined }
    },
    enabled: myCourseIds.length > 0, staleTime: 5 * 60 * 1000,
  })
  const myPapers = useMemo(() => groupQuestionsIntoPapers(myQuestionRows), [myQuestionRows])
  const myPapersByCourse = useMemo(() => groupPapersByCourse(myPapers), [myPapers])
  const filteredMyPapersByCourse = useMemo(() => {
    if (!deferredSearch) return myPapersByCourse
    const q = deferredSearch.toLowerCase()
    const out = {}
    Object.entries(myPapersByCourse).forEach(([cid, group]) => {
      if (group.courseName.toLowerCase().includes(q) || group.courseCode?.toLowerCase().includes(q)) out[cid] = group
    })
    return out
  }, [myPapersByCourse, deferredSearch])

  const { data: allPrograms = [], isLoading: programsLoading, error: programsError, refetch: refetchPrograms } = useQuery({
    queryKey: ['allPrograms'], queryFn: fetchAllPrograms, enabled: browsingAll,
  })
  const { data: browseCourses = [], isLoading: coursesLoading, error: coursesError, refetch: refetchCourses } = useQuery({
    queryKey: ['browseCourses', currentProgram?.id], queryFn: () => fetchCoursesForProgram(currentProgram?.id), enabled: !!currentProgram?.id,
  })
  const { data: coursePaperRows = [], isLoading: coursePapersLoading, error: coursePapersError, refetch: refetchCoursePapers } = useQuery({
    queryKey: ['coursePapers', currentCourse?.id],
    queryFn: () => fetchQuestionsForCourseIds(currentCourse?.id ? [currentCourse.id] : []),
    initialData: () => {
      if (!currentCourse?.id) return undefined
      try {
        const cached = localStorage.getItem('sh_cq_' + currentCourse.id)
        return cached ? JSON.parse(cached) : undefined
      } catch { return undefined }
    },
    enabled: !!currentCourse?.id,
  })
  const coursePapers = useMemo(() => groupQuestionsIntoPapers(coursePaperRows), [coursePaperRows])
  const sortedCoursePapers = useMemo(() => sortPapersRecentFirst(coursePapers), [coursePapers])

  // Background prefetch: save paper scan files before user even thinks about switching format
  useEffect(() => {
    if (!sortedCoursePapers?.length) return
    const prefetchScanFiles = async () => {
      for (const p of sortedCoursePapers.slice(0, 3)) {
        if (!p?.paperId) continue
        try {
          const cacheKey = `sh_file_meta_${p.paperId}`
          let fileUrl = null
          const cached = localStorage.getItem(cacheKey)
          if (cached) {
            fileUrl = JSON.parse(cached)?.file_url
          } else {
            const { data } = await supabase
              .from('past_paper')
              .select('id, file_url, file_name, file_type, thumbnail_url, page_count, title, course, year')
              .eq('paper_id', p.paperId)
              .maybeSingle()
            if (data?.file_url) {
              localStorage.setItem(cacheKey, JSON.stringify(data))
              fileUrl = data.file_url
            }
          }
          if (fileUrl && 'caches' in window) {
            const cache = await caches.open('studyhub-papers-v1')
            const match = await cache.match(fileUrl)
            if (!match) {
              fetch(fileUrl, { mode: 'cors' }).then(res => {
                if (res.ok) cache.put(fileUrl, res)
              }).catch(() => {})
            }
          }
        } catch {}
      }
    }
    prefetchScanFiles()
  }, [sortedCoursePapers])

  useEffect(() => {
    if (currentView !== 'questions') return
    if (!sortedCoursePapers.length) { if (currentPaper) setCurrentPaper(null); return }
    const stillValid = currentPaper && sortedCoursePapers.some(p => p.paperId === currentPaper.paperId)
    if (!stillValid) setCurrentPaper(sortedCoursePapers[0])
  }, [sortedCoursePapers, currentView])

  useEffect(() => { sessionStorage.setItem('ppView', currentView) }, [currentView])
  useEffect(() => { try { sessionStorage.setItem('ppCurrentPaper', JSON.stringify(currentPaper)) } catch {} }, [currentPaper])
  useEffect(() => { try { localStorage.setItem('savedQuestions', JSON.stringify([...savedQuestionIds])) } catch {} }, [savedQuestionIds])
  useEffect(() => { try { localStorage.setItem('reviewedQuestions', JSON.stringify([...reviewedIds])) } catch {} }, [reviewedIds])
  useEffect(() => { try { localStorage.setItem('flaggedQuestions', JSON.stringify([...flaggedIds])) } catch {} }, [flaggedIds])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    fetchSavedQuestionIds().then((serverIds) => {
      if (cancelled || !serverIds) return
      setSavedQuestionIds(prev => new Set([...prev, ...serverIds]))
    })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true); setShowOfflineToast(false)
      flushSyncQueue().then(() => setPendingSyncCount(loadSyncQueue().length))
    }
    const onOffline = () => { setIsOnline(false); setShowOfflineToast(true) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (navigator.onLine) flushSyncQueue().then(() => setPendingSyncCount(loadSyncQueue().length))
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    if (!showOfflineToast) return
    const t = setTimeout(() => setShowOfflineToast(false), 4000)
    return () => clearTimeout(t)
  }, [showOfflineToast])

  // Navigation
  const goToMyCourses = useCallback(() => startTransition(() => {
    setBrowsingAll(false); setCurrentView('my-courses')
    setCurrentProgram(null); setCurrentCourse(null); setCurrentPaper(null); setShowSaved(false)
  }), [])
  const goToBrowsePrograms = useCallback(() => startTransition(() => {
    setBrowsingAll(true); setCurrentView('programs')
    setCurrentProgram(null); setCurrentCourse(null); setCurrentPaper(null); setShowSaved(false)
  }), [])
  const goToBrowseCourses = useCallback((program) => startTransition(() => {
    setCurrentProgram(program); setCurrentView('courses'); setCurrentCourse(null); setCurrentPaper(null)
  }), [])
  const goToCourseDetail = useCallback((course) => startTransition(() => {
    setCurrentCourse(course); setCurrentView('questions'); setStudyMode('papers'); setCurrentPaper(null); setShowSaved(false)
  }), [])
  const handleBack = () => {
    if (currentView === 'questions') browsingAll ? goToBrowseCourses(currentProgram) : goToMyCourses()
    else if (currentView === 'courses') goToBrowsePrograms()
    else goToMyCourses()
  }

  const handleToggleSave = useCallback((question) => {
    setSavedQuestionIds(prev => {
      const next = new Set(prev)
      const willSave = !next.has(question.id)
      if (willSave) next.add(question.id); else next.delete(question.id)
      writeWithOfflineFallback(
        () => (willSave ? saveQuestionOnServer(question) : unsaveQuestionOnServer(question.id)),
        { type: willSave ? 'save' : 'unsave', questionId: question.id, paperId: question.paperId || null },
      ).then(() => setPendingSyncCount(loadSyncQueue().length))
      return next
    })
  }, [])

  const handleOpenQuestion = useCallback((question, list = null) => {
    setActiveEntry({ question, list, paperContext: null })
  }, [])

  const handleAskPaper = useCallback((paperContext) => {
    const effectivePaperId = paperContext?.paperId || currentPaper?.paperId || null
    const syntheticQuestion = {
      id: `paper_${effectivePaperId || 'unknown'}`,
      paperId: effectivePaperId,
      text: `${currentPaper?.courseName || paperContext?.paperTitle || ''} ${currentPaper?.year || ''} Past Paper`,
      course: currentPaper?.courseName || null,
      marks: null,
      topic: null,
      number: 'Paper',
    }
    setActiveEntry({ question: syntheticQuestion, list: null, paperContext })
  }, [currentPaper])

  const handleMarkReviewed = useCallback((question) => {
    setReviewedIds(prev => {
      if (prev.has(question.id)) return prev
      const next = new Set(prev)
      next.add(question.id)
      writeWithOfflineFallback(
        () => markQuestionReviewedOnServer(question.id),
        { type: 'reviewed', questionId: question.id },
      ).then(() => setPendingSyncCount(loadSyncQueue().length))
      if (currentPaper && coursePaperRows.length) {
        const paperQIds = coursePaperRows.filter(r => r.paper_id === currentPaper.paperId).map(r => r.id)
        const newCount = paperQIds.filter(id => next.has(id)).length
        if (newCount === paperQIds.length && paperQIds.length > 0) showMilestone('Paper complete! Well done.')
      }
      return next
    })
  }, [currentPaper, coursePaperRows, showMilestone])

  const handleFlagQuestion = useCallback((question) => {
    setFlaggedIds(prev => {
      if (prev.has(question.id)) return prev
      const next = new Set(prev)
      next.add(question.id)
      writeWithOfflineFallback(
        () => flagQuestionOnServer(question.id, 'student-reported'),
        { type: 'flag', questionId: question.id, reason: 'student-reported' },
      ).then(() => setPendingSyncCount(loadSyncQueue().length))
      return next
    })
  }, [])

  const reviewedCountFor = useCallback((ids) => {
    let count = 0; for (const id of ids) if (reviewedIds.has(id)) count++; return count
  }, [reviewedIds])

  const showBack = currentView !== 'my-courses'
  const searchPlaceholder = currentView === 'programs' ? 'Search programs…' : 'Search courses…'

  const renderPrograms = () => {
    const list = deferredSearch ? allPrograms.filter(p => p.name.toLowerCase().includes(deferredSearch.toLowerCase())) : allPrograms
    if (!list.length) return <EmptyState label="No programs found" isSearch={!!deferredSearch} />
    return list.map((prog, idx) => (
      <ProgramCard key={prog.id} program={prog} onClick={() => goToBrowseCourses(prog)} delay={Math.min(idx * 35, 200)} />
    ))
  }
  const renderCourses = () => {
    const list = deferredSearch
      ? browseCourses.filter(c => c.course_name.toLowerCase().includes(deferredSearch.toLowerCase()) || c.course_code?.toLowerCase().includes(deferredSearch.toLowerCase()))
      : browseCourses
    if (!list.length) return <EmptyState label="No courses yet" isSearch={!!deferredSearch} />
    return list.map((course, idx) => (
      <CourseCard key={course.id} course={course} onClick={() => goToCourseDetail(course)} delay={Math.min(idx * 35, 200)} />
    ))
  }

  return (
    <MotionContext.Provider value={reduceMotion}>
      <style>{ANIM_CSS}</style>
      <div className="relative h-screen h-[100dvh] w-full overflow-hidden bg-white flex flex-col">
        {/* Main scrollable body */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-white w-full no-scrollbar pb-32 lg:pb-6"
        >

        {/* Header */}
        <header
          className={`sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 transition-transform duration-300 ease-out will-change-transform ${
            isImmersive ? '-translate-y-full shadow-none pointer-events-none' : 'translate-y-0 shadow-sm'
          }`}
        >
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {showBack && (
                <button className="w-11 h-11 flex items-center justify-center hover:bg-indigo-50 rounded-xl transition-colors active:scale-90 flex-shrink-0" onClick={handleBack} aria-label="Go back">
                  <ArrowLeft className="w-5 h-5 text-gray-700" />
                </button>
              )}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <img src="/images/luanar7.png" alt="Logo" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
                </div>
                <h1 className="text-lg font-bold tracking-tight font-display truncate">
                  <span className="text-gray-800">Past</span>
                  <span className="text-indigo-600"> Papers</span>
                </h1>
                {!isOnline && <span className="text-[11px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold flex-shrink-0">Offline</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {currentView === 'my-courses' && (
                <button
                  onClick={() => setShowSaved(s => !s)}
                  className={`flex items-center gap-1 px-2.5 h-9 rounded-full border text-sm font-semibold transition-all active:scale-95 ${
                    showSaved ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                >
                  {showSaved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                  Saved
                  {savedQuestionIds.size > 0 && (
                    <span className={`text-[11px] font-bold px-1.5 rounded-full ${showSaved ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                      {savedQuestionIds.size}
                    </span>
                  )}
                </button>
              )}
              {currentView === 'questions' && (
                <button
                  onClick={() => {
                    isImmersiveRef.current = !isImmersive;
                    setIsImmersive(prev => !prev);
                  }}
                  className={`p-2 rounded-xl border transition-all active:scale-90 flex-shrink-0 ${
                    isImmersive
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                  title={isImmersive ? 'Exit fullscreen reading mode' : 'Fullscreen reading mode'}
                  aria-label="Toggle Fullscreen"
                >
                  {isImmersive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              )}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent w-32 sm:w-44 transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 w-5 h-5 flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Breadcrumb */}
        {currentView !== 'my-courses' && (
          <div className="flex items-center gap-1 px-4 pt-2 pb-1 text-xs text-gray-500 overflow-x-auto no-scrollbar whitespace-nowrap">
            <button onClick={goToMyCourses} className="hover:text-indigo-600 transition-colors font-medium min-h-[36px] flex items-center">My Courses</button>
            {browsingAll && (
              <>
                <ChevronRight className="w-3 h-3 opacity-30 flex-shrink-0" />
                <button onClick={currentView !== 'programs' ? goToBrowsePrograms : undefined} className={`min-h-[36px] flex items-center ${currentView !== 'programs' ? 'hover:text-indigo-600 transition-colors font-medium' : 'text-gray-700 font-semibold'}`}>
                  Programs
                </button>
              </>
            )}
            {browsingAll && currentProgram && (
              <>
                <ChevronRight className="w-3 h-3 opacity-30 flex-shrink-0" />
                <button onClick={currentView !== 'courses' ? () => goToBrowseCourses(currentProgram) : undefined} className={`min-h-[36px] flex items-center ${currentView !== 'courses' ? 'hover:text-indigo-600 transition-colors font-medium' : 'text-gray-700 font-semibold'}`}>
                  {currentProgram.name}
                </button>
              </>
            )}
            {currentCourse && (
              <>
                <ChevronRight className="w-3 h-3 opacity-30 flex-shrink-0" />
                <span className="text-gray-700 font-semibold truncate max-w-[150px]">{currentCourse.course_name}</span>
              </>
            )}
          </div>
        )}

        {/* Content */}
        <div className="py-3 space-y-3">

          {currentView === 'my-courses' && !showSaved && (
            <>
              <div className="px-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your courses</p>
                  {(myYear || mySemester) && (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-bold rounded-md">
                      {myYear ? `Year ${myYear}` : ''}
                      {myYear && mySemester ? ' · ' : ''}
                      {mySemester ? `Semester ${mySemester}` : ''}
                    </span>
                  )}
                </div>
                <button onClick={goToBrowsePrograms} className="text-sm font-semibold text-indigo-600 hover:underline h-9 flex items-center">
                  Browse other programs →
                </button>
              </div>
              {authLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4">{Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}</div>
              ) : !user ? (
                <EmptyState label="Sign in to see your courses" sub="Your past papers and revision progress are saved to your account." action={{ label: 'Sign in', onClick: () => window.location.href = '/auth' }} />
              ) : myCoursesResolving || myPapersLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
              ) : myPapersError ? (
                <ErrorState onRetry={() => refetchMyPapers()} message={myPapersError.message} />
              ) : myCourseIds.length === 0 ? (
                <EmptyState label="No courses found for your program yet" sub="Check back soon — new programs are added regularly." />
              ) : Object.keys(filteredMyPapersByCourse).length === 0 ? (
                <EmptyState label="No matching courses" isSearch />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4">
                  {Object.entries(filteredMyPapersByCourse).map(([courseId, group], idx) => {
                    const course = myCourses.find(c => String(c.id) === String(courseId)) || { id: courseId, course_name: group.courseName, course_code: group.courseCode }
                    const courseQIds = myQuestionRows.filter(r => String(r.course_id) === String(courseId)).map(r => r.id)
                    return (
                      <CourseThumbnailCard
                        key={courseId}
                        courseName={group.courseName}
                        courseCode={group.courseCode}
                        paperCount={group.papers.length}
                        onClick={() => goToCourseDetail(course)}
                        delay={Math.min(idx * 35, 200)}
                      />
                    )
                  })}
                </div>
              )}
            </>
          )}

          {currentView === 'my-courses' && showSaved && (
            <SavedQuestionsView
              savedIds={savedQuestionIds}
              allQuestionRows={myQuestionRows}
              onOpenQuestion={handleOpenQuestion}
              onToggleSave={handleToggleSave}
              reviewedIds={reviewedIds}
            />
          )}

          {currentView === 'programs' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4">
              {programsLoading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                : programsError ? <ErrorState onRetry={() => refetchPrograms()} message={programsError.message} />
                : renderPrograms()}
            </div>
          )}

          {currentView === 'courses' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4">
              {coursesLoading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                : coursesError ? <ErrorState onRetry={() => refetchCourses()} message={coursesError.message} />
                : renderCourses()}
            </div>
          )}

          {currentView === 'questions' && (
            coursePapersLoading ? (
              <div className="px-4 pt-2 space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            ) : coursePapersError ? (
              <ErrorState onRetry={() => refetchCoursePapers()} message={coursePapersError.message} />
            ) : !sortedCoursePapers.length ? (
              <EmptyState label="No past papers for this course yet" />
            ) : (
              <>
                <PaperToolbar
                  papers={sortedCoursePapers}
                  currentPaperId={currentPaper?.paperId}
                  onSelect={setCurrentPaper}
                  viewFormat={paperViewFormat}
                  onFormatChange={setPaperViewFormat}
                />
                {currentPaper && (
                  paperViewFormat === 'actual' ? (
                    <ActualPaperView
                      paper={currentPaper}
                      onSwitchToText={() => setPaperViewFormat('extracted')}
                      onAskPaper={handleAskPaper}
                    />
                  ) : (
                    <QuestionListView
                      paper={currentPaper}
                      onOpenQuestion={handleOpenQuestion}
                      savedIds={savedQuestionIds}
                      reviewedIds={reviewedIds}
                      onToggleSave={handleToggleSave}
                    />
                  )
                )}
              </>
            )
          )}
        </div>

        {/* ActionSheet and Toasts outside scroll container */}
        <ActionSheet
          question={activeEntry?.question ?? null}
          questionList={activeEntry?.list ?? null}
          paperContext={activeEntry?.paperContext ?? null}
          onClose={() => setActiveEntry(null)}
          savedIds={savedQuestionIds}
          onToggleSave={handleToggleSave}
          flaggedIds={flaggedIds}
          onFlag={handleFlagQuestion}
          isOnline={isOnline}
          aiCache={aiCache}
          reviewedIds={reviewedIds}
          onMarkReviewed={handleMarkReviewed}
          onNavigate={(q) => setActiveEntry(prev => prev ? { ...prev, question: q } : null)}
        />

        <OfflineToast visible={showOfflineToast} pendingCount={pendingSyncCount} />
        <MilestoneToast visible={!!milestoneMsg} message={milestoneMsg} />
      </div>

      {/* Bottom Navigation - Fixed and separated from scroll */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ease-out pointer-events-none ${
          currentView === 'questions' && isImmersive ? 'translate-y-32' : 'translate-y-0'
        }`}
      >
        <div className="pointer-events-auto">
          <BottomNav />
        </div>
      </div>

      {currentView === 'questions' && isImmersive && (
        <div className="fixed bottom-6 right-6 z-50 ed-fade-up">
          <button
            onClick={() => {
              isImmersiveRef.current = false;
              setIsImmersive(false);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900/90 hover:bg-black text-white backdrop-blur-md text-xs font-semibold rounded-full shadow-2xl transition-all active:scale-95 border border-white/20"
            title="Exit fullscreen reading mode"
          >
            <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Exit Fullscreen</span>
          </button>
        </div>
      )}
    </div>
    </MotionContext.Provider>
  )
}