// ============================================================
// Quiz.jsx — Study Mode / Exam Mode architecture (Phases 2–31)
//
// v16 — UX audit round 2 (priority fixes):
//   P0 • Dead-end error screens now carry a real CTA (Go to Settings / Retry)
//        instead of prose with nowhere to go.
//   P0 • "Resume session" moved from sessionStorage → localStorage with a
//        6-hour expiry, so it survives an actual tab/app close instead of
//        silently failing at the exact moment it's needed.
//   P0 • Setup screen now shows an inline "no questions yet" banner with a
//        CTA instead of a fire-and-forget toast.
//   P1 • MCQ options, textarea, and photo upload are now disabled while an
//        answer is being graded — no more editing an answer mid-grade.
//   P1 • Grade colors for D/F switched from alarm-red to warm amber/orange
//        so the color channel matches the growth-mindset copy instead of
//        contradicting it.
//   P2 • Added a "What's the difference?" expander on the Study/Exam picker
//        so first-timers aren't guessing at a consequential choice.
//   P2 • Exam grading screen now shows "X of Y graded" with a real progress
//        bar, not just cycling copy over an indeterminate spinner.
//   P3 • Attempt number is now visible on the FeedbackCard itself, and the
//        retry button relabels once a fresh question is about to be served.
//
// v16.1 — UX polish (end‑of‑quiz & grading feedback):
//   • Study Mode: "Continue" → "See Results" on the last question.
//   • Checking / marking messages expanded with encouraging, progress‑oriented
//     phrases and animated dots for a more responsive feel.
//
// v15 — UX/UI audit fixes applied:
//   • Inter font loaded for reading-quality typography
//   • explanationBox text 13px → 16px, lineHeight → 1.75
//   • Escalation buttons 11px → 13px
//   • ReviewCard chevron direction corrected (ChevronDown/Up)
//   • Failure-state copy → growth-mindset language
//   • Uncertain verdict label + copy reframed
//   • Continue button deduped arrow icon
//   • checkAnswer card pulse + spinner during AI grading
//   • Results CTA buttons moved above review list
//   • Home stats consolidated into a single compact strip
//   • ExplainControl progressive disclosure fixed per level
//   • Exit button icon-text gap made consistent
//
// ============================================================
import React, {
  useState, useEffect, useCallback, useReducer, useRef, useMemo,
  useTransition, Suspense, memo,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import 'katex/dist/katex.min.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { MathText } from './math-fix.jsx';

import {
  BookOpen,
  ClipboardList,
  Target,
  CheckCircle,
  PenTool,
  RefreshCw,
  Flame,
  Zap,
  Trophy,
  Flag,
  Book,
  Camera,
  Paperclip,
  Clipboard,
  DoorClosed,
  LogOut,
  AlertTriangle,
  FolderOpen,
  Lightbulb,
  Check,
  X,
  HelpCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Image,
  FileEdit,
  Send,
  Home,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Sparkles,
  GraduationCap,
  Award,
  BarChart,
  Layers,
  Settings as SettingsIcon,
  Info,
} from 'lucide-react';

// ─── Design tokens ──────────────────────────────────────────
const C = {
  bg: '#f0f6ff', card: '#ffffff',
  primary: '#2563eb', primaryDark: '#1d4ed8',
  primaryLight: '#dbeafe', primaryMuted: '#eff6ff',
  success: '#059669', successLight: '#d1fae5',
  error: '#dc2626', errorLight: '#fee2e2',
  warning: '#d97706', warningLight: '#fef3c7',
  encourage: '#c2410c', encourageLight: '#ffedd5',
  partial: '#7c3aed', partialLight: '#f3e8ff',
  uncertain: '#64748b', uncertainLight: '#f1f5f9',
  border: '#e2e8f0', text: '#0f172a',
  textMuted: '#64748b', textLight: '#94a3b8',
  overlay: 'rgba(15,23,42,0.5)', disabled: '#94a3b8',
};

const FONT_STACK = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const TYPE = {
  micro: 11, label: 13, body: 16, h3: 18, h3lg: 20, h2: 22, h1: 28,
};
const WEIGHT = { regular: 400, medium: 500, bold: 700 };
const SPACE = { xs: 4, sm: 8, md: 12, md2: 14, lg: 16, lg2: 18, xl: 24, xxl: 32 };
const TAP = 44;

const CATEGORY_PALETTE = [
  { bg: '#eff6ff', fg: '#2563eb' }, { bg: '#ecfdf5', fg: '#059669' },
  { bg: '#fdf4ff', fg: '#a21caf' }, { bg: '#fff7ed', fg: '#d97706' },
  { bg: '#f0f9ff', fg: '#0891b2' }, { bg: '#fef2f2', fg: '#dc2626' },
];

// ─── Verdict presentation ───────────────────────────────────
const VERDICT_META = {
  correct:   { icon: Check,       label: 'Correct',             color: C.success,   bg: C.successLight },
  partial:   { icon: Minus,       label: 'Almost there',        color: C.partial,   bg: C.partialLight },
  incorrect: { icon: X,           label: 'Not quite',           color: C.error,     bg: C.errorLight },
  uncertain: { icon: HelpCircle,  label: 'Need more detail',    color: C.uncertain, bg: C.uncertainLight },
};

// ─── Static style objects ──────────────────────────────────
const S = {
  pageMax: { maxWidth: 480, margin: '0 auto' },
  backBtn: {
    display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
    padding: '10px 16px', borderRadius: 10, background: 'none',
    border: `1px solid ${C.border}`, color: C.text, fontSize: TYPE.label,
    cursor: 'pointer', minHeight: TAP,
  },
  card: { background: C.card, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardSoft: { background: C.card, borderRadius: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
  progressTrack: (h) => ({ height: h, borderRadius: h / 2, background: C.border, overflow: 'hidden' }),
  progressFill: (color) => ({ height: '100%', background: color, borderRadius: 'inherit', transition: 'width 0.4s ease' }),
  modalOverlay: {
    position: 'fixed', inset: 0, background: C.overlay, display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: SPACE.lg,
  },
  modalCard: {
    background: C.card, borderRadius: 20, padding: '28px 24px', maxWidth: 340,
    width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  modalTitle: { textAlign: 'center', color: C.text, margin: `0 0 ${SPACE.xs}px`, fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold },
  modalBody: { textAlign: 'center', color: C.textMuted, fontSize: TYPE.label, lineHeight: 1.5, margin: '0 0 4px' },
  modalRow: { display: 'flex', gap: SPACE.md2, marginTop: SPACE.xl },
  modalBtnGhost: {
    flex: 1, padding: '13px', borderRadius: 12, border: `1.5px solid ${C.border}`,
    background: 'none', color: C.text, fontWeight: WEIGHT.medium, cursor: 'pointer',
    fontSize: TYPE.label, minHeight: TAP,
  },
  primaryBtn: {
    width: '100%', padding: '16px', borderRadius: 14, background: C.primary,
    color: '#fff', border: 'none', fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold,
    cursor: 'pointer', minHeight: TAP,
  },
  whyPill: {
    display: 'inline-flex', alignItems: 'center', gap: SPACE.xs + 2,
    padding: '10px 14px', borderRadius: 20, fontSize: TYPE.label,
    fontWeight: WEIGHT.medium, lineHeight: 1.3, minHeight: TAP,
  },
  explanationBox: {
    marginTop: SPACE.md2, padding: '14px 16px', background: C.primaryMuted,
    borderRadius: 10, fontSize: TYPE.body, color: C.text, lineHeight: 1.75,
  },
  inlineBanner: {
    display: 'flex', alignItems: 'flex-start', gap: SPACE.md, padding: '14px 16px',
    borderRadius: 12, background: C.warningLight, border: `1px solid #fde68a`,
    marginBottom: SPACE.lg,
  },
};

// ─── In-memory cache ────────────────────────────────────────
const quizCache = new Map();
const QUIZ_CACHE_MAX_ENTRIES = 20;
const setQuizCacheEntry = (key, value) => {
  if (quizCache.size >= QUIZ_CACHE_MAX_ENTRIES && !quizCache.has(key)) {
    const oldestKey = quizCache.keys().next().value;
    if (oldestKey !== undefined) quizCache.delete(oldestKey);
  }
  quizCache.set(key, value);
};
const invalidateSubjectCache = (courseId) => {
  for (const key of quizCache.keys()) {
    if (key.startsWith(`${courseId}_`)) quizCache.delete(key);
  }
};

// ─── Pending-submission queue (Exam Mode) ──────────────────
const PENDING_SUBMISSIONS_KEY = 'studyhub_pending_submissions';
const readPendingSubmissions = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_SUBMISSIONS_KEY) || '[]'); }
  catch { return []; }
};
const writePendingSubmissions = (items) => {
  try { localStorage.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(items)); } catch {}
};
const enqueuePendingSubmission = (payload) => {
  const items = readPendingSubmissions();
  items.push({ ...payload, _queuedAt: Date.now() });
  writePendingSubmissions(items);
};
async function flushPendingSubmissions(baseUrl, token) {
  if (!token || !navigator.onLine) return { flushed: 0, remaining: readPendingSubmissions().length };
  const items = readPendingSubmissions();
  if (!items.length) return { flushed: 0, remaining: 0 };
  const stillPending = [];
  let flushed = 0;
  for (const item of items) {
    const { _queuedAt, ...payload } = item;
    try {
      const res = await fetch(`${baseUrl}/api/exam/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) flushed++; else stillPending.push(item);
    } catch { stillPending.push(item); }
  }
  writePendingSubmissions(stillPending);
  return { flushed, remaining: stillPending.length };
}

// ─── sessionStorage cache (subjects list only — safe to lose on tab close) ──
const QUIZ_SETUP_CACHE_KEY = 'quizSetupCache';
const readQuizSetupCache = () => {
  try { const raw = sessionStorage.getItem(QUIZ_SETUP_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
};
const writeQuizSetupCache = (data) => {
  try { sessionStorage.setItem(QUIZ_SETUP_CACHE_KEY, JSON.stringify(data)); } catch {}
};

// ─── FIX (P0): in-progress quiz state — localStorage, not sessionStorage ───
const QUIZ_RESUME_KEY = 'studyhub_quiz_state';
const QUIZ_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const readQuizResume = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(QUIZ_RESUME_KEY) || 'null');
    if (!raw) return null;
    if (!raw._savedAt || Date.now() - raw._savedAt > QUIZ_RESUME_MAX_AGE_MS) {
      localStorage.removeItem(QUIZ_RESUME_KEY);
      return null;
    }
    return raw;
  } catch { return null; }
};
const writeQuizResume = (data) => {
  try { localStorage.setItem(QUIZ_RESUME_KEY, JSON.stringify({ ...data, _savedAt: Date.now() })); } catch {}
};
const clearQuizResume = () => { try { localStorage.removeItem(QUIZ_RESUME_KEY); } catch {} };

// ─── Error Boundary ─────────────────────────────────────────
class QuizErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding: SPACE.xxl, textAlign: 'center' }}>
        <AlertTriangle size={48} color={C.error} style={{ margin: '0 auto' }} />
        <h3 style={{ color: C.error, fontSize: TYPE.h2, fontWeight: WEIGHT.bold }}>Something went wrong</h3>
        <p style={{ color: C.textMuted, fontSize: TYPE.body, lineHeight: 1.5 }}>{this.state.error?.message}</p>
        <button onClick={() => window.location.reload()} style={S.primaryBtn}>Reload</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── SMILES Canvas ──────────────────────────────────────────
const SmilesCanvas = memo(({ smiles, width = 280, height = 180 }) => {
  const ref = useRef(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!ref.current || !smiles || err) return;
    let cancelled = false;
    import('smiles-drawer')
      .then(({ default: SmilesDrawer }) => {
        if (cancelled || !ref.current) return;
        try {
          const d = new SmilesDrawer.Drawer({ width, height, bondThickness: 1.4 });
          SmilesDrawer.parse(smiles, tree => d.draw(tree, ref.current, 'light', false), () => setErr(true));
        } catch { setErr(true); }
      })
      .catch(() => setErr(true));
    return () => { cancelled = true; };
  }, [smiles, width, height, err]);
  if (!smiles) return null;
  if (err) return <span style={{ fontSize: TYPE.label, color: C.textMuted }}>Structure unavailable</span>;
  return <canvas ref={ref} width={width} height={height} style={{ maxWidth: '100%', borderRadius: 8 }} />;
});

// ─── Question Display ───────────────────────────────────────
const QuestionDisplay = memo(({ question, hideDiagram }) => {
  const { question: text, latex_math, smiles, image_url, question_type } = question;
  const isDiagram = question_type === 'diagram';
  return (
    <div>
      <div style={{ fontSize: TYPE.body, lineHeight: 1.7, color: C.text }}>
        <MathText text={text} />
      </div>
      {latex_math && !text?.includes('$') && (
        <div style={{ margin: `${SPACE.md}px 0`, padding: SPACE.md, background: C.primaryMuted, borderRadius: 10 }}>
          <MathText text={latex_math} />
        </div>
      )}
      {smiles && !isDiagram && (
        <div style={{ margin: `${SPACE.md}px 0`, textAlign: 'center' }}><SmilesCanvas smiles={smiles} /></div>
      )}
      {isDiagram && hideDiagram && (
        <div style={{ margin: `${SPACE.md}px 0`, padding: '12px 16px', background: C.warningLight, borderRadius: 10, fontSize: TYPE.label, color: C.warning, fontWeight: WEIGHT.medium, lineHeight: 1.5 }}>
          <PenTool size={16} style={{ display: 'inline', marginRight: SPACE.xs }} /> Draw your answer on paper and upload a photo below
        </div>
      )}
      {image_url && (
        <img src={image_url} alt="Question diagram" style={{ maxWidth: '100%', borderRadius: 10, marginTop: SPACE.md }} loading="lazy" />
      )}
    </div>
  );
});

// ─── Helpers ─────────────────────────────────────────────────
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const compressImage = (file, maxW = 800, maxH = 800, q = 0.72) =>
  new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width: w, height: h } = img;
        if (w > maxW || h > maxH) { const r = Math.min(maxW / w, maxH / h); w *= r; h *= r; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? res(b) : rej(new Error('Blob null')), 'image/jpeg', q);
      };
      img.onerror = rej;
      img.src = e.target.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });

const getGrade = (pct) => {
  if (pct >= 80) return { letter: 'A', label: 'Excellent',                     color: C.success,   bg: C.successLight };
  if (pct >= 70) return { letter: 'B', label: 'Good work',                     color: '#0891b2',    bg: '#e0f2fe' };
  if (pct >= 60) return { letter: 'C', label: 'Solid progress',                color: C.warning,    bg: C.warningLight };
  if (pct >= 50) return { letter: 'D', label: 'Needs more practice',           color: C.encourage,  bg: C.encourageLight };
  return         { letter: 'F', label: 'Additional review recommended',        color: C.encourage,  bg: C.encourageLight };
};

const BADGES = [
  { id: 'first_quiz',  label: 'First Quiz',    icon: Flag,   check: s => s.completed >= 1 },
  { id: 'streak_3',   label: '3-Day Streak',  icon: Flame,  check: s => s.streak >= 3 },
  { id: 'streak_7',   label: '7-Day Streak',  icon: Zap,    check: s => s.streak >= 7 },
  { id: 'master_90',  label: 'Mastery 90%',   icon: Trophy, check: s => s.totalQ > 0 && s.totalCorrect / s.totalQ >= 0.9 },
  { id: '100_questions', label: '100 Questions', icon: Book, check: s => s.totalQ >= 100 },
];

// ─── Toast ────────────────────────────────────────────────────
const Toast = memo(({ toasts, removeToast }) => (
  <div style={{ position: 'fixed', bottom: 90, right: SPACE.lg, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
    {toasts.map(t => (
      <div key={t.id} style={{
        padding: '10px 10px 10px 14px', borderRadius: 10, fontSize: TYPE.label, fontWeight: WEIGHT.medium, lineHeight: 1.4,
        background: t.type === 'error' ? C.error : t.type === 'success' ? C.success : C.primary,
        color: '#fff', display: 'flex', alignItems: 'center', gap: SPACE.sm,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 300,
      }}>
        <span style={{ flex: 1 }}>{t.message}</span>
        <button onClick={() => removeToast(t.id)} aria-label="Dismiss"
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1, width: TAP, height: TAP, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
      </div>
    ))}
  </div>
));

// ─── Quiz reducer ────────────────────────────────────────────
const initState = { questions: [], currentIndex: 0, answers: {}, phase: 'idle', results: null };

function reducer(state, action) {
  switch (action.type) {
    case 'START':        return { questions: action.questions, currentIndex: 0, answers: {}, phase: 'active', results: null };
    case 'ANSWER':       return { ...state, answers: { ...state.answers, [action.index]: action.value } };
    case 'GO_TO':        return { ...state, currentIndex: Math.max(0, Math.min(action.index, state.questions.length - 1)) };
    case 'NEXT':         return state.currentIndex < state.questions.length - 1 ? { ...state, currentIndex: state.currentIndex + 1 } : state;
    case 'PREV':         return state.currentIndex > 0 ? { ...state, currentIndex: state.currentIndex - 1 } : state;
    case 'SWAP_CURRENT': {
      const qs = [...state.questions];
      qs[state.currentIndex] = action.question;
      const answers = { ...state.answers };
      delete answers[state.currentIndex];
      return { ...state, questions: qs, answers };
    }
    case 'GRADING':  return { ...state, phase: 'grading' };
    case 'DONE':     return { ...state, phase: 'done', results: action.results };
    case 'RESTORE':  return { questions: action.q, currentIndex: action.idx, answers: action.ans, phase: 'active', results: null };
    case 'RESET':    return initState;
    default:         return state;
  }
}

// ─── Review Card (Exam Mode results) ───────────────────────
const ReviewCard = memo(({ detail, index }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 12, marginBottom: SPACE.md, overflow: 'hidden', border: `1px solid ${detail.isCorrect ? '#bbf7d0' : '#fecaca'}` }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.md, textAlign: 'left', minHeight: TAP }}>
        <span style={{ fontSize: 18 }}>{detail.isCorrect ? <Check size={18} color={C.success} /> : <X size={18} color={C.error} />}</span>
        <span style={{ flex: 1, fontSize: TYPE.body, color: C.text, fontWeight: WEIGHT.medium, lineHeight: 1.5 }}>
          Q{index + 1}: <MathText text={(detail.question || '').substring(0, 80) + ((detail.question || '').length > 80 ? '…' : '')} />
        </span>
        <span style={{ color: C.textMuted }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ marginTop: SPACE.md }}>
            <div style={{ fontSize: TYPE.label, color: C.textMuted, marginBottom: SPACE.xs }}>Your answer:</div>
            <div style={{ fontSize: TYPE.body, color: detail.isCorrect ? C.success : C.error, fontWeight: WEIGHT.medium, lineHeight: 1.5 }}>
              {detail.userAnswerText || <em style={{ color: C.textMuted }}>No answer given</em>}
            </div>
          </div>
          {!detail.isCorrect && (
            <div style={{ marginTop: SPACE.md }}>
              <div style={{ fontSize: TYPE.label, color: C.textMuted, marginBottom: SPACE.xs }}>Correct answer:</div>
              <div style={{ fontSize: TYPE.body, color: C.success, fontWeight: WEIGHT.medium, lineHeight: 1.5 }}>
                <MathText text={detail.correctAnswerText || ''} />
              </div>
              {detail.smiles && (
                <div style={{ marginTop: SPACE.sm, textAlign: 'center' }}><SmilesCanvas smiles={detail.smiles} width={240} height={150} /></div>
              )}
            </div>
          )}
          {detail.explanation && (
            <div style={S.explanationBox}><Lightbulb size={16} style={{ display: 'inline', marginRight: SPACE.xs }} /> <MathText text={detail.explanation} /></div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Skeletons ──────────────────────────────────────────────
const HomeSkeleton = () => (
  <div style={{ ...S.pageMax, padding: `${SPACE.xl}px ${SPACE.lg}px ${SPACE.xl}px` }}>
    <div style={{ marginBottom: SPACE.xl }}>
      <div className="animate-pulse" style={{ height: 16, width: 120, background: '#e2e8f0', borderRadius: 4 }} />
      <div className="animate-pulse" style={{ height: 28, width: 160, background: '#e2e8f0', borderRadius: 4, marginTop: SPACE.sm }} />
    </div>
    <div className="animate-pulse" style={{ background: C.card, borderRadius: 16, padding: '18px 20px', marginBottom: SPACE.lg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: SPACE.sm }}>
        <div style={{ height: 16, width: 100, background: '#e2e8f0', borderRadius: 4 }} />
        <div style={{ height: 24, width: 40, background: '#e2e8f0', borderRadius: 4 }} />
      </div>
      <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4 }} />
      <div style={{ marginTop: SPACE.sm, height: 12, width: 140, background: '#e2e8f0', borderRadius: 4 }} />
    </div>
    {[1, 2, 3].map(i => (
      <div key={i} className="animate-pulse" style={{ background: C.card, borderRadius: 14, padding: '14px 18px', marginBottom: SPACE.md, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md2 }}>
          <div style={{ width: 28, height: 28, background: '#e2e8f0', borderRadius: 8 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 16, width: '60%', background: '#e2e8f0', borderRadius: 4 }} />
            <div style={{ height: 12, width: '40%', background: '#e2e8f0', borderRadius: 4, marginTop: SPACE.xs }} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const SetupSkeleton = () => (
  <div style={{ ...S.pageMax, padding: `${SPACE.xl}px ${SPACE.lg}px` }}>
    <div className="animate-pulse" style={{ height: 36, width: 100, background: '#e2e8f0', borderRadius: 10, marginBottom: SPACE.xl }} />
    <div className="animate-pulse" style={{ height: 28, width: '60%', background: '#e2e8f0', borderRadius: 4, marginBottom: SPACE.xs }} />
    <div className="animate-pulse" style={{ height: 14, width: '40%', background: '#e2e8f0', borderRadius: 4, marginBottom: SPACE.xl }} />
    {[1, 2, 3].map(i => (
      <div key={i} className="animate-pulse" style={{ background: C.card, borderRadius: 14, padding: '14px 16px', marginBottom: SPACE.md, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: SPACE.md }}>
          <div style={{ width: 22, height: 22, background: '#e2e8f0', borderRadius: 4 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 16, width: '50%', background: '#e2e8f0', borderRadius: 4 }} />
            <div style={{ height: 12, width: '70%', background: '#e2e8f0', borderRadius: 4, marginTop: SPACE.xs }} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─── Marking / checking messages ─────────────────────────────
const MARKING_MESSAGES = [
  'Reviewing all your answers…',
  'Marking each question…',
  'Checking your reasoning and approach…',
  'Identifying strengths and areas to improve…',
  'Recording weak spots for your next session…',
  'Compiling your results…',
];

const CHECKING_MESSAGES = [
  'Reviewing your answer…',
  'Marking your work…',
  'Checking your reasoning…',
  'Finalising feedback…',
];

// ─── Why control (Phase 8/9) ────────────────────────────────
const ExplainControl = ({ verdict, onFetch, disabled, disabledHint }) => {
  const [level, setLevel] = useState(0);
  const [text, setText] = useState({});
  const [loading, setLoading] = useState(false);

  const label = verdict === 'correct' ? 'Why is this right?'
    : verdict === 'partial' ? 'What am I missing?'
    : 'Why was I wrong?';

  const openLevel = async (lvl) => {
    setLevel(lvl);
    if (text[lvl]) return;
    setLoading(true);
    try {
      const result = await onFetch(lvl);
      setText(p => ({ ...p, [lvl]: result }));
    } catch {
      setText(p => ({ ...p, [lvl]: "Couldn't load an explanation right now." }));
    } finally { setLoading(false); }
  };

  if (disabled) {
    return (
      <button disabled title={disabledHint}
        style={{ ...S.whyPill, border: `1px solid ${C.border}`, background: '#f8fafc', color: C.textLight, cursor: 'default' }}>
        <Lightbulb size={16} style={{ marginRight: SPACE.xs }} /> {disabledHint || label}
      </button>
    );
  }

  return (
    <div>
      <button onClick={() => (level ? setLevel(0) : openLevel(1))}
        style={{ ...S.whyPill, border: `1px solid ${C.primaryLight}`, background: C.primaryMuted, color: C.primary, cursor: 'pointer' }}>
        <Lightbulb size={16} style={{ marginRight: SPACE.xs }} /> {level ? 'Hide explanation' : label}
      </button>
      {level > 0 && (
        <div style={S.explanationBox}>
          {loading
            ? <span style={{ color: C.textMuted, fontSize: TYPE.body }}>Thinking…</span>
            : <MathText text={text[level] || ''} />
          }
          {!loading && (
            <div style={{ marginTop: SPACE.lg, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              {level === 1 && (
                <>
                  <div style={{ fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.medium }}>Want a deeper explanation?</div>
                  <button onClick={() => openLevel(2)}
                    style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${C.primaryLight}`, background: '#fff', color: C.primary, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: 'pointer', textAlign: 'left' }}>
                    Explain step by step
                  </button>
                </>
              )}
              {level === 2 && (
                <>
                  <div style={{ fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.medium }}>Want to fully understand this concept?</div>
                  <button onClick={() => openLevel(3)}
                    style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${C.primaryLight}`, background: '#fff', color: C.primary, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: 'pointer', textAlign: 'left' }}>
                    Teach me this topic
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Feedback Card (Phase 7) ────────────────────────────────
// FIX (P3): accepts `attemptNumber` and surfaces it directly on the card,
// plus relabels the retry action once the next retry will swap in a fresh
// question (matches the tryAgain logic: swap happens once count >= 2).
// FIX (v16.1): added `isLastQuestion` prop to change "Continue" → "See Results".
// FIX (v17): added `loading` prop so the primary action gives immediate
// feedback instead of appearing to do nothing while results are saved.
const FeedbackCard = ({
  graded,
  attemptNumber,
  onTryAgain,
  onContinue,
  onExplainFetch,
  onHint,
  hint,
  hintLoading,
  canRetry,
  isLastQuestion = false,
  loading = false,
}) => {
  const meta = VERDICT_META[graded.verdict] || VERDICT_META.uncertain;
  const Icon = meta.icon;
  const willSwapQuestion = attemptNumber >= 2;
  return (
    <div style={{ ...S.card, padding: SPACE.xl, marginBottom: SPACE.lg, border: `1.5px solid ${meta.color}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, marginBottom: SPACE.md }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={18} />
          </span>
          <span style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: meta.color }}>{meta.label}</span>
        </div>
        {attemptNumber > 1 && (
          <span style={{ fontSize: TYPE.micro, fontWeight: WEIGHT.medium, color: C.textMuted, background: '#f1f5f9', padding: '4px 10px', borderRadius: 12, flexShrink: 0 }}>
            Attempt {attemptNumber}
          </span>
        )}
      </div>

      <div style={{ fontSize: TYPE.body, color: C.text, lineHeight: 1.6, marginBottom: SPACE.md }}>
        <MathText text={graded.feedback} />
      </div>

      {graded.strengths?.length > 0 && (
        <div style={{ marginBottom: SPACE.sm }}>
          {graded.strengths.map((s, i) => (
            <div key={i} style={{ fontSize: TYPE.label, color: C.success, lineHeight: 1.6 }}><Check size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> {s}</div>
          ))}
        </div>
      )}
      {graded.missing_concepts?.length > 0 && (
        <div style={{ marginBottom: SPACE.md }}>
          {graded.missing_concepts.map((s, i) => (
            <div key={i} style={{ fontSize: TYPE.label, color: C.textMuted, lineHeight: 1.6 }}><Minus size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> {s}</div>
          ))}
        </div>
      )}

      {graded.verdict === 'uncertain' && (
        <div style={{ fontSize: TYPE.micro, color: C.uncertain, marginBottom: SPACE.md, lineHeight: 1.6, padding: '10px 12px', background: C.uncertainLight, borderRadius: 8 }}>
          <HelpCircle size={14} style={{ display: 'inline', marginRight: SPACE.xs }} />
          We need a bit more detail to assess your answer — try adding one more sentence explaining your reasoning. For drawings, a clearer photo helps. This attempt won't count against your mastery.
        </div>
      )}

      {hint && (
        <div style={{ ...S.explanationBox, background: C.warningLight, marginBottom: SPACE.md }}><Lightbulb size={16} style={{ display: 'inline', marginRight: SPACE.xs }} /> Hint: {hint}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.md }}>
        {canRetry && (
          <button onClick={onTryAgain} disabled={loading}
            style={{ padding: '10px 16px', borderRadius: 20, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: loading ? 'default' : 'pointer', minHeight: TAP, opacity: loading ? 0.6 : 1 }}>
            <RotateCw size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> {willSwapQuestion ? 'Try a fresh question' : 'Try again'}
          </button>
        )}
        {canRetry && !hint && (
          <button onClick={onHint} disabled={hintLoading || loading}
            style={{ padding: '10px 16px', borderRadius: 20, border: `1px solid ${C.warning}55`, background: '#fff', color: C.warning, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: (hintLoading || loading) ? 'default' : 'pointer', minHeight: TAP, opacity: loading ? 0.6 : 1 }}>
            {hintLoading
              ? <><Loader2 size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> Loading hint…</>
              : <><Lightbulb size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> Hint</>
            }
          </button>
        )}
        {graded.verdict !== 'uncertain' && (
          <ExplainControl verdict={graded.verdict} onFetch={onExplainFetch} disabled={loading} />
        )}
      </div>

      {canRetry && willSwapQuestion && (
        <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginBottom: SPACE.md, lineHeight: 1.5 }}>
          Trying again now will swap in a new question on the same concept, so you're not just re-answering the one you already saw.
        </div>
      )}

      {/* FIX: shows a real loading state instead of appearing unresponsive
          while the last question's results are being saved. */}
      <button onClick={onContinue} disabled={loading}
        style={{ ...S.primaryBtn, background: loading ? C.disabled : C.primary, fontSize: TYPE.h3, cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm }}>
        {loading
          ? <><Loader2 size={18} className="animate-spin" /> {isLastQuestion ? 'Preparing your results…' : 'Loading…'}</>
          : <><ArrowRight size={18} /> {isLastQuestion ? 'See Results' : 'Continue'}</>
        }
      </button>
    </div>
  );
};

