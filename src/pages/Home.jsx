import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from 'react';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { useNavigate, Navigate } from 'react-router-dom';
import AiStudyAssistantCard from '../components/AiCard';
import Files from '../components/Files';
import { ensureConsistentSession } from '../lib/authGuard';
import {
  Target, FileText, TrendingUp, RefreshCw, Flame, ChevronRight, WifiOff,
} from 'lucide-react';

const DEV = import.meta.env.DEV;
const log = DEV ? console.log : () => {};

const getNotePublicUrl = (note) => {
  if (note.storage_type === 'gdrive' && note.filepath) {
    return `https://drive.google.com/file/d/${note.filepath}/view`;
  }
  if (note.filepath && note.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(note.filepath);
    if (data?.publicUrl) return data.publicUrl;
  }
  if (note.url && (note.url.startsWith('http://') || note.url.startsWith('https://'))) {
    return note.url;
  }
  return null;
};

// ─── Dashboard cache ───────────────────────────────────────────────────────
// FIX: switched from sessionStorage -> localStorage.
// sessionStorage is wiped the moment the tab/app is closed, so a PWA
// re-opened while offline had *nothing* to render — it would sit on the
// skeleton forever. localStorage survives restarts, which is what "must
// load even offline" actually requires. We still treat it as a
// stale-while-revalidate cache (timestamped, always re-validated the
// instant we're back online in loadUserProfile) rather than a permanent
// cache, so this isn't "aggressive" caching — it's just resilient enough
// to paint something real before the network round-trip finishes.
const CACHE_KEY = 'homeDashboardCache';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — stale after this, but still shown while revalidating

const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.updatedAt) return parsed; // legacy cache shape, still usable
    return parsed;
  } catch { return null; }
};
const writeCache = (partial) => {
  try {
    const prev = readCache() || {};
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...prev, ...partial, updatedAt: Date.now() }));
  } catch {}
};

// ─── Activity hints — timed to feel present without being frantic ────────────
const ACTIVITY_HINTS = [
  { emoji: '🧠', text: 'Practice a quiz', cta: 'Start now', route: '/quiz' },
  { emoji: '📄', text: 'Explore past papers', cta: 'Open', route: '/papers' },
  { emoji: '📈', text: 'Review weak areas', cta: 'See topics', route: '/course' },
  { emoji: '🤖', text: 'Ask the AI anything', cta: 'Ask now', route: '/AiChat' },
  { emoji: '📅', text: 'Check your timetable', cta: 'View', route: '/timetable' },
];

// ─── Streak flow — a real sequence, so a numbered/ordered treatment is earned ─
const STREAK_STEPS = [
  { id: 's1', Icon: Target, title: 'Practice a quiz', desc: 'Test yourself on any topic' },
  { id: 's2', Icon: FileText, title: 'Explore past papers', desc: 'See real exam questions' },
  { id: 's3', Icon: TrendingUp, title: 'Improve', desc: 'Review what you got wrong' },
  { id: 's4', Icon: RefreshCw, title: 'Repeat tomorrow', desc: 'Come back to keep the streak alive' },
];

// ─── Hint rotation timing ──────────────────────────────────────────────────
const FIRST_HINT_DELAY_MS = 4000;
const HINT_VISIBLE_MS = 8000;
const HINT_GAP_MS = 6000;
const HINT_CYCLE_MS = HINT_VISIBLE_MS + HINT_GAP_MS;

// ─── Scroll-header thresholds ──────────────────────────────────────────────
// FIX: hysteresis instead of a single 4px trigger.
// A single threshold flips true/false on every tiny bounce of scrollTop
// around that value (rubber-band overscroll on iOS/Android hovers right
// around 0-8px), and each flip re-ran the header's layout-affecting CSS
// transition (padding/width/height/font-size). That rapid re-triggering
// is exactly what reads as "crushing/jamming" while scrolling. A dead
// zone between the enter/exit thresholds means the state can only flip
// once per real scroll gesture.
const SCROLL_COLLAPSE_AT = 24;
const SCROLL_EXPAND_AT = 6;

