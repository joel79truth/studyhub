import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import {
  UploadCloud,
  FileText,
  BookOpen,
  Camera,
  Layers,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RefreshCw,
  Plus,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Lock,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { cleanPhoto, buildA4PdfFromPages, warmScannerWorker } from '../services/scannerService';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { showNotificationBanner } from '../utils/notificationBannerService';
import appLogo from '/images/luanar7.png';

// Local storage keys for metadata persistence across sessions & tabs
const STORAGE_KEY_PROGRAM_ID = 'studyhub_upload_program_id';
const STORAGE_KEY_PROGRAM_NAME = 'studyhub_upload_program_name';
const STORAGE_KEY_SEMESTER = 'studyhub_upload_semester';

export default function Upload({ isAdminMode = false }) {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Auth & Role State ───────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('checking'); // 'checking' | 'admin' | 'lecturer' | 'student'
  const [authLoading, setAuthLoading] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState('');

  // ── Tab State ───────────────────────────────────────────────────────────────
  // 'notes' | 'papers' | 'tutorials'
  const [activeTab, setActiveTab] = useState(
    location.state?.defaultTab || (location.pathname.includes('admin') ? 'papers' : 'notes')
  );

  // ── Shared Academic Metadata ────────────────────────────────────────────────
  const [programs, setPrograms] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState(
    () => localStorage.getItem(STORAGE_KEY_PROGRAM_ID) || ''
  );
  const [selectedProgramName, setSelectedProgramName] = useState(
    () => localStorage.getItem(STORAGE_KEY_PROGRAM_NAME) || ''
  );
  const [selectedSemester, setSelectedSemester] = useState(
    () => localStorage.getItem(STORAGE_KEY_SEMESTER) || '1'
  );
  const [courseInput, setCourseInput] = useState('');
  const [coursesList, setCoursesList] = useState([]);

  // Past paper specific metadata
  const currentYear = new Date().getFullYear();
  const [paperYear, setPaperYear] = useState(String(currentYear));
  const [examType, setExamType] = useState('end_sem'); // 'end_sem' | 'mid_sem' | 'test' | 'assignment'

  // Past paper mode: 'files' | 'scanner'
  const [paperMode, setPaperMode] = useState('files');

  // Scanner state (camera capture)
  const [scannedPages, setScannedPages] = useState([]);
  const [compilingPdf, setCompilingPdf] = useState(false);
  const cameraInputRef = useRef(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // ── High-Speed Upload Queue ─────────────────────────────────────────────────
  const {
    queue,
    isUploading,
    addFiles,
    removeFile,
    retryFile,
    startUpload,
    resetQueue,
    clearCompleted,
    stats,
  } = useUploadQueue({
    onFileSuccess: (item, result) => {
      showNotificationBanner({
        type: item.category || 'notes',
        uploadType: item.category === 'past_papers' ? 'Past Paper' : item.category === 'tutorials' ? 'Tutorial' : 'Notes',
        title: `New ${item.category === 'past_papers' ? 'Past Paper' : item.category === 'tutorials' ? 'Tutorial' : 'Notes'} Shared`,
        program: item.program,
        course: item.subject,
        semester: item.semester,
        filename: item.name,
        imageUrl: result?.thumbnailUrl || null,
        url: result?.id ? `/viewer?fileId=${encodeURIComponent(result.id)}` : '/',
      });
    },
  });

  // ── Warm scanner web worker early ───────────────────────────────────────────
  useEffect(() => {
    warmScannerWorker();
  }, []);

  // ── Check Auth & Contributor Role ───────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const checkRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (mounted) {
            setUser(null);
            setRole('student');
            setAuthLoading(false);
          }
          return;
        }

        const currentUser = session.user;
        if (mounted) setUser(currentUser);

        // Check metadata first
        const metaRole = String(currentUser.app_metadata?.role || currentUser.user_metadata?.role || '').toLowerCase();
        const metaIsAdmin = Boolean(currentUser.user_metadata?.is_admin || currentUser.app_metadata?.is_admin);

        if (metaRole === 'admin' || metaIsAdmin) {
          if (mounted) { setRole('admin'); setAuthLoading(false); }
          return;
        }
        if (metaRole === 'lecturer') {
          if (mounted) { setRole('lecturer'); setAuthLoading(false); }
          return;
        }

        // Query profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, role, admin')
          .eq('id', currentUser.id)
          .maybeSingle();

        const pRole = String(profile?.role || '').toLowerCase();
        const isAdmin = Boolean(profile?.is_admin === true || profile?.admin === true || pRole === 'admin');
        const isLecturer = pRole === 'lecturer';

        if (mounted) {
          if (isAdmin) setRole('admin');
          else if (isLecturer) setRole('lecturer');
          else setRole('student');
          setAuthLoading(false);
        }
      } catch (err) {
        console.error('[Upload] Auth check error:', err);
        if (mounted) {
          setRole('student');
          setAuthLoading(false);
        }
      }
    };

    checkRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkRole();
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // ── Load Programs List ──────────────────────────────────────────────────────
  useEffect(() => {
    const loadPrograms = async () => {
      try {
        const { data, error } = await supabase
          .from('programs')
          .select('id, name')
          .order('name');
        if (error) throw error;
        setPrograms(data || []);

        // Default to first program if nothing saved yet
        if (!selectedProgramId && data && data.length > 0) {
          setSelectedProgramId(data[0].id);
          setSelectedProgramName(data[0].name);
          localStorage.setItem(STORAGE_KEY_PROGRAM_ID, data[0].id);
          localStorage.setItem(STORAGE_KEY_PROGRAM_NAME, data[0].name);
        }
      } catch (err) {
        console.warn('Failed to load programs list:', err);
      }
    };
    loadPrograms();
  }, [selectedProgramId]);

  // ── Load Courses for selected Program & Semester ────────────────────────────
  useEffect(() => {
    if (!selectedProgramId) return;
    const loadCourses = async () => {
      try {
        const semNum = parseInt(selectedSemester, 10) || 1;
        const { data } = await supabase
          .from('courses')
          .select('id, course_name, course_code, semester')
          .eq('program_id', selectedProgramId)
          .eq('semester', semNum)
          .order('course_name');
        setCoursesList(data || []);
      } catch (_) {
        setCoursesList([]);
      }
    };
    loadCourses();
  }, [selectedProgramId, selectedSemester]);

  // ── Save metadata updates to localStorage ───────────────────────────────────
  const handleProgramChange = (e) => {
    const progId = e.target.value;
    const progObj = programs.find((p) => p.id === progId);
    setSelectedProgramId(progId);
    const progName = progObj ? progObj.name : '';
    setSelectedProgramName(progName);
    localStorage.setItem(STORAGE_KEY_PROGRAM_ID, progId);
    localStorage.setItem(STORAGE_KEY_PROGRAM_NAME, progName);
  };

  const handleSemesterChange = (sem) => {
    setSelectedSemester(String(sem));
    localStorage.setItem(STORAGE_KEY_SEMESTER, String(sem));
  };

  // ── Unlock Lecturer Access Inline ───────────────────────────────────────────
  const handleUnlockLecturer = async (e) => {
    e.preventDefault();
    if (!unlockPassword.trim()) return;

    setUnlocking(true);
    setUnlockError('');

    try {
      const cleanKey = String(unlockPassword).toLowerCase().replace(/[^a-z0-9]/g, '');
      const isMatch = cleanKey === 'studyhublecturer2026' || cleanKey === 'studyhublecturer2025';

      let backendOk = false;
      const { data: { session } } = await supabase.auth.getSession();
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
        const res = await fetch(`${API_BASE_URL}/api/auth/lecturer-verify`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: unlockPassword.trim() }),
        });
        if (res.ok) backendOk = true;
      } catch (_) {}

      if (!isMatch && !backendOk) {
        throw new Error('Incorrect lecturer access password. Please check your department credentials and try again.');
      }

      if (session?.user) {
        await supabase.from('profiles').upsert({
          id: session.user.id,
          role: 'lecturer',
          email: session.user.email,
        }, { onConflict: 'id' }).catch(() => {});

        await supabase.auth.updateUser({
          data: { role: 'lecturer', contributor_unlocked: true },
        }).catch(() => {});
      }

      localStorage.setItem('studyhub_lecturer_unlocked', 'true');
      localStorage.setItem('studyhub_user_role', 'lecturer');

      setRole('lecturer');
      setUnlockPassword('');
    } catch (err) {
      setUnlockError(err.message || 'Verification failed. Please try again.');
    } finally {
      setUnlocking(false);
    }
  };

  // ── File Picking (Mobile Native + Web) ───────────────────────────────────────
  const triggerFileBrowser = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const types =
          activeTab === 'past_papers'
            ? ['application/pdf', 'image/*']
            : activeTab === 'tutorials'
            ? ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
            : ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];

        const result = await FilePicker.pickFiles({ types, multiple: true, readData: false });
        if (!result.files || result.files.length === 0) return;

        const convertedFiles = await Promise.all(
          result.files.map(async (f) => {
            let blob = null;
            if (f.webPath) {
              blob = await fetch(f.webPath).then((r) => r.blob());
            } else if (f.path) {
              const src = Capacitor.convertFileSrc(f.path);
              blob = await fetch(src).then((r) => r.blob());
            }
            return new File([blob || ''], f.name || 'document.pdf', {
              type: f.mimeType || 'application/pdf',
            });
          })
        );
        handleIncomingFiles(convertedFiles);
      } catch (err) {
        console.warn('Native FilePicker error, falling back to input:', err);
        fileInputRef.current?.click();
      }
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
    }
  };

  const handleIncomingFiles = (incomingList) => {
    if (!incomingList || incomingList.length === 0) return;

    const category =
      activeTab === 'past_papers' ? 'past_papers' : activeTab === 'tutorials' ? 'tutorials' : 'notes';

    const defaultMeta = {
      category,
      program: selectedProgramName || 'General Program',
      programId: selectedProgramId || undefined,
      semester: selectedSemester,
      subject: courseInput.trim() || 'General Course',
      year: activeTab === 'past_papers' ? parseInt(paperYear, 10) || currentYear : undefined,
      examType: activeTab === 'past_papers' ? examType : undefined,
      title: activeTab === 'tutorials' ? courseInput.trim() : undefined,
      sourceType: 'typed_pdf',
    };

    addFiles(incomingList, defaultMeta);
  };

  // ── Drag & Drop Handlers ────────────────────────────────────────────────────
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length > 0) {
      handleIncomingFiles(Array.from(e.dataTransfer.files));
    }
  };

  // ── Camera Scanner Handlers (Past Papers) ───────────────────────────────────
  const handleCapturePagePhoto = async (e) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const incoming = Array.from(rawFiles).filter((f) => f.type?.startsWith('image/'));
    if (incoming.length === 0) return;

    const newPageItems = incoming.map((f, i) => {
      const url = URL.createObjectURL(f);
      return {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
        originalBlob: f,
        originalUrl: url,
        cleanedBlob: f,
        cleanedUrl: url,
        useOriginal: false,
        showCleaned: true,
        cleaning: true,
        cleaningStage: 'Enhancing...',
        name: f.name || `Page_${scannedPages.length + i + 1}`,
      };
    });

    setScannedPages((prev) => [...prev, ...newPageItems]);

    // Process each photo in background web worker
    for (const item of newPageItems) {
      try {
        const cleaned = await cleanPhoto(item.originalBlob, (stage) => {
          setScannedPages((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, cleaningStage: stage.message } : p))
          );
        });

        setScannedPages((prev) =>
          prev.map((p) => {
            if (p.id !== item.id) return p;
            return {
              ...p,
              cleaning: false,
              cleaningStage: '',
              cleanedBlob: cleaned.cleanedBlob,
              cleanedUrl: cleaned.cleanedUrl,
              useOriginal: cleaned.useOriginal || false,
            };
          })
        );
      } catch (_) {
        setScannedPages((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, cleaning: false, useOriginal: true } : p))
        );
      }
    }
  };

  const reorderScannedPage = (index, direction) => {
    setScannedPages((prev) => {
      const copy = [...prev];
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= copy.length) return prev;
      const temp = copy[index];
      copy[index] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  const removeScannedPage = (id) => {
    setScannedPages((prev) => prev.filter((p) => p.id !== id));
  };

  const compileScannedPagesToPdf = async () => {
    if (scannedPages.length === 0) return;
    setCompilingPdf(true);

    try {
      const safeCourse = (courseInput.trim() || 'Exam_Paper').replace(/\s+/g, '_');
      const filename = `${safeCourse}_${paperYear || currentYear}_${scannedPages.length}pages.pdf`;
      const generatedPdfFile = await buildA4PdfFromPages(scannedPages, filename);

      const defaultMeta = {
        category: 'past_papers',
        program: selectedProgramName || 'General Program',
        programId: selectedProgramId || undefined,
        semester: selectedSemester,
        subject: courseInput.trim() || 'General Course',
        year: parseInt(paperYear, 10) || currentYear,
        examType,
        sourceType: 'scanned_pdf',
      };

      addFiles([generatedPdfFile], defaultMeta);
      setScannedPages([]);
      setPaperMode('files');
    } catch (err) {
      console.error('Failed to compile scanned PDF:', err);
      alert('Error creating PDF from scanned pages: ' + err.message);
    } finally {
      setCompilingPdf(false);
    }
  };

  // ── Formatters ──────────────────────────────────────────────────────────────
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // ── Check authorization gate ────────────────────────────────────────────────
  const isContributor = role === 'admin' || role === 'lecturer';

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Checking authorization...</p>
        </div>
      </div>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50/70 pb-20">
      
      {/* Top App Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl overflow-hidden shadow-xs ring-1 ring-slate-200">
                <img src={appLogo} alt="LUANAR" className="w-full h-full object-cover" />
              </div>
              <div>
                <h1 className="text-sm font-black text-slate-900 leading-tight flex items-center gap-2">
                  <span>Resource Contributor</span>
                  {role === 'admin' && (
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider">
                      Admin
                    </span>
                  )}
                  {role === 'lecturer' && (
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider">
                      Lecturer
                    </span>
                  )}
                </h1>
                <p className="text-[11px] text-slate-500 font-medium">
                  High-speed upload portal for academic resources
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {role === 'admin' && (
              <button
                onClick={() => navigate('/admin/live')}
                className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-all border border-indigo-200/60"
              >
                <span>Live Activity</span>
                <ExternalLink size={13} />
              </button>
            )}
            <button
              onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full overflow-hidden border border-slate-300 ring-2 ring-slate-100"
              title="Profile"
            >
              <img
                src={user?.user_metadata?.avatar_url || 'https://www.w3schools.com/howto/img_avatar.png'}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">

        {/* ── STUDENT GATE (if not unlocked yet) ── */}
        {!isContributor && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xl max-w-lg mx-auto text-center space-y-5 animate-fadeIn">
            <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs ring-4 ring-indigo-50">
              <Lock size={26} strokeWidth={2.2} />
            </div>

            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Academic Contributor Access
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1.5 max-w-sm mx-auto leading-relaxed">
                This upload engine is dedicated to lecturers and administrators contributing academic materials for LUANAR students.
              </p>
            </div>

            {unlockError && (
              <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-xl border border-rose-200 text-left font-medium">
                {unlockError}
              </div>
            )}

            <form onSubmit={handleUnlockLecturer} className="space-y-3 pt-2">
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Enter lecturer access password"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-mono text-center"
                required
              />
              <button
                type="submit"
                disabled={unlocking || !unlockPassword.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold py-3 px-4 rounded-xl text-sm transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                {unlocking ? 'Verifying access...' : 'Unlock Contributor Tools'}
              </button>
            </form>

            <p className="text-[11px] text-slate-400">
              If you are a student, please contact your lecturer or the university administration to gain access to this contributor portal.
            </p>
          </div>
        )}

        {/* ── UNIFIED CONTRIBUTOR PORTAL ── */}
        {isContributor && (
          <>
            {/* Tab Navigation: Notes, Past Papers, Tutorials */}
            <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-slate-200/70 rounded-2xl shadow-inner">
              <button
                type="button"
                onClick={() => setActiveTab('notes')}
                className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 select-none ${
                  activeTab === 'notes'
                    ? 'bg-white text-blue-600 shadow-md scale-[1.01]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <BookOpen size={17} strokeWidth={2.2} />
                <span>Notes</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('papers')}
                className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 select-none ${
                  activeTab === 'papers'
                    ? 'bg-white text-indigo-600 shadow-md scale-[1.01]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <FileText size={17} strokeWidth={2.2} />
                <span>Past Papers</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('tutorials')}
                className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 select-none ${
                  activeTab === 'tutorials'
                    ? 'bg-white text-purple-600 shadow-md scale-[1.01]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Layers size={17} strokeWidth={2.2} />
                <span>Tutorials</span>
              </button>
            </div>

            {/* Shared Academic Metadata Card (Persistent across tabs) */}
            <section className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck size={15} className="text-blue-600" />
                  <span>Academic Metadata</span>
                </span>
                <span className="text-[11px] text-slate-400 font-medium">
                  Applied to all files in this batch
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Program selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Program <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={selectedProgramId}
                    onChange={handleProgramChange}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 font-medium truncate"
                  >
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Course Name / Subject */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Course / Subject <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={courseInput}
                      onChange={(e) => setCourseInput(e.target.value)}
                      placeholder="e.g. Basic Physics / AGR 101"
                      list="courses-suggestions"
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 font-medium"
                    />
                    <datalist id="courses-suggestions">
                      {coursesList.map((c) => (
                        <option key={c.id} value={c.course_name}>
                          {c.course_code ? `${c.course_code} - ` : ''}{c.course_name}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              {/* Semester Selector Buttons (Sem 1 to Sem 8) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Semester <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSemesterChange(s)}
                      className={`flex-1 min-w-[42px] py-2 text-xs font-bold rounded-xl border transition-all ${
                        selectedSemester === String(s)
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Sem {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Past Paper Specific Metadata: Year & Exam Type */}
              {activeTab === 'papers' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 animate-fadeIn">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Academic Year <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={paperYear}
                      onChange={(e) => setPaperYear(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-medium"
                    >
                      {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4, currentYear - 5, currentYear - 6, currentYear - 7].map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Exam Type
                    </label>
                    <select
                      value={examType}
                      onChange={(e) => setExamType(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-medium"
                    >
                      <option value="end_sem">End of Semester Examination</option>
                      <option value="mid_sem">Mid-Semester Assessment</option>
                      <option value="test">Continuous Assessment Test</option>
                      <option value="assignment">Assignment / Project</option>
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* ── TAB 2: PAST PAPERS SUB-MODE TOGGLE (Files vs Camera Scanner) ── */}
            {activeTab === 'papers' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaperMode('files')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all border ${
                    paperMode === 'files'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <FileText size={15} />
                  <span>Upload Existing PDFs / Images</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaperMode('scanner')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all border ${
                    paperMode === 'scanner'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Camera size={15} />
                  <span>Scan with Camera ({scannedPages.length} pages)</span>
                </button>
              </div>
            )}

            {/* ── CAMERA DOCUMENT SCANNER (when in scanner mode) ── */}
            {activeTab === 'papers' && paperMode === 'scanner' && (
              <section className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Camera size={18} className="text-indigo-600" />
                      <span>Document Page Scanner</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Take photos of paper pages. OpenCV automatically flattens lighting, removes shadows, and builds a clean A4 PDF.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3.5 rounded-xl shadow-sm transition-all"
                  >
                    <Plus size={15} />
                    <span>Take Photo</span>
                  </button>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={handleCapturePagePhoto}
                    className="hidden"
                  />
                </div>

                {/* Scanned Pages Grid */}
                {scannedPages.length === 0 ? (
                  <div
                    onClick={() => cameraInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-200 rounded-2xl p-8 text-center cursor-pointer hover:bg-indigo-50/40 transition-colors"
                  >
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Camera size={22} />
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      Tap here to take photos of exam paper pages
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Works on mobile phones & desktop webcams. Pages can be rearranged before compiling.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {scannedPages.map((page, idx) => (
                        <div
                          key={page.id}
                          className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden p-2 flex flex-col justify-between group relative"
                        >
                          <div className="relative aspect-[3/4] bg-slate-200 rounded-lg overflow-hidden flex items-center justify-center mb-2">
                            <img
                              src={page.useOriginal ? page.originalUrl : page.cleanedUrl}
                              alt={`Page ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            {page.cleaning && (
                              <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center text-white p-2">
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mb-1" />
                                <span className="text-[10px] text-center font-medium leading-tight">{page.cleaningStage || 'Enhancing...'}</span>
                              </div>
                            )}
                            <span className="absolute top-1.5 left-1.5 bg-slate-900/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md">
                              P.{idx + 1}
                            </span>
                          </div>

                          {/* Page Actions */}
                          <div className="flex items-center justify-between text-slate-600 pt-1">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => reorderScannedPage(idx, -1)}
                                className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-30"
                                title="Move left"
                              >
                                <ChevronLeft size={14} />
                              </button>
                              <button
                                type="button"
                                disabled={idx === scannedPages.length - 1}
                                onClick={() => reorderScannedPage(idx, 1)}
                                className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-30"
                                title="Move right"
                              >
                                <ChevronRight size={14} />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeScannedPage(page.id)}
                              className="p-1 text-rose-500 hover:bg-rose-50 rounded-md"
                              title="Delete page"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                      >
                        <Plus size={14} /> Add more pages
                      </button>

                      <button
                        type="button"
                        disabled={compilingPdf}
                        onClick={compileScannedPagesToPdf}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl flex items-center gap-2 shadow-sm transition-all disabled:opacity-50"
                      >
                        {compilingPdf ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Compiling A4 PDF...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={15} />
                            <span>Combine {scannedPages.length} Pages into PDF</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── DRAG & DROP / FILE BROWSER ZONE ── */}
            {!(activeTab === 'papers' && paperMode === 'scanner') && (
              <section
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={triggerFileBrowser}
                className={`border-2 border-dashed rounded-3xl p-6 sm:p-10 text-center cursor-pointer transition-all duration-200 select-none ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/80 scale-[1.008]'
                    : 'border-slate-300 hover:border-blue-400 bg-white hover:bg-slate-50/60 shadow-xs'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={
                    activeTab === 'past_papers'
                      ? '.pdf,.png,.jpg,.jpeg'
                      : activeTab === 'tutorials'
                      ? '.pdf,.pptx,.docx,.doc'
                      : '.pdf,.pptx'
                  }
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handleIncomingFiles(Array.from(e.target.files));
                    }
                  }}
                  className="hidden"
                />

                <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xs ring-4 ring-blue-50">
                  <UploadCloud size={28} strokeWidth={2.2} />
                </div>

                <h3 className="text-sm sm:text-base font-black text-slate-800">
                  Tap to browse or drop {activeTab === 'past_papers' ? 'past exam files' : activeTab === 'tutorials' ? 'tutorial files' : 'lecture notes'} here
                </h3>
                <p className="text-xs text-slate-500 mt-1 font-medium max-w-sm mx-auto">
                  {activeTab === 'past_papers'
                    ? 'Supports PDF documents or high-res paper scans. Select multiple files at once.'
                    : activeTab === 'tutorials'
                    ? 'Supports PDF, PPTX, or DOCX tutorial sheets and solutions.'
                    : 'Supports PDF lecture slides & PPTX presentations up to 50MB per file.'}
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50/80 px-3 py-1.5 rounded-xl border border-blue-100">
                  <Plus size={14} />
                  <span>Select Multiple Files</span>
                </div>
              </section>
            )}

            {/* ── LIVE UPLOAD QUEUE UI (PART 4) ── */}
            {queue.length > 0 && (
              <section className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-4 animate-fadeIn">
                
                {/* Batch Header & Stats */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <span>Upload Queue</span>
                      <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                        {stats.completed}/{stats.total} Finished
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      High-speed concurrent engine (up to 3 parallel transfers)
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isUploading && stats.completed > 0 && (
                      <button
                        type="button"
                        onClick={clearCompleted}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        Clear Finished
                      </button>
                    )}
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={resetQueue}
                        className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Overall Progress Bar */}
                {queue.length > 0 && (
                  <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span>Total Batch Progress</span>
                      <span>{stats.overallProgress}% ({formatBytes(stats.totalLoadedBytes)} / {formatBytes(stats.totalBytes)})</span>
                    </div>
                    <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${stats.overallProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Individual File Items */}
                <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pr-1">
                  {queue.map((item) => {
                    const isDone = item.status === 'completed';
                    const isFailed = item.status === 'failed';
                    const isWorking = item.status === 'uploading' || item.status === 'processing';

                    return (
                      <div key={item.id} className="py-3 flex items-center justify-between gap-3 group">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* File Icon */}
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            isDone ? 'bg-emerald-50 text-emerald-600' : isFailed ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {isDone ? (
                              <CheckCircle2 size={20} />
                            ) : isFailed ? (
                              <AlertCircle size={20} />
                            ) : (
                              <FileText size={20} />
                            )}
                          </div>

                          {/* File Details */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-xs font-bold text-slate-800 truncate" title={item.name}>
                                {item.name}
                              </p>
                              <span className="text-[10px] text-slate-400 font-medium flex-shrink-0">
                                {formatBytes(item.size)}
                              </span>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-1">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-200 ${
                                  isDone
                                    ? 'bg-emerald-500'
                                    : isFailed
                                    ? 'bg-rose-500'
                                    : 'bg-blue-600'
                                }`}
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>

                            {/* Status label */}
                            <div className="flex items-center justify-between text-[10px]">
                              <span className={`font-semibold capitalize ${
                                isDone
                                  ? 'text-emerald-600'
                                  : isFailed
                                  ? 'text-rose-600'
                                  : isWorking
                                  ? 'text-blue-600 animate-pulse'
                                  : 'text-slate-400'
                              }`}>
                                {item.status === 'uploading' ? `Uploading (${item.progress}%)` : item.status}
                                {item.error && ` · ${item.error}`}
                              </span>

                              {isWorking && (
                                <span className="text-slate-400 font-mono">
                                  {formatBytes(item.loadedBytes)} / {formatBytes(item.size)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Item Actions: Retry / Remove */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => retryFile(item.id)}
                              className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                              title="Retry file upload"
                            >
                              <RefreshCw size={13} />
                              <span className="hidden sm:inline">Retry</span>
                            </button>
                          )}

                          {!isWorking && (
                            <button
                              type="button"
                              onClick={() => removeFile(item.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition-colors"
                              title="Remove from queue"
                            >
                              <X size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Batch Action Buttons */}
                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={triggerFileBrowser}
                    disabled={isUploading}
                    className="w-full sm:w-auto text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <Plus size={15} />
                    <span>Add More Files</span>
                  </button>

                  {stats.waiting > 0 && (
                    <button
                      type="button"
                      disabled={isUploading || !courseInput.trim()}
                      onClick={startUpload}
                      className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 text-xs sm:text-sm transition-all disabled:opacity-50"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Uploading Batch ({stats.completed}/{stats.total})...</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={17} />
                          <span>Upload {stats.waiting} Selected File{stats.waiting > 1 ? 's' : ''} Now</span>
                        </>
                      )}
                    </button>
                  )}

                  {stats.waiting === 0 && stats.completed > 0 && (
                    <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                      <CheckCircle2 size={16} />
                      <span>All {stats.completed} files successfully contributed!</span>
                    </div>
                  )}
                </div>

                {!courseInput.trim() && stats.waiting > 0 && (
                  <p className="text-[11px] text-amber-600 font-medium text-center">
                    ⚠️ Please fill in the Course / Subject name in Academic Metadata above to begin upload.
                  </p>
                )}
              </section>
            )}

          </>
        )}

      </main>
    </div>
  );
}
