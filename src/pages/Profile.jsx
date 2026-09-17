import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import {
  ArrowLeft,
  User,
  Mail,
  BookOpen,
  Calendar,
  Award,
  Flame,
  CheckCircle,
  TrendingUp,
  BarChart2,
  Edit3,
  X,
  Save,
  LogOut,
  Upload,
  FileText,
  Search,
  ExternalLink,
  Sparkles,
  School,
  Brain,
  ChevronRight,
  Layers,
  Camera,
  Settings as SettingsIcon,
} from 'lucide-react';

const PROFILE_CACHE_KEY = 'studyhub_full_profile_cache';

const readProfileCache = () => {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeProfileCache = (data) => {
  try {
    sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
  } catch {}
};

// ─── Linear Progress Graph (SVG Spline) ──────────────────────────────────────
const LearningTrendGraph = memo(({ sessions }) => {
  const navigate = useNavigate();
  const [activePoint, setActivePoint] = useState(null);

  // Process data chronologically
  const points = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    // Sort oldest to newest
    const sorted = [...sessions].sort(
      (a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0)
    );
    return sorted.map((s, idx) => ({
      index: idx,
      date: s.completed_at
        ? new Date(s.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `Quiz ${idx + 1}`,
      score: Math.min(100, Math.max(0, s.percentage ?? Math.round(((s.correct_answers || 0) / (s.total_questions || 1)) * 100))),
      course: String(s.course_name || (s.course_id ? `Course ${s.course_id}` : 'General')),
      totalQ: s.total_questions || 0,
      correct: s.correct_answers || 0,
    }));
  }, [sessions]);

  // Overall average
  const avgScore = useMemo(() => {
    if (points.length === 0) return 0;
    const sum = points.reduce((acc, p) => acc + p.score, 0);
    return Math.round(sum / points.length);
  }, [points]);

  // Calculate SVG Coordinates (viewBox 0 0 540 200)
  const svgWidth = 540;
  const svgHeight = 200;
  const padLeft = 40;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const coords = useMemo(() => {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return [
        {
          ...points[0],
          x: padLeft + chartW / 2,
          y: padTop + chartH - (points[0].score / 100) * chartH,
        },
      ];
    }
    return points.map((p, i) => ({
      ...p,
      x: padLeft + (i / (points.length - 1)) * chartW,
      y: padTop + chartH - (p.score / 100) * chartH,
    }));
  }, [points, chartW, chartH, padLeft, padTop]);

  // Smooth Bezier path generator
  const { linePath, areaPath } = useMemo(() => {
    if (coords.length === 0) return { linePath: '', areaPath: '' };
    if (coords.length === 1) {
      const p = coords[0];
      return {
        linePath: `M ${p.x - 20} ${p.y} L ${p.x + 20} ${p.y}`,
        areaPath: `M ${p.x - 20} ${padTop + chartH} L ${p.x - 20} ${p.y} L ${p.x + 20} ${p.y} L ${p.x + 20} ${padTop + chartH} Z`,
      };
    }

    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i === 0 ? 0 : i - 1];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    const first = coords[0];
    const last = coords[coords.length - 1];
    const area = `${d} L ${last.x} ${padTop + chartH} L ${first.x} ${padTop + chartH} Z`;

    return { linePath: d, areaPath: area };
  }, [coords, chartH, padTop]);

  if (points.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs mb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <TrendingUp className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Performance Trajectory
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-medium">Linear Overview</span>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center px-4 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
          <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3">
            <Brain className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-800 mb-1">No Quiz Activity Recorded Yet</p>
          <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">
            Take practice quizzes and exam questions to generate your real-time learning trajectory and mastery curve.
          </p>
          <button
            onClick={() => navigate('/quiz')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span>Start Practice Quiz</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs mb-5">
      {/* Header with KPI badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <TrendingUp className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Learning Trajectory</h3>
            <p className="text-[11px] text-slate-500">Quiz score progression over time</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200/60">
            Avg: {avgScore}%
          </span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600">
            {points.length} {points.length === 1 ? 'Quiz' : 'Quizzes'}
          </span>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
            </linearGradient>
            <filter id="shadowFilter" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.1" />
            </filter>
          </defs>

          {/* Horizontal Benchmark Lines */}
          {[
            { val: 100, label: '100%' },
            { val: 80, label: '80%' },
            { val: 50, label: '50%' },
            { val: 0, label: '0%' },
          ].map((g) => {
            const y = padTop + chartH - (g.val / 100) * chartH;
            return (
              <g key={g.val}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + chartW}
                  y2={y}
                  stroke={g.val === 50 || g.val === 80 ? '#cbd5e1' : '#f1f5f9'}
                  strokeDasharray={g.val === 50 || g.val === 80 ? '3 3' : 'none'}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontWeight="600"
                  textAnchor="end"
                >
                  {g.label}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          <path d={areaPath} fill="url(#trendGradient)" />

          {/* Main Bezier Line */}
          <path
            d={linePath}
            fill="none"
            stroke="#4f46e5"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {coords.map((pt, idx) => {
            const isHovered = activePoint?.index === pt.index;
            return (
              <g key={idx} className="cursor-pointer" onClick={() => setActivePoint(pt)}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 7 : 4.5}
                  fill={isHovered ? '#4338ca' : '#ffffff'}
                  stroke="#4f46e5"
                  strokeWidth={isHovered ? 3.5 : 2}
                  className="transition-all duration-150"
                />
              </g>
            );
          })}

          {/* X Axis date labels */}
          {coords.length > 1 && (
            <>
              <text
                x={coords[0].x}
                y={padTop + chartH + 18}
                fill="#64748b"
                fontSize="10"
                textAnchor="start"
              >
                {coords[0].date}
              </text>
              <text
                x={coords[coords.length - 1].x}
                y={padTop + chartH + 18}
                fill="#64748b"
                fontSize="10"
                textAnchor="end"
              >
                {coords[coords.length - 1].date}
              </text>
            </>
          )}
        </svg>

        {/* Floating Tooltip if selected (smart positioned so it's never clipped) */}
        {activePoint && (
          <div
            className={`absolute z-30 bg-slate-900 text-white text-xs rounded-xl px-3 py-2 shadow-xl pointer-events-none border border-slate-700 ${
              activePoint.y < 60 ? 'translate-y-3' : '-translate-y-full -mt-2.5'
            }`}
            style={{
              left: `${Math.max(12, Math.min(88, (activePoint.x / svgWidth) * 100))}%`,
              top: `${(activePoint.y / svgHeight) * 100}%`,
              transform: `translateX(-50%) ${activePoint.y < 60 ? 'translateY(12px)' : 'translateY(-100%)'}`,
            }}
          >
            <div className="font-bold text-indigo-300">{activePoint.course}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span>Score: <strong className="text-emerald-400 font-bold">{activePoint.score}%</strong></span>
              <span className="text-slate-300">({activePoint.correct}/{activePoint.totalQ})</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">{activePoint.date}</div>
          </div>
        )}
      </div>

      {/* Prominent Active Point Detail Card (guaranteed 100% visible and unclipped) */}
      {activePoint && (
        <div className="mt-3 p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg border border-indigo-500/30 flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex flex-col items-center justify-center font-bold text-sm text-emerald-400 shrink-0">
              <span>{activePoint.score}%</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-white tracking-tight">{activePoint.course}</p>
                <span className="text-[10px] text-indigo-300 font-semibold px-1.5 py-0.5 rounded bg-indigo-900/70 border border-indigo-700/50">
                  {activePoint.date}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {activePoint.correct} of {activePoint.totalQ} questions correct • {activePoint.score >= 75 ? '🎉 Strong mastery' : activePoint.score >= 50 ? '👍 Passing score' : '⚠️ Review needed'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setActivePoint(null)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close details"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-indigo-600 rounded-full inline-block" />
          <span>Score Progression</span>
        </div>
        <span className="text-slate-400">Tap points for quiz details</span>
      </div>
    </div>
  );
});

LearningTrendGraph.displayName = 'LearningTrendGraph';

// ─── Course Mastery Bar Graph (Course by Course) ─────────────────────────────
const CourseMasteryBarGraph = memo(({ sessions }) => {
  // Aggregate sessions by course_id
  const courseStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const map = new Map();

    sessions.forEach((s) => {
      const rawCourse = s.course_name || (s.course_id != null ? `Course ${s.course_id}` : 'General');
      const course = String(rawCourse || 'General').toUpperCase().trim();
      const score = Math.min(100, Math.max(0, s.percentage ?? Math.round(((s.correct_answers || 0) / (s.total_questions || 1)) * 100)));
      if (!map.has(course)) {
        map.set(course, { course, totalScore: 0, count: 0, scores: [] });
      }
      const entry = map.get(course);
      entry.totalScore += score;
      entry.count += 1;
      entry.scores.push(score);
    });

    const list = Array.from(map.values()).map((e) => {
      const avg = Math.round(e.totalScore / e.count);
      const latest = e.scores[e.scores.length - 1];
      const isImproving = e.scores.length > 1 && latest >= avg;
      return {
        course: e.course,
        avgScore: avg,
        quizCount: e.count,
        latestScore: latest,
        isImproving,
      };
    });

    // Sort highest to lowest mastery
    return list.sort((a, b) => b.avgScore - a.avgScore);
  }, [sessions]);

  if (courseStats.length === 0) {
    return null;
  }

  const topCourse = courseStats[0];
  const lowestCourse = courseStats.length > 1 ? courseStats[courseStats.length - 1] : null;

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs mb-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
            <BarChart2 className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Course Mastery Breakdown</h3>
            <p className="text-[11px] text-slate-500">Detailed performance by subject</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-slate-500">
          {courseStats.length} {courseStats.length === 1 ? 'Course' : 'Courses'}
        </span>
      </div>

      {/* Course Bar Items */}
      <div className="space-y-3.5">
        {courseStats.map((item) => {
          const isHigh = item.avgScore >= 75;
          const isMedium = item.avgScore >= 50 && item.avgScore < 75;
          const barColor = isHigh
            ? 'bg-emerald-500'
            : isMedium
            ? 'bg-indigo-500'
            : 'bg-rose-500';
          const badgeColor = isHigh
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : isMedium
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-rose-50 text-rose-700 border-rose-200';

          return (
            <div key={item.course} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <span>{item.course}</span>
                  {item.isImproving && (
                    <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-0.5">
                      <TrendingUp className="w-3 h-3" /> Improving
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">
                    {item.quizCount} {item.quizCount === 1 ? 'quiz' : 'quizzes'}
                  </span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded-md text-[11px] border ${badgeColor}`}
                  >
                    {item.avgScore}%
                  </span>
                </div>
              </div>

              {/* Progress Track */}
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${item.avgScore}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Insights Footer */}
      {topCourse && (
        <div className="mt-5 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600">
            <span className="text-emerald-500 font-bold">★ Strongest:</span>
            <span className="font-semibold text-slate-800">{topCourse.course} ({topCourse.avgScore}%)</span>
          </div>
          {lowestCourse && lowestCourse.avgScore < 70 && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <span className="text-amber-500 font-bold">⚠ Review:</span>
              <span className="font-medium text-slate-700">{lowestCourse.course} ({lowestCourse.avgScore}%)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

CourseMasteryBarGraph.displayName = 'CourseMasteryBarGraph';

// ─── Main Profile Page Component ────────────────────────────────────────────
export default function Profile() {
  const navigate = useNavigate();
  const cached = useMemo(readProfileCache, []);

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(cached?.profile || null);
  const [files, setFiles] = useState(cached?.files || []);
  const [quizSessions, setQuizSessions] = useState([]);
  const [programsList, setProgramsList] = useState([]);
  const [toast, setToast] = useState({ message: '', type: '' });

  // Academic Info Editor State
  const [showAcademicModal, setShowAcademicModal] = useState(false);
  const [customProgramMode, setCustomProgramMode] = useState(false);
  const [academicForm, setAcademicForm] = useState({
    name: '',
    program: '',
    year_of_study: '',
    semester: '',
    campus: '',
    bio: '',
  });
  const [savingAcademic, setSavingAcademic] = useState(false);

  // Files search
  const [fileSearch, setFileSearch] = useState('');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 3000);
  };

  // 1. Authenticate & fetch user
  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
        navigate('/login');
        return;
      }
      if (mounted) {
        setUser(session.user);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(session.user);
      else navigate('/login');
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [navigate]);

  // 2. Load Profile, Quizzes, Programs, and Files
  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        setLoading(true);

        // Fetch profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        const currentProfile = profileData || {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
          program: '',
          semester: null,
          year_of_study: null,
          campus: '',
          bio: '',
          profile_pic: user.user_metadata?.avatar_url || '',
          streak: 0,
          total_questions: 0,
          total_correct: 0,
          quizzes_completed: 0,
        };

        setProfile(currentProfile);
        setAcademicForm({
          name: currentProfile.name || '',
          program: currentProfile.program || '',
          year_of_study: currentProfile.year_of_study ? String(currentProfile.year_of_study) : '1',
          semester: currentProfile.semester ? String(currentProfile.semester) : '1',
          campus: currentProfile.campus || 'Bunda',
          bio: currentProfile.bio || '',
        });

        // Fetch courses for friendly name lookup
        const { data: coursesData } = await supabase
          .from('courses')
          .select('id, course_name, course_code');

        const courseLookup = {};
        (coursesData || []).forEach((c) => {
          courseLookup[c.id] = c.course_code || c.course_name;
        });

        // Fetch completed quiz sessions
        const { data: sessionsData } = await supabase
          .from('quiz_sessions')
          .select('*')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: true });

        const enrichedSessions = (sessionsData || []).map((s) => ({
          ...s,
          course_name:
            courseLookup[s.course_id] ||
            (s.course_id ? `Course ${s.course_id}` : 'General Quiz'),
        }));

        setQuizSessions(enrichedSessions);

        // Fetch official programs list
        const { data: progs } = await supabase
          .from('programs')
          .select('id, name, campus, level')
          .order('name', { ascending: true });

        setProgramsList(progs || []);

        // Fetch user uploads
        const { data: filesData } = await supabase
          .from('user_files')
          .select('*')
          .eq('user_id', user.id)
          .order('uploaded_at', { ascending: false });

        setFiles(filesData || []);

        writeProfileCache({
          userId: user.id,
          profile: currentProfile,
          files: filesData || [],
        });
      } catch (err) {
        console.error('Error loading profile data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  // Profile Picture Upload
  const handlePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image too large (max 5MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      const { error } = await supabase
        .from('profiles')
        .update({ profile_pic: base64, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) {
        showToast('Failed to update avatar', 'error');
      } else {
        const updated = { ...profile, profile_pic: base64 };
        setProfile(updated);
        writeProfileCache({ userId: user.id, profile: updated, files });
        showToast('Profile picture updated!');
      }
    };
    reader.readAsDataURL(file);
  };

  // Save Academic Details
  const handleSaveAcademic = async (e) => {
    e.preventDefault();
    if (!user) return;
    setSavingAcademic(true);

    try {
      const semesterNum = parseInt(academicForm.semester, 10) || 1;
      const yearNum = parseInt(academicForm.year_of_study, 10) || 1;

      const { error } = await supabase
        .from('profiles')
        .update({
          name: academicForm.name.trim(),
          program: academicForm.program.trim(),
          year_of_study: yearNum,
          semester: semesterNum,
          campus: academicForm.campus,
          bio: academicForm.bio.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      const updated = {
        ...profile,
        name: academicForm.name.trim(),
        program: academicForm.program.trim(),
        year_of_study: yearNum,
        semester: semesterNum,
        campus: academicForm.campus,
        bio: academicForm.bio.trim(),
      };

      setProfile(updated);
      writeProfileCache({ userId: user.id, profile: updated, files });
      setShowAcademicModal(false);
      showToast('Academic profile updated successfully!');
    } catch (err) {
      console.error(err);
      showToast('Failed to save profile details', 'error');
    } finally {
      setSavingAcademic(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Sign out of StudyHub?')) {
      try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
      await supabase.auth.signOut();
      navigate('/login');
    }
  };

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (!fileSearch.trim()) return files;
    const q = fileSearch.toLowerCase();
    return files.filter(
      (f) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.subject || '').toLowerCase().includes(q)
    );
  }, [files, fileSearch]);

  // Key KPI stats
  const kpis = useMemo(() => {
    const totalQuizzes = quizSessions.length || profile?.quizzes_completed || 0;
    const totalQ = profile?.total_questions || quizSessions.reduce((acc, s) => acc + (s.total_questions || 0), 0);
    const totalCorrect = profile?.total_correct || quizSessions.reduce((acc, s) => acc + (s.correct_answers || 0), 0);
    const accuracy = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;
    const streak = profile?.streak || 0;

    return { totalQuizzes, totalQ, accuracy, streak };
  }, [quizSessions, profile]);

  const isAdmin = useMemo(() => {
    return Boolean(profile?.is_admin || profile?.admin);
  }, [profile]);

  if (loading && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Loading learning profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 pb-20 font-sans">
      {/* Toast Notification */}
      {toast.message && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-2 animate-in fade-in duration-200 ${
            toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top App Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-100"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h1 className="text-sm font-bold text-slate-800">Learning Profile & Analytics</h1>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-100"
            title="Settings & Updates"
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5">
        {/* User Identity & Academic Card */}
        <section className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs mb-5">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 text-center sm:text-left">
            {/* Avatar with Camera Overlay */}
            <div
              className="relative w-20 h-20 rounded-full cursor-pointer group flex-shrink-0"
              onClick={() => document.getElementById('profilePicInput')?.click()}
              title="Change profile picture"
            >
              <img
                src={profile?.profile_pic || 'https://www.w3schools.com/howto/img_avatar.png'}
                alt="Profile"
                className="w-full h-full rounded-full object-cover border-2 border-white shadow-sm ring-2 ring-indigo-500/30"
              />
              <div className="absolute inset-0 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                <Camera className="w-5 h-5" />
              </div>
              <input
                type="file"
                id="profilePicInput"
                accept="image/*"
                className="hidden"
                onChange={handlePictureUpload}
              />
            </div>

            {/* Profile Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900 truncate">
                    {profile?.name || user?.user_metadata?.full_name || 'LUANAR Student'}
                  </h2>
                  <p className="text-xs text-slate-500 font-medium truncate">{profile?.email || user?.email}</p>
                </div>
                <button
                  onClick={() => setShowAcademicModal(true)}
                  className="self-center sm:self-start flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200/60 transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Academic Details</span>
                </button>
              </div>

              {/* Academic Tags */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 mt-3">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-100">
                  <BookOpen className="w-3.5 h-3.5" />
                  {profile?.program || 'Programme Not Set'}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  Year {profile?.year_of_study || 1} · Sem {profile?.semester || 1}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100">
                  <School className="w-3.5 h-3.5" />
                  {profile?.campus ? `${profile.campus} Campus` : 'LUANAR'}
                </span>
              </div>

              {/* Bio if set */}
              {profile?.bio && (
                <p className="text-xs text-slate-600 mt-2.5 italic line-clamp-2">
                  "{profile.bio}"
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Top KPI Metrics Grid */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs text-center">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-1.5">
              <Brain className="w-4 h-4" />
            </span>
            <div className="text-xl font-extrabold text-slate-900">{kpis.totalQuizzes}</div>
            <div className="text-[11px] font-semibold text-slate-500">Quizzes Taken</div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs text-center">
            <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1.5">
              <Award className="w-4 h-4" />
            </span>
            <div className="text-xl font-extrabold text-slate-900">{kpis.accuracy}%</div>
            <div className="text-[11px] font-semibold text-slate-500">Avg Accuracy</div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs text-center">
            <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-1.5">
              <Flame className="w-4 h-4" />
            </span>
            <div className="text-xl font-extrabold text-slate-900">{kpis.streak} <span className="text-xs font-medium text-slate-400">days</span></div>
            <div className="text-[11px] font-semibold text-slate-500">Study Streak</div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs text-center">
            <span className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto mb-1.5">
              <CheckCircle className="w-4 h-4" />
            </span>
            <div className="text-xl font-extrabold text-slate-900">{kpis.totalQ}</div>
            <div className="text-[11px] font-semibold text-slate-500">Questions Answered</div>
          </div>
        </section>

        {/* 1. Linear Graph (Trajectory over time) */}
        <LearningTrendGraph sessions={quizSessions} />

        {/* 2. Bar Graph (Detailed course-by-course breakdown) */}
        <CourseMasteryBarGraph sessions={quizSessions} />

        {/* My Uploaded Notes Section (Visible ONLY to Admins) */}
        {isAdmin && (
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                  <FileText className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">My Uploaded Notes</h3>
                  <p className="text-[11px] text-slate-500">{files.length} documents uploaded</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('/upload')}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload</span>
                </button>
                <button
                  onClick={() => navigate('/admin/upload')}
                  className="flex items-center gap-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Admin Upload</span>
                </button>
              </div>
            </div>

            {files.length > 3 && (
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter your notes..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            )}

            {files.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                You haven't uploaded any notes yet.
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                No notes match "{fileSearch}"
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/60 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <span className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs">
                        {file.name?.endsWith('.pdf') ? '📕' : '📄'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{file.name}</p>
                        <p className="text-[10px] text-slate-400">{file.subject || 'General'}</p>
                      </div>
                    </div>
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md bg-white border border-slate-200 cursor-pointer flex-shrink-0"
                    >
                      <span>View</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Admin Upload Tile (Visible ONLY to Admins) */}
        {isAdmin && (
          <div className="mb-3">
            <button
              onClick={() => navigate('/admin/upload')}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 hover:from-purple-100 hover:to-indigo-100 border border-indigo-200/90 shadow-xs transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
                  <Upload className="w-4 h-4" />
                </span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-indigo-950">Admin Upload Portal</p>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-indigo-200 text-indigo-800">Admin</span>
                  </div>
                  <p className="text-[11px] text-indigo-700">Upload past papers, course modules, and questions</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-indigo-500" />
            </button>
          </div>
        )}

        {/* Settings & Updates Link */}
        <div className="mb-3">
          <button
            onClick={() => navigate('/settings')}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200/80 shadow-xs transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <SettingsIcon className="w-4 h-4" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-800">Settings & App Updates</p>
                <p className="text-[11px] text-slate-500">Theme, cache, and official release updates</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Sign Out Button */}
        <div className="pt-2 pb-6">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-rose-50/80 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200/80 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out of StudyHub</span>
          </button>
        </div>
      </main>

      {/* ─── Academic Details Edit Modal ─────────────────────────────────── */}
      {showAcademicModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-xl bg-indigo-50 text-indigo-600">
                  <School className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Edit Academic Profile</h3>
                  <p className="text-xs text-slate-500">Update your programme, semester, and year</p>
                </div>
              </div>
              <button
                onClick={() => setShowAcademicModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAcademic} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={academicForm.name}
                  onChange={(e) => setAcademicForm({ ...academicForm, name: e.target.value })}
                  placeholder="e.g. John Banda"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Programme Selection */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Programme of Study
                  </label>
                  {programsList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomProgramMode(!customProgramMode)}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                    >
                      {customProgramMode ? 'Select from list' : 'Type custom programme'}
                    </button>
                  )}
                </div>
                {!customProgramMode && programsList.length > 0 ? (
                  <select
                    value={academicForm.program}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomProgramMode(true);
                      } else {
                        setAcademicForm({ ...academicForm, program: e.target.value });
                      }
                    }}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">— Select your programme —</option>
                    {programsList.map((prog) => (
                      <option key={prog.id} value={prog.name}>
                        {prog.name} ({prog.campus || 'LUANAR'})
                      </option>
                    ))}
                    <option value="__custom__">✏️ Other (Type custom programme)...</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={academicForm.program}
                    onChange={(e) => setAcademicForm({ ...academicForm, program: e.target.value })}
                    placeholder="e.g. BSc in Agricultural Economics"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  />
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  {customProgramMode
                    ? 'Enter your custom programme name'
                    : 'Choose from official LUANAR curriculum or enter custom'}
                </p>
              </div>

              {/* Year of Study & Semester (Pills) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Year of Study
                  </label>
                  <div className="grid grid-cols-5 gap-1">
                    {['1', '2', '3', '4', '5'].map((y) => (
                      <button
                        type="button"
                        key={y}
                        onClick={() => setAcademicForm({ ...academicForm, year_of_study: y })}
                        className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          academicForm.year_of_study === y
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        Yr {y}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Semester
                  </label>
                  <div className="max-h-32 overflow-y-auto pr-1 flex flex-col gap-1 border border-slate-200/90 rounded-xl p-1.5 bg-slate-50/60 shadow-inner">
                    {['1', '2', '3', '4', '5', '6', '7', '8'].map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => setAcademicForm({ ...academicForm, semester: s })}
                        className={`w-full py-1.5 px-2.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                          academicForm.semester === s
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span>Semester {s}</span>
                        {academicForm.semester === s && <CheckCircle className="w-3.5 h-3.5 text-white shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Campus */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Campus</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'Bunda', label: 'Bunda Campus' },
                    { id: 'NRC', label: 'NRC Campus' },
                    { id: 'City', label: 'City Campus' },
                  ].map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setAcademicForm({ ...academicForm, campus: c.id })}
                      className={`py-2 px-1 text-xs font-semibold rounded-xl border transition-all cursor-pointer text-center ${
                        academicForm.campus === c.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Short Study Bio
                </label>
                <textarea
                  rows={2}
                  maxLength={150}
                  value={academicForm.bio}
                  onChange={(e) => setAcademicForm({ ...academicForm, bio: e.target.value })}
                  placeholder="Share your academic goals or focal areas..."
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="submit"
                  disabled={savingAcademic}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingAcademic ? 'Saving Changes…' : 'Save Details'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAcademicModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}