// Quiz.jsx – Pure JS, no TypeScript, SmilesCanvas inline
// Flow: Home → Setup → Quiz → Submit → AI Grading → Results

import React, {
  useState, useEffect, useCallback, useReducer, useRef,
} from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import SmilesDrawer from 'smiles-drawer';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#f0f6ff', card: '#ffffff',
  primary: '#2563eb', primaryDark: '#1d4ed8',
  primaryLight: '#dbeafe', primaryMuted: '#eff6ff',
  success: '#059669', successLight: '#d1fae5',
  error: '#dc2626', errorLight: '#fee2e2',
  warning: '#d97706', warningLight: '#fef3c7',
  border: '#e2e8f0', text: '#0f172a',
  textMuted: '#64748b', textLight: '#94a3b8',
  overlay: 'rgba(15,23,42,0.5)', disabled: '#94a3b8',
};

// ─── Error Boundary (plain JS class, no generics) ────────────────────────────
class QuizErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 48 }}>⚠️</p>
        <h3 style={{ color: C.error }}>Something went wrong</h3>
        <p style={{ color: C.textMuted }}>{this.state.error?.message}</p>
        <button onClick={() => window.location.reload()}
          style={{ marginTop: 16, padding: '10px 24px', borderRadius: 10, background: C.primary, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Reload
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── SMILES Canvas (inline, no separate file) ─────────────────────────────────
const SmilesCanvas = ({ smiles, width = 280, height = 180 }) => {
  const ref = useRef(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!ref.current || !smiles || err) return;
    try {
      const d = new SmilesDrawer.Drawer({ width, height, bondThickness: 1.4 });
      SmilesDrawer.parse(smiles, tree => d.draw(tree, ref.current, 'light', false), () => setErr(true));
    } catch { setErr(true); }
  }, [smiles, width, height]);
  if (!smiles) return null;
  if (err) return <span style={{ fontSize: 13, color: C.textMuted }}>⚠️ Structure unavailable</span>;
  return <canvas ref={ref} width={width} height={height} style={{ maxWidth: '100%', borderRadius: 8 }} />;
};

// ─── LaTeX fix: double-escaped backslashes from DB ────────────────────────────
const fixLatex = (math) =>
  math.replace(/\\\\/g, '\\').replace(/\\_/g, '_').replace(/\\\^/g, '^');
// Clean common LaTeX extraction errors
const cleanLatexErrors = (latex) => {
  if (typeof latex !== 'string') return latex;
  let cleaned = latex;
  // Fix \text{text...} → \text{...}
  cleaned = cleaned.replace(/\\text\{text/g, '\\text{');
  // Fix \times \text{times} → \times
  cleaned = cleaned.replace(/\\times\s*\\text\{times\}/g, '\\times');
  // Fix \text{...} but with double closing braces? Not needed.
  return cleaned;
};
// Convert common chemical formulas like H2O → H$_{2}$O
const chemToLatex = (text) => {
  if (typeof text !== 'string') return text;
  // Pattern: uppercase letter (optional lowercase) followed by digits
  return text.replace(/([A-Z][a-z]?)(\d+)/g, (match, element, num) => {
    return `${element}$_{${num}}$`;
  });
};
// ─── Safe LaTeX renderer ──────────────────────────────────────────────────────
const SafeLatex = React.memo(({ text }) => {
  if (!text) return null;
  try {
    // First, apply chemical conversion, then clean LaTeX errors
    const converted = chemToLatex(text);
    const cleaned = cleanLatexErrors(converted);
    const parts = cleaned.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith('$$') && part.endsWith('$$'))
            return <BlockMath key={i} math={fixLatex(part.slice(2, -2))} />;
          if (part.startsWith('$') && part.endsWith('$') && part.length > 2)
            return <InlineMath key={i} math={fixLatex(part.slice(1, -1))} />;
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  } catch {
    return <span>{text}</span>;
  }
});

// ─── Question display (hides SMILES for diagram questions during exam) ────────
const QuestionDisplay = React.memo(({ question, hideDiagram }) => {
  const { question: text, latex_math, smiles, image_url, question_type } = question;
  const isDiagram = question_type === 'diagram';
  return (
    <div>
      <div style={{ fontSize: 16, lineHeight: 1.7, color: C.text }}>
        <SafeLatex text={text} />
      </div>
      {latex_math && !text?.includes('$') && (
        <div style={{ margin: '12px 0', padding: '12px', background: C.primaryMuted, borderRadius: 10 }}>
          <BlockMath math={fixLatex(latex_math)} />
        </div>
      )}
      {smiles && !isDiagram && (
        <div style={{ margin: '12px 0', textAlign: 'center' }}>
          <SmilesCanvas smiles={smiles} />
        </div>
      )}
      {isDiagram && hideDiagram && (
        <div style={{ margin: '12px 0', padding: '12px 16px', background: C.warningLight, borderRadius: 10, fontSize: 13, color: C.warning, fontWeight: 500 }}>
          📝 Draw your answer on paper and upload a photo below
        </div>
      )}
      {image_url && (
        <img src={image_url} alt="Question diagram" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 12 }} />
      )}
    </div>
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  if (pct >= 80) return { letter: 'A', label: 'Excellent!',   color: C.success,  bg: C.successLight };
  if (pct >= 70) return { letter: 'B', label: 'Good job!',    color: '#0891b2',  bg: '#e0f2fe' };
  if (pct >= 60) return { letter: 'C', label: 'Keep going!',  color: C.warning,  bg: C.warningLight };
  if (pct >= 50) return { letter: 'D', label: 'Needs work',   color: '#ea580c',  bg: '#ffedd5' };
  return           { letter: 'F', label: 'Study harder',      color: C.error,    bg: C.errorLight };
};

