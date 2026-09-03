// PastPapers.jsx – v18 (fix: duplicate renderInline + broken AiBlock call)
//
// Changes from v17:
//  v17 added `import { MathText, renderInline } from './math-fix'` at the
//  top but LEFT the old local `function renderInline(...)` further down in
//  the same file — a duplicate top-level identifier, which is a hard
//  SyntaxError in ES modules (import bindings and top-level declarations
//  share the same scope). It also left `AiBlock` calling
//  `isolateBlockMath(normalizeMathDelimiters(content))`, but those two
//  functions had already been deleted (only their comments remained) —
//  a guaranteed ReferenceError the moment any AI block rendered.
//
//  v18 removes both leftovers:
//   - The local `renderInline` definition is gone; the imported one (which
//     shares its tokenizer with MathText — see math-fix.jsx) is the only
//     one now.
//   - `AiBlock` passes `content` straight into `MarkdownLite`. The cleanup
//     work (normalizing \( \) / \[ \], pairing $$ blocks, wrapping
//     undelimited DB macros) all happens inside `renderInline` /
//     `parseMathSegments` in math-fix.jsx now, in exactly one place.
//   - The local `MathFallback`, `mathRenderError`, and `tidyPlainText`
//     helpers are gone too — `mathRenderError` is imported from
//     math-fix.jsx so there is one copy of that logic, not two.
//
// (v14–v17 changes retained below for reference)
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
  Tag, ArrowRight,
} from 'lucide-react'
import { MathText, renderInline, mathRenderError } from './math-fix'