// ─── Animations ───────────────────────────────────────────────────────────────
// FIX: the two "glow" animations used to animate `box-shadow` directly.
// Animating box-shadow forces the browser to repaint the whole element
// on every frame of the animation (it is not a compositor-only property
// like transform/opacity), continuously, for as long as a card is on
// screen — competing with the scroll thread for frame budget on low-end
// devices. Replaced with a pseudo-layer whose *opacity* is animated
// instead; opacity and transform can run entirely on the compositor
// without ever touching layout or paint, so this now costs effectively
// nothing during scroll.
const ANIM_CSS = `
  @keyframes ed-fade-up {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ed-pop {
    0%   { transform: scale(0.74); opacity: 0; }
    65%  { transform: scale(1.08); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes ed-glow-fade {
    0%, 100% { opacity: 0; }
    50%       { opacity: 1; }
  }
  @keyframes ed-flame {
    0%, 100% { transform: scale(1) rotate(-4deg); }
    50%       { transform: scale(1.2) rotate(5deg); }
  }
  @keyframes ed-progress {
    from { width: 0%; }
  }
  @keyframes ed-toast-in {
    from { opacity: 0; transform: translateY(18px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes ed-toast-out {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to   { opacity: 0; transform: translateY(18px) scale(0.95); }
  }
  .ed-fade-up       { animation: ed-fade-up 0.36s ease-out both; }
  .ed-pop           { animation: ed-pop 0.48s cubic-bezier(.34,1.56,.64,1) both; }
  .ed-flame         { animation: ed-flame 1.5s ease-in-out infinite; }
  .ed-progress      { animation: ed-progress 1.2s ease-out both; }
  .ed-toast-in      { animation: ed-toast-in 0.22s ease-out both; }
  .ed-toast-out     { animation: ed-toast-out 0.2s ease-in both; }

  /* Compositor-only glow: a blurred, absolutely-positioned box whose
     opacity is animated, instead of animating box-shadow on the card
     itself. Costs ~nothing on the main thread. */
  .ed-glow {
    position: absolute;
    inset: -6px;
    border-radius: inherit;
    pointer-events: none;
    z-index: 0;
    filter: blur(10px);
    animation: ed-glow-fade 2.8s ease-in-out infinite;
    will-change: opacity;
  }
  .ed-glow-orange { background: rgba(251,146,60,0.28); }
  .ed-glow-blue   { background: rgba(99,102,241,0.24); }

  @media (prefers-reduced-motion: reduce) {
    .ed-fade-up, .ed-pop, .ed-flame, .ed-progress, .ed-toast-in, .ed-toast-out, .ed-glow {
      animation: none !important;
    }
  }
`;

const StyleInjector = memo(() => <style>{ANIM_CSS}</style>);

const ExamIconSvg = (
  <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
  </svg>
);

// ─── Offline banner ─────────────────────────────────────────────────────────
// Non-blocking: the dashboard keeps working from cache, this just tells
// the person why numbers might be a little stale.
const OfflineBanner = memo(() => (
  <div className="flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] font-medium py-1.5 px-4">
    <WifiOff className="w-3 h-3 flex-shrink-0" />
    <span>You're offline — showing your last saved dashboard</span>
  </div>
));

// ─── Toast ────────────────────────────────────────────────────────────────────
const Toast = memo(({ toast, onDismiss, onAction }) => {
  const [exiting, setExiting] = useState(false);
  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 220);
  }, [onDismiss]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, toast.duration ?? 4000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  const icons = { error: '⚠️', info: 'ℹ️', success: '✅' };
  const colors = {
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
  };
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div className={`pointer-events-auto max-w-sm w-full border rounded-xl px-4 py-3 shadow-lg flex items-start gap-3 ${colors[toast.type] || colors.info} ${exiting ? 'ed-toast-out' : 'ed-toast-in'}`}>
        <span className="text-base leading-none mt-0.5 flex-shrink-0">{icons[toast.type] || icons.info}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{toast.message}</p>
          {toast.sub && <p className="text-xs opacity-75 mt-0.5">{toast.sub}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {toast.action && onAction && (
            <button onClick={() => { onAction(toast.action.route); dismiss(); }} className="text-xs font-semibold underline underline-offset-2 opacity-90 hover:opacity-100">
              {toast.action.label}
            </button>
          )}
          <button onClick={dismiss} className="opacity-50 hover:opacity-80 text-lg leading-none">&times;</button>
        </div>
      </div>
    </div>
  );
});