const BADGES = [
  { id: 'first_quiz',    label: 'First Quiz',    icon: '🏁', check: s => s.completed >= 1 },
  { id: 'streak_3',      label: '3-Day Streak',  icon: '🔥', check: s => s.streak >= 3 },
  { id: 'streak_7',      label: '7-Day Streak',  icon: '⚡', check: s => s.streak >= 7 },
  { id: 'master_90',     label: 'Mastery 90%',   icon: '🏆', check: s => s.totalQ > 0 && s.totalCorrect / s.totalQ >= 0.9 },
  { id: '100_questions', label: '100 Questions', icon: '📚', check: s => s.totalQ >= 100 },
];

// ─── Toast ────────────────────────────────────────────────────────────────────
const Toast = ({ toasts, removeToast }) => (
  <div style={{ position: 'fixed', bottom: 90, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
    {toasts.map(t => (
      <div key={t.id} style={{
        padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 500,
        background: t.type === 'error' ? C.error : t.type === 'success' ? C.success : C.primary,
        color: '#fff', display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 300,
      }}>
        <span style={{ flex: 1 }}>{t.message}</span>
        <button onClick={() => removeToast(t.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
    ))}
  </div>
);

// ─── Quiz reducer ─────────────────────────────────────────────────────────────
const initState = { questions: [], currentIndex: 0, answers: {}, phase: 'idle', results: null };

function reducer(state, action) {
  switch (action.type) {
    case 'START':   return { questions: action.questions, currentIndex: 0, answers: {}, phase: 'active', results: null };
    case 'ANSWER':  return { ...state, answers: { ...state.answers, [action.index]: action.value } };
    case 'GO_TO':   return { ...state, currentIndex: Math.max(0, Math.min(action.index, state.questions.length - 1)) };
    case 'NEXT':    return state.currentIndex < state.questions.length - 1 ? { ...state, currentIndex: state.currentIndex + 1 } : state;
    case 'PREV':    return state.currentIndex > 0 ? { ...state, currentIndex: state.currentIndex - 1 } : state;
    case 'GRADING': return { ...state, phase: 'grading' };
    case 'DONE':    return { ...state, phase: 'done', results: action.results };
    case 'RESTORE': return { questions: action.q, currentIndex: action.idx, answers: action.ans, phase: 'active', results: null };
    case 'RESET':   return initState;
    default:        return state;
  }
}

// ─── Question review accordion card ──────────────────────────────────────────
const ReviewCard = ({ detail, index }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 12, marginBottom: 10, overflow: 'hidden', border: `1px solid ${detail.isCorrect ? '#bbf7d0' : '#fecaca'}` }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
        <span style={{ fontSize: 18 }}>{detail.isCorrect ? '✅' : '❌'}</span>
        <span style={{ flex: 1, fontSize: 14, color: C.text, fontWeight: 500 }}>
          Q{index + 1}: <SafeLatex text={(detail.question || '').substring(0, 80) + ((detail.question || '').length > 80 ? '…' : '')} />
        </span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>Your answer:</div>
            <div style={{ fontSize: 14, color: detail.isCorrect ? C.success : C.error, fontWeight: 500 }}>
              {detail.userAnswerText || <em style={{ color: C.textMuted }}>No answer given</em>}
            </div>
          </div>
          {!detail.isCorrect && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>Correct answer:</div>
              <div style={{ fontSize: 14, color: C.success, fontWeight: 500 }}>
                <SafeLatex text={detail.correctAnswerText || ''} />
              </div>
              {detail.smiles && (
                <div style={{ marginTop: 8, textAlign: 'center' }}>
                  <SmilesCanvas smiles={detail.smiles} width={240} height={150} />
                </div>
              )}
            </div>
          )}
          {detail.explanation && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: C.primaryMuted, borderRadius: 8, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
              💡 <SafeLatex text={detail.explanation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main Quiz Component ──────────────────────────────────────────────────────
const Quiz = () => {
  const location = useLocation();

  const [screen, setScreen] = useState('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [subjects, setSubjects] = useState({});
  const [currentSubjectId, setCurrentSubjectId] = useState(null);
  const [setupCount, setSetupCount] = useState(10);
  const [setupMode, setSetupMode] = useState('auto');

  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ completed: 0, totalCorrect: 0, totalQ: 0, streak: 0, lastActivity: null, badges: [] });
  const [lastSession, setLastSession] = useState(null);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [weakTopics, setWeakTopics] = useState([]);
  const dailyGoal = 10;

  const [textAnswers, setTextAnswers] = useState({});
  const [imageData, setImageData] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingResume, setPendingResume] = useState(null);

  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), []);

  const [quiz, dispatch] = useReducer(reducer, initState);
  const { questions, currentIndex, answers, phase, results } = quiz;

  // ── DB stats ──────────────────────────────────────────────────────────────
 const fetchDBStats = useCallback(async (uid) => {
  try {
    // Get weak topics from the dedicated table
    const { data: weakData, error: weakError } = await supabase
      .from('user_weak_topics')
      .select('topic, mastery, course')
      .eq('user_id', uid);

    if (!weakError && weakData) {
      setWeakTopics(
        weakData.map(w => ({
          topic: w.topic,
          mastery: w.mastery,
          course: w.course || 'General',
        }))
      );
    }

    // Get last session (use maybeSingle to avoid 406)
    const { data: last, error: lastError } = await supabase
      .from('quiz_sessions')
      .select('*')
      .eq('user_id', uid)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastError && last) setLastSession(last);
  } catch (err) {
    console.warn('Could not fetch stats:', err);
  }
}, []);

  // ── Load user + subjects ──────────────────────────────────────────────────
  const loadUser = useCallback(async (authUser) => {
  if (!authUser) {
    setError('You are not logged in.');
    setLoading(false);
    return;
  }
  setUser(authUser);

  try {
    // Get or create profile
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!profile) {
      // Insert with default values (new columns will get defaults)
      await supabase.from('profiles').insert({ id: authUser.id });
      const { data: newProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();
      profile = newProfile;
    }

    // Read stats from profile (no localStorage)
    const todayStr = new Date().toDateString();
    const dailyCounts = profile.daily_counts || {};
    const todayAnswered = dailyCounts[todayStr] || 0;
    setTodayAnswered(todayAnswered);

    setStats({
      completed: profile.quizzes_completed || 0,
      totalCorrect: profile.total_correct || 0,
      totalQ: profile.total_questions || 0,
      streak: profile.streak || 0,
      lastActivity: profile.last_active || null,
      badges: profile.badges || [],
    });

    // Program & semester check
    if (!profile.program || profile.semester == null) {
      setError('Please set your program and semester in Settings first.');
      setLoading(false);
      return;
    }

    // Fetch courses for this program/semester
    const { data: prog } = await supabase
      .from('programs')
      .select('id')
      .eq('name', profile.program)
      .maybeSingle();

    if (!prog) throw new Error(`Program "${profile.program}" not found.`);

    const { data: courses, error: ce } = await supabase
      .from('courses')
      .select('id, course_name, course_code')
      .eq('program_id', prog.id)
      .eq('semester', parseInt(profile.semester, 10));

    if (ce) throw new Error(ce.message);

    const map = {};
    (courses || []).forEach(c => {
      map[c.id] = {
        id: c.id,
        title: c.course_name,
        code: c.course_code,
        icon: '📘',
      };
    });
    setSubjects(map);
    if (!Object.keys(map).length) {
      setError('No courses found for your program/semester.');
    }

    // Fetch weak topics and last session from DB
    await fetchDBStats(authUser.id);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}, [fetchDBStats]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user } }) => { if (mounted) loadUser(user); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
      if (!mounted) return;
      if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') loadUser(session?.user);
      if (ev === 'SIGNED_OUT') setError('You have been signed out.');
    });
    return () => { mounted = false; subscription?.unsubscribe(); };
  }, [loadUser]);

  // ── Resume detection ──────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('studyhub_quiz_state') || 'null');
      if (saved?.questions?.length > 0) { setPendingResume(saved); setShowResumeModal(true); }
    } catch { /* corrupt */ }
  }, []);

  // ── Persist quiz state ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'active' && questions.length > 0) {
      localStorage.setItem('studyhub_quiz_state', JSON.stringify({ questions, currentIndex, answers, subjectId: currentSubjectId }));
    } else {
      localStorage.removeItem('studyhub_quiz_state');
    }
  }, [phase, questions, currentIndex, answers, currentSubjectId]);

  // ── External navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const st = location.state;
    if (st?.subjectId && subjects[st.subjectId]) {
      setCurrentSubjectId(st.subjectId);
      setScreen('setup');
      window.history.replaceState({}, '');
    }
  }, [location, subjects]);

  // ── Fetch questions ───────────────────────────────────────────────────────