// ── API layer ─────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

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
async function fetchUserProgramId(userId) {
  if (!userId) return null
  const { data, error } = await supabase.from('profiles').select('program').eq('id', userId).single()
  if (error) throw error; return data?.program ?? null
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
async function fetchCoursesForProgram(programId) {
  if (!programId) return []
  const { data, error } = await supabase.from('courses').select('*').eq('program_id', programId)
    .order('year', { ascending: true }).order('semester', { ascending: true })
  if (error) throw error; return data || []
}
async function fetchQuestionsForCourseIds(courseIds) {
  if (!courseIds?.length) return []
  const { data, error } = await supabase
    .from('past_papers')
    .select('*, courses ( id, course_code, course_name, semester, year, program_id )')
    .in('course_id', courseIds).order('created_at', { ascending: false })
  if (error) throw error; return data || []
}
async function fetchQuestionsForPaper(paperId) {
  if (!paperId) return []
  const { data, error } = await supabase
    .from('past_papers').select('*').eq('paper_id', paperId).order('created_at', { ascending: true })
  if (error) throw error; return data || []
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
      }
    }
    const p = byPaper[key]
    p.questionCount += 1
    if (typeof row.marks === 'number') p.totalMarks += row.marks
    if (row.topic) p.topics.add(row.topic)
    if (p.year == null && row.year != null) p.year = row.year
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
const CourseThumbnailCard = memo(({ courseName, courseCode, paperCount, reviewedCount = 0, totalCount = 0, onClick, delay = 0 }) => {
  const rm = useReducedMotion()
  const pct = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0
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
        {reviewedCount > 0 && (
          <div className="mt-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold mb-0.5">
              <span className="text-indigo-500 flex items-center gap-0.5"><CheckCheck className="w-3 h-3" /> {reviewedCount} done</span>
              <span className="text-gray-500">{pct}%</span>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  )
})

// ── Paper year pill switcher ───────────────────────────────────
const PaperSwitcher = memo(({ papers, currentPaperId, onSelect }) => {
  if (papers.length < 2) return null
  return (
    <div className="flex gap-2 px-4 sm:px-8 pt-3 pb-1 overflow-x-auto no-scrollbar">
      {papers.map((p) => (
        <button
          key={p.paperId}
          onClick={() => onSelect(p)}
          className={`flex-shrink-0 px-3.5 h-9 rounded-full text-sm font-semibold whitespace-nowrap border transition-all active:scale-95 ${
            p.paperId === currentPaperId
              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-200'
              : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
          }`}
        >
          {p.year || 'Paper'} · {p.questionCount} Qs
        </button>
      ))}
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

function MarkdownLite({ text }) {
  const blocks = useMemo(() => text.split(/\n{2,}/).filter(Boolean), [text])
  return (
    // Paragraph rhythm widened again (space-y-4 → space-y-5) and line-height nudged up
    // (leading-relaxed/1.625 → leading-[1.7]) — a touch more air between wrapped lines
    // without going as loose as leading-loose. text-base stays the reading-size floor.
    <div className="ai-response space-y-5 text-base leading-[1.7] text-gray-800">
      {blocks.map((block, bi) => {
        const trimmedBlock = block.trim()
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        const isBulleted = lines.length > 0 && lines.every(l => /^[-*]\s+/.test(l))
        const isNumbered = lines.length > 0 && lines.every(l => /^\d+[.)]\s+/.test(l))
        // Capture the heading LEVEL (##, ###, ####) instead of a flat boolean —
        // each level now gets its own style via HEADING_STYLE below.
        const headingMatch = block.match(/^(#{2,4})\s+(.*)$/s)
        // A block that is ENTIRELY one $$...$$ display equation gets its own
        // boxed, centered treatment. renderInline (via parseMathSegments in
        // math-fix.jsx) would render this correctly too — this branch just
        // adds the bordered/centered box styling on top for a standalone
        // equation, which reads better than an inline-flow equation would.
        const blockMathMatch = trimmedBlock.match(/^\$\$([\s\S]+?)\$\$$/)
        // Fallback for plain-text equations with NO LaTeX macros and NO $
        // delimiters at all (e.g. "70000 - 875Tf = 2134.86Tf - 53371.5").
        // math-fix.jsx's undelimited-macro wrapper only fires when it finds
        // an actual \command or ^{...}/_{...} — bare arithmetic like this
        // has neither, so it would otherwise fall through as plain text.
        // This box is the safety net for exactly that case.
        const isPlainEquation = !trimmedBlock.includes('$') && lines.length > 0 && lines.length <= 4 && lines.every(l => EQUATION_RE.test(l.trim()))

        if (headingMatch) {
          const level = headingMatch[1].length
          const style = HEADING_STYLE[level] || HEADING_STYLE[3]
          return (
            // More separation from the block ABOVE (mt-6) than below (first:mt-1) —
            // Gestalt proximity: a heading should sit closer to what it introduces.
            <p key={bi} className={`${style} font-display mt-6 first:mt-1`}>
              {renderInline(headingMatch[2], bi)}
            </p>
          )
        }
        if (blockMathMatch) return (
          <div key={bi} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 overflow-x-auto no-scrollbar flex justify-center">
            <BlockMath math={blockMathMatch[1].trim()} errorColor="#e11d48" renderError={mathRenderError(blockMathMatch[1])} />
          </div>
        )
        // Legacy plain-text equation box — matches body reading size instead of
        // dropping to text-sm.
        if (isPlainEquation) return (
          <div key={bi} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 font-mono text-base leading-7 tracking-tight text-gray-800 overflow-x-auto no-scrollbar">
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )
        if (isBulleted) return (
          <ul key={bi} className="space-y-1.5 pl-1">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-400 flex-shrink-0 mt-1">•</span>
                <span>{renderInline(l.replace(/^[-*]\s+/, ''), `${bi}-${i}`)}</span>
              </li>
            ))}
          </ul>
        )
        if (isNumbered) return (
          <ol key={bi} className="space-y-1.5 pl-1">
            {lines.map((l, i) => {
              const m = l.match(/^(\d+)[.)]\s+(.*)$/)
              return (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-500 flex-shrink-0 font-semibold tabular-nums">{m?.[1] || i + 1}.</span>
                  <span>{renderInline(m?.[2] || l, `${bi}-${i}`)}</span>
                </li>
              )
            })}
          </ol>
        )
        return (
          <p key={bi} style={{ whiteSpace: 'pre-line' }}>{renderInline(block, bi)}</p>
        )
      })}
    </div>
  )
}

// AiBlock: streaming caret respects reduced-motion — a blinking cursor is pure
// decoration once we know the device/connection prefers calm UI.
// v18: no more useMemo/normalizeMathDelimiters/isolateBlockMath here — that
// entire cleanup step lived in this file twice over (once here, once inside
// the old local renderInline) and disagreed with itself. `content` now goes
// straight into MarkdownLite; every bit of delimiter handling happens once,
// inside renderInline -> parseMathSegments (math-fix.jsx), at render time.
const AiBlock = memo(({ content, streaming }) => {
  const rm = useReducedMotion()
  return (
    <div>
      <MarkdownLite text={content} />
      {streaming && <span className={rm ? 'ed-cursor-static' : 'ed-cursor'} />}
    </div>
  )
})

// ThinkingIndicator: dots only bounce when motion is allowed; otherwise a plain,
// still label — same information, no animation cost on a weak GPU or slow link.
const ThinkingIndicator = memo(({ label = 'Luna is thinking' }) => {
  const rm = useReducedMotion()
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-3 ed-fade-up">
      <span>{label}</span>
      {!rm && (
        <span className="flex gap-1">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1.5 h-1.5 rounded-full bg-indigo-300"
              style={{ animation: 'ed-thinking-dot 1.1s ease-in-out infinite', animationDelay: `${d}ms` }} />
          ))}
        </span>
      )}
      {rm && <span className="text-gray-300">…</span>}
    </div>
  )
})