// ─── Avatar ───────────────────────────────────────────────────────────────────
const UserAvatar = memo(({ src, initials, size = 8, className = '' }) => {
  const [imgOk, setImgOk] = useState(!!src);
  useEffect(() => { setImgOk(!!src); }, [src]);
  if (imgOk) {
    return (
      <img src={src} alt="Profile"
        className={`w-${size} h-${size} rounded-full border-2 border-blue-500 object-cover ${className}`}
        onError={() => setImgOk(false)} loading="eager" />
    );
  }
  return (
    <div className={`w-${size} h-${size} rounded-full border-2 border-blue-500 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-xs ${className}`}>
      {initials}
    </div>
  );
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────
const DashboardSkeleton = memo(() => (
  <div className="px-4 space-y-4 animate-pulse">
    <div className="bg-white border border-gray-100 rounded-2xl h-28" />
    <div className="grid grid-cols-2 gap-3">
      {[1, 2].map(i => <div key={i} className="bg-white border border-gray-100 rounded-xl h-24" />)}
    </div>
    <div className="space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="bg-white border border-gray-100 rounded-xl h-16" />)}
    </div>
  </div>
));

// ─── Empty Files State — no upload option for regular users ──────────────────
const EmptyFilesState = memo(({ onBrowse }) => (
  <div className="flex flex-col items-center justify-center py-10 px-4 text-center bg-white border border-dashed border-gray-200 rounded-2xl ed-fade-up">
    <div className="w-14 h-14 bg-gradient-to-br from-blue-100 to-purple-100 rounded-2xl flex items-center justify-center mb-4">
      <svg className="w-7 h-7 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
      </svg>
    </div>
    <h3 className="text-sm font-semibold text-gray-900 mb-1">No notes yet for your programme</h3>
    <p className="text-xs text-gray-500 mb-5 max-w-xs">Notes for your programme will appear here once they're available.</p>
    <button
      onClick={onBrowse}
      className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs font-semibold rounded-lg active:scale-95 transition-transform"
    >
      Browse All Courses
    </button>
  </div>
));

const TapAffordance = () => (
  <ChevronRight className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 text-gray-300" aria-hidden="true" />
);

// ─── Streak Card ──────────────────────────────────────────────────────────────
const StreakCard = memo(({ streak, onTap, hint, showHint, onHintAction }) => {
  const isHot = streak >= 7;
  const isMilestone = streak > 0 && streak % 7 === 0;
  const daysToNext = streak > 0 ? (isMilestone ? 7 : 7 - (streak % 7)) : 7;

  return (
    <div
      className={`relative bg-white border rounded-xl overflow-hidden ${isHot ? 'border-orange-200' : 'border-gray-100'}`}
      style={{ height: 96 }}
    >
      {isHot && <div className="ed-glow ed-glow-orange" aria-hidden="true" />}
      {isHot && <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-red-50/20 pointer-events-none" />}

      <button
        type="button"
        onClick={onTap}
        aria-label="View streak details"
        className="absolute inset-0 p-3 flex flex-col justify-between w-full text-left transition-opacity duration-300"
        style={{ opacity: showHint ? 0 : 1, pointerEvents: showHint ? 'none' : 'auto' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-500">Learning Streak</h3>
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500 to-red-500">
            <span className="block text-sm leading-none ed-flame">🔥</span>
          </div>
        </div>
        <div>
          <div key={streak} className="text-xl font-bold text-gray-900 ed-pop">{streak} <span className="text-sm font-semibold">days</span></div>
          {isMilestone
            ? <p className="text-[10px] font-semibold text-orange-500">Milestone reached</p>
            : streak > 0
              ? <p className="text-[10px] text-gray-400">{daysToNext}d to next milestone</p>
              : <p className="text-[10px] text-blue-500 font-medium">Tap to learn more</p>
          }
        </div>
        {!showHint && <TapAffordance />}
      </button>

      <button
        type="button"
        onClick={() => hint && onHintAction && onHintAction(hint.route)}
        aria-label={hint ? hint.text : 'Suggested action'}
        className="absolute inset-0 p-3 flex flex-col justify-between w-full text-left transition-opacity duration-300"
        style={{ opacity: showHint ? 1 : 0, pointerEvents: showHint ? 'auto' : 'none' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-500">Try this</h3>
          <span className="text-base leading-none">{hint?.emoji}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 leading-tight">{hint?.text}</p>
          <p className="text-[10px] text-blue-500 font-semibold mt-0.5">{hint?.cta} →</p>
        </div>
      </button>
    </div>
  );
});

// ─── Streak Sheet ───────────────────────────────────────────────────────────
const StreakSheet = memo(({ open, onClose }) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl p-6 pb-10 ed-fade-up shadow-2xl max-w-lg mx-auto">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
            <Flame className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">How streaks work</h3>
            <p className="text-xs text-gray-500">Return daily and your streak grows</p>
          </div>
        </div>

        <div className="mb-6">
          {STREAK_STEPS.map(({ id, Icon, title, desc }, i) => (
            <div key={id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-slate-600" />
                </div>
                {i < STREAK_STEPS.length - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
              </div>
              <div className={i < STREAK_STEPS.length - 1 ? 'flex-1 pb-5' : 'flex-1'}>
                <p className="text-sm font-semibold text-gray-800">{title}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="h-px bg-gray-100 mb-4" />
        <p className="text-xs text-gray-400 mb-5 text-center">Each return = +1 streak. Miss a day and it resets. Every 7 days is a milestone.</p>
        <button onClick={onClose} className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold py-3 rounded-xl active:scale-[0.98] transition-transform text-sm">
          Let's go — start a quiz
        </button>
      </div>
    </>
  );
});

// ─── Exam Countdown Card ────────────────────────────────────────────────────
const ExamCountdownCard = memo(({ daysLeft, daysDelta, hint, showHint, onHintAction, onPrimaryAction }) => {
  const SEMESTER_DAYS = 120;
  const progress = daysLeft > 0
    ? Math.max(4, Math.min(96, ((SEMESTER_DAYS - daysLeft) / SEMESTER_DAYS) * 100))
    : 100;
  const isUrgent = daysLeft > 0 && daysLeft <= 14;
  const isClose  = daysLeft > 0 && daysLeft <= 30;

  return (
    <div
      className={`relative bg-white border rounded-xl overflow-hidden ${isUrgent ? 'border-blue-300/60' : 'border-gray-100'}`}
      style={{ height: 96 }}
    >
      {isUrgent && <div className="ed-glow ed-glow-blue" aria-hidden="true" />}

      <button
        type="button"
        onClick={onPrimaryAction}
        aria-label="View exam timetable"
        className="absolute inset-0 p-3 flex flex-col justify-between w-full text-left transition-opacity duration-300"
        style={{ opacity: showHint ? 0 : 1, pointerEvents: showHint ? 'none' : 'auto' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-500">Days Until Exams</h3>
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
            {ExamIconSvg}
          </div>
        </div>
        <div>
          <div key={daysLeft} className="text-xl font-bold text-gray-900 ed-pop leading-none mb-0.5">{daysLeft}</div>
          {daysDelta && <p className="text-[10px] text-gray-400 mb-1.5">{daysDelta}</p>}
          {daysLeft > 0 && (
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ed-progress ${isClose ? 'bg-gradient-to-r from-blue-500 to-purple-500' : 'bg-gradient-to-r from-blue-400 to-cyan-400'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {!showHint && <TapAffordance />}
      </button>

      <button
        type="button"
        onClick={() => hint && onHintAction && onHintAction(hint.route)}
        aria-label={hint ? hint.text : 'Suggested action'}
        className="absolute inset-0 p-3 flex flex-col justify-between w-full text-left transition-opacity duration-300"
        style={{ opacity: showHint ? 1 : 0, pointerEvents: showHint ? 'auto' : 'none' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-500">Quick action</h3>
          <span className="text-base leading-none">{hint?.emoji}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 leading-tight">{hint?.text}</p>
          <p className="text-[10px] text-blue-500 font-semibold mt-0.5">{hint?.cta} →</p>
        </div>
      </button>
    </div>
  );
});

// ─── Main Home ────────────────────────────────────────────────────────────────
const Home = () => {
  const navigate = useNavigate();
  const initialCache = useMemo(readCache, []);

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [userData, setUserData] = useState(initialCache?.userData ?? null);
  const [loading, setLoading] = useState(!initialCache?.userData);
  const [streak, setStreak] = useState(initialCache?.streak ?? 0);
  const [daysLeft, setDaysLeft] = useState(initialCache?.daysLeft ?? 0);
  const [daysDelta, setDaysDelta] = useState(initialCache?.daysDelta ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [streakSheetOpen, setStreakSheetOpen] = useState(false);
  const [filesEmpty, setFilesEmpty] = useState(false);
  const [toast, setToast] = useState(null);

  // FIX: real connectivity state, so we can (a) skip network calls that
  // would just hang/fail offline, (b) avoid treating "no network" as
  // "no session" (which used to force a redirect to /login), and
  // (c) show a small, non-blocking banner instead of an infinite skeleton.
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  // Activity hint rotation
  const [hintIdx, setHintIdx] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [hintTarget, setHintTarget] = useState(0); // 0 = exam card, 1 = streak card

  const scrollContainerRef = useRef(null);
  const profilePicSrc = useMemo(() => localStorage.getItem('userProfilePic') || '', []);

  const [showProfileForm, setShowProfileForm] = useState(false);
  const [program, setProgram] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');
  const [role, setRole] = useState('');
  const [lecturerCode, setLecturerCode] = useState('');
  const [programs, setPrograms] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({ program: false, semester: false, year: false, role: false, code: false });
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState('');

  const fetchRequestId = useRef(0);
  const lastFetchedUserId = useRef(null);

  const showToast = useCallback((type, message, sub = '', action = null) => {
    setToast({ type, message, sub, action, key: Date.now() });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  const handleToastAction = useCallback((route) => navigate(route), [navigate]);

  // Search debounce (desktop search bar only)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // FIX: track online/offline explicitly and re-sync the moment we come
  // back online, instead of only ever trying once on mount.
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (user) loadUserProfile(user);
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Activity hint rotation
  useEffect(() => {
    let idx = 0;
    let target = 0;

    const showNext = () => {
      setShowHint(false);
      setTimeout(() => {
        idx = (idx + 1) % ACTIVITY_HINTS.length;
        target = target === 0 ? 1 : 0;
        setHintIdx(idx);
        setHintTarget(target);
        setShowHint(true);
        setTimeout(() => setShowHint(false), HINT_VISIBLE_MS);
      }, 350);
    };

    const firstTimer = setTimeout(showNext, FIRST_HINT_DELAY_MS);
    const interval = setInterval(showNext, HINT_CYCLE_MS);
    return () => { clearTimeout(firstTimer); clearInterval(interval); };
  }, []);

  const LECTURER_SECRET = import.meta.env.VITE_LECTURER_SECRET || 'LUANAR-FACULTY-2026';

  const loadPrograms = useCallback(async () => {
    if (!navigator.onLine) return; // FIX: don't fire a doomed request offline
    try {
      const { data, error } = await supabase.from('programs').select('id, name, campus, level').order('name', { ascending: true });
      if (error) throw error;
      setPrograms(data || []);
    } catch (err) { console.error('Failed to load programs:', err); }
  }, []);

  useEffect(() => {
    if (showProfileForm && programs.length === 0) loadPrograms();
  }, [showProfileForm, programs.length, loadPrograms]);

  // Exam countdown — December 3, 2026
  const calculateExamCountdown = useCallback(() => {
    const examDate = new Date(2026, 11, 3);
    const now = new Date();
    const diffDays = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
    let delta = '';
    if (diffDays > 0) { setDaysLeft(diffDays); delta = 'days until exams'; }
    else if (diffDays === 0) { setDaysLeft(0); delta = 'Exams start today!'; }
    else { setDaysLeft(0); delta = 'Exams are over'; }
    setDaysDelta(delta);
    return { diffDays, delta };
  }, []);

  const loadUserProfile = useCallback(async (authUser) => {
    // FIX: offline short-circuit. Previously any failed fetch here (which
    // is guaranteed offline) fell into the catch block and forced
    // showProfileForm(true) — i.e. an offline user got bounced into a
    // "complete your profile" form instead of their cached dashboard.
    // If we have a cached profile for this exact user, trust it and stop;
    // if we don't, there is nothing useful we can do offline, so just
    // stop loading rather than showing a form we can't submit anyway.
    if (!navigator.onLine) {
      const cached = readCache();
      if (cached?.userData && lastFetchedUserId.current !== null) {
        setUserData(cached.userData);
        setStreak(cached.streak ?? 0);
        setDaysLeft(cached.daysLeft ?? 0);
        setDaysDelta(cached.daysDelta ?? '');
      }
      calculateExamCountdown(); // pure client-side math, always safe
      setLoading(false);
      return;
    }

    const currentRequestId = ++fetchRequestId.current;
    lastFetchedUserId.current = authUser.id;
    try {
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (error) throw error;
      if (currentRequestId !== fetchRequestId.current) return;

      if (!profile) {
        setShowProfileForm(true);
        setUserData({ displayName: authUser.user_metadata?.full_name || authUser.email, email: authUser.email });
        setLoading(false);
        return;
      }

      const hasProgram = profile.program && profile.program.trim().length > 0;
      const hasSemester = profile.semester > 0 && profile.semester <= 8;
      const hasYear = profile.year_of_study > 0 && profile.year_of_study <= 4;
      const hasRole = profile.role === 'Student' || profile.role === 'Lecturer';
      const isComplete = hasProgram && hasSemester && hasYear && hasRole;

      if (!isComplete) {
        setShowProfileForm(true);
        setUserData({ displayName: authUser.user_metadata?.full_name || authUser.email, email: authUser.email, program: profile.program || '', semester: profile.semester ?? '', year: profile.year_of_study ?? '', role: profile.role || '' });
        setProgram(profile.program || '');
        setSemester(profile.semester ?? '');
        setYear(profile.year_of_study ?? '');
        setRole(profile.role || '');
        setLoading(false);
        return;
      }

      setShowProfileForm(false);
      const nextUserData = {
        displayName: authUser.user_metadata?.full_name || authUser.email,
        email: authUser.email,
        program: profile.program,
        semester: profile.semester,
        year: profile.year_of_study,
        role: profile.role,
      };
      setUserData(nextUserData);

      const today = new Date().toDateString();
      const lastActive = profile.last_active ? new Date(profile.last_active).toDateString() : null;
      let newStreak = profile.streak || 0;
      const wasAlreadyActiveToday = lastActive === today;
      if (!wasAlreadyActiveToday) {
        newStreak = lastActive === new Date(Date.now() - 86400000).toDateString() ? newStreak + 1 : 1;
        supabase.from('profiles').upsert({ id: authUser.id, streak: newStreak, last_active: new Date().toISOString() })
          .then(({ error: upsertErr }) => { if (upsertErr) console.error('Streak update failed:', upsertErr); });
      }
      setStreak(newStreak);
      const { diffDays, delta } = calculateExamCountdown();
      writeCache({ userData: nextUserData, streak: newStreak, daysLeft: diffDays, daysDelta: delta });
      setLoading(false);
    } catch (err) {
      console.error('Error loading profile:', err);
      // FIX: only send the person into the "complete your profile" form
      // on a real response from the backend. A network-level failure
      // (offline, DNS hiccup, flaky connection) should fall back to
      // whatever we already have cached, not require re-entering profile
      // data the person already submitted before.
      const looksLikeNetworkFailure = !navigator.onLine || err?.message?.toLowerCase().includes('fetch');
      if (looksLikeNetworkFailure) {
        const cached = readCache();
        if (cached?.userData) {
          setUserData(cached.userData);
          setStreak(cached.streak ?? 0);
          setDaysLeft(cached.daysLeft ?? 0);
          setDaysDelta(cached.daysDelta ?? '');
          setShowProfileForm(false);
        } else {
          setShowProfileForm(true);
        }
      } else {
        setShowProfileForm(true);
      }
      setLoading(false);
    }
  }, [calculateExamCountdown]);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        const isNewUser = lastFetchedUserId.current !== session.user.id;
        if (isNewUser || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          if (isNewUser || !userData) {
            (async () => {
              // FIX: don't run the "is this session still valid" network
              // check while offline — it can only fail, and it used to
              // sign the person out (clearing cache) purely because the
              // network was unreachable, not because the session was
              // actually invalid.
              if (!navigator.onLine) {
                loadUserProfile(session.user);
                return;
              }
              const ok = await ensureConsistentSession();
              if (!mounted) return;
              if (!ok) {
                setUser(null); setUserData(null); setShowProfileForm(false);
                localStorage.removeItem(CACHE_KEY);
                lastFetchedUserId.current = null;
                setLoading(false);
                return;
              }
              const { data: { session: liveSession } } = await supabase.auth.getSession();
              if (!mounted) return;
              if (liveSession?.user) loadUserProfile(liveSession.user);
              else setLoading(false);
            })();
          }
        }
      } else if (event === 'SIGNED_OUT' || !session) {
        setUser(null); setUserData(null); setShowProfileForm(false);
        localStorage.removeItem(CACHE_KEY); lastFetchedUserId.current = null; setLoading(false);
      }
      setAuthReady(true);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUserProfile]);

  // ─── Scroll handling ───────────────────────────────────────────────────
  // FIX (the main "crushing/jamming" bug): this used to flip `isScrolled`
  // at a single 4px threshold, and that boolean drove *layout-affecting*
  // inline-style transitions in the header (padding, logo width/height,
  // font-size). Two problems compounded:
  //   1. scrollTop naturally jitters by a few px around a single
  //      threshold during momentum/rubber-band scrolling, so the boolean
  //      — and therefore the layout transition — could re-fire many times
  //      per second.
  //   2. animating padding/width/height/font-size forces the browser to
  //      recompute layout (not just paint/composite), which is the most
  //      expensive category of style change and directly competes with
  //      the scroll thread for frame time.
  // Fixed by (a) hysteresis so the state can only flip once per gesture,
  // and (b) the header itself no longer resizes anything on scroll — see
  // the render below. rAF-gating is kept so we still only touch state at
  // most once per frame.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const top = container.scrollTop;
        setIsScrolled((prev) => {
          if (!prev && top > SCROLL_COLLAPSE_AT) return true;
          if (prev && top < SCROLL_EXPAND_AT) return false;
          return prev;
        });
        ticking = false;
      });
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const getPersonalizedDescription = useMemo(() => {
    if (streak === 0 && filesEmpty) return 'New here? Ask the AI to explain any topic.';
    if (daysLeft > 0 && daysLeft <= 30) return `⚡ ${daysLeft} days until exams – let's crush it!`;
    if (streak > 0 && streak % 7 === 0) return `🔥 ${streak}-day streak! You're unstoppable!`;
    if (daysLeft > 30) return '🎯 How to get a 3.7 GPA this semester?';
    const msgs = ["Ask anything. Get answers.", "💪 Crush your goals today!", "📚 Every question answered.", "🚀 You've got this!"];
    return msgs[(streak + daysLeft) % msgs.length];
  }, [daysLeft, streak, filesEmpty]);

  const displayName = user?.email?.split('@')[0] || userData?.displayName || 'User';
  const initials = useMemo(() => {
    const names = displayName.trim().split(' ');
    return (names.length === 1 ? names[0][0] : names[0][0] + names[names.length - 1][0]).toUpperCase();
  }, [displayName]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const timeGreeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    let subtext = 'Continue your learning journey';
    if (streak >= 3) subtext = `🔥 ${streak}-day streak — keep it going`;
    else if (daysLeft > 0 && daysLeft <= 7) subtext = `⚡ ${daysLeft} days to exams — stay sharp`;
    return { timeGreeting, subtext };
  }, [streak, daysLeft]);

  const handleNavigation = useCallback((path) => navigate(path), [navigate]);

  const handleFileClick = useCallback((file) => {
    const url = getNotePublicUrl(file);
    if (!url) {
      showToast('error', "This file isn't available yet.", 'Try again or request it from your lecturer.', { label: 'Request', route: '/Request' });
      return;
    }
    navigate(`/viewer?fileId=${encodeURIComponent(file.id)}`, {
      state: {
        fileId: file.id,
        url,
        filename: file.course_name || file.filename || 'Document',
        fileType: file.filename?.toLowerCase().endsWith('.pptx') ? 'pptx' : 'pdf',
      },
    });
  }, [navigate, showToast]);

  const handleProfileSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      setProfileError("You're offline — connect to the internet to save your profile.");
      return;
    }
    setProfileError('');
    setFieldErrors({ program: false, semester: false, year: false, role: false, code: false });
    const errors = { program: false, semester: false, year: false, role: false, code: false };
    let valid = true;
    if (!program || program.trim().length === 0) { errors.program = true; valid = false; }
    const semesterNum = parseInt(semester, 10);
    if (isNaN(semesterNum) || semesterNum < 1 || semesterNum > 8) { errors.semester = true; valid = false; }
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1 || yearNum > 4) { errors.year = true; valid = false; }
    if (!role) { errors.role = true; valid = false; }
    if (role === 'Lecturer' && lecturerCode !== LECTURER_SECRET) { errors.code = true; valid = false; }
    if (!valid) { setFieldErrors(errors); return; }
    setProfileSubmitting(true);
    try {
      const ok = await ensureConsistentSession();
      if (!ok) throw new Error('Your session was invalid and has been cleared — please sign in again.');
      const { data: { session: liveSession } } = await supabase.auth.getSession();
      if (!liveSession?.user) throw new Error('Your session expired — please sign in again.');
      const updateData = { id: liveSession.user.id, program: program.trim(), semester: semesterNum, year_of_study: yearNum, role, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('profiles').upsert(updateData, { onConflict: 'id' }).select();
      if (error) throw error;
      setShowProfileForm(false);
      setUserData(prev => ({ ...prev, program: updateData.program, semester: updateData.semester, year: updateData.year_of_study, role: updateData.role }));
      await loadUserProfile(liveSession.user);
    } catch (err) {
      console.error('Profile update error:', err);
      setProfileError(err.message || 'Failed to save profile. Please try again.');
      if (err.message?.includes('session was invalid') || err.message?.includes('session expired')) navigate('/login', { replace: true });
    } finally { setProfileSubmitting(false); }
  }, [program, semester, year, role, lecturerCode, LECTURER_SECRET, loadUserProfile, navigate]);

  const currentHint = ACTIVITY_HINTS[hintIdx];

  // ─── Cold-start skeleton ───────────────────────────────────────────────────
  if (!authReady && loading) {
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <StyleInjector />
        <div className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-100 rounded-lg animate-pulse" />
              <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
            </div>
            <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4"><DashboardSkeleton /></div>
        <BottomNav />
      </div>
    );
  }

  // FIX: don't force a logout redirect purely because we're offline and
  // have no live `user` object yet — if we have a cached session/profile,
  // ride on that instead of bouncing to /login.
  if (authReady && !user && !loading && (isOnline || !initialCache?.userData)) {
    return <Navigate to="/login" replace />;
  }

  // ─── Profile form ──────────────────────────────────────────────────────────
  if (showProfileForm) {
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <StyleInjector />
        {!isOnline && <OfflineBanner />}
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-white/50 overflow-hidden ed-fade-up">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 px-6 py-5 text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <span className="text-2xl">✍️</span>
              </div>
              <h2 className="text-xl font-bold text-white">Complete your profile</h2>
              <p className="text-sm text-white/80 mt-1">Just a few details to personalise your dashboard</p>
              <div className="mt-3 inline-flex items-center gap-2 bg-white/15 rounded-full px-3 py-1">
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span className="text-xs text-white font-medium">Takes 30 seconds</span>
              </div>
            </div>
            <div className="p-6">
              {profileError && (
                <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700" role="alert">{profileError}</div>
              )}
              <form onSubmit={handleProfileSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Programme of study <span className="text-red-500">*</span></label>
                  <select value={program} onChange={(e) => setProgram(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.program ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">— Select programme —</option>
                    {programs.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.campus})</option>)}
                  </select>
                  {fieldErrors.program && <p className="text-red-500 text-xs mt-1" role="alert">Program is required</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester <span className="text-red-500">*</span></label>
                  <select value={semester} onChange={(e) => setSemester(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.semester ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Select semester</option>
                    {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Semester {s}</option>)}
                  </select>
                  {fieldErrors.semester && <p className="text-red-500 text-xs mt-1" role="alert">Select a valid semester (1–8)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year of study <span className="text-red-500">*</span></label>
                  <select value={year} onChange={(e) => setYear(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.year ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Select year</option>
                    {[1,2,3,4].map(y => <option key={y} value={y}>Year {y}</option>)}
                  </select>
                  {fieldErrors.year && <p className="text-red-500 text-xs mt-1" role="alert">Select a valid year (1–4)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role <span className="text-red-500">*</span></label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.role ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                    <option value="">Choose role</option>
                    <option value="Student">Student</option>
                    <option value="Lecturer">Lecturer</option>
                  </select>
                  {fieldErrors.role && <p className="text-red-500 text-xs mt-1" role="alert">Role is mandatory</p>}
                </div>
                {role === 'Lecturer' && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lecturer authorization code</label>
                    <input type="password" value={lecturerCode} onChange={(e) => setLecturerCode(e.target.value)}
                      className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${fieldErrors.code ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      placeholder="Enter secure code" />
                    <p className="text-xs text-gray-500 mt-1.5">
                      Sent to your faculty email.{' '}
                      <a href="mailto:admin@luanar.ac.mw" className="text-blue-500 underline underline-offset-2">Need help?</a>
                    </p>
                    {fieldErrors.code && <p className="text-red-500 text-xs mt-1" role="alert">Invalid lecturer code</p>}
                  </div>
                )}
                <button type="submit" disabled={profileSubmitting || !isOnline}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 rounded-lg transition-all active:scale-[0.98] disabled:opacity-70">
                  {profileSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Saving…
                    </span>
                  ) : !isOnline ? 'Connect to the internet to continue' : '🚀 Access Dashboard'}
                </button>
              </form>
            </div>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // ==================== MAIN DASHBOARD ====================
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50 overflow-hidden">
      <StyleInjector />

      {/* ── MOBILE HEADER ──
          FIX: dropped `backdrop-blur-md`. A blurred sticky header sitting
          above scrolling content has to recompute the blur of whatever is
          now behind it on *every single frame* of the scroll — this is one
          of the most common causes of scroll jank on mid/low-end phones,
          independent of anything React is doing. A solid, near-opaque
          background gives the same "floating header" read for a fraction
          of the GPU cost.
          FIX: the header no longer resizes anything (padding, logo size,
          font-size) as you scroll — those were layout-affecting properties
          animated via inline styles, which forces a reflow on every toggle.
          The only things that change now are: a shadow (paint-only) and
          the greeting block's presence (opacity + max-height, and gated by
          the hysteresis thresholds above so it can't flicker). */}
      <div
        className="lg:hidden flex-shrink-0 sticky top-0 z-30 bg-white border-b border-gray-100"
        style={{ boxShadow: isScrolled ? '0 1px 8px rgba(0,0,0,0.06)' : 'none' }}
      >
        {!isOnline && <OfflineBanner />}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 -ml-2 hover:bg-gray-100 active:scale-90 rounded-lg transition-colors duration-100"
              aria-label="Toggle menu"
            >
              <div className="flex flex-col gap-[4.5px] w-5">
                <span className="block h-0.5 w-5 bg-gray-700 rounded-full" />
                <span className="block h-0.5 w-5 bg-gray-700 rounded-full" />
                <span className="block h-0.5 w-5 bg-gray-700 rounded-full" />
              </div>
            </button>

            <div className="flex items-center gap-2">
              <div className="rounded-lg overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0 w-8 h-8">
                <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" loading="eager" />
              </div>
              <h1 className="font-semibold leading-none flex items-baseline gap-1.5 text-[17px]" style={{ letterSpacing: '-0.01em' }}>
                <span className="text-gray-900">StudyHub</span>
                <span className="text-green-700 font-medium text-[0.6em] tracking-[0.12em]">LUANAR</span>
              </h1>
            </div>
          </div>

          <button onClick={() => handleNavigation('/profile')} className="flex flex-col items-center px-1.5 py-1 -mr-1 active:scale-90 transition-transform duration-100">
            <UserAvatar src={profilePicSrc} initials={initials} size={8} />
            <span className="text-[9px] font-bold text-blue-500 mt-0.5 leading-none">You</span>
          </button>
        </div>

        {/* Greeting — collapses via opacity + max-height only (no reflow of
            surrounding elements' own box), gated by hysteresis so it can
            only fire once per real scroll gesture, not per jittery pixel. */}
        <div
          className="overflow-hidden transition-[max-height,opacity] duration-150 ease-out"
          style={{ maxHeight: isScrolled ? 0 : 64, opacity: isScrolled ? 0 : 1 }}
        >
          <div className="px-4 pb-3 text-center">
            <h2 className="text-sm font-medium text-gray-900">
              {greeting.timeGreeting}, <span className="font-bold">{displayName}</span> 👋
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{greeting.subtext}</p>
          </div>
        </div>
      </div>

      {/* DESKTOP HEADER */}
      <div className="hidden lg:block flex-shrink-0 px-6 py-6 space-y-4">
        {!isOnline && <div className="-mx-6 -mt-6 mb-2"><OfflineBanner /></div>}
        <div className="ed-fade-up">
          <h1 className="text-2xl font-semibold text-gray-900" style={{ letterSpacing: '-0.01em' }}>
            {greeting.timeGreeting}, <span className="font-bold">{displayName}</span> 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">{greeting.subtext}</p>
        </div>
        <div className="relative max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search courses, topics..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder:text-gray-400 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ──
          FIX: this is the single, only scrolling region in the tree (the
          header above is a flex sibling with flex-shrink-0, not part of
          the scroll flow), which is the right pattern for smooth native
          scrolling. `overscroll-behavior-y: contain` stops the browser
          from chaining an overscroll bounce up to the page behind it. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}
      >
        <div className="px-4 lg:px-6 space-y-4 pt-2 pb-32">

          <div className="ed-fade-up" style={{ animationDelay: '0.04s' }}>
            <AiStudyAssistantCard onAskClick={() => navigate('/AiChat')} description={getPersonalizedDescription} />
          </div>

          <div className="grid grid-cols-2 gap-3 ed-fade-up" style={{ animationDelay: '0.09s' }}>
            <ExamCountdownCard
              daysLeft={daysLeft}
              daysDelta={daysDelta}
              hint={hintTarget === 0 ? currentHint : null}
              showHint={showHint && hintTarget === 0}
              onHintAction={handleNavigation}
              onPrimaryAction={() => handleNavigation('/timetable')}
            />
            <StreakCard
              streak={streak}
              onTap={() => setStreakSheetOpen(true)}
              hint={hintTarget === 1 ? currentHint : null}
              showHint={showHint && hintTarget === 1}
              onHintAction={handleNavigation}
            />
          </div>

          <div className="ed-fade-up" style={{ animationDelay: '0.14s' }}>
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-900">Pick up where you left off</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Recently uploaded for your programme</p>
            </div>
            <Files
              searchQuery={debouncedSearch}
              limit={6}
              onFileClick={handleFileClick}
              profile={userData}
              onEmpty={() => setFilesEmpty(true)}
              emptyState={<EmptyFilesState onBrowse={() => handleNavigation('/course')} />}
            />
          </div>

        </div>
      </div>

      <BottomNav />
      <Toast toast={toast} onDismiss={dismissToast} onAction={handleToastAction} />
      <StreakSheet open={streakSheetOpen} onClose={() => setStreakSheetOpen(false)} />

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-[2px]" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`lg:hidden fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-100 transform z-50 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ transition: 'transform 0.2s ease-out', willChange: 'transform' }}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600">
              <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" />
            </div>
            <span className="text-sm font-bold text-gray-900">Menu</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-100" aria-label="Close">
            <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m18 6-12 12"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
              <p className="text-xs text-gray-400 truncate">{userData?.role || 'Student'}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 overflow-y-auto space-y-4">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Study</p>
            <ul className="space-y-1">
              {[
                {
                  path: '/timetable', label: 'Timetable',
                  icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
                },
                {
                  path: '/Request', label: 'Request Notes',
                  icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21,13.89 7,23 12,20 17,23 15.79,13.88"/></svg>,
                },
              ].map(({ path, label, icon }) => (
                <li key={path}>
                  <button
                    onClick={() => { handleNavigation(path); setSidebarOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-gray-700 text-sm transition-colors duration-100 active:scale-95 text-left"
                  >
                    {icon}{label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Account</p>
            <ul className="space-y-1">
              {[
                {
                  path: '/profile', label: 'Profile',
                  icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
                },
              ].map(({ path, label, icon }) => (
                <li key={path}>
                  <button
                    onClick={() => { handleNavigation(path); setSidebarOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-gray-700 text-sm transition-colors duration-100 active:scale-95 text-left"
                  >
                    {icon}{label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <p className="text-[10px] text-gray-300 text-center">© 2026 StudyHub LUANAR</p>
        </div>
      </div>
    </div>
  );
};

export default Home;