import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { API_BASE_URL } from '../lib/apiConfig';
import {
  FileText, PlusCircle, Clock, Search, BookOpen, GraduationCap,
  ArrowLeft, CheckCircle2, AlertCircle, Upload, ChevronRight,
  Filter, Sparkles, RefreshCw, Send, X, ExternalLink
} from 'lucide-react';

export default function RequestNotes() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // URL query params (from push notifications)
  const paramTopic = searchParams.get('topic') || '';
  const paramCourse = searchParams.get('course') || '';
  const paramProgram = searchParams.get('program') || '';
  const paramSemester = searchParams.get('semester') || '';

  // ─── Auth & Profile ──────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  // ─── Tabs & Views: 'form' | 'history' ────────────────────────
  const [activeTab, setActiveTab] = useState(() => {
    return paramTopic || paramCourse ? 'history' : 'form';
  });
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'mine'
  const [searchQuery, setSearchQuery] = useState(paramTopic || '');

  // ─── Form State ──────────────────────────────────────────────
  const [topic, setTopic] = useState(paramTopic || '');
  const [course, setCourse] = useState(paramCourse || '');
  const [program, setProgram] = useState(paramProgram || '');
  const [semester, setSemester] = useState(paramSemester || '1');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');

  // ─── Data & UI State ─────────────────────────────────────────
  const [programs, setPrograms] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ─── 1. Load User Session & Profile ──────────────────────────
  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setEmail(session.user.email || '');

        const { data: prof } = await supabase
          .from('profiles')
          .select('program, semester, year_of_study')
          .eq('id', session.user.id)
          .maybeSingle();

        if (prof) {
          setProfile(prof);
          if (!paramProgram && prof.program) setProgram(prof.program);
          if (!paramSemester && prof.semester) setSemester(String(prof.semester));
        }
      }
    };
    loadUser();
  }, [paramProgram, paramSemester]);

  // ─── 2. Load Programs ────────────────────────────────────────
  useEffect(() => {
    const loadPrograms = async () => {
      try {
        const { data, error } = await supabase.from('programs').select('name').order('name');
        if (!error && data?.length) {
          setPrograms(data.map(p => p.name));
        } else {
          const res = await fetch(`${API_BASE_URL}/api/programs`);
          if (res.ok) {
            const json = await res.json();
            setPrograms(json.programs || []);
          }
        }
      } catch (e) {
        console.warn('Programs load error:', e);
      }
    };
    loadPrograms();
  }, []);

  // ─── 3. Load All Requests ────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/requests`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      } else {
        const { data: sbRequests, error: sbError } = await supabase
          .from('requests')
          .select('*')
          .order('created_at', { ascending: false });
        if (!sbError && sbRequests) {
          setRequests(sbRequests);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch requests from API, trying direct table:', err);
      try {
        const { data: sbRequests } = await supabase
          .from('requests')
          .select('*')
          .order('created_at', { ascending: false });
        if (sbRequests) setRequests(sbRequests);
      } catch (_) {}
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // ─── 4. Handle Form Submit ───────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!topic.trim() || !course.trim() || !program.trim() || !semester) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        topic: topic.trim(),
        course: course.trim(),
        program: program.trim(),
        semester: String(semester),
        notes: notes.trim(),
        email: email.trim() || user?.email || '',
        user_id: user?.id || null,
      };

      const res = await fetch(`${API_BASE_URL}/submit-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showToast('Request submitted! Peers and lecturers have been notified.');
        setTopic('');
        setNotes('');
        await fetchRequests();
        setActiveTab('history');
        setFilterMode('mine');
      } else {
        const errJson = await res.json().catch(() => ({}));
        showToast(errJson.message || 'Submission failed. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Submit error:', err);
      showToast('Connection error. Check your internet connection.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Filtered Requests ───────────────────────────────────────
  const filteredRequests = useMemo(() => {
    let list = requests;
    if (filterMode === 'mine' && user?.email) {
      list = list.filter(r => (r.email || '').toLowerCase() === user.email.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r =>
        (r.topic || '').toLowerCase().includes(q) ||
        (r.course || '').toLowerCase().includes(q) ||
        (r.program || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [requests, filterMode, searchQuery, user?.email]);

  const isHighlighted = (r) => {
    if (!paramTopic && !paramCourse) return false;
    return (
      (paramTopic && (r.topic || '').toLowerCase().includes(paramTopic.toLowerCase())) ||
      (paramCourse && (r.course || '').toLowerCase().includes(paramCourse.toLowerCase()))
    );
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Recently';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return 'Recently';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20 lg:pb-0 w-full flex flex-col font-sans">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-xl transition-all active:scale-95 text-slate-700"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
              <img src="/images/luanar7.png" alt="LUANAR" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight">Request Notes</h1>
              <p className="text-[11px] text-slate-400 font-medium">Community Study Requests</p>
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate('/profile')}
          className="p-1 rounded-full hover:bg-slate-100 transition-colors"
          aria-label="Profile"
        >
          <img
            src={user?.user_metadata?.avatar_url || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}
            alt="Profile"
            className="w-8 h-8 rounded-full border border-indigo-200 object-cover shadow-sm"
          />
        </button>
      </header>

      {/* ─── Notification Deep-Link Banner ─── */}
      {(paramTopic || paramCourse) && (
        <div className="bg-indigo-600 text-white px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 truncate">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-amber-300" />
            <span className="truncate">
              Viewing request: <strong>{paramTopic || paramCourse}</strong>
              {paramSemester ? ` (Semester ${paramSemester})` : ''}
            </span>
          </div>
          <button
            onClick={() => navigate('/Request', { replace: true })}
            className="text-white/80 hover:text-white px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-0.5 bg-white/10 hover:bg-white/20 transition-all flex-shrink-0"
          >
            Clear <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ─── Main Container ─── */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-5 sm:py-6">
        {/* ─── Segmented Navigation Tabs ─── */}
        <div className="bg-slate-200/70 p-1 rounded-2xl flex items-center mb-6 shadow-inner">
          <button
            onClick={() => setActiveTab('form')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'form'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Make Request</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'history'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Requests Board</span>
            {requests.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'history' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-300 text-slate-700'
              }`}>
                {requests.length}
              </span>
            )}
          </button>
        </div>

        {/* ─── TAB 1: MAKE A REQUEST FORM ─── */}
        {activeTab === 'form' && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xl shadow-indigo-50/50 animate-fade-up max-w-xl mx-auto">
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
                <FileText className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Request Missing Notes</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                Can&apos;t find materials for a specific topic? Submit a request and peers or lecturers will upload them.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Topic */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Topic or Chapter <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., Photosynthesis & Light Reactions, Regression Analysis"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
              </div>

              {/* Course */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Course / Subject Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  placeholder="e.g., General Chemistry (CHE111), Soil Physics"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
              </div>

              {/* Program & Semester Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Program <span className="text-red-500">*</span>
                  </label>
                  {programs.length > 0 ? (
                    <select
                      value={program}
                      onChange={(e) => setProgram(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-800"
                      required
                    >
                      <option value="">Select program</option>
                      {programs.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={program}
                      onChange={(e) => setProgram(e.target.value)}
                      placeholder="e.g., BSc Horticulture"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                      required
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Semester <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-800 font-semibold"
                    required
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                      <option key={s} value={s}>Sem {s}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Additional Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Additional Details <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g., Need lecture slides from week 4-6 or past assignment solution guide"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold rounded-2xl hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-md shadow-indigo-200 active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2 mt-2"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Broadcasting Request…</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Post Request</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ─── TAB 2: REQUESTS BOARD ─── */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            {/* Search & Filter Controls */}
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by topic, course, or program…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    filterMode === 'all'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Requests ({requests.length})
                </button>
                <button
                  onClick={() => setFilterMode('mine')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    filterMode === 'mine'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  My Requests
                </button>
                <button
                  onClick={fetchRequests}
                  className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl transition-all"
                  title="Refresh requests list"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingRequests ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Requests List */}
            {loadingRequests && !requests.length ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 bg-white rounded-2xl border border-slate-100 animate-pulse" />
                ))}
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-800">
                  {searchQuery ? 'No matching requests found' : filterMode === 'mine' ? "You haven't requested any notes yet" : 'No requests yet'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                  {searchQuery
                    ? 'Try searching with a different keyword or clear the search filter.'
                    : 'Be the first to request notes for your upcoming lectures or exams!'}
                </p>
                <button
                  onClick={() => setActiveTab('form')}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm hover:bg-indigo-700 transition-all active:scale-95"
                >
                  <PlusCircle className="w-4 h-4" /> Make a Request
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredRequests.map((req) => {
                  const highlighted = isHighlighted(req);
                  return (
                    <div
                      key={req.id || `${req.topic}-${req.created_at}`}
                      className={`bg-white rounded-2xl p-5 border transition-all relative flex flex-col justify-between ${
                        highlighted
                          ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md bg-indigo-50/20'
                          : 'border-slate-100 hover:border-slate-200 shadow-sm'
                      }`}
                    >
                      {highlighted && (
                        <div className="absolute -top-2.5 right-4 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                          Requested via Notification
                        </div>
                      )}

                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-100">
                            <Clock className="w-3 h-3" /> Requested
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium">
                            {formatDate(req.created_at)}
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-slate-900 leading-snug tracking-tight">
                          {req.topic}
                        </h3>

                        <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold mt-1">
                          <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{req.course}</span>
                        </div>

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                            {req.program || 'General'}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                            Sem {req.semester}
                          </span>
                        </div>

                        {req.notes && (
                          <div className="mt-3 p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 leading-relaxed italic">
                            &ldquo;{req.notes}&rdquo;
                          </div>
                        )}
                      </div>

                      {/* Action Bar */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                          {req.email ? req.email.split('@')[0] : 'Student'}
                        </span>
                        <button
                          onClick={() => {
                            navigate(`/upload?program=${encodeURIComponent(req.program || '')}&course=${encodeURIComponent(req.course || '')}&semester=${req.semester || ''}`);
                          }}
                          className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-all active:scale-95 flex-shrink-0"
                          title="Upload notes for this requested topic"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Notes</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ─── Toast ─── */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold flex items-center gap-2 animate-fade-up ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Bottom Nav */}
      <BottomNav />
    </div>
  );
}