// ─── Mode select card (Phase 2) ─────────────────────────────
const ModeCard = ({ icon: Icon, title, subtitle, selected, onClick }) => (
  <button onClick={onClick}
    style={{
      width: '100%', textAlign: 'left', padding: '18px 20px', borderRadius: 16, cursor: 'pointer',
      border: `2px solid ${selected ? C.primary : C.border}`, background: selected ? C.primaryMuted : C.card,
      display: 'flex', alignItems: 'center', gap: SPACE.md2, marginBottom: SPACE.md,
    }}>
    <Icon size={28} color={selected ? C.primary : C.text} />
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: selected ? C.primary : C.text }}>{title}</div>
      <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>
    </div>
    {selected && <Check size={20} color={C.primary} />}
  </button>
);

// ─── Progressive-disclosure option row (setup screen) ───────
// A single "default" option is shown as a full ModeCard; anything else
// lives behind a one-line "Show other options" toggle. Selecting a
// non-default option keeps that section expanded on return, so the
// active choice is never hidden from the user (Nielsen: visibility of
// system status).
const DisclosureToggle = ({ expanded, onClick, expandLabel, collapseLabel }) => (
  <button onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, background: 'none', border: 'none',
      color: C.primary, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: 'pointer',
      padding: '6px 0', marginTop: SPACE.xs, marginBottom: SPACE.md,
    }}>
    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
    {expanded ? collapseLabel : expandLabel}
  </button>
);