// ── AI stream hook ─────────────────────────────────────────────
function useAiStream() {
  const [blocks, setBlocks] = useState([])
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)
  const controllerRef = useRef(null)

  const run = useCallback(async (path, body) => {
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
    setStatus(prev => (prev === 'thinking' || prev === 'streaming' ? 'done' : prev))
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

// ── Action pill switcher (replaces the 2×2 menu grid) ────────
const AI_ACTIONS = [
  { id: 'understand', icon: Lightbulb,     label: 'Explain' },
  { id: 'solve',      icon: PenLine,       label: 'Solve' },
  { id: 'practice',   icon: RefreshCcw,    label: 'Practice' },
  { id: 'chat',       icon: MessageCircle, label: 'Ask' },
]

const ActionPillBar = memo(({ screen, onSwitch, actionResults }) => (
  <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-1 pb-2">
    {AI_ACTIONS.map((a) => {
      const Icon = a.icon
      const active = screen === a.id
      const done = !!actionResults[a.id]
      return (
        <button
          key={a.id}
          onClick={() => onSwitch(a.id)}
          className={`flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold whitespace-nowrap transition-all active:scale-95 flex-shrink-0 border ${
            active
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200'
              : done
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {a.label}
          {done && !active && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
        </button>
      )
    })}
  </div>
))

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

// ── Action sheet content ──────────────────────────────────────
// REDESIGNED: no more "menu" screen. Opens directly to Explain.
// Horizontal pill switcher replaces the 2×2 grid.
// Swipe left/right on the scroll area navigates questions — now with a discoverability
// hint, edge chevrons, and keyboard arrow support (see fixes above).
function ActionSheetContent({
  question, isSaved, onToggleSave, isFlagged, onFlag,
  isOnline, aiCache, isReviewed, onMarkReviewed,
  hasPrev, hasNext, onPrev, onNext, questionList,
}) {
  const reducedMotion = useReducedMotion()
  const cached = aiCache.get(question.id)
  // Default directly to 'understand' (no menu screen)
  const [screen, setScreen] = useState(cached?.screen || 'understand')
  const [actionResults, setActionResults] = useState(cached?.actionResults || {})
  const [runningAction, setRunningAction] = useState(null)
  const { blocks: liveBlocks, status: liveStatus, errorMsg: liveError, run, stop } = useAiStream()

  const [conversation, setConversation] = useState(cached?.conversation || [])
  const [pendingMessage, setPendingMessage] = useState(null)
  const [chatInput, setChatInput] = useState('')

  const [practiceQuestions, setPracticeQuestions] = useState(cached?.practiceQuestions || null)
  const [practiceLoading, setPracticeLoading] = useState(false)
  const [practiceError, setPracticeError] = useState(null)

  // "Mark Done" now offers next-question as a dismissible toast instead of forcing it.
  const [showDone, setShowDone] = useState(false)
  const [showNextOffer, setShowNextOffer] = useState(false)

  const showSwipeHint = useSwipeHintOnce((questionList?.length ?? 0) > 1)

  useEffect(() => {
    aiCache.set(question.id, { screen, actionResults, conversation, practiceQuestions })
  }, [question.id, screen, actionResults, conversation, practiceQuestions, aiCache])

  useEffect(() => () => { stop() }, [stop])

  // Auto-start Explain when opening a question with no cached result —
  // BUT skip on a detected slow/metered connection (reducedMotion also covers
  // saveData / 2G). Streaming an unrequested answer on a poor connection spends
  // the user's data without asking; show a manual trigger instead.
  useEffect(() => {
    if (screen === 'understand' && !actionResults.understand && !runningAction && !reducedMotion) {
      setRunningAction('understand')
      run('/api/exam/question-action/stream', { action: 'understand', question: questionPayload })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id, reducedMotion])

  useEffect(() => {
    if (!runningAction || runningAction === 'chat') return
    if (liveStatus === 'done' || liveStatus === 'error') {
      setActionResults(prev => ({ ...prev, [runningAction]: { blocks: liveBlocks, status: liveStatus, errorMsg: liveError } }))
      setRunningAction(null)
    }
  }, [liveStatus, liveBlocks, liveError, runningAction])

  useEffect(() => {
    if ((liveStatus === 'done' || liveStatus === 'error') && pendingMessage !== null && screen === 'chat' && runningAction === 'chat') {
      setConversation(prev => [...prev, { id: `${Date.now()}-${prev.length}`, message: pendingMessage, blocks: liveBlocks }])
      setPendingMessage(null); setRunningAction(null)
    }
  }, [liveStatus, liveBlocks, pendingMessage, screen, runningAction])

  // Keyboard navigation — desktop/trackpad users have no swipe gesture at all,
  // so arrow keys aren't a nice-to-have, they're the only way in for that input mode.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      if (e.key === 'ArrowRight' && hasNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onPrev, onNext])

  const questionPayload = useMemo(() => ({
    id: question.id, paperId: question.paperId || null,
    course: question.course || null, text: question.text,
    marks: question.marks, topic: question.topic,
  }), [question])

  const startStream = (actionId, { force = false } = {}) => {
    setScreen(actionId)
    if (!force && actionResults[actionId]) return
    setRunningAction(actionId)
    run('/api/exam/question-action/stream', { action: actionId, question: questionPayload })
  }

  const loadPractice = async ({ force = false } = {}) => {
    setScreen('practice')
    if (!force && practiceQuestions) return
    setPracticeLoading(true); setPracticeError(null)
    try {
      const { result } = await apiPostJson('/api/exam/question-action/practice', { question: questionPayload })
      setPracticeQuestions(result)
    } catch (err) { setPracticeError(err.message) }
    finally { setPracticeLoading(false) }
  }

  const handleSwitch = (actionId) => {
    if (actionId === 'understand') return startStream('understand')
    if (actionId === 'solve') return startStream('solve')
    if (actionId === 'practice') return loadPractice()
    if (actionId === 'chat') setScreen('chat')
  }

  // FIXED: no forced timeout-based navigation. Mark the question done, briefly
  // celebrate, then OFFER the next question via a dismissible toast — the student
  // keeps control of when (or whether) to move on, per Nielsen's "user control and freedom".
  const handleMarkReviewed = () => {
    if (isReviewed) return
    setShowDone(true)
    onMarkReviewed()
    setTimeout(() => setShowDone(false), 900)
    if (hasNext) setShowNextOffer(true)
  }

  const displayed = (runningAction === screen && runningAction !== 'chat')
    ? { blocks: liveBlocks, status: liveStatus, errorMsg: liveError }
    : (actionResults[screen] || { blocks: [], status: 'idle', errorMsg: null })

  const composerBusy = runningAction === 'chat' && (liveStatus === 'thinking' || liveStatus === 'streaming')
  const actionBusy = displayed.status === 'thinking' || displayed.status === 'streaming'

  const submitComposer = (e) => {
    e.preventDefault()
    const msg = chatInput.trim()
    if (!msg || composerBusy) return
    setChatInput(''); setPendingMessage(msg); setRunningAction('chat')
    run('/api/exam/question-action/stream', { action: 'ask', question: questionPayload, message: msg })
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

  // Swipe handler — attached to scrollable content div
  const swipe = useSwipeNav(onPrev, onNext, hasPrev, hasNext)

  return (
    <>
      <div className="flex-1 overflow-y-auto no-scrollbar relative" {...swipe}>

        {/* One-time swipe-gesture hint — teaches, then disappears for good */}
        {showSwipeHint && (
          <div className="sticky top-0 z-10 flex justify-center pt-2 pointer-events-none">
            <span className="ed-swipe-hint bg-gray-900/85 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg">
              ← Swipe to move between questions →
            </span>
          </div>
        )}

        {/* Persistent low-weight edge chevrons — desktop only (touch users have the gesture itself) */}
        <SwipeEdgeChevron side="left" visible={hasPrev} onClick={onPrev} />
        <SwipeEdgeChevron side="right" visible={hasNext} onClick={onNext} />

        {/* Question header */}
        <div className="px-5 pt-2 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Question {question.number || ''}</span>
            <span className="text-sm text-gray-500 font-medium">{question.marks != null ? `${question.marks} marks` : ''}</span>
          </div>
          {/* Question text — text-base font-normal for readability */}
          <p className="text-base text-gray-800 leading-relaxed">
            <MathText text={question.text} />
          </p>
          <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <span className="text-xs text-gray-600 font-semibold flex items-center gap-1">
              <Tag className="w-3 h-3" /> {question.topic}
            </span>
            {question.needsReview && (
              <span title="Our team is verifying this question." className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full cursor-help">
                <ShieldAlert className="w-3 h-3" /> Under review
              </span>
            )}
          </div>
          {/* Action row — HIERARCHY FIX: Mark Done is now the primary, solid action;
              Save and Report are secondary/ghost. A first-time user shouldn't have to
              read three equal-weight buttons to find the one they'll use most. */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {/* Mark Done — primary */}
            <button
              onClick={handleMarkReviewed}
              disabled={isReviewed}
              className={`flex items-center gap-1.5 text-xs font-semibold h-9 px-4 rounded-full transition-all active:scale-95 ${
                isReviewed || showDone
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200'
              }`}
            >
              <CheckCheck className={`w-3.5 h-3.5 ${showDone ? 'ed-done-pop' : ''}`} />
              {isReviewed || showDone ? 'Done!' : 'Mark done'}
            </button>

            {/* Save — secondary/ghost */}
            <button
              onClick={onToggleSave}
              className={`flex items-center gap-1 text-xs font-medium h-9 px-3 rounded-full transition-all active:scale-95 ${
                isSaved ? 'text-indigo-600' : 'text-gray-500 hover:text-indigo-500'
              }`}
            >
              {isSaved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              {isSaved ? 'Saved' : 'Save'}
            </button>

            {/* Report — secondary/ghost, least frequently used */}
            <button
              onClick={onFlag}
              disabled={isFlagged}
              className={`flex items-center gap-1 text-xs font-medium h-9 px-3 rounded-full transition-all active:scale-95 ${
                isFlagged ? 'text-gray-400 cursor-default' : 'text-gray-500 hover:text-rose-500'
              }`}
            >
              <Flag className="w-3 h-3" /> {isFlagged ? 'Reported' : 'Report'}
            </button>
          </div>
        </div>

        {/* Action pill switcher — replaces 2×2 menu grid */}
        <div className="px-5 pt-3">
          <ActionPillBar screen={screen} onSwitch={handleSwitch} actionResults={actionResults} />
        </div>

        {/* Content */}
        <div className="px-5 pb-3">

          {/* Explain / Solve */}
          {(screen === 'understand' || screen === 'solve') && (
            <div className="pt-2">
              {/* Manual trigger shown instead of auto-streaming when on a slow/metered connection */}
              {screen === 'understand' && reducedMotion && !actionResults.understand && displayed.status === 'idle' && (
                <button
                  onClick={() => startStream('understand', { force: true })}
                  className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-xl h-11 hover:bg-indigo-100 active:scale-[0.99] transition-all"
                >
                  <Lightbulb className="w-4 h-4" /> Generate explanation
                </button>
              )}
              {displayed.blocks.map((b, i) => (
                <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}>
                  <AiBlock content={b.content} streaming={b.streaming} />
                </div>
              ))}
              {displayed.status === 'thinking' && (
                <ThinkingIndicator label={screen === 'solve' ? 'Working through it' : 'Luna is thinking'} />
              )}
              {displayed.status === 'error' && errorBanner(displayed.errorMsg, () => startStream(screen, { force: true }))}
              {actionBusy && (
                <button onClick={stop} className="mt-3 flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors active:scale-95 h-9">
                  <StopCircle className="w-3.5 h-3.5" /> Stop
                </button>
              )}
              {(displayed.status === 'done' || displayed.status === 'error') && (
                <button onClick={() => startStream(screen, { force: true })} className="mt-2 flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors active:scale-95 h-9">
                  <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                </button>
              )}
            </div>
          )}

          {/* Chat */}
          {screen === 'chat' && (
            <div className="pt-2 space-y-4">
              {conversation.length === 0 && pendingMessage === null && (
                <div className="text-center py-8">
                  <Sparkles className="w-6 h-6 text-indigo-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 max-w-[220px] mx-auto leading-relaxed">
                    Ask anything about this question — StudyHub answers right here.
                  </p>
                </div>
              )}
              {conversation.map((turn) => (
                <div key={turn.id} className="space-y-2.5">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-indigo-600 text-white text-base leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5">
                      {turn.message}
                    </div>
                  </div>
                  <div>
                    {turn.blocks.map((b, i) => (
                      <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}>
                        <AiBlock content={b.content} streaming={false} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {pendingMessage !== null && (
                <div className="space-y-2.5">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-indigo-600 text-white text-base leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5">
                      {pendingMessage}
                    </div>
                  </div>
                  <div>
                    {liveBlocks.map((b, i) => (
                      <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}>
                        <AiBlock content={b.content} streaming={b.streaming} />
                      </div>
                    ))}
                    {liveStatus === 'thinking' && <ThinkingIndicator />}
                    {liveStatus === 'error' && errorBanner(liveError, () => {
                      const msg = pendingMessage; setRunningAction('chat')
                      run('/api/exam/question-action/stream', { action: 'ask', question: questionPayload, message: msg })
                    })}
                  </div>
                </div>
              )}
              {composerBusy && (
                <button onClick={stop} className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors active:scale-95 h-9">
                  <StopCircle className="w-3.5 h-3.5" /> Stop
                </button>
              )}
            </div>
          )}

          {/* Practice */}
          {screen === 'practice' && (
            <div className="pt-2 space-y-2.5">
              {!practiceLoading && (practiceQuestions?.length || practiceError) && (
                <div className="flex items-start gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 mb-1">
                  <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-violet-700 font-medium leading-snug">
                    AI-generated practice — similar style, not from an actual past paper.
                  </p>
                </div>
              )}
              {practiceLoading && (
                <>
                  <ThinkingIndicator label="Generating similar questions" />
                  {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
                </>
              )}
              {practiceError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700 ed-pop-in">
                  <p className="font-semibold mb-1">Couldn't generate questions</p>
                  <p className="text-xs opacity-80 mb-2">{practiceError}</p>
                  <button onClick={() => loadPractice({ force: true })} className="text-xs font-semibold text-rose-700 underline active:scale-95 h-9">Try again</button>
                </div>
              )}
              {practiceQuestions?.map((pq, i) => (
                <div key={i} className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-3.5 ed-pop-in" style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-violet-500 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Practice {i + 1}
                    </span>
                    {pq.marks != null && <span className="text-[11px] text-gray-500 font-medium">{pq.marks} marks</span>}
                  </div>
                  {/* Practice question text — font-normal, body reading size */}
                  <p className="text-base text-gray-900 leading-relaxed"><MathText text={pq.text} /></p>
                  {pq.hint && (
                    <p className="text-xs text-gray-600 mt-1.5 flex items-start gap-1">
                      <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {pq.hint}
                    </p>
                  )}
                </div>
              ))}
              {!practiceLoading && (
                <button onClick={() => loadPractice({ force: true })} className="mt-1 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline active:scale-95 h-9">
                  <RotateCcw className="w-3.5 h-3.5" /> New set
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat composer — pinned to bottom, only in chat mode */}
      {screen === 'chat' && (
        <form onSubmit={submitComposer} className="flex-shrink-0 border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask StudyHub about this question…"
            disabled={composerBusy}
            className="flex-1 text-base border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 transition-all"
          />
          {composerBusy ? (
            <button type="button" onClick={stop} className="w-11 h-11 flex-shrink-0 flex items-center justify-center bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 active:scale-95 transition-all">
              <StopCircle className="w-5 h-5" />
            </button>
          ) : (
            <button type="submit" disabled={!chatInput.trim()} className="w-11 h-11 flex-shrink-0 flex items-center justify-center bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      )}

      {/* Dot position indicator — replaces Prev/Next bar */}
      <DotIndicator questionList={questionList} currentId={question.id} />

      {/* Offered next-question action — replaces the old forced auto-advance timeout */}
      <ActionToast
        visible={showNextOffer}
        message="Marked done"
        actionLabel={hasNext ? 'Next question' : null}
        onAction={() => { setShowNextOffer(false); onNext() }}
        onDismiss={() => setShowNextOffer(false)}
      />
    </>
  )
}

// ── Action sheet wrapper ──────────────────────────────────────
const ActionSheet = memo(({
  question, questionList, onClose,
  savedIds, onToggleSave, flaggedIds, onFlag,
  isOnline, aiCache, reviewedIds, onMarkReviewed, onNavigate,
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
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90]" onClick={onClose} />
      <div className={`fixed z-[100] ed-slide-up ${isFull ? 'inset-0' : 'bottom-0 left-0 right-0'}`}>
        <div className={`bg-white shadow-2xl max-w-lg mx-auto overflow-hidden flex flex-col w-full ${isFull ? 'h-[100dvh] rounded-none' : 'rounded-t-3xl h-[72vh] sm:h-[76vh]'}`}>
          {/* Sheet handle row */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1 flex-shrink-0">
            <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:scale-90 transition-all">
              <X className="w-5 h-5" />
            </button>
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
            <button
              onClick={() => setSheetSize(isFull ? 'half' : 'full')}
              className="w-11 h-11 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:scale-90 transition-all"
              title={isFull ? 'Minimize' : 'Expand'}
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
    onClick={onToggle}
    className="w-9 h-9 flex items-center justify-center rounded-lg transition-all active:scale-90 hover:bg-gray-50"
    title={isSaved ? 'Remove from saved' : 'Save for revision'}
  >
    {isSaved
      ? <BookmarkCheck className="w-4 h-4 text-indigo-500" />
      : <Bookmark className="w-4 h-4 text-gray-300 hover:text-indigo-400" />}
  </button>
))

// content-visibility: auto defers paint for off-screen question blocks — key perf win on slow devices
const PaperSubItem = memo(({ label, text, marks, imageUrl, indent, onAskAi, isSaved, onToggleSave, needsReview, altLabel }) => (
  <div className={indent ? 'pl-4' : ''} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}>
    <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed">
      {label && <span className="font-semibold text-gray-600 mr-1.5">{label}.</span>}
      <MathText text={text} />
    </p>
    <div className="flex items-center justify-between mt-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {marks != null && <span className="text-sm text-gray-500 font-medium">({marks} marks)</span>}
        {needsReview && (
          <span title="Under review — use caution." className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full cursor-help">
            <ShieldAlert className="w-3 h-3" /> Under review
          </span>
        )}
      </div>
      {/* Condensed to two actions only — bookmark + Ask AI */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <BookmarkBtn isSaved={isSaved} onToggle={onToggleSave} />
        <button
          onClick={onAskAi}
          className="flex items-center gap-1 px-2.5 h-9 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-90 transition-all text-xs font-semibold"
        >
          <Sparkles className="w-3 h-3" /> Ask AI
        </button>
      </div>
    </div>
    {imageUrl && (
      <div className="mt-2 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
        <img src={imageUrl} alt={`Figure for question ${altLabel}`} className="w-full h-auto object-contain" loading="lazy" />
      </div>
    )}
  </div>
))

const PaperQuestionBlock = memo(({ group, onOpenQuestion, savedIds, onToggleSave, delay = 0 }) => {
  const rm = useReducedMotion()
  const hasSubParts = group.items.length > 1
  const singleQuestion = group.items[0]
  const inline = !hasSubParts ? parseInlineSubParts(singleQuestion?.text) : null
  const leadingStem = hasSubParts ? extractLeadingStem(group.items[0]?.text) : null
  const groupNeedsReview = group.items.some(q => q.needsReview)

  return (
    <div
      className={rm ? '' : 'ed-fade-up'}
      style={{ ...(rm ? undefined : { animationDelay: `${delay}ms` }), contentVisibility: 'auto', containIntrinsicSize: '0 160px' }}
    >
      <p className="font-bold text-gray-800 text-lg font-display mb-3">Question {group.number}:</p>
      {inline ? (
        <div>
          <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed"><MathText text={inline.stem} /></p>
          {singleQuestion.marks != null && <p className="text-sm text-gray-500 font-medium mt-0.5">({singleQuestion.marks} marks)</p>}
          <div className="mt-2 space-y-3 pl-4">
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
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <BookmarkBtn isSaved={savedIds?.has(singleQuestion.id)} onToggle={() => onToggleSave(singleQuestion)} />
            <button onClick={() => onOpenQuestion(singleQuestion)} className="flex items-center gap-1 px-2.5 h-9 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-90 transition-all text-xs font-semibold">
              <Sparkles className="w-3 h-3" /> Ask AI
            </button>
            {groupNeedsReview && (
              <span title="Under review." className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full cursor-help">
                <ShieldAlert className="w-3 h-3" /> Under review
              </span>
            )}
          </div>
        </div>
      ) : (
        <div>
          {leadingStem && <p className="text-base sm:text-[17px] text-gray-800 leading-relaxed mb-3"><MathText text={leadingStem.stem} /></p>}
          <div className="space-y-4">
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

// ── Review progress bar ───────────────────────────────────────
const ReviewProgressBar = memo(({ reviewed, total }) => {
  if (!total) return null
  const pct = Math.min(100, Math.round((reviewed / total) * 100))
  return (
    <div className="px-4 sm:px-8 pt-3 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1.5">
        <span className="flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5 text-indigo-400" /> {reviewed} of {total} done</span>
        <span className={pct === 100 ? 'text-emerald-500 font-bold' : ''}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-400' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
})

// ── Question list view ────────────────────────────────────────
const GROUP_PAGE_SIZE = 5

const QuestionListView = memo(({ paper, onOpenQuestion, savedIds, reviewedIds, onToggleSave }) => {
  const { data: rawRows = [], isLoading, error, refetch } = useQuery({
    queryKey: ['paperQuestions', paper?.paperId],
    queryFn: () => fetchQuestionsForPaper(paper?.paperId),
    enabled: !!paper?.paperId, staleTime: 5 * 60 * 1000,
  })
  const questions = useMemo(() => rawRows.map(normalizeDbQuestion).sort(naturalQuestionSort), [rawRows])
  const groups = useMemo(() => groupQuestionsForPaper(questions), [questions])
  const reviewedCount = useMemo(() => questions.filter(q => reviewedIds?.has(q.id)).length, [questions, reviewedIds])
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
      <ReviewProgressBar reviewed={reviewedCount} total={questions.length} />
      <div className="bg-white border-t border-b border-gray-100 px-4 sm:px-8 py-5 sm:py-6 w-full mt-3">
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
              <button onClick={() => onOpenQuestion(q, savedQuestions)} className="flex items-center gap-1 px-2.5 h-9 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-90 transition-all text-xs font-semibold whitespace-nowrap">
                <Sparkles className="w-3 h-3" /> Ask AI
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

  // Queries
  const { data: myProgramName } = useQuery({ queryKey: ['myProgramName', user?.id], queryFn: () => fetchUserProgramId(user?.id), enabled: !!user?.id })
  const { data: myProgramId } = useQuery({ queryKey: ['myProgramId', myProgramName], queryFn: () => fetchProgramIdByName(myProgramName), enabled: !!myProgramName })
  const { data: myCourses = [], isLoading: myCoursesLoading } = useQuery({ queryKey: ['myCourses', myProgramId], queryFn: () => fetchCoursesForProgram(myProgramId), enabled: !!myProgramId })
  const myCourseIds = useMemo(() => myCourses.map(c => c.id), [myCourses])
  const myCoursesResolving =
    (!!user?.id && myProgramName === undefined) ||
    (!!myProgramName && myProgramId === undefined) ||
    (!!myProgramId && myCoursesLoading)

  const { data: myQuestionRows = [], isLoading: myPapersLoading, error: myPapersError, refetch: refetchMyPapers } = useQuery({
    queryKey: ['myQuestions', myCourseIds],
    queryFn: () => fetchQuestionsForCourseIds(myCourseIds),
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
    enabled: !!currentCourse?.id,
  })
  const coursePapers = useMemo(() => groupQuestionsIntoPapers(coursePaperRows), [coursePaperRows])
  const sortedCoursePapers = useMemo(() => sortPapersRecentFirst(coursePapers), [coursePapers])

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
    setActiveEntry({ question, list })
  }, [])

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
      <div className="h-screen overflow-y-auto bg-white pb-20 lg:pb-0 w-full no-scrollbar">

        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-100">
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

          {currentView === 'questions' && <StudyModeBar activeMode={studyMode} onChange={setStudyMode} />}
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
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your courses</p>
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
                        reviewedCount={reviewedCountFor(courseQIds)}
                        totalCount={courseQIds.length}
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
            <>
              {studyMode === 'papers' && (
                coursePapersLoading ? (
                  <div className="px-4 pt-2 space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                ) : coursePapersError ? (
                  <ErrorState onRetry={() => refetchCoursePapers()} message={coursePapersError.message} />
                ) : !sortedCoursePapers.length ? (
                  <EmptyState label="No past papers for this course yet" />
                ) : (
                  <>
                    <PaperSwitcher papers={sortedCoursePapers} currentPaperId={currentPaper?.paperId} onSelect={setCurrentPaper} />
                    {currentPaper && (
                      <QuestionListView
                        paper={currentPaper}
                        onOpenQuestion={handleOpenQuestion}
                        savedIds={savedQuestionIds}
                        reviewedIds={reviewedIds}
                        onToggleSave={handleToggleSave}
                      />
                    )}
                  </>
                )
              )}
              {studyMode === 'exam-focus' && (
                <ExamFocusPanel courseId={currentCourse?.id} onOpenSampleQuestion={(q) => handleOpenQuestion(q)} />
              )}
              {studyMode === 'last-minute' && (
                <LastMinutePanel courseId={currentCourse?.id} onOpenQuestion={handleOpenQuestion} />
              )}
            </>
          )}
        </div>

        <ActionSheet
          question={activeEntry?.question ?? null}
          questionList={activeEntry?.list ?? null}
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
        <BottomNav />
      </div>
    </MotionContext.Provider>
  )
}