const getAdaptiveQuiz = useCallback(async (courseId, mode, count) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const url = `${base}/api/exam/quiz?mode=${mode}&count=${count}&courseId=${courseId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }
    const data = await res.json();
    return data.questions.map(r => ({
      id: r.id,
      question: r.question || '',
      question_type: r.question_type || 'mcq',
      options: r.question_type === 'mcq'
        ? [r.option_a, r.option_b, r.option_c, r.option_d].map(o => o || '')
        : [],
      correct_answer_index: r.question_type === 'mcq'
        ? ['A','B','C','D'].indexOf((r.answer || '').trim().toUpperCase())
        : null,
      answer: r.answer || '',
      explanation: r.explanation || '',
      topic: r.topic || 'General',
      course: r.course || 'Unknown',
      marks: r.marks || 1,
      latex_math: r.latex_math || null,
      smiles: r.smiles || null,
      image_url: r.image_url || null,
    }));
  } catch (err) {
    console.error('Adaptive quiz error:', err);
    addToast('Could not load adaptive quiz. Please try again.', 'error');
    return [];
  }
}, [addToast]);

  // ── Start quiz ────────────────────────────────────────────────────────────
  const startQuiz = async (subjectId, mode, count) => {
  setIsSubmitting(true);
  console.log('🚀 Starting quiz with:', { subjectId, mode, count });

  // ✅ Use adaptive quiz endpoint (not direct fetchQuestions)
  const qs = await getAdaptiveQuiz(subjectId, mode, count);

  if (!qs.length) {
    addToast('No questions available for this subject. Upload a past paper first.', 'error');
    setIsSubmitting(false);
    return;
  }

  dispatch({ type: 'START', questions: qs });
  setTextAnswers({});
  setImageData({});
  setScreen('quiz');
  setIsSubmitting(false);
};
  // ── Answer handlers ───────────────────────────────────────────────────────
  const setMcq = (index, optionIndex) => dispatch({ type: 'ANSWER', index, value: optionIndex });

  const setStructured = (index, text) => {
    setTextAnswers(p => ({ ...p, [index]: text }));
    const prev = answers[index] || {};
    dispatch({ type: 'ANSWER', index, value: { ...prev, text } });
  };

  const handleImageUpload = async (index, file) => {
    try {
      const blob = await compressImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = reader.result;
        setImageData(p => ({ ...p, [index]: b64 }));
        const prev = answers[index] || {};
        dispatch({ type: 'ANSWER', index, value: { ...prev, image: b64 } });
        addToast('Drawing attached & compressed ✅', 'success');
      };
      reader.readAsDataURL(blob);
    } catch { addToast('Image processing failed', 'error'); }
  };

  // ── AI grading with keyword fallback ─────────────────────────────────────
const gradeStructured = async (questionText, correctAnswer, userAnswer) => {
  // ✅ If no user answer, skip API and return fallback
  if (!userAnswer?.trim()) {
    return { correct: false, explanation: `No answer provided. Correct answer: ${correctAnswer}` };
  }

  // 1️⃣ Try AI grading from backend
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const url = `${base}/api/exam/grade`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questionText, correctAnswer, userAnswer }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return await res.json();
      // If API returns an error (e.g., 400), fall through to keyword matching
    }
  } catch { /* fallback */ }

  // 2️⃣ Fallback: lenient keyword matching (unchanged)
  const ua = userAnswer.toLowerCase().trim();
  const ca = (correctAnswer || '').toLowerCase().trim();

  const stopwords = new Set([
    'the','a','an','of','for','on','at','to','in','with','without',
    'and','or','but','not','by','from','as','so','if','then','else',
    'when','where','which','that','this','these','those','are','is','was','were'
  ]);
  const caWords = ca.split(/\W+/).filter(w => w.length > 2 && !stopwords.has(w));
  const uaWords = ua.split(/\W+/).filter(w => w.length > 2 && !stopwords.has(w));

  if (!caWords.length) {
    return { correct: ua === ca, explanation: ua === ca ? 'Correct!' : `Incorrect. Correct answer: ${correctAnswer}` };
  }

  const intersection = caWords.filter(w =>
    uaWords.some(uw => uw.includes(w) || w.includes(uw))
  );
  const score = intersection.length / caWords.length;

  if (score >= 0.5) {
    return { correct: true, explanation: 'Good – you covered the key concepts.' };
  }
  if (score >= 0.25) {
    return { correct: false, explanation: `Partial match. Full answer: ${correctAnswer}` };
  }
  return { correct: false, explanation: `Incorrect. Correct answer: ${correctAnswer}` };
};
  // ── Submit all answers → grade → show results ─────────────────────────────
 const submitQuiz = async () => {
  setShowConfirmSubmit(false);
  dispatch({ type: 'GRADING' });
  const optLabels = ['A', 'B', 'C', 'D'];

  const details = await Promise.all(
    questions.map(async (q, idx) => {
      if (q.question_type === 'mcq') {
        const chosen = answers[idx];
        const correct = chosen === q.correct_answer_index;
        return {
          index: idx, isCorrect: correct,
          userAnswerText: chosen != null && chosen >= 0 ? `${optLabels[chosen]}. ${q.options[chosen]}` : 'No answer',
          correctAnswerText: q.correct_answer_index != null
            ? `${optLabels[q.correct_answer_index]}. ${q.options[q.correct_answer_index]}`
            : q.answer,
          question: q.question, topic: q.topic, explanation: q.explanation, smiles: q.smiles,
        };
      }
      const ans = answers[idx] || {};
      const userText = ans.text || '';
      const hasImage = !!ans.image;
      const { correct, explanation } = await gradeStructured(q.question, q.answer, userText);
      return {
        index: idx, isCorrect: correct,
        userAnswerText: userText || (hasImage ? '[Drawing uploaded]' : 'No answer'),
        correctAnswerText: q.answer,
        question: q.question, topic: q.topic,
        explanation: explanation || q.explanation, smiles: q.smiles,
      };
    })
  );

  const correctCount = details.filter(d => d.isCorrect).length;
  const total = questions.length;
  const percentage = Math.round((correctCount / total) * 100);
  dispatch({ type: 'DONE', results: { correct: correctCount, total, percentage, details } });

  // ✅ Send each answer to the backend for spaced repetition
  const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';   // <-- base without /api/exam
  await Promise.all(
    details.map(async (d) => {
      const q = questions[d.index];
      const userAnswer = (answers[d.index] && answers[d.index].text) || '';
      const payload = {
        questionId: q.id,
        questionType: q.question_type,
        correct: d.isCorrect,
        topic: q.topic,
        userAnswer: userAnswer,
        questionText: q.question,
        correctAnswer: q.answer,
        course: q.course || 'Unknown',
      };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          await fetch(`${base}/api/exam/submit-answer`, {   // <-- correct path
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          });
        }
      } catch (err) {
        console.warn('Failed to send answer to backend:', err);
      }
    })
  );

  await persistResults(correctCount, total, details);
  setScreen('results');
};
  // ── Persist results + update stats ───────────────────────────────────────
const persistResults = async (correct, total, details) => {
  const todayStr = new Date().toDateString();

  // 1. Get current profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_questions, total_correct, daily_counts, quizzes_completed, streak, last_active, badges')
    .eq('id', user.id)
    .single();

  const newTotalQ = (profile?.total_questions || 0) + total;
  const newTotalCorrect = (profile?.total_correct || 0) + correct;
  const newCompleted = (profile?.quizzes_completed || 0) + 1;

  // Streak logic
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  let newStreak = profile?.streak || 0;
  if (profile?.last_active !== todayStr) {
    newStreak = profile?.last_active === yesterday.toDateString() ? newStreak + 1 : 1;
  }

  // Daily counts
  const daily = profile?.daily_counts || {};
  daily[todayStr] = (daily[todayStr] || 0) + total;

  // Badges
  const newBadges = [...(profile?.badges || [])];
  const updatedStats = { totalQ: newTotalQ, totalCorrect: newTotalCorrect, completed: newCompleted, streak: newStreak };
  BADGES.forEach(b => {
    if (!newBadges.includes(b.id) && b.check(updatedStats)) {
      newBadges.push(b.id);
    }
  });

  // 2. Update profile
  await supabase
    .from('profiles')
    .update({
      total_questions: newTotalQ,
      total_correct: newTotalCorrect,
      quizzes_completed: newCompleted,
      streak: newStreak,
      last_active: todayStr,
      badges: newBadges,
      daily_counts: daily,
    })
    .eq('id', user.id);

  // 3. Update local state
  setStats(prev => ({
    ...prev,
    totalQ: newTotalQ,
    totalCorrect: newTotalCorrect,
    completed: newCompleted,
    streak: newStreak,
    lastActivity: todayStr,
    badges: newBadges,
  }));
  setTodayAnswered(daily[todayStr] || 0);

  // 4. Insert quiz session (now works after column type change)
  await supabase.from('quiz_sessions').insert({
  user_id: user.id,
  course_id: currentSubjectId,        // integer (217, 220, etc.)
  total_questions: total,
  correct_answers: correct,
  percentage: Math.round((correct / total) * 100),
  completed_at: new Date().toISOString(),
});

  // 🔥 REMOVED: duplicate user_progress insert – backend handles this via /submit-answer
};

  // ─── Home screen ───────────────────────────────────────────────────────────
const renderHome = () => {
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student';

  // Improved exam readiness: based on mastery and total attempts
  const avgMastery = weakTopics.length
    ? weakTopics.reduce((sum, w) => sum + w.mastery, 0) / weakTopics.length
    : 0.5;
  const attemptsFactor = 1 - Math.exp(-stats.totalQ / 50);
  const readiness = Math.min(100, Math.round(avgMastery * attemptsFactor * 100));

  const todayPct = Math.min(100, Math.round((todayAnswered / dailyGoal) * 100));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Group weak topics by course
  const groupedWeak = weakTopics.reduce((acc, w) => {
    const course = w.course || 'General';
    if (!acc[course]) acc[course] = [];
    acc[course].push(w);
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: C.textMuted }}>{greeting} 👋</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{name}</div>
      </div>

      {/* Readiness */}
      <div style={{ background: C.card, borderRadius: 16, padding: '18px 20px', marginBottom: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Exam Readiness</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: readiness >= 70 ? C.success : readiness >= 50 ? C.warning : C.error }}>{readiness}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${readiness}%`, background: readiness >= 70 ? C.success : readiness >= 50 ? C.warning : C.error, borderRadius: 4, transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.textMuted }}>{stats.totalCorrect} correct · {stats.totalQ} attempted · {stats.completed} sessions</div>
      </div>

      {/* Daily goal */}
      <div style={{ background: C.card, borderRadius: 16, padding: '16px 20px', marginBottom: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Today's Goal</span>
          <span style={{ fontSize: 14, color: C.primary, fontWeight: 600 }}>{todayAnswered}/{dailyGoal} questions</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${todayPct}%`, background: C.primary, borderRadius: 3, transition: 'width 0.4s ease' }} />
        </div>
        {todayPct >= 100 && <div style={{ marginTop: 6, fontSize: 12, color: C.success, fontWeight: 500 }}>🎉 Daily goal achieved!</div>}
      </div>

      {/* Last session */}
      {lastSession && (
        <div style={{ background: C.primaryMuted, borderRadius: 14, padding: '14px 18px', marginBottom: 14, border: `1px solid ${C.primaryLight}` }}>
          <div style={{ fontSize: 11, color: C.primary, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>LAST SESSION</div>
          <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>
            {subjects[lastSession.subject_id]?.title || 'Quiz'} —{' '}
            <span style={{ color: lastSession.percentage >= 70 ? C.success : C.warning, fontWeight: 700 }}>{lastSession.percentage}%</span>
            <span style={{ color: C.textMuted }}> ({lastSession.correct_answers}/{lastSession.total_questions})</span>
          </div>
        </div>
      )}

      {/* Streak */}
      {stats.streak > 0 && (
        <div style={{ background: '#fff7ed', borderRadius: 12, padding: '10px 16px', marginBottom: 14, border: '1px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🔥</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.warning }}>{stats.streak} Day Streak</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Keep it up!</div>
          </div>
        </div>
      )}

      {/* Weak topics – grouped by course */}
      {weakTopics.length > 0 && (
        <div style={{ background: C.card, borderRadius: 14, padding: '14px 18px', marginBottom: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Areas to Improve 📍</div>
          {Object.entries(groupedWeak).map(([course, topics]) => (
            <div key={course} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, marginBottom: 4 }}>{course}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {topics.map(w => (
                  <span key={w.topic} style={{ padding: '4px 10px', borderRadius: 20, background: C.errorLight, color: C.error, fontSize: 12, fontWeight: 500 }}>
                    {w.topic} · {Math.round(w.mastery * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subject list */}
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10, marginTop: 4 }}>Pick a Subject</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Object.values(subjects).map(subj => (
          <button key={subj.id}
            onClick={() => { setCurrentSubjectId(subj.id); setScreen('setup'); }}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: 28 }}>{subj.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{subj.title}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{subj.code}</div>
            </div>
            <span style={{ color: C.textLight, fontSize: 18 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
};

  // ─── Setup screen ──────────────────────────────────────────────────────────
  const renderSetup = () => {
    const subj = subjects[currentSubjectId];
    if (!subj) return <div style={{ padding: 32, color: C.error }}>Subject not found.</div>;
    const modes = [
      { id: 'auto',       icon: '🎯', label: 'Mixed Questions',      desc: 'A combination of MCQ and written — ideal for full exam prep' },
      { id: 'mcq',        icon: '✅', label: 'Multiple Choice Only', desc: 'Only tick-box questions — fast practice, instant results' },
      { id: 'structured', icon: '✍️', label: 'Written & Diagrams',   desc: 'Open-ended and drawing questions — AI marks your responses' },
    ];
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <button onClick={() => setScreen('home')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}>
          ← Back
        </button>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>{subj.icon} {subj.title}</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 24 }}>Set up your exam session</div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>Question Style</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {modes.map(m => (
              <button key={m.id} onClick={() => setSetupMode(m.id)}
                style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${setupMode === m.id ? C.primary : C.border}`, background: setupMode === m.id ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 22, marginTop: 2 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: setupMode === m.id ? C.primary : C.text }}>{m.label}</div>
                  <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{m.desc}</div>
                </div>
                {setupMode === m.id && <span style={{ color: C.primary, fontSize: 18, marginTop: 2 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>Number of Questions</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[5, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setSetupCount(n)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: `2px solid ${setupCount === n ? C.primary : C.border}`, background: setupCount === n ? C.primaryMuted : C.card, color: setupCount === n ? C.primary : C.text, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => startQuiz(currentSubjectId, setupMode, setupCount)} disabled={isSubmitting}
          style={{ width: '100%', padding: '16px', borderRadius: 14, background: isSubmitting ? C.disabled : C.primary, color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: isSubmitting ? 'default' : 'pointer' }}>
          {isSubmitting ? '⏳ Loading questions…' : '🚀 Enter Exam Room'}
        </button>
      </div>
    );
  };

  // ─── Quiz screen ───────────────────────────────────────────────────────────
  const renderQuiz = () => {
    if (!questions.length) return null;

    if (phase === 'grading') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: 16, padding: 32 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: 56 }}>📝</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Marking your paper…</div>
        <div style={{ fontSize: 14, color: C.textMuted, textAlign: 'center', maxWidth: 260 }}>AI is reviewing each answer. Sit tight!</div>
        <div style={{ width: 44, height: 44, border: `4px solid ${C.primaryLight}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.9s linear infinite', marginTop: 8 }} />
      </div>
    );

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
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 24px' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => { if (window.confirm('Exit exam? Your progress is saved.')) setScreen('setup'); }}
            style={{ padding: '6px 12px', borderRadius: 8, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontSize: 13, cursor: 'pointer' }}>
            ← Exit
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Q{currentIndex + 1}</span>
            <span style={{ fontSize: 14, color: C.textMuted }}> / {total}</span>
          </div>
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: isMcq ? C.primaryLight : isDiagram ? C.warningLight : '#f0fdf4', color: isMcq ? C.primary : isDiagram ? C.warning : C.success }}>
            {isMcq ? 'MCQ' : isDiagram ? 'Diagram' : 'Written'}
          </span>
        </div>

        {/* Progress */}
        <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: 'hidden', marginBottom: 18 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: C.primary, borderRadius: 3, transition: 'width 0.3s ease' }} />
        </div>

        {/* Question */}
        <div style={{ background: C.card, borderRadius: 16, padding: '20px', marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {q.marks > 1 && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, fontWeight: 500 }}>[{q.marks} marks]</div>}
          <QuestionDisplay question={q} hideDiagram={isDiagram} />
        </div>

        {/* Answer */}
        {isMcq ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {q.options.map((opt, idx) => (
              <button key={idx} onClick={() => setMcq(currentIndex, idx)}
                style={{ padding: '14px 16px', borderRadius: 14, border: `2px solid ${currentAnswer === idx ? C.primary : C.border}`, background: currentAnswer === idx ? C.primaryMuted : C.card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: currentAnswer === idx ? C.primary : C.border, color: currentAnswer === idx ? '#fff' : C.textMuted, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {'ABCD'[idx]}
                </span>
                <span style={{ fontSize: 15, color: C.text, lineHeight: 1.5 }}><SafeLatex text={opt} /></span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <textarea rows={5} value={textValue} onChange={e => setStructured(currentIndex, e.target.value)}
              placeholder={isDiagram ? 'Add notes or labels… then attach your drawing below' : 'Type your answer here…'}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: `2px solid ${C.border}`, fontSize: 15, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', color: C.text, background: C.card, boxSizing: 'border-box', outline: 'none' }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '10px 16px', borderRadius: 10, border: `1.5px dashed ${C.primary}`, color: C.primary, fontSize: 14, fontWeight: 500, cursor: 'pointer', background: C.primaryMuted }}>
              📎 {hasImage ? 'Replace drawing' : 'Attach drawing'}
              <input type="file" accept="image/*" hidden onChange={e => { if (e.target.files?.[0]) handleImageUpload(currentIndex, e.target.files[0]); }} />
            </label>
            {hasImage && (
              <div style={{ marginTop: 10 }}>
                <img src={imageData[currentIndex]} alt="Drawing" style={{ maxWidth: 200, borderRadius: 8, border: `1px solid ${C.border}` }} />
                <div style={{ fontSize: 12, color: C.success, marginTop: 4 }}>✅ Drawing attached & compressed</div>
              </div>
            )}
          </div>
        )}

        {/* Question palette */}
        <div style={{ background: C.card, borderRadius: 14, padding: '14px 16px', marginBottom: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em' }}>QUESTION OVERVIEW — {answeredCount}/{total} answered</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {questions.map((_, idx) => {
              const ans = answers[idx];
              const isAnswered = typeof ans === 'number' ? ans >= 0 : !!(ans?.text?.trim() || ans?.image);
              const isCurrent = idx === currentIndex;
              return (
                <button key={idx} onClick={() => dispatch({ type: 'GO_TO', index: idx })}
                  style={{ width: 30, height: 30, borderRadius: 8, border: `2px solid ${isCurrent ? C.primary : isAnswered ? C.success : C.border}`, background: isCurrent ? C.primary : isAnswered ? C.successLight : '#f8fafc', color: isCurrent ? '#fff' : isAnswered ? C.success : C.textMuted, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={() => dispatch({ type: 'PREV' })} disabled={currentIndex === 0}
            style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: currentIndex === 0 ? C.textLight : C.text, cursor: currentIndex === 0 ? 'default' : 'pointer', fontWeight: 600, fontSize: 14 }}>
            ← Prev
          </button>
          <button onClick={() => dispatch({ type: 'NEXT' })}
            style={{ padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: C.textMuted, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
            Skip
          </button>
          <button onClick={() => dispatch({ type: 'NEXT' })} disabled={currentIndex === total - 1}
            style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: currentIndex === total - 1 ? C.textLight : C.text, cursor: currentIndex === total - 1 ? 'default' : 'pointer', fontWeight: 600, fontSize: 14 }}>
            Next →
          </button>
        </div>

        {/* Submit */}
        <button onClick={() => setShowConfirmSubmit(true)}
          style={{ width: '100%', padding: '16px', borderRadius: 14, background: C.success, color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(5,150,105,0.3)' }}>
          Submit Exam Paper ({answeredCount}/{total} answered)
        </button>

        {/* Confirm modal */}
        {showConfirmSubmit && (
          <div style={{ position: 'fixed', inset: 0, background: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: C.card, borderRadius: 20, padding: '28px 24px', maxWidth: 340, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 12 }}>📋</div>
              <h3 style={{ textAlign: 'center', color: C.text, margin: '0 0 8px', fontSize: 18 }}>Submit Your Paper?</h3>
              <p style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, margin: '0 0 4px' }}>
                <strong>{answeredCount}</strong> of <strong>{total}</strong> questions answered.
              </p>
              {answeredCount < total && (
                <p style={{ textAlign: 'center', color: C.warning, fontSize: 13, margin: '8px 0 0' }}>
                  ⚠️ {total - answeredCount} unanswered {total - answeredCount === 1 ? 'question' : 'questions'} will be marked incorrect.
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button onClick={() => setShowConfirmSubmit(false)}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: 'none', color: C.text, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                  Go back
                </button>
                <button onClick={submitQuiz}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, background: C.success, color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                  Submit ✓
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Results screen ────────────────────────────────────────────────────────
  const renderResults = () => {
    if (!results) return null;
    const { correct, total, percentage, details } = results;
    const grade = getGrade(percentage);
    const improved = [...new Set(details.filter(d => d.isCorrect).map(d => d.topic))];
    const toReview = [...new Set(details.filter(d => !d.isCorrect).map(d => d.topic))];
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 32px' }}>
        <button onClick={() => { dispatch({ type: 'RESET' }); setScreen('home'); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'none', border: `1px solid ${C.border}`, color: C.text, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}>
          ← Dashboard
        </button>

        <div style={{ background: C.card, borderRadius: 20, padding: '28px 24px', textAlign: 'center', marginBottom: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 72, fontWeight: 900, color: grade.color, lineHeight: 1 }}>{grade.letter}</div>
          <div style={{ fontSize: 15, color: grade.color, fontWeight: 600, marginTop: 4 }}>{grade.label}</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: C.text, marginTop: 12 }}>{percentage}%</div>
          <div style={{ fontSize: 14, color: C.textMuted, marginTop: 4 }}>{correct} correct out of {total}</div>
          <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: 'hidden', marginTop: 16 }}>
            <div style={{ height: '100%', width: `${percentage}%`, background: grade.color, borderRadius: 4 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {improved.length > 0 && (
            <div style={{ flex: 1, background: C.successLight, borderRadius: 14, padding: '14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.success, marginBottom: 8, letterSpacing: '0.04em' }}>✅ STRONG TOPICS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {improved.slice(0, 5).map(t => (
                  <span key={t} style={{ padding: '2px 8px', borderRadius: 10, background: '#fff', color: C.success, fontSize: 11, fontWeight: 600 }}>{t}</span>
                ))}
              </div>
            </div>
          )}
          {toReview.length > 0 && (
            <div style={{ flex: 1, background: C.errorLight, borderRadius: 14, padding: '14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.error, marginBottom: 8, letterSpacing: '0.04em' }}>📚 REVIEW THESE</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {toReview.slice(0, 5).map(t => (
                  <span key={t} style={{ padding: '2px 8px', borderRadius: 10, background: '#fff', color: C.error, fontSize: 11, fontWeight: 600 }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>Full Question Review</div>
          {details.map((d, i) => <ReviewCard key={i} detail={d} index={i} />)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => { dispatch({ type: 'RESET' }); setScreen('setup'); }}
            style={{ padding: '14px', borderRadius: 14, background: C.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            Retake Exam
          </button>
          <button onClick={() => { dispatch({ type: 'RESET' }); setScreen('home'); }}
            style={{ padding: '14px', borderRadius: 14, background: 'none', color: C.primary, border: `2px solid ${C.primary}`, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  };

  // ─── Loading / Error ───────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 40, height: 40, border: `4px solid ${C.primaryLight}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ fontSize: 14, color: C.textMuted }}>Loading your courses…</div>
    </div>
  );

  if (error) return (
    <div style={{ padding: '48px 20px', textAlign: 'center', maxWidth: 380, margin: '0 auto' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <div style={{ fontSize: 16, color: C.error, fontWeight: 600, marginBottom: 8 }}>{error}</div>
      <button onClick={() => window.location.reload()}
        style={{ marginTop: 16, padding: '12px 24px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
        Retry
      </button>
    </div>
  );

  return (
    <QuizErrorBoundary>
      <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
        {screen === 'home'    && renderHome()}
        {screen === 'setup'   && renderSetup()}
        {screen === 'quiz'    && renderQuiz()}
        {screen === 'results' && renderResults()}
      </div>

      {showResumeModal && (
        <div style={{ position: 'fixed', inset: 0, background: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: C.card, borderRadius: 20, padding: '28px 24px', maxWidth: 340, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 12 }}>📂</div>
            <h3 style={{ textAlign: 'center', color: C.text, margin: '0 0 8px' }}>Unfinished Exam</h3>
            <p style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, margin: '0 0 24px' }}>You have an exam in progress. Continue where you left off?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { localStorage.removeItem('studyhub_quiz_state'); setShowResumeModal(false); setPendingResume(null); }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: 'none', color: C.text, fontWeight: 600, cursor: 'pointer' }}>
                Discard
              </button>
              <button onClick={() => {
                if (pendingResume) {
                  setCurrentSubjectId(pendingResume.subjectId);
                  dispatch({ type: 'RESTORE', q: pendingResume.questions, idx: pendingResume.currentIndex, ans: pendingResume.answers });
                  setScreen('quiz');
                  localStorage.removeItem('studyhub_quiz_state');
                }
                setShowResumeModal(false);
                setPendingResume(null);
              }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, background: C.primary, color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} removeToast={removeToast} />
      <BottomNav />
    </QuizErrorBoundary>
  );
};

export default Quiz;