// ─── Main Quiz Component ────────────────────────────────────
const Quiz = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  // ── ONE-TIME CLICK RULE (processing guard) ──────────────────
  const processingRef = useRef(new Set());
  const [processing, setProcessing] = useState(new Set());

  const startProcessing = useCallback((id) => {
    if (processingRef.current.has(id)) return false;
    processingRef.current.add(id);
    setProcessing(new Set(processingRef.current));
    return true;
  }, []);

  const stopProcessing = useCallback((id) => {
    processingRef.current.delete(id);
    setProcessing(new Set(processingRef.current));
  }, []);

  const isProcessing = useCallback((id) => processing.has(id), [processing]);

  // ── Other state ──────────────────────────────────────────────
  const initialSetupCache = useMemo(readQuizSetupCache, []);

  const [screen, setScreen] = useState('home');
  const [loading, setLoading] = useState(!initialSetupCache?.subjects);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState('generic');

  const [subjects, setSubjects] = useState(initialSetupCache?.subjects || {});
  const [currentSubjectId, setCurrentSubjectId] = useState(null);
  const [setupCount, setSetupCount] = useState(10);
  // Multiple Choice is the default, always-visible question style (FIX: was
  // 'auto' plus a first-timer-only override — now consistent for everyone).
  const [setupMode, setSetupMode] = useState('mcq');
  const [modeExpanded, setModeExpanded] = useState(false);
  const [styleExpanded, setStyleExpanded] = useState(false);
  const [showModeExplain, setShowModeExplain] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // Study is the default, always-visible practice mode.
  const [quizMode, setQuizMode] = useState('study');

  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ completed: 0, totalCorrect: 0, totalQ: 0, streak: 0, lastActivity: null, badges: [] });
  const [lastSession, setLastSession] = useState(null);
  const [prevSession, setPrevSession] = useState(null);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [weakTopics, setWeakTopics] = useState([]);
  const dailyGoal = 10;

  const [textAnswers, setTextAnswers] = useState({});
  const [imageData, setImageData] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingResume, setPendingResume] = useState(null);

  const [subjectSearch, setSubjectSearch] = useState('');
  const [markingMsgIndex, setMarkingMsgIndex] = useState(0);
  const [gradingProgress, setGradingProgress] = useState({ done: 0, total: 0 });

  // FIX (v17): explicit "finishing up" state for Study Mode's last question,
  // so the See Results click always produces a visible, immediate response.
  const [finishingSession, setFinishingSession] = useState(false);

  const [attempts, setAttempts] = useState({});
  const getAttempt = (idx) => attempts[idx] || { count: 0, lastVerdict: null, lastScore: null, feedbackShown: false, hintUsed: false, whyOpened: false, retryCompleted: false };
  const updateAttempt = (idx, patch) => setAttempts(p => ({ ...p, [idx]: { ...getAttempt(idx), ...patch } }));

  const [feedbackByIndex, setFeedbackByIndex] = useState({});
  const [hintByIndex, setHintByIndex] = useState({});
  const [checkingIndex, setCheckingIndex] = useState(null);
  const [hintLoadingIndex, setHintLoadingIndex] = useState(null);
  const [checkingMsgIdx, setCheckingMsgIdx] = useState(0);

  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), []);

  const [quiz, dispatch] = useReducer(reducer, initState);
  const { questions, currentIndex, answers, phase, results } = quiz;

  // FIX: Load Inter for reading-quality typography across all content
  useEffect(() => {
    const existing = document.querySelector('link[data-studyhub-font]');
    if (existing) return;
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap';
    link.rel = 'stylesheet';
    link.setAttribute('data-studyhub-font', 'true');
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    if (phase !== 'grading') { setMarkingMsgIndex(0); return; }
    const id = setInterval(() => setMarkingMsgIndex(i => Math.min(i + 1, MARKING_MESSAGES.length - 1)), 2200);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (checkingIndex == null) { setCheckingMsgIdx(0); return; }
    const id = setInterval(() => setCheckingMsgIdx(i => (i + 1) % CHECKING_MESSAGES.length), 1400);
    return () => clearInterval(id);
  }, [checkingIndex]);

  // ── Derived data ────────────────────────────────────────────
  const subjectList = useMemo(() => Object.values(subjects), [subjects]);
  const subjColorMap = useMemo(
    () => Object.fromEntries(subjectList.map((s, i) => [s.id, CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]])),
    [subjectList]
  );

  const subjectsWithMeta = useMemo(() => {
    const withMastery = subjectList.map(s => {
      const masteries = weakTopics.filter(w => w.course === s.title).map(w => w.mastery);
      const avgMastery = masteries.length ? masteries.reduce((a, b) => a + b, 0) / masteries.length : null;
      return { ...s, avgMastery };
    });
    let recommendedId = null; let lowest = 0.6;
    withMastery.forEach(s => { if (s.avgMastery != null && s.avgMastery < lowest) { lowest = s.avgMastery; recommendedId = s.id; } });
    const arr = withMastery.map(s => ({ ...s, isRecommended: s.id === recommendedId }));
    if (lastSession) arr.sort((a, b) => (a.id === lastSession.course_id ? -1 : b.id === lastSession.course_id ? 1 : 0));
    return arr;
  }, [subjectList, weakTopics, lastSession]);

  const filteredSubjects = useMemo(() => {
    if (!subjectSearch.trim()) return subjectsWithMeta;
    const q = subjectSearch.toLowerCase();
    return subjectsWithMeta.filter(s => s.title.toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q));
  }, [subjectsWithMeta, subjectSearch]);

  // ── React Query ─────────────────────────────────────────────
  const fetchUserStats = useCallback(async (uid) => {
    if (!uid) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('total_questions, total_correct, quizzes_completed, streak, last_active, badges, daily_counts')
      .eq('id', uid).single();
    return profile;
  }, []);
  const { data: profileData, isLoading: statsLoading } = useQuery({
    queryKey: ['quizStats', user?.id], queryFn: () => fetchUserStats(user.id),
    enabled: !!user, staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000,
  });
  useEffect(() => {
    if (!profileData) return;
    const todayStr = new Date().toDateString();
    const dailyCounts = profileData.daily_counts || {};
    setTodayAnswered(dailyCounts[todayStr] || 0);
    setStats({
      completed: profileData.quizzes_completed || 0, totalCorrect: profileData.total_correct || 0,
      totalQ: profileData.total_questions || 0, streak: profileData.streak || 0,
      lastActivity: profileData.last_active || null, badges: profileData.badges || [],
    });
  }, [profileData]);

  const fetchWeakTopics = useCallback(async (uid) => {
    if (!uid) return [];
    const { data } = await supabase.from('user_weak_topics').select('topic, mastery, course').eq('user_id', uid);
    return data || [];
  }, []);
  const { data: weakData } = useQuery({
    queryKey: ['weakTopics', user?.id], queryFn: () => fetchWeakTopics(user.id),
    enabled: !!user, staleTime: 10 * 60 * 1000, gcTime: 20 * 60 * 1000,
  });
  useEffect(() => { if (weakData) setWeakTopics(weakData); }, [weakData]);

  const fetchRecentSessions = useCallback(async (uid) => {
    if (!uid) return [];
    const { data } = await supabase.from('quiz_sessions').select('*').eq('user_id', uid)
      .order('completed_at', { ascending: false }).limit(2);
    return data || [];
  }, []);
  const { data: recentSessionsData } = useQuery({
    queryKey: ['recentSessions', user?.id], queryFn: () => fetchRecentSessions(user.id),
    enabled: !!user, staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000,
  });
  useEffect(() => {
    if (!recentSessionsData) return;
    setLastSession(recentSessionsData[0] || null);
    setPrevSession(recentSessionsData[1] || null);
  }, [recentSessionsData]);

  // ── Load user + subjects ────────────────────────────────────
  const loadUser = useCallback(async (authUser) => {
    if (!authUser) { setErrorType('generic'); setError('You are not logged in.'); setLoading(false); return; }
    setUser(authUser);
    try {
      let { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (!profile) {
        await supabase.from('profiles').insert({ id: authUser.id });
        const { data: newProfile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
        profile = newProfile;
      }
      if (!profile.program || profile.semester == null) {
        setErrorType('settings');
        setError('Please set your program and semester in Settings first.');
        setLoading(false); return;
      }
      const { data: prog } = await supabase.from('programs').select('id').eq('name', profile.program).maybeSingle();
      if (!prog) {
        setErrorType('settings');
        throw new Error(`We couldn't find the program "${profile.program}" — please re-check it in Settings.`);
      }
      const { data: courses, error: ce } = await supabase.from('courses').select('id, course_name, course_code')
        .eq('program_id', prog.id).eq('semester', parseInt(profile.semester, 10));
      if (ce) { setErrorType('generic'); throw new Error(ce.message); }
      const map = {};
      (courses || []).forEach(c => { map[c.id] = { id: c.id, title: c.course_name, code: c.course_code }; });
      setSubjects(map);
      writeQuizSetupCache({ userId: authUser.id, subjects: map });
      if (!Object.keys(map).length) {
        setErrorType('settings');
        setError('No courses found for your program and semester. Double-check them in Settings, or check back once your courses are added.');
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => { if (mounted) loadUser(session?.user ?? null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
      if (!mounted) return;
      if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') loadUser(session?.user);
      if (ev === 'SIGNED_OUT') { setErrorType('generic'); setError('You have been signed out.'); try { sessionStorage.removeItem(QUIZ_SETUP_CACHE_KEY); } catch {} }
    });
    return () => { mounted = false; subscription?.unsubscribe(); };
  }, [loadUser]);

  useEffect(() => {
    const saved = readQuizResume();
    if (saved?.questions?.length > 0) { setPendingResume(saved); setShowResumeModal(true); }
  }, []);

  useEffect(() => {
    const tryFlush = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const { flushed } = await flushPendingSubmissions(base, token);
      if (flushed > 0) addToast(`Synced ${flushed} saved answer${flushed === 1 ? '' : 's'}`, 'success');
    };
    tryFlush();
    window.addEventListener('online', tryFlush);
    return () => window.removeEventListener('online', tryFlush);
  }, [addToast]);

  useEffect(() => {
    if (phase === 'active' && questions.length > 0) {
      writeQuizResume({ questions, currentIndex, answers, subjectId: currentSubjectId, quizMode });
    } else {
      clearQuizResume();
    }
  }, [phase, questions, currentIndex, answers, currentSubjectId, quizMode]);

  useEffect(() => {
    const st = location.state;
    if (st?.subjectId && subjects[st.subjectId]) {
      setCurrentSubjectId(st.subjectId);
      startTransition(() => setScreen('setup'));
      window.history.replaceState({}, '');
    }
  }, [location, subjects]);

  // ── Auth helper ──────────────────────────────────────────
  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }, []);
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // ── Fetch questions ─────────────────────────────────────────
  const fetchQuestions = useCallback(async (courseId, mode, count) => {
    const cacheKey = `${courseId}_${mode}_${count}`;
    const cached = quizCache.get(cacheKey);
    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000;
    if (cached && (now - cached.timestamp < CACHE_TTL)) return cached.data;
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const url = `${apiBase}/api/exam/quiz?mode=${mode}&count=${count}&courseId=${courseId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const transformed = data.questions.map(r => {
        if (r.question_type !== 'mcq') {
          return {
            id: r.id, question: r.question || '', question_type: r.question_type || 'mcq',
            options: [], correct_answer_index: null, answer: r.answer || '',
            explanation: r.explanation || '', topic: r.topic || 'General', course: r.course || 'Unknown',
            marks: r.marks || 1, latex_math: r.latex_math || null, smiles: r.smiles || null, image_url: r.image_url || null,
          };
        }
        const rawOptions = [r.option_a, r.option_b, r.option_c, r.option_d].map(o => o || '');
        const correctRawIndex = ['A', 'B', 'C', 'D'].indexOf((r.answer || '').trim().toUpperCase());
        const withIndex = rawOptions.map((text, i) => ({ text, wasCorrect: i === correctRawIndex }));
        const shuffled = shuffle(withIndex);
        return {
          id: r.id, question: r.question || '', question_type: 'mcq',
          options: shuffled.map(o => o.text), correct_answer_index: shuffled.findIndex(o => o.wasCorrect),
          answer: r.answer || '', explanation: r.explanation || '', topic: r.topic || 'General', course: r.course || 'Unknown',
          marks: r.marks || 1, latex_math: r.latex_math || null, smiles: r.smiles || null, image_url: r.image_url || null,
        };
      });
      setQuizCacheEntry(cacheKey, { data: transformed, timestamp: now });
      return transformed;
    } catch (err) {
      console.error('Adaptive quiz error:', err);
      addToast('Could not load adaptive quiz. Please try again.', 'error');
      return [];
    }
  }, [addToast, getToken, apiBase]);

  const resetStudyState = () => { setAttempts({}); setFeedbackByIndex({}); setHintByIndex({}); setCheckingIndex(null); };

  const startQuiz = useCallback(async (subjectId, mode, count) => {
    const actionId = 'startQuiz';
    if (!startProcessing(actionId)) return;
    setIsSubmitting(true);
    setSetupError(null);
    try {
      const qs = await fetchQuestions(subjectId, mode, count);
      if (!qs.length) {
        setSetupError('No questions are available for this subject yet.');
        setIsSubmitting(false);
        return;
      }
      dispatch({ type: 'START', questions: qs });
      setTextAnswers({}); setImageData({}); resetStudyState();
      startTransition(() => setScreen('quiz'));
    } catch (err) {
      addToast('Failed to start quiz.', 'error');
    } finally {
      setIsSubmitting(false);
      stopProcessing(actionId);
    }
  }, [fetchQuestions, addToast, startProcessing, stopProcessing]);

  const startTopicPractice = useCallback(async (courseId, topic) => {
    const actionId = `practice_${courseId}_${topic}`;
    if (!startProcessing(actionId)) return;
    setIsSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const url = `${apiBase}/api/exam/quiz?mode=auto&count=10&courseId=${courseId}&topic=${encodeURIComponent(topic)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const qs = data.questions.map(r => {
        if (r.question_type !== 'mcq') {
          return {
            id: r.id, question: r.question || '', question_type: r.question_type || 'mcq',
            options: [], correct_answer_index: null, answer: r.answer || '', explanation: r.explanation || '',
            topic: r.topic || topic, course: r.course || 'Unknown', marks: r.marks || 1,
            latex_math: r.latex_math || null, smiles: r.smiles || null, image_url: r.image_url || null,
          };
        }
        const rawOptions = [r.option_a, r.option_b, r.option_c, r.option_d].map(o => o || '');
        const correctRawIndex = ['A', 'B', 'C', 'D'].indexOf((r.answer || '').trim().toUpperCase());
        const shuffled = shuffle(rawOptions.map((text, i) => ({ text, wasCorrect: i === correctRawIndex })));
        return {
          id: r.id, question: r.question || '', question_type: 'mcq',
          options: shuffled.map(o => o.text), correct_answer_index: shuffled.findIndex(o => o.wasCorrect),
          answer: r.answer || '', explanation: r.explanation || '', topic: r.topic || topic, course: r.course || 'Unknown',
          marks: r.marks || 1, latex_math: r.latex_math || null, smiles: r.smiles || null, image_url: r.image_url || null,
        };
      });
      if (!qs.length) { addToast(`No practice questions found for ${topic} yet.`, 'error'); return; }
      setCurrentSubjectId(courseId);
      setQuizMode('study');
      dispatch({ type: 'START', questions: qs });
      setTextAnswers({}); setImageData({}); resetStudyState();
      startTransition(() => setScreen('quiz'));
    } catch {
      addToast('Could not load topic practice. Try again.', 'error');
    } finally {
      setIsSubmitting(false);
      stopProcessing(actionId);
    }
  }, [addToast, getToken, apiBase, startProcessing, stopProcessing]);

  // ── Answer handlers ─────────────────────────────────────────
  const setMcq = useCallback((index, optionIndex) => { dispatch({ type: 'ANSWER', index, value: optionIndex }); }, []);
  const setStructured = useCallback((index, text) => {
    setTextAnswers(p => ({ ...p, [index]: text }));
    dispatch({ type: 'ANSWER', index, value: { text } });
  }, []);
  const handleImageUpload = useCallback(async (index, file) => {
    try {
      const blob = await compressImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = reader.result;
        setImageData(p => ({ ...p, [index]: b64 }));
        dispatch({ type: 'ANSWER', index, value: { image: b64 } });
        addToast('Drawing attached', 'success');
      };
      reader.readAsDataURL(blob);
    } catch { addToast('Image processing failed', 'error'); }
  }, [addToast]);

  // ── Check Answer (Study Mode) ────────────────────────────────
  const checkAnswer = useCallback(async (index) => {
    const actionId = `check_${index}`;
    if (!startProcessing(actionId)) return;
    const q = questions[index];
    if (!q) {
      stopProcessing(actionId);
      return;
    }
    const att = getAttempt(index);
    const attemptNumber = att.count + 1;
    setCheckingIndex(index);

    let graded;
    try {
      if (q.question_type === 'mcq') {
        const chosen = answers[index];
        const isCorrect = chosen === q.correct_answer_index;
        graded = {
          verdict: chosen == null ? 'uncertain' : (isCorrect ? 'correct' : 'incorrect'),
          confidence: 1, score: isCorrect ? 1 : 0, strengths: [], missing_concepts: [],
          error_type: isCorrect ? 'none' : 'conceptual',
          feedback: isCorrect ? 'Correct!' : `The correct answer is ${'ABCD'[q.correct_answer_index]}. ${q.options[q.correct_answer_index]}`,
          retry_recommended: !isCorrect,
        };
      } else {
        const ans = answers[index] || {};
        const userText = ans.text || textAnswers[index] || '';
        const token = await getToken();
        if (ans.image) {
          const res = await fetch(`${apiBase}/api/exam/grade-diagram`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ questionId: q.id, questionText: q.question, correctAnswer: q.answer, userAnswer: userText, imageBase64: ans.image, attemptNumber, topic: q.topic, courseId: currentSubjectId }),
            signal: AbortSignal.timeout(20000),
          });
          graded = res.ok ? await res.json() : { verdict: 'uncertain', confidence: 0, score: 0, strengths: [], missing_concepts: [], error_type: 'uncertain', feedback: "We need a bit more detail — try adding notes to your drawing.", retry_recommended: true };
        } else {
          const res = await fetch(`${apiBase}/api/exam/grade`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ questionId: q.id, questionText: q.question, correctAnswer: q.answer, userAnswer: userText, attemptNumber, topic: q.topic, courseId: currentSubjectId }),
            signal: AbortSignal.timeout(12000),
          });
          graded = res.ok ? await res.json() : { verdict: 'uncertain', confidence: 0, score: 0, strengths: [], missing_concepts: [], error_type: 'uncertain', feedback: "We need a bit more detail — try expanding your answer.", retry_recommended: true };
        }
      }
    } catch {
      graded = { verdict: 'uncertain', confidence: 0, score: 0, strengths: [], missing_concepts: [], error_type: 'uncertain', feedback: "Couldn't reach the server — check your connection and try again.", retry_recommended: true };
    }

    setFeedbackByIndex(p => ({ ...p, [index]: graded }));
    updateAttempt(index, { count: attemptNumber, lastVerdict: graded.verdict, lastScore: graded.score, feedbackShown: true });
    setCheckingIndex(null);
    stopProcessing(actionId);

    if (graded.verdict !== 'uncertain') {
      try {
        const token = await getToken();
        await fetch(`${apiBase}/api/exam/submit-answer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            questionId: q.id, questionType: q.question_type, correct: graded.verdict === 'correct',
            topic: q.topic, userAnswer: (answers[index] && answers[index].text) || '', questionText: q.question,
            correctAnswer: q.answer, course: q.course || 'Unknown', attemptNumber, errorType: graded.error_type,
          }),
        });
      } catch { /* best-effort */ }
    }
  }, [questions, answers, textAnswers, getToken, apiBase, currentSubjectId, attempts, startProcessing, stopProcessing]);

  // Try again
  const tryAgain = useCallback(async (index) => {
    const actionId = `tryAgain_${index}`;
    if (!startProcessing(actionId)) return;
    const att = getAttempt(index);
    if (att.count >= 2) {
      const q = questions[index];
      setCheckingIndex(index);
      try {
        const token = await getToken();
        const res = await fetch(`${apiBase}/api/exam/similar-question`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ questionText: q.question, correctAnswer: q.answer, topic: q.topic, course: q.course, questionType: q.question_type }),
        });
        if (res.ok) {
          const { question } = await res.json();
          dispatch({ type: 'SWAP_CURRENT', question: { ...question, question_type: q.question_type } });
          setTextAnswers(p => { const n = { ...p }; delete n[index]; return n; });
          setImageData(p => { const n = { ...p }; delete n[index]; return n; });
          addToast('New question, same concept — give it a shot.', 'info');
        } else {
          addToast("Couldn't generate a similar question — try this one again.", 'info');
        }
      } catch { addToast("Couldn't generate a similar question — try this one again.", 'info'); }
      finally { setCheckingIndex(null); }
    }
    setFeedbackByIndex(p => { const n = { ...p }; delete n[index]; return n; });
    setHintByIndex(p => { const n = { ...p }; delete n[index]; return n; });
    updateAttempt(index, { retryCompleted: true });
    stopProcessing(actionId);
  }, [questions, getToken, apiBase, addToast, startProcessing, stopProcessing]);

  // Hint
  const fetchHint = useCallback(async (index) => {
    const actionId = `hint_${index}`;
    if (!startProcessing(actionId)) return;
    const q = questions[index];
    setHintLoadingIndex(index);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/api/exam/hint`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questionText: q.question, correctAnswer: q.answer, topic: q.topic }),
      });
      const data = res.ok ? await res.json() : { hint: "Think about what the question is really asking." };
      setHintByIndex(p => ({ ...p, [index]: data.hint }));
      updateAttempt(index, { hintUsed: true });
    } catch { setHintByIndex(p => ({ ...p, [index]: "Think about what the question is really asking." })); }
    finally { setHintLoadingIndex(null); stopProcessing(actionId); }
  }, [questions, getToken, apiBase, startProcessing, stopProcessing]);

  // Explain
  const fetchExplain = useCallback(async (index, level) => {
    const q = questions[index];
    const graded = feedbackByIndex[index];
    const userAnswer = q.question_type === 'mcq'
      ? (answers[index] != null ? `${'ABCD'[answers[index]]}. ${q.options[answers[index]]}` : 'No answer')
      : (textAnswers[index] || '[drawing]');
    updateAttempt(index, { whyOpened: true });
    const token = await getToken();
    const res = await fetch(`${apiBase}/api/exam/explain`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        question: q.question, correctAnswer: q.answer, userAnswer,
        context: graded?.verdict || 'incorrect', level, missingConcepts: graded?.missing_concepts || [],
      }),
    });
    if (!res.ok) throw new Error('explain failed');
    const data = await res.json();
    return data.explanation;
  }, [questions, feedbackByIndex, answers, textAnswers, getToken, apiBase]);

  const finishStudySession = useCallback(async () => {
    const details = questions.map((q, idx) => {
      const graded = feedbackByIndex[idx];
      const att = getAttempt(idx);
      const isCorrect = graded?.verdict === 'correct';
      return {
        index: idx, isCorrect,
        userAnswerText: q.question_type === 'mcq'
          ? (answers[idx] != null ? `${'ABCD'[answers[idx]]}. ${q.options[answers[idx]]}` : 'No answer')
          : (textAnswers[idx] || (imageData[idx] ? '[Drawing uploaded]' : 'No answer')),
        correctAnswerText: q.question_type === 'mcq' && q.correct_answer_index != null
          ? `${'ABCD'[q.correct_answer_index]}. ${q.options[q.correct_answer_index]}` : q.answer,
        question: q.question, topic: q.topic, explanation: q.explanation, smiles: q.smiles,
        verdict: graded?.verdict || 'uncertain', attemptCount: att.count || 1,
      };
    });
    const correctCount = details.filter(d => d.isCorrect).length;
    const total = questions.length;
    const percentage = total ? Math.round((correctCount / total) * 100) : 0;
    const firstAttemptCorrect = details.filter(d => d.isCorrect && d.attemptCount === 1).length;
    const retried = details.filter(d => d.attemptCount > 1);
    const retrySuccess = retried.filter(d => d.isCorrect).length;

    dispatch({ type: 'DONE', results: {
      correct: correctCount, total, percentage, details,
      studyMeta: { firstAttemptCorrect, retryAttempted: retried.length, retrySuccess },
    } });

    if (user && currentSubjectId) {
      await persistResults(correctCount, total, details);
      invalidateSubjectCache(currentSubjectId);
    }
    startTransition(() => setScreen('results'));
  }, [questions, feedbackByIndex, attempts, answers, textAnswers, imageData, user, currentSubjectId]);

  // FIX (v17): now awaits finishStudySession and keeps an explicit
  // `finishingSession` flag on for its duration, so the "See Results"
  // button always shows a spinner + label change instead of doing
  // nothing visible while results are being saved.
  const continueAfterFeedback = useCallback(async (index) => {
    const actionId = `continue_${index}`;
    if (!startProcessing(actionId)) return;
    if (currentIndex < questions.length - 1) {
      dispatch({ type: 'NEXT' });
      stopProcessing(actionId);
      return;
    }
    setFinishingSession(true);
    try {
      await finishStudySession();
    } finally {
      setFinishingSession(false);
      stopProcessing(actionId);
    }
  }, [currentIndex, questions.length, startProcessing, stopProcessing, finishStudySession]);

  // ── Grade structured / diagram (Exam Mode fallback grader) ──
  const gradeStructured = useCallback(async (questionText, correctAnswer, userAnswer, token, userImage) => {
    if (userImage) {
      try {
        if (token) {
          const res = await fetch(`${apiBase}/api/exam/grade-diagram`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ questionText, correctAnswer, userAnswer: userAnswer || '', imageBase64: userImage }),
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const g = await res.json();
            return { correct: g.verdict === 'correct', explanation: g.feedback, needsManualReview: g.verdict === 'uncertain' };
          }
        }
      } catch {}
      if (!userAnswer?.trim()) {
        return { correct: false, explanation: `Could not auto-grade your drawing — flagged for review. Correct answer: ${correctAnswer}`, needsManualReview: true };
      }
    }
    if (!userAnswer?.trim()) return { correct: false, explanation: `No answer provided. Correct answer: ${correctAnswer}` };
    try {
      if (token) {
        const res = await fetch(`${apiBase}/api/exam/grade`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ questionText, correctAnswer, userAnswer }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const g = await res.json();
          return { correct: g.verdict === 'correct', explanation: g.feedback };
        }
      }
    } catch {}
    const ua = userAnswer.toLowerCase().trim();
    const ca = (correctAnswer || '').toLowerCase().trim();
    const stopwords = new Set(['the','a','an','of','for','on','at','to','in','with','without','and','or','but','not','by','from','as','so','if','then','else','when','where','which','that','this','these','those','are','is','was','were']);
    const caWords = ca.split(/\W+/).filter(w => w.length > 2 && !stopwords.has(w));
    const uaWords = ua.split(/\W+/).filter(w => w.length > 2 && !stopwords.has(w));
    if (!caWords.length) return { correct: ua === ca, explanation: ua === ca ? 'Correct!' : `Incorrect. Correct answer: ${correctAnswer}` };
    const intersection = caWords.filter(w => uaWords.some(uw => uw.includes(w) || w.includes(uw)));
    const score = intersection.length / caWords.length;
    if (score >= 0.5) return { correct: true, explanation: 'Good – you covered the key concepts.' };
    if (score >= 0.25) return { correct: false, explanation: `Partial match. Full answer: ${correctAnswer}` };
    return { correct: false, explanation: `Incorrect. Correct answer: ${correctAnswer}` };
  }, [apiBase]);

  // ── Exam Mode submit ─────────────────────────────────────────
  const submitQuiz = useCallback(async () => {
    const actionId = 'submitQuiz';
    if (!startProcessing(actionId)) return;
    setShowConfirmSubmit(false);
    dispatch({ type: 'GRADING' });
    setGradingProgress({ done: 0, total: questions.length });
    const optLabels = ['A', 'B', 'C', 'D'];
    const token = await getToken();

    const gradeOne = async (q, idx) => {
      let result;
      if (q.question_type === 'mcq') {
        const chosen = answers[idx];
        const correct = chosen === q.correct_answer_index;
        result = {
          index: idx, isCorrect: correct,
          userAnswerText: chosen != null && chosen >= 0 ? `${optLabels[chosen]}. ${q.options[chosen]}` : 'No answer',
          correctAnswerText: q.correct_answer_index != null ? `${optLabels[q.correct_answer_index]}. ${q.options[q.correct_answer_index]}` : q.answer,
          question: q.question, topic: q.topic, explanation: q.explanation, smiles: q.smiles,
        };
      } else {
        const ans = answers[idx] || {};
        const userText = ans.text || '';
        const hasImage = !!ans.image;
        const { correct, explanation, needsManualReview } = await gradeStructured(q.question, q.answer, userText, token, ans.image);
        result = {
          index: idx, isCorrect: correct,
          userAnswerText: userText || (hasImage ? '[Drawing uploaded]' : 'No answer'),
          correctAnswerText: q.answer, question: q.question, topic: q.topic,
          explanation: explanation || q.explanation, smiles: q.smiles, needsManualReview: !!needsManualReview,
        };
      }
      setGradingProgress(p => ({ ...p, done: p.done + 1 }));
      return result;
    };

    const details = await Promise.all(questions.map((q, idx) => gradeOne(q, idx)));

    const correctCount = details.filter(d => d.isCorrect).length;
    const total = questions.length;
    const percentage = Math.round((correctCount / total) * 100);
    dispatch({ type: 'DONE', results: { correct: correctCount, total, percentage, details } });

    let queuedCount = 0;
    if (token) {
      await Promise.all(
        details.map(async (d) => {
          const q = questions[d.index];
          const userAnswer = (answers[d.index] && answers[d.index].text) || '';
          const payload = {
            questionId: q.id, questionType: q.question_type, correct: d.isCorrect, topic: q.topic,
            userAnswer, questionText: q.question, correctAnswer: q.answer, course: q.course || 'Unknown',
          };
          try {
            const res = await fetch(`${apiBase}/api/exam/submit-answer`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            if (!res.ok) { enqueuePendingSubmission(payload); queuedCount++; }
          } catch { enqueuePendingSubmission(payload); queuedCount++; }
        })
      );
    }
    if (queuedCount > 0) addToast(`Saved offline — ${queuedCount} answer${queuedCount === 1 ? '' : 's'} will sync when you're back online.`, 'info');

    await persistResults(correctCount, total, details);
    invalidateSubjectCache(currentSubjectId);
    startTransition(() => setScreen('results'));
    stopProcessing(actionId);
  }, [questions, answers, gradeStructured, addToast, getToken, apiBase, currentSubjectId, startProcessing, stopProcessing]);

  const persistResults = useCallback(async (correct, total, details) => {
    const todayStr = new Date().toDateString();
    const { data: profile } = await supabase.from('profiles')
      .select('total_questions, total_correct, daily_counts, quizzes_completed, streak, last_active, badges')
      .eq('id', user.id).single();

    const newTotalQ = (profile?.total_questions || 0) + total;
    const newTotalCorrect = (profile?.total_correct || 0) + correct;
    const newCompleted = (profile?.quizzes_completed || 0) + 1;

    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    let newStreak = profile?.streak || 0;
    if (profile?.last_active !== todayStr) newStreak = profile?.last_active === yesterday.toDateString() ? newStreak + 1 : 1;

    const daily = profile?.daily_counts || {};
    daily[todayStr] = (daily[todayStr] || 0) + total;

    const newBadges = [...(profile?.badges || [])];
    const updatedStats = { totalQ: newTotalQ, totalCorrect: newTotalCorrect, completed: newCompleted, streak: newStreak };
    BADGES.forEach(b => { if (!newBadges.includes(b.id) && b.check(updatedStats)) newBadges.push(b.id); });

    await supabase.from('profiles').update({
      total_questions: newTotalQ, total_correct: newTotalCorrect, quizzes_completed: newCompleted,
      streak: newStreak, last_active: todayStr, badges: newBadges, daily_counts: daily,
    }).eq('id', user.id);

    queryClient.invalidateQueries({ queryKey: ['quizStats', user.id] });
    queryClient.invalidateQueries({ queryKey: ['recentSessions', user.id] });

    setStats(prev => ({ ...prev, totalQ: newTotalQ, totalCorrect: newTotalCorrect, completed: newCompleted, streak: newStreak, lastActivity: todayStr, badges: newBadges }));
    setTodayAnswered(daily[todayStr] || 0);

    await supabase.from('quiz_sessions').insert({
      user_id: user.id, course_id: currentSubjectId, total_questions: total, correct_answers: correct,
      percentage: Math.round((correct / total) * 100), completed_at: new Date().toISOString(),
    });
  }, [user, currentSubjectId, queryClient]);

  // ── Screen transitions ───────────────────────────────────────
  const goToSetup = useCallback((subjectId) => {
    const actionId = `goToSetup_${subjectId}`;
    if (!startProcessing(actionId)) return;
    setSetupError(null);
    startTransition(() => { setCurrentSubjectId(subjectId); setScreen('setup'); });
  }, [startProcessing]);

  const goToHome = useCallback(() => {
    const actionId = 'goToHome';
    if (!startProcessing(actionId)) return;
    startTransition(() => setScreen('home'));
  }, [startProcessing]);

  // ── Render: Home ─────────────────────────────────────────────
  const renderHome = useCallback(() => {
    const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student';
    const avgMastery = weakTopics.length ? weakTopics.reduce((sum, w) => sum + w.mastery, 0) / weakTopics.length : 0.5;
    const attemptsFactor = 1 - Math.exp(-stats.totalQ / 50);
    const readiness = Math.min(100, Math.round(avgMastery * attemptsFactor * 100));
    const todayPct = Math.min(100, Math.round((todayAnswered / dailyGoal) * 100));
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const groupedWeak = weakTopics.reduce((acc, w) => {
      const course = w.course || 'General';
      if (!acc[course]) acc[course] = [];
      acc[course].push(w);
      return acc;
    }, {});
    const earnedBadges = BADGES.filter(b => stats.badges?.includes(b.id));
    const userSegment = statsLoading ? null : (stats.completed === 0 ? 'new' : (stats.completed < 5 && stats.streak < 2 ? 'returning' : 'power'));
    const isEstablished = userSegment && userSegment !== 'new';
    const subtitle =
      userSegment === 'new' ? "Let's get your first quiz done — pick a subject below to begin." :
      userSegment === 'returning' ? 'Good to see you again — keep the momentum going.' :
      userSegment === 'power' ? "You're on a roll. Let's keep pushing that mastery up." : '';

    return (
      <div style={{ ...S.pageMax, padding: `${SPACE.xl}px ${SPACE.lg}px ${SPACE.xl}px` }}>
        <div style={{ marginBottom: SPACE.lg }}>
          <div style={{ fontSize: TYPE.label, color: C.textMuted }}>{greeting}</div>
          <div style={{ fontSize: TYPE.h2, fontWeight: WEIGHT.bold, color: C.text }}>{name}</div>
          {subtitle && <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: SPACE.xs, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>

        {userSegment === 'new' && (
          <div style={{ background: C.primaryMuted, borderRadius: 16, padding: `${SPACE.lg2}px ${SPACE.xl}px`, marginBottom: SPACE.lg, border: `1px solid ${C.primaryLight}`, display: 'flex', alignItems: 'center', gap: SPACE.md2 }}>
            <Target size={32} color={C.primary} />
            <div>
              <div style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: C.text }}>Welcome to StudyHub!</div>
              <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>Pick a subject below and start with 5–10 questions to see where you stand.</div>
            </div>
          </div>
        )}

        {isEstablished && (
          <div style={{ ...S.card, padding: `${SPACE.lg}px ${SPACE.xl}px`, marginBottom: SPACE.lg }}>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: SPACE.md }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold, color: C.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Flame size={18} color={C.warning} /> {stats.streak}
                </div>
                <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginTop: 2 }}>Day streak</div>
              </div>
              <div style={{ width: 1, background: C.border, alignSelf: 'stretch' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold, color: readiness >= 70 ? C.success : readiness >= 50 ? C.warning : C.error }}>
                  {readiness}%
                </div>
                <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginTop: 2 }}>Readiness</div>
              </div>
              <div style={{ width: 1, background: C.border, alignSelf: 'stretch' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold, color: todayPct >= 100 ? C.success : C.primary }}>
                  {todayAnswered}/{dailyGoal}
                </div>
                <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginTop: 2 }}>Today</div>
              </div>
            </div>
            <div style={S.progressTrack(5)}>
              <div style={{ ...S.progressFill(todayPct >= 100 ? C.success : C.primary), width: `${todayPct}%` }} />
            </div>
            {todayPct >= 100 && (
              <div style={{ marginTop: SPACE.xs, fontSize: TYPE.micro, color: C.success, fontWeight: WEIGHT.medium, textAlign: 'center' }}>
                Daily goal achieved!
              </div>
            )}
            {earnedBadges.length > 0 && (
              <div style={{ display: 'flex', gap: SPACE.xs, justifyContent: 'center', marginTop: SPACE.md }}>
                {earnedBadges.slice(-4).map(b => {
                  const Icon = b.icon;
                  return <Icon key={b.id} size={16} title={b.label} color={C.textMuted} />;
                })}
              </div>
            )}
          </div>
        )}

        {lastSession && (
          <div style={{ background: C.primaryMuted, borderRadius: 14, padding: `${SPACE.md2}px ${SPACE.lg2}px`, marginBottom: SPACE.lg, border: `1px solid ${C.primaryLight}`, display: 'flex', alignItems: 'center', gap: SPACE.md2 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `3px solid ${lastSession.percentage >= 70 ? C.success : C.warning}` }}>
              <span style={{ fontSize: TYPE.label, fontWeight: WEIGHT.bold, color: lastSession.percentage >= 70 ? C.success : C.warning }}>{lastSession.percentage}%</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: TYPE.micro, color: C.primary, fontWeight: WEIGHT.bold, letterSpacing: '0.05em' }}>LAST SESSION</div>
              <div style={{ fontSize: TYPE.body, color: C.text, fontWeight: WEIGHT.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subjects[lastSession.course_id]?.title || 'Quiz'}</div>
              <div style={{ fontSize: TYPE.micro, color: C.textMuted }}>{lastSession.correct_answers}/{lastSession.total_questions} correct</div>
            </div>
            <button onClick={() => goToSetup(lastSession.course_id)}
              style={{ padding: '10px 16px', borderRadius: 10, background: C.primary, color: '#fff', border: 'none', fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: 'pointer', flexShrink: 0, minHeight: TAP }}>
              <RotateCw size={16} style={{ display: 'inline', marginRight: SPACE.xs }} /> Retry
            </button>
          </div>
        )}

        {weakTopics.length > 0 && (() => {
          const sorted = [...weakTopics].sort((a, b) => a.mastery - b.mastery);
          const worst = sorted[0];
          const worstCourseId = subjectList.find(s => s.title === worst.course)?.id;
          return (
            <div style={{ ...S.cardSoft, padding: `${SPACE.lg}px ${SPACE.lg2}px`, marginBottom: SPACE.lg }}>
              <div style={{ fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.bold, letterSpacing: '0.04em', marginBottom: SPACE.xs }}><Target size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> BEST NEXT PRACTICE</div>
              <div style={{ fontSize: TYPE.label, color: C.text, lineHeight: 1.6 }}>
                <strong>{worst.course}</strong> — <strong>{worst.topic}</strong> ({Math.round(worst.mastery * 100)}% mastery).
              </div>
              {worstCourseId ? (
                <button onClick={() => startTopicPractice(worstCourseId, worst.topic)} disabled={isSubmitting || isProcessing(`practice_${worstCourseId}_${worst.topic}`)}
                  style={{ marginTop: SPACE.md, width: '100%', padding: '13px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: WEIGHT.medium, fontSize: TYPE.body, cursor: 'pointer', minHeight: TAP }}>
                  {isSubmitting || isProcessing(`practice_${worstCourseId}_${worst.topic}`) ? <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: SPACE.xs }} /> : null}
                  Practice {worst.topic} now
                </button>
              ) : null}
              {sorted.length > 1 && (
                <details style={{ marginTop: SPACE.md }}>
                  <summary style={{ fontSize: TYPE.micro, color: C.textMuted, cursor: 'pointer', fontWeight: WEIGHT.medium }}>All weak areas ({sorted.length})</summary>
                  <div style={{ marginTop: SPACE.md }}>
                    {Object.entries(groupedWeak).map(([course, topics]) => (
                      <div key={course} style={{ marginBottom: SPACE.md }}>
                        <div style={{ fontSize: TYPE.micro, fontWeight: WEIGHT.medium, color: C.primary, marginBottom: SPACE.xs }}>{course}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
                          {topics.map(w => {
                            const cId = subjectList.find(s => s.title === w.course)?.id;
                            return (
                              <button key={w.topic} onClick={() => cId && startTopicPractice(cId, w.topic)}
                                style={{ padding: '6px 12px', borderRadius: 20, background: C.errorLight, color: C.error, fontSize: TYPE.micro, fontWeight: WEIGHT.regular, border: 'none', cursor: cId ? 'pointer' : 'default', minHeight: 32 }}>
                                {w.topic} · {Math.round(w.mastery * 100)}%
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })()}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.md, marginTop: SPACE.xs }}>
          <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: C.text }}>Pick a Subject</div>
        </div>

        {subjectList.length > 4 && (
          <div style={{ marginBottom: SPACE.md }}>
            <input value={subjectSearch} onChange={e => setSubjectSearch(e.target.value)} placeholder="Search your subjects…"
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${C.border}`, fontSize: TYPE.body, color: C.text, background: C.card, boxSizing: 'border-box', outline: 'none', minHeight: TAP }} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          {filteredSubjects.map(subj => {
            const palette = subjColorMap[subj.id] || CATEGORY_PALETTE[0];
            const isContinue = lastSession?.course_id === subj.id;
            const Icon = Book;
            return (
              <button key={subj.id} onClick={() => goToSetup(subj.id)}
                style={{ background: C.card, border: `1px solid ${subj.isRecommended ? C.primary : C.border}`, borderRadius: 14, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.md2, textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', minHeight: TAP + 16 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: palette.bg, color: palette.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                  <Icon size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subj.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs + 2, marginTop: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: TYPE.micro, color: C.textMuted }}>{subj.code}</span>
                    {isContinue && <span style={{ fontSize: 10, fontWeight: WEIGHT.bold, color: C.primary, background: C.primaryLight, padding: '1px 6px', borderRadius: 8 }}>CONTINUE</span>}
                    {subj.isRecommended && !isContinue && <span style={{ fontSize: 10, fontWeight: WEIGHT.bold, color: C.warning, background: C.warningLight, padding: '1px 6px', borderRadius: 8 }}>RECOMMENDED</span>}
                    {subj.avgMastery != null && <span style={{ fontSize: 10, fontWeight: WEIGHT.medium, color: palette.fg }}>{Math.round(subj.avgMastery * 100)}% mastery</span>}
                  </div>
                </div>
                <ChevronRight size={18} color={C.textLight} />
              </button>
            );
          })}
          {filteredSubjects.length === 0 && <div style={{ textAlign: 'center', padding: '24px 0', color: C.textMuted, fontSize: TYPE.label }}>No subjects match "{subjectSearch}"</div>}
        </div>
      </div>
    );
  }, [user, stats, statsLoading, weakTopics, todayAnswered, lastSession, subjects, subjectList, filteredSubjects, subjColorMap, subjectSearch, goToSetup, startTopicPractice, isSubmitting, isProcessing]);

  // ── Render: Setup ────────────────────────────────────────────
  const renderSetup = useCallback(() => {
    const subj = subjects[currentSubjectId];
    if (!subj) return <div style={{ padding: SPACE.xxl, color: C.error, fontSize: TYPE.body }}>Subject not found.</div>;

    const showExamOption = modeExpanded || quizMode === 'exam';
    const showOtherStyles = styleExpanded || setupMode !== 'mcq';

    return (
      <div style={{ ...S.pageMax, padding: `${SPACE.xl}px ${SPACE.lg}px` }}>
        <button onClick={goToHome} style={{ ...S.backBtn, marginBottom: SPACE.xl }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ fontSize: TYPE.h2, fontWeight: WEIGHT.bold, color: C.text, marginBottom: SPACE.xs }}><Book size={24} style={{ display: 'inline', marginRight: SPACE.sm }} /> {subj.title}</div>
        <div style={{ fontSize: TYPE.label, color: C.textMuted, marginBottom: SPACE.xl }}>Set up your session</div>

        {setupError && (
          <div style={S.inlineBanner}>
            <AlertTriangle size={20} color={C.warning} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: TYPE.label, color: C.text, fontWeight: WEIGHT.medium, lineHeight: 1.5 }}>{setupError}</div>
              <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginTop: SPACE.xs, lineHeight: 1.5 }}>
                Once a past paper or question set is uploaded for this subject, it'll show up here automatically.
              </div>
              <button
                onClick={() => navigate('/upload', { state: { subjectId: currentSubjectId } })}
                style={{ marginTop: SPACE.sm, background: 'none', border: 'none', color: C.primary, fontSize: TYPE.micro, fontWeight: WEIGHT.bold, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                Upload questions for this subject
              </button>
            </div>
          </div>
        )}

        {/* ── Practice Mode: Study is the default, always-visible option.
             Exam lives behind a one-click disclosure so the common path
             (Study) needs zero extra clicks, and switching to Exam needs
             exactly one. ── */}
        <div style={{ marginBottom: SPACE.xl }}>
          <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: C.text, marginBottom: SPACE.md }}>Practice Mode</div>

          <ModeCard icon={BookOpen} title="Study" subtitle="Feedback after each question, with hints and retries" selected={quizMode === 'study'} onClick={() => setQuizMode('study')} />

          {showExamOption && (
            <ModeCard icon={ClipboardList} title="Exam" subtitle="Answer everything first, then review your results" selected={quizMode === 'exam'} onClick={() => setQuizMode('exam')} />
          )}

          <DisclosureToggle
            expanded={showExamOption}
            onClick={() => setModeExpanded(v => !v)}
            expandLabel="Show Exam mode"
            collapseLabel="Hide Exam mode"
          />

          <button onClick={() => setShowModeExplain(v => !v)}
            style={{ display: 'block', background: 'none', border: 'none', color: C.textMuted, fontSize: TYPE.micro, fontWeight: WEIGHT.medium, cursor: 'pointer', padding: 0, marginTop: -SPACE.xs, marginBottom: SPACE.sm, display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }}>
            <Info size={13} /> What's the difference?
          </button>
          {showModeExplain && (
            <div style={{ marginTop: SPACE.sm, padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: `1px solid ${C.border}`, fontSize: TYPE.micro, color: C.textMuted, lineHeight: 1.6 }}>
              <strong style={{ color: C.text }}>Study:</strong> see feedback after each question, get hints, and retry before moving on. Best while you're still learning the material.<br /><br />
              <strong style={{ color: C.text }}>Exam:</strong> answer all questions first, no feedback until you submit — closer to the real thing. Best once you want to test yourself under pressure.
            </div>
          )}
        </div>

        {/* ── Question Style: Multiple Choice is the default, always-visible
             option. Mixed and Written & Diagrams live behind the same
             disclosure pattern. ── */}
        <div style={{ marginBottom: SPACE.xl }}>
          <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: C.text, marginBottom: SPACE.md }}>Question Style</div>

          <button onClick={() => setSetupMode('mcq')}
            style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${setupMode === 'mcq' ? C.primary : C.border}`, background: setupMode === 'mcq' ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: SPACE.md, width: '100%', marginBottom: SPACE.md }}>
            <CheckCircle size={22} color={setupMode === 'mcq' ? C.primary : C.text} style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: setupMode === 'mcq' ? C.primary : C.text }}>Multiple Choice</div>
              <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>Tick-box questions only — fast practice with instant results</div>
            </div>
            {setupMode === 'mcq' && <Check size={18} color={C.primary} style={{ marginTop: 2 }} />}
          </button>

          {showOtherStyles && (
            <>
              <button onClick={() => setSetupMode('auto')}
                style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${setupMode === 'auto' ? C.primary : C.border}`, background: setupMode === 'auto' ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: SPACE.md, width: '100%', marginBottom: SPACE.md }}>
                <Target size={22} color={setupMode === 'auto' ? C.primary : C.text} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: setupMode === 'auto' ? C.primary : C.text }}>Mixed Questions</div>
                  <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>A combination of multiple choice and written — full exam preparation</div>
                </div>
                {setupMode === 'auto' && <Check size={18} color={C.primary} style={{ marginTop: 2 }} />}
              </button>

              <button onClick={() => setSetupMode('structured')}
                style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${setupMode === 'structured' ? C.primary : C.border}`, background: setupMode === 'structured' ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: SPACE.md, width: '100%', marginBottom: SPACE.md }}>
                <PenTool size={22} color={setupMode === 'structured' ? C.primary : C.text} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: setupMode === 'structured' ? C.primary : C.text }}>Written &amp; Diagrams</div>
                  <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>Open-ended and drawing questions — marked automatically</div>
                </div>
                {setupMode === 'structured' && <Check size={18} color={C.primary} style={{ marginTop: 2 }} />}
              </button>
            </>
          )}

          <DisclosureToggle
            expanded={showOtherStyles}
            onClick={() => setStyleExpanded(v => !v)}
            expandLabel="Show other question styles"
            collapseLabel="Hide other question styles"
          />
        </div>

        <div style={{ marginBottom: SPACE.xl }}>
          <div style={{ fontSize: TYPE.body, fontWeight: WEIGHT.medium, color: C.text, marginBottom: SPACE.md }}>Number of Questions</div>
          <div style={{ display: 'flex', gap: SPACE.md }}>
            {[5, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setSetupCount(n)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: `2px solid ${setupCount === n ? C.primary : C.border}`, background: setupCount === n ? C.primaryMuted : C.card, color: setupCount === n ? C.primary : C.text, fontWeight: WEIGHT.bold, fontSize: TYPE.h3, cursor: 'pointer', minHeight: TAP }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => startQuiz(currentSubjectId, setupMode, setupCount)} disabled={isSubmitting || isProcessing('startQuiz')}
          style={{ ...S.primaryBtn, background: (isSubmitting || isProcessing('startQuiz')) ? C.disabled : C.primary, fontSize: TYPE.h3lg, cursor: (isSubmitting || isProcessing('startQuiz')) ? 'default' : 'pointer' }}>
          {isSubmitting || isProcessing('startQuiz') ? <Loader2 size={20} className="animate-spin" style={{ display: 'inline', marginRight: SPACE.sm }} /> : null}
          {(isSubmitting || isProcessing('startQuiz')) ? 'Loading questions…' : (quizMode === 'study' ? 'Start Studying' : 'Enter Exam Room')}
        </button>
      </div>
    );
  }, [subjects, currentSubjectId, setupMode, setupCount, isSubmitting, startQuiz, goToHome, modeExpanded, styleExpanded, showModeExplain, quizMode, setupError, navigate, isProcessing]);

  // ── Render: Study Mode question screen ───────────────────────
  const renderStudyQuestion = useCallback(() => {
    if (!questions.length) return null;
    const q = questions[currentIndex];
    if (!q) return null;
    const total = questions.length;
    const pct = ((currentIndex + 1) / total) * 100;
    const isMcq = q.question_type === 'mcq';
    const isDiagram = q.question_type === 'diagram';
    const currentAnswer = answers[currentIndex];
    const textValue = textAnswers[currentIndex] || '';
    const hasImage = !!imageData[currentIndex];
    const graded = feedbackByIndex[currentIndex];
    const isChecking = checkingIndex === currentIndex;
    const hint = hintByIndex[currentIndex];
    const hintLoading = hintLoadingIndex === currentIndex;
    const canCheck = isMcq ? currentAnswer != null : (textValue.trim() || hasImage);
    const checkingId = `check_${currentIndex}`;
    const continueId = `continue_${currentIndex}`;
    const isLastQuestion = currentIndex === total - 1;
    const isFinishingThis = isLastQuestion && (finishingSession || isProcessing(continueId));

    return (
      <div style={{ ...S.pageMax, padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px` }}>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes pulse-border {
            0%, 100% { box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
            50% { box-shadow: 0 0 0 3px ${C.primaryLight}, 0 2px 12px rgba(37,99,235,0.1); }
          }
        `}</style>

        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md }}>
          <button onClick={() => setShowExitConfirm(true)}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontSize: TYPE.label, cursor: 'pointer', minHeight: TAP, display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }}>
            <ArrowLeft size={16} /> Exit
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: TYPE.label, fontWeight: WEIGHT.bold, color: C.text }}>{currentIndex + 1}</span>
            <span style={{ fontSize: TYPE.label, color: C.textMuted }}> / {total}</span>
          </div>
          <span style={{ padding: '6px 12px', borderRadius: 20, fontSize: TYPE.micro, fontWeight: WEIGHT.medium, background: C.primaryLight, color: C.primary }}>Study</span>
        </div>
        <div style={{ ...S.progressTrack(6), marginBottom: SPACE.lg2 }}>
          <div style={{ ...S.progressFill(C.primary), width: `${pct}%` }} />
        </div>

        <div style={{
          ...S.card, padding: SPACE.xl, marginBottom: SPACE.lg,
          animation: isChecking ? 'pulse-border 1.5s ease-in-out infinite' : 'none',
          transition: 'box-shadow 0.3s ease',
        }}>
          <div style={{ fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.bold, letterSpacing: '0.05em', marginBottom: SPACE.sm }}>QUESTION</div>
          <QuestionDisplay question={q} hideDiagram={isDiagram} />
        </div>

        {!graded ? (
          <>
            {isMcq ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, marginBottom: SPACE.lg, opacity: isChecking ? 0.6 : 1, pointerEvents: isChecking ? 'none' : 'auto', transition: 'opacity 0.2s ease' }}>
                {q.options.map((opt, idx) => (
                  <button key={idx} onClick={() => setMcq(currentIndex, idx)} disabled={isChecking}
                    style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${currentAnswer === idx ? C.primary : C.border}`, background: currentAnswer === idx ? C.primaryMuted : C.card, cursor: isChecking ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: SPACE.md, minHeight: TAP + 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', background: currentAnswer === idx ? C.primary : C.border, color: currentAnswer === idx ? '#fff' : C.textMuted, fontSize: TYPE.micro, fontWeight: WEIGHT.bold, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{'ABCD'[idx]}</span>
                    <span style={{ fontSize: TYPE.body, color: C.text, lineHeight: 1.5 }}><MathText text={opt} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ marginBottom: SPACE.lg, opacity: isChecking ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>
                <div style={{ fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.bold, letterSpacing: '0.05em', marginBottom: SPACE.sm }}>YOUR ANSWER</div>
                <textarea rows={5} value={textValue} onChange={e => setStructured(currentIndex, e.target.value)} disabled={isChecking}
                  placeholder="Type your answer…"
                  style={{ width: '100%', padding: SPACE.md2, borderRadius: 12, border: `2px solid ${C.border}`, fontSize: TYPE.body, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', color: C.text, background: isChecking ? '#f8fafc' : C.card, boxSizing: 'border-box', outline: 'none' }} />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md, padding: '12px 16px', borderRadius: 10, border: `1.5px dashed ${C.primary}`, color: C.primary, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: isChecking ? 'default' : 'pointer', background: C.primaryMuted, minHeight: TAP, pointerEvents: isChecking ? 'none' : 'auto' }}>
                  <Camera size={18} /> {hasImage ? 'Replace photo' : 'Add photo'}
                  <input type="file" accept="image/*" hidden disabled={isChecking} onChange={e => { if (e.target.files?.[0]) handleImageUpload(currentIndex, e.target.files[0]); }} />
                </label>
                {hasImage && (
                  <div style={{ marginTop: SPACE.md }}>
                    <img src={imageData[currentIndex]} alt="Answer" style={{ maxWidth: 200, borderRadius: 8, border: `1px solid ${C.border}` }} />
                  </div>
                )}
              </div>
            )}

            <button onClick={() => checkAnswer(currentIndex)} disabled={!canCheck || isChecking || isProcessing(checkingId)}
              style={{ ...S.primaryBtn, background: (!canCheck || isChecking || isProcessing(checkingId)) ? C.disabled : C.success, fontSize: TYPE.h3lg, cursor: (!canCheck || isChecking || isProcessing(checkingId)) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm }}>
              {isChecking || isProcessing(checkingId) ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span key={checkingMsgIdx}>{CHECKING_MESSAGES[checkingMsgIdx]}</span>
                </>
              ) : (
                <><Check size={20} /> Check</>
              )}
            </button>
          </>
        ) : (
          <FeedbackCard
            graded={graded}
            attemptNumber={getAttempt(currentIndex).count}
            hint={hint}
            hintLoading={hintLoading}
            canRetry={graded.verdict !== 'correct' && !isFinishingThis}
            isLastQuestion={isLastQuestion}
            loading={isFinishingThis}
            onHint={() => fetchHint(currentIndex)}
            onTryAgain={() => tryAgain(currentIndex)}
            onExplainFetch={(level) => fetchExplain(currentIndex, level)}
            onContinue={() => continueAfterFeedback(currentIndex)}
          />
        )}

        {showExitConfirm && (
          <div style={S.modalOverlay}>
            <div style={S.modalCard}>
              <DoorClosed size={44} style={{ margin: '0 auto', display: 'block', marginBottom: SPACE.md }} />
              <h3 style={S.modalTitle}>Exit Study Session?</h3>
              <p style={S.modalBody}>Your progress on graded questions is already saved.</p>
              <div style={S.modalRow}>
                <button onClick={() => setShowExitConfirm(false)} style={S.modalBtnGhost}>Keep going</button>
                <button onClick={() => { setShowExitConfirm(false); dispatch({ type: 'RESET' }); resetStudyState(); startTransition(() => setScreen('setup')); }}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, background: C.error, color: '#fff', border: 'none', fontWeight: WEIGHT.bold, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
                  <LogOut size={16} /> Exit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }, [questions, currentIndex, answers, textAnswers, imageData, feedbackByIndex, checkingIndex, checkingMsgIdx, hintByIndex, hintLoadingIndex, attempts, finishingSession, setMcq, setStructured, handleImageUpload, checkAnswer, tryAgain, fetchHint, fetchExplain, continueAfterFeedback, showExitConfirm, isProcessing]);

  // ── Render: Exam Mode question screen ───────────────────────
  const renderExamQuestion = useCallback(() => {
    if (!questions.length) return null;
    if (phase === 'grading') {
      const { done, total: gradTotal } = gradingProgress;
      const gradPct = gradTotal ? Math.round((done / gradTotal) * 100) : 0;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: SPACE.lg, padding: SPACE.xxl }}>
          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes ed-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes dot-pulse { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }
            .dot-pulse { animation: dot-pulse 1.4s infinite; font-size: 28px; line-height: 1; display: inline-block; }
          `}</style>
          <ClipboardList size={56} color={C.primary} />
          <div style={{ fontSize: TYPE.h3lg, fontWeight: WEIGHT.bold, color: C.text }}>Marking your paper…</div>
          <div style={{ width: '100%', maxWidth: 260 }}>
            <div style={S.progressTrack(6)}>
              <div style={{ ...S.progressFill(C.primary), width: `${gradPct}%` }} />
            </div>
            <div style={{ textAlign: 'center', marginTop: SPACE.xs, fontSize: TYPE.micro, color: C.textMuted, fontWeight: WEIGHT.medium }}>
              {done} of {gradTotal} graded
            </div>
          </div>
          <div key={markingMsgIndex} style={{ fontSize: TYPE.label, color: C.textMuted, textAlign: 'center', maxWidth: 280, minHeight: 20, lineHeight: 1.5, animation: 'ed-fade 0.3s ease-out' }}>
            {MARKING_MESSAGES[markingMsgIndex]}
            <span style={{ display: 'inline-block', marginLeft: 4 }}>
              <span className="dot-pulse" style={{ animationDelay: '0s' }}>.</span>
              <span className="dot-pulse" style={{ animationDelay: '0.2s' }}>.</span>
              <span className="dot-pulse" style={{ animationDelay: '0.4s' }}>.</span>
            </span>
          </div>
          <div style={{ fontSize: TYPE.micro, color: C.textLight, textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>You can stay on this screen — your paper is being marked now.</div>
        </div>
      );
    }

    const q = questions[currentIndex];
    if (!q) return null;
    const total = questions.length;
    const pct = ((currentIndex + 1) / total) * 100;
    const isMcq = q.question_type === 'mcq';
    const isDiagram = q.question_type === 'diagram';
    const currentAnswer = answers[currentIndex];
    const textValue = textAnswers[currentIndex] || '';
    const hasImage = !!imageData[currentIndex];
    const answeredCount = Object.entries(answers).filter(([, v]) => {
      if (typeof v === 'number') return v >= 0;
      if (v && typeof v === 'object') return !!(v.text?.trim() || v.image);
      return false;
    }).length;

    return (
      <div style={{ ...S.pageMax, padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px` }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md }}>
          <button onClick={() => setShowExitConfirm(true)}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontSize: TYPE.label, cursor: 'pointer', minHeight: TAP, display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }}>
            <ArrowLeft size={16} /> Exit
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: TYPE.label, fontWeight: WEIGHT.bold, color: C.text }}>Q{currentIndex + 1}</span>
            <span style={{ fontSize: TYPE.label, color: C.textMuted }}> / {total}</span>
          </div>
          <span style={{ padding: '6px 12px', borderRadius: 20, fontSize: TYPE.micro, fontWeight: WEIGHT.medium, background: isMcq ? C.primaryLight : isDiagram ? C.warningLight : '#f0fdf4', color: isMcq ? C.primary : isDiagram ? C.warning : C.success }}>
            {isMcq ? 'MCQ' : isDiagram ? 'Diagram' : 'Written'}
          </span>
        </div>
        <div style={{ ...S.progressTrack(6), marginBottom: SPACE.lg2 }}><div style={{ ...S.progressFill(C.primary), width: `${pct}%` }} /></div>

        <div style={{ ...S.card, padding: SPACE.xl, marginBottom: SPACE.lg }}>
          {q.marks > 1 && <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginBottom: SPACE.sm, fontWeight: WEIGHT.medium }}>[{q.marks} marks]</div>}
          <QuestionDisplay question={q} hideDiagram={isDiagram} />
        </div>

        {isMcq ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, marginBottom: SPACE.md }}>
            {q.options.map((opt, idx) => (
              <button key={idx} onClick={() => setMcq(currentIndex, idx)}
                style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${currentAnswer === idx ? C.primary : C.border}`, background: currentAnswer === idx ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: SPACE.md, minHeight: TAP + 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: currentAnswer === idx ? C.primary : C.border, color: currentAnswer === idx ? '#fff' : C.textMuted, fontSize: TYPE.micro, fontWeight: WEIGHT.bold, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{'ABCD'[idx]}</span>
                <span style={{ fontSize: TYPE.body, color: C.text, lineHeight: 1.5 }}><MathText text={opt} /></span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: SPACE.md }}>
            <textarea rows={5} value={textValue} onChange={e => setStructured(currentIndex, e.target.value)}
              placeholder={isDiagram ? 'Add notes or labels… then attach your drawing below' : 'Type your answer here…'}
              style={{ width: '100%', padding: SPACE.md2, borderRadius: 12, border: `2px solid ${C.border}`, fontSize: TYPE.body, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', color: C.text, background: C.card, boxSizing: 'border-box', outline: 'none' }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md, padding: '12px 16px', borderRadius: 10, border: `1.5px dashed ${C.primary}`, color: C.primary, fontSize: TYPE.label, fontWeight: WEIGHT.medium, cursor: 'pointer', background: C.primaryMuted, minHeight: TAP }}>
              <Paperclip size={18} /> {hasImage ? 'Replace drawing' : 'Attach drawing'}
              <input type="file" accept="image/*" hidden onChange={e => { if (e.target.files?.[0]) handleImageUpload(currentIndex, e.target.files[0]); }} />
            </label>
            {hasImage && (
              <div style={{ marginTop: SPACE.md }}>
                <img src={imageData[currentIndex]} alt="Drawing" style={{ maxWidth: 200, borderRadius: 8, border: `1px solid ${C.border}` }} />
                <div style={{ fontSize: TYPE.micro, color: C.success, marginTop: SPACE.xs }}><Check size={14} style={{ display: 'inline' }} /> Drawing attached</div>
              </div>
            )}
          </div>
        )}

        <div style={{ ...S.cardSoft, padding: `${SPACE.md2}px ${SPACE.lg}px`, marginBottom: SPACE.lg }}>
          <div style={{ fontSize: TYPE.micro, color: C.textMuted, marginBottom: SPACE.md, fontWeight: WEIGHT.medium, letterSpacing: '0.04em' }}>QUESTION OVERVIEW — {answeredCount}/{total} answered</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
            {questions.map((_, idx) => {
              const ans = answers[idx];
              const isAnswered = typeof ans === 'number' ? ans >= 0 : !!(ans?.text?.trim() || ans?.image);
              const isCurrent = idx === currentIndex;
              return (
                <button key={idx} onClick={() => dispatch({ type: 'GO_TO', index: idx })}
                  style={{ width: TAP, height: TAP, borderRadius: 10, border: `2px solid ${isCurrent ? C.primary : isAnswered ? C.success : C.border}`, background: isCurrent ? C.primary : isAnswered ? C.successLight : '#f8fafc', color: isCurrent ? '#fff' : isAnswered ? C.success : C.textMuted, fontSize: TYPE.label, fontWeight: WEIGHT.bold, cursor: 'pointer' }}>{idx + 1}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: SPACE.md, marginBottom: SPACE.md2 }}>
          <button onClick={() => dispatch({ type: 'PREV' })} disabled={currentIndex === 0 || isProcessing('nav_prev')}
            style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: currentIndex === 0 ? C.textLight : C.text, cursor: (currentIndex === 0 || isProcessing('nav_prev')) ? 'default' : 'pointer', fontWeight: WEIGHT.medium, fontSize: TYPE.body, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
            <ArrowLeft size={16} /> Prev
          </button>
          <button onClick={() => dispatch({ type: 'NEXT' })} disabled={currentIndex === total - 1 || isProcessing('nav_next')}
            style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: currentIndex === total - 1 ? C.textLight : C.text, cursor: (currentIndex === total - 1 || isProcessing('nav_next')) ? 'default' : 'pointer', fontWeight: WEIGHT.medium, fontSize: TYPE.body, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
            Next <ArrowRight size={16} />
          </button>
        </div>

        <button onClick={() => setShowConfirmSubmit(true)} disabled={isProcessing('submitQuiz')}
          style={{ ...S.primaryBtn, background: isProcessing('submitQuiz') ? C.disabled : C.success, fontSize: TYPE.h3lg, boxShadow: '0 4px 14px rgba(5,150,105,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm }}>
          {isProcessing('submitQuiz') ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          {isProcessing('submitQuiz') ? 'Submitting…' : `Submit Exam Paper (${answeredCount}/${total} answered)`}
        </button>

        {showExitConfirm && (
          <div style={S.modalOverlay}>
            <div style={S.modalCard}>
              <DoorClosed size={44} style={{ margin: '0 auto', display: 'block', marginBottom: SPACE.md }} />
              <h3 style={S.modalTitle}>Exit Exam?</h3>
              <p style={S.modalBody}>Your progress is saved — you can resume exactly where you left off.</p>
              <div style={S.modalRow}>
                <button onClick={() => setShowExitConfirm(false)} style={S.modalBtnGhost}>Keep going</button>
                <button onClick={() => { setShowExitConfirm(false); startTransition(() => setScreen('setup')); }}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, background: C.error, color: '#fff', border: 'none', fontWeight: WEIGHT.bold, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
                  <LogOut size={16} /> Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {showConfirmSubmit && (
          <div style={S.modalOverlay}>
            <div style={S.modalCard}>
              <Clipboard size={44} style={{ margin: '0 auto', display: 'block', marginBottom: SPACE.md }} />
              <h3 style={S.modalTitle}>Submit Your Paper?</h3>
              <p style={S.modalBody}><strong>{answeredCount}</strong> of <strong>{total}</strong> questions answered.</p>
              {answeredCount < total && (
                <p style={{ textAlign: 'center', color: C.warning, fontSize: TYPE.label, lineHeight: 1.5, margin: '8px 0 0' }}><AlertTriangle size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> {total - answeredCount} unanswered {total - answeredCount === 1 ? 'question' : 'questions'} will be marked incorrect.</p>
              )}
              <div style={S.modalRow}>
                <button onClick={() => setShowConfirmSubmit(false)} style={S.modalBtnGhost}>Go back</button>
                <button onClick={submitQuiz} disabled={isProcessing('submitQuiz')}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, background: isProcessing('submitQuiz') ? C.disabled : C.success, color: '#fff', border: 'none', fontWeight: WEIGHT.bold, cursor: isProcessing('submitQuiz') ? 'default' : 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
                  {isProcessing('submitQuiz') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {isProcessing('submitQuiz') ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }, [questions, phase, currentIndex, answers, textAnswers, imageData, setMcq, setStructured, handleImageUpload, submitQuiz, showConfirmSubmit, showExitConfirm, markingMsgIndex, gradingProgress, isProcessing]);

  // ── Render: Results ──────────────────────────────────────────
  const renderResults = useCallback(() => {
    if (!results) return null;
    const { correct, total, percentage, details, studyMeta } = results;
    const grade = getGrade(percentage);
    const improved = [...new Set(details.filter(d => d.isCorrect).map(d => d.topic))];
    const toReview = [...new Set(details.filter(d => !d.isCorrect).map(d => d.topic))];

    const priorForSubject = prevSession && prevSession.course_id === currentSubjectId ? prevSession : null;
    const delta = priorForSubject ? percentage - priorForSubject.percentage : null;

    const touchedTopics = [...new Set(details.map(d => d.topic).filter(Boolean))];
    const masteryByTopic = touchedTopics.map(t => {
      const wt = weakTopics.find(w => w.topic === t);
      return { topic: t, mastery: wt ? wt.mastery : null };
    }).filter(t => t.mastery != null);

    return (
      <div style={{ ...S.pageMax, padding: `${SPACE.xl}px ${SPACE.lg}px 32px` }}>
        <button onClick={() => { dispatch({ type: 'RESET' }); resetStudyState(); startTransition(() => setScreen('home')); }}
          style={{ ...S.backBtn, marginBottom: SPACE.xl }}>
          <ArrowLeft size={16} style={{ marginRight: SPACE.sm }} /> Dashboard
        </button>

        {/* Score summary card */}
        <div style={{ background: C.card, borderRadius: 20, padding: '28px 24px', textAlign: 'center', marginBottom: SPACE.lg, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 72, fontWeight: WEIGHT.bold, color: grade.color, lineHeight: 1 }}>{grade.letter}</div>
          <div style={{ fontSize: TYPE.body, color: grade.color, fontWeight: WEIGHT.medium, marginTop: SPACE.xs }}>{grade.label}</div>
          <div style={{ fontSize: 40, fontWeight: WEIGHT.bold, color: C.text, marginTop: SPACE.md }}>{percentage}%</div>
          <div style={{ fontSize: TYPE.label, color: C.textMuted, marginTop: SPACE.xs }}>{correct} correct out of {total}</div>
          <div style={{ ...S.progressTrack(8), marginTop: SPACE.lg }}><div style={{ ...S.progressFill(grade.color), width: `${percentage}%` }} /></div>
          {delta != null && (
            <div style={{ marginTop: SPACE.md, fontSize: TYPE.label, fontWeight: WEIGHT.medium, color: delta >= 0 ? C.success : C.textMuted }}>
              {delta > 0 ? <><ArrowRight size={14} style={{ display: 'inline' }} /> {delta} percentage points since last time</> : delta < 0 ? `${Math.abs(delta)} points down vs last time — keep at it` : 'Same as last time'}
            </div>
          )}
        </div>

        {studyMeta && (studyMeta.retryAttempted > 0 || studyMeta.firstAttemptCorrect > 0) && (
          <div style={{ ...S.cardSoft, padding: `${SPACE.md2}px ${SPACE.lg}px`, marginBottom: SPACE.lg, display: 'flex', gap: SPACE.lg }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: C.text }}>{studyMeta.firstAttemptCorrect}/{total}</div>
              <div style={{ fontSize: TYPE.micro, color: C.textMuted }}>First-attempt correct</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: C.text }}>{studyMeta.retrySuccess}/{studyMeta.retryAttempted || 0}</div>
              <div style={{ fontSize: TYPE.micro, color: C.textMuted }}>Retry success</div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: SPACE.md, marginBottom: SPACE.lg }}>
          {improved.length > 0 && (
            <div style={{ flex: 1, background: C.successLight, borderRadius: 14, padding: SPACE.md2 }}>
              <div style={{ fontSize: TYPE.micro, fontWeight: WEIGHT.bold, color: C.success, marginBottom: SPACE.sm, letterSpacing: '0.04em' }}><ThumbsUp size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> SOLID</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>{improved.slice(0, 5).map(t => <span key={t} style={{ padding: '3px 9px', borderRadius: 10, background: '#fff', color: C.success, fontSize: TYPE.micro, fontWeight: WEIGHT.medium }}>{t}</span>)}</div>
            </div>
          )}
          {toReview.length > 0 && (
            <div style={{ flex: 1, background: C.errorLight, borderRadius: 14, padding: SPACE.md2 }}>
              <div style={{ fontSize: TYPE.micro, fontWeight: WEIGHT.bold, color: C.error, marginBottom: SPACE.sm, letterSpacing: '0.04em' }}><ThumbsDown size={14} style={{ display: 'inline', marginRight: SPACE.xs }} /> REVIEW</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>{toReview.slice(0, 5).map(t => <span key={t} style={{ padding: '3px 9px', borderRadius: 10, background: '#fff', color: C.error, fontSize: TYPE.micro, fontWeight: WEIGHT.medium }}>{t}</span>)}</div>
            </div>
          )}
        </div>

        {masteryByTopic.length > 0 && (
          <div style={{ ...S.cardSoft, padding: `${SPACE.lg}px ${SPACE.lg2}px`, marginBottom: SPACE.lg }}>
            <div style={{ fontSize: TYPE.label, fontWeight: WEIGHT.medium, color: C.text, marginBottom: SPACE.md }}><BarChart size={18} style={{ display: 'inline', marginRight: SPACE.xs }} /> Concept mastery</div>
            {masteryByTopic.map(t => (
              <div key={t.topic} style={{ marginBottom: SPACE.sm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TYPE.micro, color: C.textMuted, marginBottom: 4 }}>
                  <span>{t.topic}</span><span>{Math.round(t.mastery * 100)}%</span>
                </div>
                <div style={S.progressTrack(6)}><div style={{ ...S.progressFill(t.mastery >= 0.7 ? C.success : t.mastery >= 0.4 ? C.warning : C.error), width: `${Math.round(t.mastery * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        {toReview.length > 0 && (() => {
          const targetTopic = toReview[0];
          const wt = weakTopics.find(w => w.topic === targetTopic);
          const courseId = wt ? subjectList.find(s => s.title === wt.course)?.id : currentSubjectId;
          const practiceId = `practice_${courseId}_${targetTopic}`;
          return (
            <div style={{ ...S.card, padding: SPACE.lg2, marginBottom: SPACE.lg, border: `1.5px solid ${C.primaryLight}` }}>
              <div style={{ fontSize: TYPE.label, fontWeight: WEIGHT.bold, color: C.text, marginBottom: SPACE.xs }}><GraduationCap size={18} style={{ display: 'inline', marginRight: SPACE.xs }} /> Your next step</div>
              <div style={{ fontSize: TYPE.label, color: C.textMuted, lineHeight: 1.5, marginBottom: SPACE.md }}><strong>{targetTopic}</strong> needs more practice.</div>
              <button onClick={() => courseId && startTopicPractice(courseId, targetTopic)} disabled={!courseId || isSubmitting || isProcessing(practiceId)}
                style={{ ...S.primaryBtn, background: C.primary, fontSize: TYPE.body }}>
                {isSubmitting || isProcessing(practiceId) ? <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: SPACE.xs }} /> : null}
                {isSubmitting || isProcessing(practiceId) ? 'Loading…' : 'Practice weak areas'}
              </button>
            </div>
          );
        })()}

        {/* FIX: Action buttons moved ABOVE the full review list. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, marginBottom: SPACE.xl }}>
          <button onClick={() => { dispatch({ type: 'RESET' }); resetStudyState(); startTransition(() => setScreen('setup')); }}
            style={{ padding: '14px', borderRadius: 14, background: C.primary, color: '#fff', border: 'none', fontWeight: WEIGHT.bold, fontSize: TYPE.h3, cursor: 'pointer', minHeight: TAP, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm }}>
            <RotateCw size={20} /> Retake
          </button>
          <button onClick={() => { dispatch({ type: 'RESET' }); resetStudyState(); startTransition(() => setScreen('home')); }}
            style={{ padding: '14px', borderRadius: 14, background: 'none', color: C.primary, border: `2px solid ${C.primary}`, fontWeight: WEIGHT.medium, fontSize: TYPE.h3, cursor: 'pointer', minHeight: TAP, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm }}>
            <Home size={20} /> Back to Dashboard
          </button>
        </div>

        {/* Full review list now below the CTAs */}
        <div style={{ marginBottom: SPACE.xl }}>
          <div style={{ fontSize: TYPE.h3, fontWeight: WEIGHT.bold, color: C.text, marginBottom: SPACE.md }}>Full Question Review</div>
          {details.map((d, i) => <ReviewCard key={i} detail={d} index={i} />)}
        </div>
      </div>
    );
  }, [results, prevSession, currentSubjectId, weakTopics, subjectList, startTopicPractice, isSubmitting, isProcessing]);

  // ─── Main render ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80, display: 'flex', flexDirection: 'column', fontFamily: FONT_STACK, lineHeight: 1.5 }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>{screen === 'home' ? <HomeSkeleton /> : <SetupSkeleton />}</div>
        <BottomNav />
      </div>
    );
  }

  if (error) return (
    <div style={{ padding: '48px 20px', textAlign: 'center', maxWidth: 380, margin: '0 auto', minHeight: '100vh', background: C.bg, fontFamily: FONT_STACK, lineHeight: 1.5 }}>
      <AlertTriangle size={48} color={C.error} style={{ margin: '0 auto' }} />
      <div style={{ fontSize: TYPE.body, color: C.error, fontWeight: WEIGHT.medium, marginTop: SPACE.md, marginBottom: SPACE.sm, lineHeight: 1.5 }}>{error}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, marginTop: SPACE.lg }}>
        {errorType === 'settings' ? (
          <>
            <button onClick={() => navigate('/settings')}
              style={{ padding: '12px 24px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: WEIGHT.medium, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
              <SettingsIcon size={16} /> Go to Settings
            </button>
            <button onClick={() => window.location.reload()}
              style={{ padding: '10px 24px', borderRadius: 12, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontWeight: WEIGHT.medium, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
              <RotateCw size={16} /> I've fixed it — Retry
            </button>
          </>
        ) : (
          <button onClick={() => window.location.reload()}
            style={{ padding: '12px 24px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: WEIGHT.medium, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
            <RotateCw size={16} /> Retry
          </button>
        )}
      </div>
    </div>
  );

  return (
    <QuizErrorBoundary>
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', fontFamily: FONT_STACK, lineHeight: 1.5 }}>
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '80px' }}>
          {screen === 'home'    && renderHome()}
          {screen === 'setup'   && renderSetup()}
          {screen === 'quiz'    && (quizMode === 'study' ? renderStudyQuestion() : renderExamQuestion())}
          {screen === 'results' && renderResults()}
        </div>

        {showResumeModal && (
          <div style={S.modalOverlay}>
            <div style={S.modalCard}>
              <FolderOpen size={44} style={{ margin: '0 auto', display: 'block', marginBottom: SPACE.md }} />
              <h3 style={S.modalTitle}>Unfinished Session</h3>
              <p style={{ ...S.modalBody, margin: '0 0 24px' }}>You have a session in progress. Continue where you left off?</p>
              <div style={{ display: 'flex', gap: SPACE.md2 }}>
                <button onClick={() => { clearQuizResume(); setShowResumeModal(false); setPendingResume(null); }} style={S.modalBtnGhost}>Discard</button>
                <button onClick={() => {
                  if (pendingResume) {
                    setCurrentSubjectId(pendingResume.subjectId);
                    setQuizMode(pendingResume.quizMode || 'exam');
                    dispatch({ type: 'RESTORE', q: pendingResume.questions, idx: pendingResume.currentIndex, ans: pendingResume.answers });
                    startTransition(() => setScreen('quiz'));
                    clearQuizResume();
                  }
                  setShowResumeModal(false); setPendingResume(null);
                }} style={{ flex: 1, padding: '13px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: WEIGHT.bold, cursor: 'pointer', fontSize: TYPE.label, minHeight: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
                  <Check size={16} /> Resume
                </button>
              </div>
            </div>
          </div>
        )}

        <Toast toasts={toasts} removeToast={removeToast} />
        <BottomNav />
      </div>
    </QuizErrorBoundary>
  );
};

export default Quiz;