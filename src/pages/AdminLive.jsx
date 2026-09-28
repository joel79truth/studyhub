import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import {
  Users,
  Activity,
  Clock,
  RotateCcw,
  Sparkles,
  BookOpen,
  HelpCircle,
  FileText,
  MessageSquare,
  TrendingUp,
  Flame,
  Volume2,
  VolumeX,
  Search,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Smartphone,
  Globe,
  Bell,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export default function AdminLive() {
  const navigate = useNavigate();
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [systemPrograms, setSystemPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProgram, setFilterProgram] = useState('ALL');
  const [prevCount, setPrevCount] = useState(0);
  const [bannerAlert, setBannerAlert] = useState(null);
  const [currentAdminId, setCurrentAdminId] = useState(null);

  const audioContextRef = useRef(null);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const prevCountRef = useRef(0);
  const currentAdminIdRef = useRef(null);
  currentAdminIdRef.current = currentAdminId;

  // Play subtle pleasant chime on user count threshold or new active connection
  const playAlertSound = () => {
    if (!soundEnabledRef.current) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (_) {}
  };

  // 1. Fetch current admin user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) {
        setCurrentAdminId(data.user.id);
        currentAdminIdRef.current = data.user.id;
      }
    });
  }, []);

  // 2. Fetch registered profiles from Supabase to compute historical retention & habits
  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, program, semester, streak, last_active, created_at, is_admin, daily_counts, quizzes_completed, total_questions')
        .order('last_active', { ascending: false, nullsFirst: false });

      if (!error && data) {
        setProfiles(data);
      }
    } catch (e) {
      console.warn('Failed to load profiles:', e);
    } finally {
      setLoading(false);
    }
  };

  // 3. Fetch official university programs list from Supabase
  const fetchPrograms = async () => {
    try {
      const { data: progs, error } = await supabase
        .from('programs')
        .select('name')
        .order('name', { ascending: true });

      if (!error && progs) {
        setSystemPrograms(progs.map((p) => p.name).filter(Boolean));
      }
    } catch (e) {
      console.warn('Failed to load university programs:', e);
    }
  };

  useEffect(() => {
    fetchProfiles();
    fetchPrograms();
  }, []);

  // 4. Subscribe to Supabase Realtime Presence Channel ('studyhub-live-presence')
  useEffect(() => {
    // Clean up any lingering presence channel on this topic before subscribing
    const existing = supabase.getChannels().filter(
      (c) => c.topic === 'realtime:studyhub-live-presence'
    );
    existing.forEach((c) => {
      try {
        supabase.removeChannel(c);
      } catch {}
    });

    const channel = supabase.channel('studyhub-live-presence', {
      config: { presence: { key: 'admin-listener' } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const activeList = [];

        Object.entries(state).forEach(([key, presences]) => {
          // Exclude the admin listener itself
          if (key === 'admin-listener') return;

          if (Array.isArray(presences) && presences.length > 0) {
            const latest = presences[presences.length - 1];
            const uid = latest.user_id || key;

            // Only filter out the admin viewer's own tab if they are currently on /admin/live
            if (
              currentAdminIdRef.current &&
              uid === currentAdminIdRef.current &&
              latest.current_page?.startsWith('/admin')
            ) {
              return;
            }

            activeList.push({
              key,
              userId: uid,
              name: latest.name || 'Anonymous Student',
              avatarUrl: latest.avatar_url,
              program: latest.program || 'General',
              semester: latest.semester,
              streak: latest.streak || 1,
              currentPage: latest.current_page || '/',
              currentAction: latest.current_action || 'Browsing StudyHub',
              actionCategory: latest.action_category || 'browse',
              isIdle: latest.is_idle || false,
              isAdmin: Boolean(latest.is_admin),
              onlineAt: latest.online_at || new Date().toISOString(),
              sessionStartedAt: latest.session_started_at || new Date().toISOString(),
              device: latest.device || 'Web Browser',
            });
          }
        });

        // Trigger alert notification when user count increases
        if (activeList.length > prevCountRef.current && activeList.length > 0) {
          playAlertSound();
          setBannerAlert(`Active users update: ${activeList.length} user${activeList.length > 1 ? 's' : ''} online right now!`);
          setTimeout(() => setBannerAlert(null), 5000);
        }

        prevCountRef.current = activeList.length;
        setPrevCount(activeList.length);
        setOnlineUsers(activeList);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (newPresences?.[0]?.name) {
          playAlertSound();
        }
      })
      .subscribe((status) => {
        console.log('[AdminLive] Presence subscription status:', status);
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, []); // Stable single subscription on mount

  // Compute Retention Metrics from Supabase Database
  const retentionStats = useMemo(() => {
    const totalRegistered = profiles.length || 1;
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * oneDayMs;
    const thirtyDaysMs = 30 * oneDayMs;

    let activeToday = 0;
    let activeThisWeek = 0;
    let activeThisMonth = 0;
    let coreHabitStudents = 0; // streak >= 3
    let steadyWeekly = 0; // returned 3+ days recorded in daily_counts
    let atRisk = 0; // inactive > 14 days

    profiles.forEach((p) => {
      const lastActive = p.last_active ? new Date(p.last_active) : null;
      if (lastActive) {
        const diff = now - lastActive;
        if (diff <= oneDayMs) activeToday++;
        if (diff <= sevenDaysMs) activeThisWeek++;
        if (diff <= thirtyDaysMs) activeThisMonth++;
        if (diff > 14 * oneDayMs) atRisk++;
      } else {
        atRisk++;
      }

      if ((p.streak || 0) >= 3) {
        coreHabitStudents++;
      }

      const dailyKeys = p.daily_counts ? Object.keys(p.daily_counts).length : 0;
      if (dailyKeys >= 3) {
        steadyWeekly++;
      }
    });

    const weeklyReturnRate = Math.round((activeThisWeek / totalRegistered) * 100);
    const monthlyReturnRate = Math.round((activeThisMonth / totalRegistered) * 100);
    const stickinessRatio = activeThisMonth > 0 ? Math.round((activeToday / activeThisMonth) * 100) : 0;

    return {
      totalRegistered,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      coreHabitStudents,
      steadyWeekly,
      atRisk,
      weeklyReturnRate,
      monthlyReturnRate,
      stickinessRatio,
    };
  }, [profiles]);

  // Unique programs for filtering — includes all 38 university programs,
  // registered student programs, and any program reported by active users.
  const allPrograms = useMemo(() => {
    const set = new Set();
    // 1. Official university programs from programs table
    systemPrograms.forEach((p) => {
      if (p) set.add(p.trim());
    });
    // 2. Programs set in user profiles
    profiles.forEach((p) => {
      if (p.program) set.add(p.program.trim());
    });
    // 3. Programs reported by active users
    onlineUsers.forEach((u) => {
      if (u.program && u.program !== 'General') set.add(u.program.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [systemPrograms, profiles, onlineUsers]);

  // Filtered active users
  const filteredUsers = useMemo(() => {
    return onlineUsers.filter((u) => {
      const matchesSearch =
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.currentAction.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.program.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesProgram = filterProgram === 'ALL' || u.program === filterProgram;
      return matchesSearch && matchesProgram;
    });
  }, [onlineUsers, searchTerm, filterProgram]);

  // Category counts of current activity
  const activeCategoryBreakdown = useMemo(() => {
    const counts = {
      past_papers: 0,
      quiz: 0,
      notes: 0,
      ai_chat: 0,
      browse: 0,
    };
    onlineUsers.forEach((u) => {
      if (counts[u.actionCategory] !== undefined) {
        counts[u.actionCategory]++;
      } else {
        counts.browse++;
      }
    });
    return counts;
  }, [onlineUsers]);

  const getCategoryBadge = (category) => {
    switch (category) {
      case 'past_papers':
        return {
          icon: <FileText className="w-3.5 h-3.5" />,
          label: 'Past Papers',
          bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
        };
      case 'quiz':
        return {
          icon: <HelpCircle className="w-3.5 h-3.5" />,
          label: 'Practice Quiz',
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        };
      case 'notes':
        return {
          icon: <BookOpen className="w-3.5 h-3.5" />,
          label: 'Lecture Notes',
          bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
        };
      case 'ai_chat':
        return {
          icon: <MessageSquare className="w-3.5 h-3.5" />,
          label: 'Luna AI Chat',
          bg: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
        };
      default:
        return {
          icon: <Activity className="w-3.5 h-3.5" />,
          label: 'Browsing',
          bg: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-800',
        };
    }
  };

  const calculateDwell = (isoTime) => {
    if (!isoTime) return '1m';
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000));
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (mins < 1) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-16">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
              title="Return to Home"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  LIVE ENGINE
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Supabase Realtime</span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                StudyHub Live Command Center
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition ${
                soundEnabled
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
                  : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
              }`}
              title={soundEnabled ? 'Mute presence sound alerts' : 'Enable presence sound alerts'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{soundEnabled ? 'Chime ON' : 'Chime OFF'}</span>
            </button>

            <Link
              to="/admin/upload"
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-blue-600 dark:hover:bg-blue-500 text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Exam Upload</span>
            </Link>

            <button
              onClick={() => {
                fetchProfiles();
                fetchPrograms();
              }}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Real-time Notification Banner for User Milestones */}
      {bannerAlert && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-2.5 shadow-md flex items-center justify-between text-xs sm:text-sm font-medium animate-in slide-in-from-top duration-200">
          <div className="max-w-7xl mx-auto w-full flex items-center gap-2">
            <Bell className="w-4 h-4 animate-bounce" />
            <span>{bannerAlert}</span>
          </div>
          <button onClick={() => setBannerAlert(null)} className="text-white/80 hover:text-white text-xs ml-4">
            ✕
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Prominent Live Notification Card */}
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 sm:p-7 shadow-xl border border-indigo-900/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span>Real-time Active Presence Synchronized</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {onlineUsers.length} Students Online Right Now
              </h2>
              <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xl">
                Live feedback on current academic activities across LUANAR programs. Track study session dwell time,
                most-used features, and student retention habits.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-4 text-center min-w-[120px]">
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400">{onlineUsers.length}</div>
                <div className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold mt-0.5">Active Live</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-4 text-center min-w-[120px]">
                <div className="text-2xl sm:text-3xl font-extrabold text-blue-400">{retentionStats.activeToday}</div>
                <div className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold mt-0.5">Today's Visits</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-4 text-center min-w-[120px]">
                <div className="text-2xl sm:text-3xl font-extrabold text-purple-400">{retentionStats.weeklyReturnRate}%</div>
                <div className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold mt-0.5">7-Day Retention</div>
              </div>
            </div>
          </div>
        </div>

        {/* 4 Key Scalability KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <span>Habit Forming</span>
              <Flame className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
              {retentionStats.coreHabitStudents}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {Math.round((retentionStats.coreHabitStudents / retentionStats.totalRegistered) * 100)}%
              </span>
              <span>students with &ge; 3 day streaks</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <span>Weekly Active (WAU)</span>
              <TrendingUp className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
              {retentionStats.activeThisWeek}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Out of {retentionStats.totalRegistered} registered students
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <span>Monthly Active (MAU)</span>
              <RotateCcw className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
              {retentionStats.activeThisMonth}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Stickiness (DAU/MAU): <strong className="text-purple-600 dark:text-purple-400">{retentionStats.stickinessRatio}%</strong>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <span>At-Risk Churn (&gt;14d)</span>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
              {retentionStats.atRisk}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Needs targeted engagement
            </div>
          </div>
        </div>

        {/* Feature Usage Pulse Row */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                Live Feature Distribution (Where Active Users Are Concentrated)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Helps allocate server load and AI inference capacity to high-traffic features.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="flex items-center justify-between text-blue-700 dark:text-blue-300 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4" /> Past Papers
                </span>
                <span className="text-base font-bold">{activeCategoryBreakdown.past_papers}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Exam preparation & solved solutions</div>
            </div>

            <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4" /> Practice Quizzes
                </span>
                <span className="text-base font-bold">{activeCategoryBreakdown.quiz}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Spaced-repetition self-testing</div>
            </div>

            <div className="p-3.5 rounded-xl border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20">
              <div className="flex items-center justify-between text-purple-700 dark:text-purple-300 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" /> Luna AI Chat
                </span>
                <span className="text-base font-bold">{activeCategoryBreakdown.ai_chat}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Interactive tutoring & explanations</div>
            </div>

            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4" /> Lecture Notes
                </span>
                <span className="text-base font-bold">{activeCategoryBreakdown.notes}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Course PDF & slides viewer</div>
            </div>
          </div>
        </div>

        {/* Main Split: Live Users Board & Scaling Strategy Box */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Users Table (2 Columns) */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-500" />
                  Active Students Stream ({filteredUsers.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Direct live stream of current screens and active operations.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search active users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36 sm:w-48"
                  />
                </div>

                <select
                  value={filterProgram}
                  onChange={(e) => setFilterProgram(e.target.value)}
                  className="py-1.5 px-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[170px]"
                >
                  <option value="ALL">All Programs ({allPrograms.length})</option>
                  {allPrograms.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* List / Table */}
            {filteredUsers.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <Users className="w-10 h-10 mx-auto stroke-1 opacity-40 mb-2" />
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">No active students on this filter right now</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1">
                  When students open StudyHub on their phones or browsers, they will automatically appear here with their live study actions.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="pb-3 pl-1">Student / Device</th>
                      <th className="pb-3">Program</th>
                      <th className="pb-3">Current Action</th>
                      <th className="pb-3">Session Dwell</th>
                      <th className="pb-3 pr-1">Streak</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {filteredUsers.map((user) => {
                      const badge = getCategoryBadge(user.actionCategory);
                      return (
                        <tr key={user.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                          <td className="py-3 pl-1">
                            <div className="flex items-center gap-2.5">
                              <div className="relative">
                                {user.avatarUrl ? (
                                  <img
                                    src={user.avatarUrl}
                                    alt={user.name}
                                    className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold flex items-center justify-center text-xs">
                                    {user.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                                    user.isIdle ? 'bg-amber-400' : 'bg-emerald-500'
                                  }`}
                                  title={user.isIdle ? 'Idle tab' : 'Active'}
                                ></span>
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <span>{user.name}</span>
                                  {user.isAdmin && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-semibold border border-purple-200 dark:border-purple-800">
                                      Admin
                                    </span>
                                  )}
                                  {user.isIdle && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-normal">
                                      idle
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                  {user.device.includes('Android') ? (
                                    <Smartphone className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Globe className="w-3 h-3 text-blue-500" />
                                  )}
                                  <span>{user.device}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-slate-600 dark:text-slate-300 max-w-[150px] truncate" title={user.program}>
                            {user.program}
                          </td>
                          <td className="py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${badge.bg}`}
                            >
                              {badge.icon}
                              <span className="max-w-[180px] sm:max-w-[220px] truncate">{user.currentAction}</span>
                            </span>
                          </td>
                          <td className="py-3 text-slate-500 dark:text-slate-400 font-mono">
                            {calculateDwell(user.sessionStartedAt)}
                          </td>
                          <td className="py-3 pr-1">
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                              <Flame className="w-3 h-3 fill-amber-500 text-amber-500" />
                              <span>{user.streak}d</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Scaling Insights & Retention Cohorts (1 Column) */}
          <div className="space-y-4">
            {/* Retention Breakdown */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-purple-500" />
                Retention & Return Cadence
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Frequency analysis based on registered user profiles.
              </p>

              <div className="space-y-2.5 pt-1">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">Daily Habit (&ge; 3 Streak)</div>
                    <div className="text-[11px] text-slate-500">{retentionStats.coreHabitStudents} students studying daily</div>
                  </div>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    {Math.round((retentionStats.coreHabitStudents / retentionStats.totalRegistered) * 100)}%
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">Weekly Returning</div>
                    <div className="text-[11px] text-slate-500">{retentionStats.activeThisWeek} students active this week</div>
                  </div>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-lg border border-blue-200 dark:border-blue-800">
                    {retentionStats.weeklyReturnRate}%
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">Monthly Active Students</div>
                    <div className="text-[11px] text-slate-500">{retentionStats.activeThisMonth} students active this month</div>
                  </div>
                  <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-lg border border-purple-200 dark:border-purple-800">
                    {retentionStats.monthlyReturnRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* Strategic Scaling Signals */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                Signals to 10x StudyHub Scale
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Actionable metrics collected from student behavior:
              </p>

              <div className="text-xs space-y-2.5 text-slate-700 dark:text-slate-300">
                <div className="p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
                  <strong className="text-blue-700 dark:text-blue-300 block mb-0.5">1. Pre-Exam Demand Spikes</strong>
                  When &gt; 15 concurrent users open the same past paper, push notifications for that course's quiz to all classmates.
                </div>

                <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                  <strong className="text-emerald-700 dark:text-emerald-300 block mb-0.5">2. Content Gap Discovery</strong>
                  Track search queries that return 0 results to know which past exams need immediate upload.
                </div>

                <div className="p-2.5 rounded-lg bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30">
                  <strong className="text-purple-700 dark:text-purple-300 block mb-0.5">3. Multi-Campus Spread</strong>
                  Expand from Bunda to NRC, City Campus, and Mzuzu by monitoring program adoption distribution.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
