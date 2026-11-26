import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import {
  UploadCloud,
  FileText,
  BookOpen,
  Camera,
  Image as ImageIcon,
  Layers,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RefreshCw,
  RotateCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  Eye,
  ShieldCheck,
  Lock,
  X,
  ExternalLink,
  Home as HomeIcon,
} from 'lucide-react';
import { cleanPhoto, buildA4PdfFromPages, warmScannerWorker } from '../services/scannerService';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { generateFileThumbnail } from '../utils/thumbnailHelper';
import { showNotificationBanner } from '../utils/notificationBannerService';
import appLogo from '/images/luanar7.png';

// Storage keys so lecturer form details survive tab switches, camera round-trips, or mobile restarts
const STORAGE_KEY_PROGRAM_ID = 'studyhub_upload_program_id';
const STORAGE_KEY_PROGRAM_NAME = 'studyhub_upload_program_name';
const STORAGE_KEY_SEMESTER = 'studyhub_upload_semester';
const STORAGE_KEY_COURSE = 'studyhub_upload_course';
const STORAGE_KEY_TAB = 'studyhub_upload_tab';
const STORAGE_KEY_PAPER_MODE = 'studyhub_upload_paper_mode';
const STORAGE_KEY_YEAR = 'studyhub_upload_year';
const STORAGE_KEY_EXAM_TYPE = 'studyhub_upload_exam_type';

const MAX_SCANNED_PAGES = 12;

function getSafeStored(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function setSafeStored(key, val) {
  try {
    localStorage.setItem(key, String(val ?? ''));
  } catch { /* ignore storage errors */ }
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|heic|bmp)$/i.test(file.name || '');
}

function revokePageUrls(page) {
  if (!page) return;
  if (page.originalUrl && page.originalUrl.startsWith('blob:')) {
    URL.revokeObjectURL(page.originalUrl);
  }
  if (page.cleanedUrl && page.cleanedUrl !== page.originalUrl && page.cleanedUrl.startsWith('blob:')) {
    URL.revokeObjectURL(page.cleanedUrl);
  }
}

export default function Upload({ isAdminMode = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentYear = new Date().getFullYear();

  // ── Auth & Role State ───────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('checking'); // 'checking' | 'admin' | 'lecturer' | 'student'
  const [authLoading, setAuthLoading] = useState(true);
  const roleRef = useRef('checking');
  const checkedUserIdRef = useRef(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // ── Tab & Mode State ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(() => {
    if (location.state?.defaultTab) return location.state.defaultTab;
    if (isAdminMode || location.pathname.includes('admin')) return 'papers';
    const stored = getSafeStored(STORAGE_KEY_TAB, 'notes');
    return ['notes', 'papers', 'tutorials'].includes(stored) ? stored : 'notes';
  });

  const [paperMode, setPaperMode] = useState(() => {
    const stored = getSafeStored(STORAGE_KEY_PAPER_MODE, 'files');
    return stored === 'scanner' ? 'scanner' : 'files';
  });

  // ── Shared Academic Metadata ────────────────────────────────────────────────
  const [programs, setPrograms] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState(() => getSafeStored(STORAGE_KEY_PROGRAM_ID, ''));
  const [selectedProgramName, setSelectedProgramName] = useState(() => {
    const paramProg = searchParams.get('program');
    return paramProg || getSafeStored(STORAGE_KEY_PROGRAM_NAME, '');
  });
  const [selectedSemester, setSelectedSemester] = useState(() => {
    const paramSem = searchParams.get('semester');
    if (paramSem && /^[1-8]$/.test(paramSem)) return paramSem;
    const stored = getSafeStored(STORAGE_KEY_SEMESTER, '1');
    return /^[1-8]$/.test(stored) ? stored : '1';
  });
  const [courseInput, setCourseInput] = useState(() => {
    const paramCourse = searchParams.get('course');
    return paramCourse || getSafeStored(STORAGE_KEY_COURSE, '');
  });
  const [coursesList, setCoursesList] = useState([]);

  // Past paper metadata
  const [paperYear, setPaperYear] = useState(() => {
    const stored = getSafeStored(STORAGE_KEY_YEAR, String(currentYear));
    return stored || String(currentYear);
  });
  const [examType, setExamType] = useState(() => getSafeStored(STORAGE_KEY_EXAM_TYPE, 'end_sem') || 'end_sem');

  // Scanner & UI state
  const [scannedPages, setScannedPages] = useState([]);
  const scannedPagesRef = useRef([]);
  useEffect(() => {
    scannedPagesRef.current = scannedPages;
  }, [scannedPages]);
  const [compilingPdf, setCompilingPdf] = useState(false);
  const [scannerNotice, setScannerNotice] = useState('');
  const [previewModal, setPreviewModal] = useState(null); // { title, src, subtitle }
  const [isDragging, setIsDragging] = useState(false);
  const [noticeBanner, setNoticeBanner] = useState(null); // { type, text }

  const cleanChainRef = useRef(Promise.resolve());

  // ── High-Speed Upload Queue ─────────────────────────────────────────────────
  const handleFileSuccess = useCallback((item, result) => {
    showNotificationBanner({
      type: item.category === 'past_papers' ? 'paper' : item.category === 'tutorials' ? 'tutorial' : 'notes',
      uploadType: item.category === 'past_papers' ? 'Past Paper' : item.category === 'tutorials' ? 'Tutorial' : 'Notes',
      title: `New ${item.category === 'past_papers' ? 'Past Paper' : item.category === 'tutorials' ? 'Tutorial' : 'Notes'} Shared`,
      program: item.program,
      course: item.subject,
      semester: item.semester,
      filename: item.name,
      imageUrl: result?.thumbnailUrl || item.thumbnailDataUrl || null,
      url: result?.id ? `/viewer?fileId=${encodeURIComponent(result.id)}` : '/',
    });
  }, []);

  const {
    queue,
    isUploading,
    addFiles,
    replaceFile,
    removeFile,
    retryFile,
    startUpload,
    resetQueue,
    clearCompleted,
    updateItem,
    stats,
  } = useUploadQueue({ onFileSuccess: handleFileSuccess });

  const isContributor = role === 'admin' || role === 'lecturer';

  // ── Persist metadata changes immediately ────────────────────────────────────
  useEffect(() => { setSafeStored(STORAGE_KEY_TAB, activeTab); }, [activeTab]);
  useEffect(() => { setSafeStored(STORAGE_KEY_PAPER_MODE, paperMode); }, [paperMode]);
  useEffect(() => { setSafeStored(STORAGE_KEY_COURSE, courseInput); }, [courseInput]);
  useEffect(() => { setSafeStored(STORAGE_KEY_YEAR, paperYear); }, [paperYear]);
  useEffect(() => { setSafeStored(STORAGE_KEY_EXAM_TYPE, examType); }, [examType]);

  // ── Lazy-warm scanner worker ONLY when Past Papers tab is active ────────────
  useEffect(() => {
    if (isContributor && activeTab === 'papers') {
      warmScannerWorker();
    }
  }, [isContributor, activeTab]);

  // ── Revoke scanned ObjectURLs on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const page of scannedPagesRef.current) {
        revokePageUrls(page);
      }
    };
  }, []);

  // ── Check Auth & Contributor Role (resilient to camera/background token refreshes)
  useEffect(() => {
    let mounted = true;

    const checkRole = async (forceRefresh = false) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (mounted) {
            checkedUserIdRef.current = null;
            setUser(null);
            setRole('student');
            setAuthLoading(false);
          }
          return;
        }

        const currentUser = session.user;
        if (!forceRefresh && checkedUserIdRef.current === currentUser.id && (roleRef.current === 'admin' || roleRef.current === 'lecturer')) {
          if (mounted) setAuthLoading(false);
          return;
        }
        checkedUserIdRef.current = currentUser.id;
        if (mounted) setUser(currentUser);

        const metaRole = String(currentUser.app_metadata?.role || currentUser.user_metadata?.role || '').toLowerCase();
        const metaIsAdmin = Boolean(
          currentUser.user_metadata?.is_admin ||
          currentUser.app_metadata?.is_admin ||
          currentUser.user_metadata?.admin
        );

        if (metaRole === 'admin' || metaIsAdmin) {
          if (mounted) { setRole('admin'); setAuthLoading(false); }
          return;
        }
        if (metaRole === 'lecturer') {
          if (mounted) { setRole('lecturer'); setAuthLoading(false); }
          return;
        }

        const { data: profile, error: profErr } = await supabase
          .from('profiles')
          .select('is_admin, role, admin')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profErr) throw profErr;

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
        console.warn('[Upload] Auth check warning:', err?.message || err);
        if (mounted) {
          // Never demote an already-verified contributor on a transient offline/background error
          if (roleRef.current !== 'admin' && roleRef.current !== 'lecturer') {
            const localRole = getSafeStored('studyhub_user_role', '').toLowerCase();
            const localAdmin = getSafeStored('studyhub_is_admin', '') === 'true';
            if (localAdmin) setRole('admin');
            else if (localRole === 'lecturer') setRole('lecturer');
            else setRole('student');
          }
          setAuthLoading(false);
        }
      }
    };

    checkRole(true);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        checkedUserIdRef.current = null;
        if (mounted) {
          setUser(null);
          setRole('student');
          setAuthLoading(false);
        }
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user?.id !== checkedUserIdRef.current) {
        checkRole(true);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // ── Load Programs List ONCE on mount ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const loadPrograms = async () => {
      try {
        const { data, error } = await supabase
          .from('programs')
          .select('id, name')
          .order('name');
        if (error) throw error;
        if (!mounted || !data?.length) return;

        setPrograms(data);

        const paramProg = searchParams.get('program');
        const currentId = getSafeStored(STORAGE_KEY_PROGRAM_ID, '');
        const currentName = paramProg || getSafeStored(STORAGE_KEY_PROGRAM_NAME, '');

        const matchedByName = currentName
          ? data.find((p) => p.name.toLowerCase() === currentName.trim().toLowerCase())
          : null;
        const matchedById = currentId
          ? data.find((p) => String(p.id) === String(currentId))
          : null;

        const resolved = matchedByName || matchedById || data[0];
        if (resolved) {
          setSelectedProgramId(String(resolved.id));
          setSelectedProgramName(resolved.name);
          setSafeStored(STORAGE_KEY_PROGRAM_ID, resolved.id);
          setSafeStored(STORAGE_KEY_PROGRAM_NAME, resolved.name);
        }
      } catch (err) {
        console.warn('[Upload] Failed to load programs list:', err?.message || err);
      }
    };
    loadPrograms();
    return () => { mounted = false; };
  }, [searchParams]);

  // ── Load Courses for selected Program & Semester ────────────────────────────
  useEffect(() => {
    if (!selectedProgramId) return;
    let active = true;
    const loadCourses = async () => {
      try {
        const semNum = parseInt(selectedSemester, 10) || 1;
        const { data } = await supabase
          .from('courses')
          .select('id, course_name, course_code, semester')
          .eq('program_id', selectedProgramId)
          .eq('semester', semNum)
          .order('course_name');
        if (active) setCoursesList(data || []);
      } catch {
        if (active) setCoursesList([]);
      }
    };
    loadCourses();
    return () => { active = false; };
  }, [selectedProgramId, selectedSemester]);

  // ── Metadata Helpers ────────────────────────────────────────────────────────
  const handleProgramChange = (e) => {
    const progId = e.target.value;
    const progObj = programs.find((p) => String(p.id) === String(progId));
    const progName = progObj ? progObj.name : '';
    setSelectedProgramId(progId);
    setSelectedProgramName(progName);
    setSafeStored(STORAGE_KEY_PROGRAM_ID, progId);
    setSafeStored(STORAGE_KEY_PROGRAM_NAME, progName);
  };

  const handleSemesterChange = (sem) => {
    const val = String(sem);
    setSelectedSemester(val);
    setSafeStored(STORAGE_KEY_SEMESTER, val);
  };

  const buildCurrentMetadata = useCallback((tabOverride = null) => {
    const tab = tabOverride || activeTab;
    const category =
      tab === 'papers' ? 'past_papers' : tab === 'tutorials' ? 'tutorials' : 'notes';

    return {
      category,
      program: selectedProgramName || 'General Program',
      programId: selectedProgramId || undefined,
      semester: selectedSemester,
      subject: courseInput.trim() || 'General Course',
      year: tab === 'papers' ? parseInt(paperYear, 10) || currentYear : undefined,
      examType: tab === 'papers' ? examType : undefined,
      title: tab === 'tutorials' ? (courseInput.trim() || undefined) : undefined,
      sourceType: 'typed_pdf',
    };
  }, [activeTab, selectedProgramName, selectedProgramId, selectedSemester, courseInput, paperYear, examType, currentYear]);

  const handleBackNavigation = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  // ── Sequential Scanner Pipeline (prevents low-end phone RAM spikes) ─────────
  const enqueueCleanForPage = useCallback((pageId, blob, rotationDeg = 0) => {
    cleanChainRef.current = cleanChainRef.current.then(async () => {
      // Skip if page was deleted before its turn
      const stillPresent = scannedPagesRef.current.some((p) => p.id === pageId);
      if (!stillPresent) return;

      try {
        const cleaned = await cleanPhoto(
          blob,
          (stage) => {
            setScannedPages((prev) =>
              prev.map((p) => (p.id === pageId ? { ...p, cleaningStage: stage.message } : p))
            );
          },
          { rotationDeg }
        );

        // Revoke the temporary originalUrl returned by cleanPhoto if we already hold originalUrl
        if (cleaned.originalUrl && cleaned.originalUrl.startsWith('blob:')) {
          URL.revokeObjectURL(cleaned.originalUrl);
        }

        setScannedPages((prev) =>
          prev.map((p) => {
            if (p.id !== pageId) {
              return p;
            }
            // Revoke previous cleanedUrl if it differed from originalUrl
            if (p.cleanedUrl && p.cleanedUrl !== p.originalUrl && p.cleanedUrl.startsWith('blob:')) {
              URL.revokeObjectURL(p.cleanedUrl);
            }
            const nextCleanedUrl = cleaned.useOriginal ? p.originalUrl : cleaned.cleanedUrl;
            if (cleaned.useOriginal && cleaned.cleanedUrl && cleaned.cleanedUrl.startsWith('blob:')) {
              URL.revokeObjectURL(cleaned.cleanedUrl);
            }
            return {
              ...p,
              cleaning: false,
              cleaningStage: '',
              cleanedBlob: cleaned.useOriginal ? p.originalBlob : cleaned.cleanedBlob,
              cleanedUrl: nextCleanedUrl,
              useOriginal: Boolean(cleaned.useOriginal),
              showCleaned: !cleaned.useOriginal,
            };
          })
        );
      } catch {
        setScannedPages((prev) =>
          prev.map((p) =>
            p.id === pageId
              ? { ...p, cleaning: false, cleaningStage: '', useOriginal: true, showCleaned: false }
              : p
          )
        );
      }
    });
  }, []);

  const processScannerImages = useCallback((rawFiles) => {
    const incoming = Array.from(rawFiles || []).filter(isImageFile);
    if (incoming.length === 0) return;

    warmScannerWorker();

    const availableSlots = MAX_SCANNED_PAGES - scannedPagesRef.current.length;
    if (availableSlots <= 0) {
      setScannerNotice(`Maximum ${MAX_SCANNED_PAGES} pages per paper. Remove a page or combine current pages first.`);
      return;
    }

    const accepted = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      setScannerNotice(`Added ${availableSlots} page(s). Maximum ${MAX_SCANNED_PAGES} pages per paper.`);
    } else {
      setScannerNotice('');
    }

    const baseIndex = scannedPagesRef.current.length;
    const newPageItems = accepted.map((file, i) => {
      const url = URL.createObjectURL(file);
      return {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
        originalBlob: file,
        originalUrl: url,
        cleanedBlob: file,
        cleanedUrl: url,
        useOriginal: false,
        showCleaned: true,
        cleaning: true,
        cleaningStage: 'Queued...',
        rotationDeg: 0,
        name: file.name || `Page_${baseIndex + i + 1}`,
      };
    });

    setScannedPages((prev) => [...prev, ...newPageItems]);

    for (const item of newPageItems) {
      enqueueCleanForPage(item.id, item.originalBlob, 0);
    }
  }, [enqueueCleanForPage]);

  const handleRotatePage = (pageId) => {
    const target = scannedPagesRef.current.find((p) => p.id === pageId);
    if (!target || target.cleaning) return;
    const nextRot = ((target.rotationDeg || 0) + 90) % 360;

    setScannedPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? { ...p, rotationDeg: nextRot, cleaning: true, cleaningStage: 'Rotating & cleaning...' }
          : p
      )
    );
    enqueueCleanForPage(pageId, target.originalBlob, nextRot);
  };

  const togglePageView = (pageId) => {
    setScannedPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, showCleaned: !p.showCleaned } : p))
    );
  };

  const toggleUseOriginal = (pageId) => {
    setScannedPages((prev) =>
      prev.map((p) =>
        p.id === pageId ? { ...p, useOriginal: !p.useOriginal, showCleaned: p.useOriginal } : p
      )
    );
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
    setScannedPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) revokePageUrls(target);
      return prev.filter((p) => p.id !== id);
    });
    setScannerNotice('');
  };

  const clearScannedPages = () => {
    for (const p of scannedPagesRef.current) {
      revokePageUrls(p);
    }
    setScannedPages([]);
    setScannerNotice('');
  };

  // ── Incoming Files Handler (for Notes, Tutorials, and Past Paper PDFs/Images) ─
  const handleIncomingFiles = useCallback(async (incomingList) => {
    if (!incomingList || incomingList.length === 0) return;
    setNoticeBanner(null);

    const filesArray = Array.from(incomingList);

    if (activeTab === 'papers') {
      const images = filesArray.filter(isImageFile);
      const nonImages = filesArray.filter((f) => !isImageFile(f));

      if (images.length > 0) {
        setPaperMode('scanner');
        processScannerImages(images);
      }

      if (nonImages.length > 0) {
        const added = addFiles(nonImages, buildCurrentMetadata('papers'));
        // Generate lightweight previews asynchronously
        for (const item of added) {
          generateFileThumbnail(item.file, 360).then((thumb) => {
            if (thumb) updateItem(item.id, { thumbnailDataUrl: thumb });
          }).catch(() => {});
        }
      }
      return;
    }

    const added = addFiles(filesArray, buildCurrentMetadata(activeTab));
    for (const item of added) {
      generateFileThumbnail(item.file, 360).then((thumb) => {
        if (thumb) updateItem(item.id, { thumbnailDataUrl: thumb });
      }).catch(() => {});
    }
  }, [activeTab, addFiles, buildCurrentMetadata, processScannerImages, updateItem]);

  // Direct <input type="file"> handlers — snapshot FileList synchronously & reset value
  const handleFileInputChange = (e) => {
    e.stopPropagation();
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (picked.length > 0) {
      handleIncomingFiles(picked);
    }
  };

  const handleCameraInputChange = (e) => {
    e.stopPropagation();
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (picked.length > 0) {
      processScannerImages(picked);
    }
  };

  const handleReplaceQueueItem = (itemId, e) => {
    e.stopPropagation();
    const picked = e.target.files?.[0] || null;
    e.target.value = '';
    if (!picked) return;

    if (activeTab === 'papers' && isImageFile(picked)) {
      // Route replacement past-paper photo through scanner
      removeFile(itemId);
      setPaperMode('scanner');
      processScannerImages([picked]);
      return;
    }

    replaceFile(itemId, picked);
    generateFileThumbnail(picked, 360).then((thumb) => {
      if (thumb) updateItem(itemId, { thumbnailDataUrl: thumb });
    }).catch(() => {});
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

  // Compile cleaned pages into one crisp A4 PDF and add to upload queue
  const compileScannedPagesToPdf = async () => {
    if (scannedPages.length === 0) return;
    if (scannedPages.some((p) => p.cleaning)) {
      setScannerNotice('Wait a moment for all pages to finish cleaning.');
      return;
    }

    setCompilingPdf(true);
    setScannerNotice('');

    try {
      const safeCourse = (courseInput.trim() || 'Exam_Paper').replace(/\s+/g, '_');
      const filename = `${safeCourse}_${paperYear || currentYear}_${scannedPages.length}pages.pdf`;
      const generatedPdfFile = await buildA4PdfFromPages(scannedPages, filename);

      // Reuse page 1 preview as thumbnail so uploadEngine avoids re-rendering PDF page 1
      let firstThumb = null;
      try {
        firstThumb = await generateFileThumbnail(generatedPdfFile, 400);
      } catch { /* fallback without thumbnail */ }

      const meta = {
        ...buildCurrentMetadata('papers'),
        sourceType: 'scanned_pdf',
        thumbnailDataUrl: firstThumb,
      };

      addFiles([generatedPdfFile], meta);
      clearScannedPages();
      setPaperMode('files');
      setNoticeBanner({
        type: 'success',
        text: `Compiled ${filename} ready in your upload queue.`,
      });
    } catch (err) {
      console.error('Failed to compile scanned PDF:', err);
      setScannerNotice('Could not create PDF from scanned pages: ' + (err.message || 'Unknown error'));
    } finally {
      setCompilingPdf(false);
    }
  };

  // ── Formatters & Labels ─────────────────────────────────────────────────────
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const acceptAttribute =
    activeTab === 'papers'
      ? '.pdf,.png,.jpg,.jpeg,.webp'
      : activeTab === 'tutorials'
      ? '.pdf,.pptx,.docx,.doc'
      : '.pdf,.pptx';

  const getItemStatusMeta = (item) => {
    switch (item.status) {
      case 'preparing':
        return { label: 'Preparing...', color: 'text-indigo-600' };
      case 'uploading':
        return { label: `Uploading · ${item.progress}%`, color: 'text-blue-600' };
      case 'processing':
        return { label: 'Processing · 99%', color: 'text-indigo-600' };
      case 'retrying':
        return { label: item.error || 'Reconnecting...', color: 'text-amber-600' };
      case 'completed':
        return { label: 'Completed · 100%', color: 'text-emerald-600' };
      case 'failed':
        return { label: `Failed${item.error ? ` · ${item.error}` : ''}`, color: 'text-rose-600' };
      default:
        return { label: 'Ready to upload', color: 'text-slate-500' };
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Checking authorization...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] bg-slate-50/80 pb-8 overflow-x-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {/* Top App Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 h-14 flex items-center">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBackNavigation}
              className="w-10 h-10 -ml-1.5 rounded-xl hover:bg-slate-100 active:bg-slate-200 text-slate-700 transition-colors flex items-center justify-center flex-shrink-0"
              aria-label="Go back"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-xl overflow-hidden shadow-xs ring-1 ring-slate-200 flex-shrink-0">
              <img src={appLogo} alt="LUANAR" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <h1 className="m-0 text-sm sm:text-base font-black text-slate-900 leading-tight tracking-normal flex items-center gap-1.5 truncate">
                <span className="truncate">Upload Resources</span>
                {role === 'admin' && (
                  <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0">
                    Admin
                  </span>
                )}
                {role === 'lecturer' && (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0">
                    Lecturer
                  </span>
                )}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {role === 'admin' && (
              <button
                type="button"
                onClick={() => navigate('/admin/live')}
                className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-all border border-indigo-200/60"
              >
                <span>Live Activity</span>
                <ExternalLink size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
              title="Student Dashboard"
              aria-label="Home"
            >
              <HomeIcon size={17} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="w-9 h-9 rounded-full overflow-hidden border border-slate-300 ring-2 ring-slate-100 flex-shrink-0"
              title="Profile"
              aria-label="Profile"
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
      <main className="max-w-3xl w-full mx-auto px-3 sm:px-6 pt-4 space-y-4">
        {/* ── ACCESS RESTRICTED ── */}
        {!isContributor && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-lg max-w-lg mx-auto text-center space-y-5 mt-4">
            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto ring-4 ring-rose-50/70">
              <Lock size={26} strokeWidth={2.2} />
            </div>

            <div>
              <span className="inline-block bg-rose-100 text-rose-800 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full mb-2">
                Faculty Authorization Required
              </span>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight m-0">
                Upload Access Restricted
              </h2>
              <p className="text-xs text-slate-600 font-medium mt-2 max-w-sm mx-auto leading-relaxed">
                Resource uploads are restricted to verified lecturers and administrators. Sign in through the Lecturer Portal to unlock uploads.
              </p>
            </div>

            <div className="pt-1 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/login?role=lecturer')}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 min-h-[44px]"
              >
                <BookOpen size={15} />
                <span>Sign in as Lecturer</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl text-xs transition-all min-h-[44px]"
              >
                Return Home
              </button>
            </div>
          </div>
        )}

        {/* ── UNIFIED CONTRIBUTOR PORTAL ── */}
        {isContributor && (
          <>
            {noticeBanner && (
              <div
                className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold border ${
                  noticeBanner.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={15} className="flex-shrink-0" />
                  <span className="truncate">{noticeBanner.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setNoticeBanner(null)}
                  className="p-1 rounded-lg hover:bg-black/5 flex-shrink-0"
                  aria-label="Dismiss message"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Tab Navigation: Notes, Past Papers, Tutorials */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/75 rounded-2xl">
              <button
                type="button"
                onClick={() => setActiveTab('notes')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-1.5 sm:px-3 rounded-xl text-[11px] sm:text-sm font-bold transition-all select-none whitespace-nowrap min-h-[42px] ${
                  activeTab === 'notes'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen size={15} className="flex-shrink-0" />
                <span>Notes</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('papers')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-1.5 sm:px-3 rounded-xl text-[11px] sm:text-sm font-bold transition-all select-none whitespace-nowrap min-h-[42px] ${
                  activeTab === 'papers'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText size={15} className="flex-shrink-0" />
                <span>Past Papers</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('tutorials')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-1.5 sm:px-3 rounded-xl text-[11px] sm:text-sm font-bold transition-all select-none whitespace-nowrap min-h-[42px] ${
                  activeTab === 'tutorials'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers size={15} className="flex-shrink-0" />
                <span>Tutorials</span>
              </button>
            </div>

            {/* Step 1: Course Details */}
            <section className="bg-white rounded-2xl p-3.5 sm:p-5 border border-slate-200/90 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <span className="text-[11px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-blue-600 flex-shrink-0" />
                  <span>1. Course Details</span>
                </span>
                <span className="text-[11px] text-slate-400 font-medium truncate">
                  Saved automatically
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Program <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={selectedProgramId}
                    onChange={handleProgramChange}
                    className="w-full min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 font-medium truncate"
                  >
                    {programs.length === 0 && (
                      <option value="">{selectedProgramName || 'Loading programs...'}</option>
                    )}
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Course / Subject <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={courseInput}
                    onChange={(e) => setCourseInput(e.target.value)}
                    placeholder="e.g. Basic Physics / AGR 101"
                    list="courses-suggestions"
                    className="w-full min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 font-medium"
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

              {/* Semester Grid: clean 4x2 on phones, 8x1 on wider screens */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Semester <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSemesterChange(s)}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all min-h-[38px] ${
                        selectedSemester === String(s)
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Sem {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Past Paper Metadata */}
              {activeTab === 'papers' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-slate-100">
                  <div className="min-w-0">
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Academic Year <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={paperYear}
                      onChange={(e) => setPaperYear(e.target.value)}
                      className="w-full min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-medium"
                    >
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((offset) => {
                        const yr = currentYear - offset;
                        return (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Exam Type
                    </label>
                    <select
                      value={examType}
                      onChange={(e) => setExamType(e.target.value)}
                      className="w-full min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-medium"
                    >
                      <option value="end_sem">End of Semester Exam</option>
                      <option value="mid_sem">Mid-Semester Assessment</option>
                      <option value="test">Continuous Assessment Test</option>
                      <option value="assignment">Assignment / Project</option>
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* Step 2: Past Paper Sub-Mode Toggle */}
            {activeTab === 'papers' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaperMode('files')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-2.5 rounded-xl text-xs font-bold transition-all border min-h-[42px] ${
                    paperMode === 'files'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <FileText size={15} className="flex-shrink-0" />
                  <span className="truncate">Upload PDF / Images</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaperMode('scanner')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-2.5 rounded-xl text-xs font-bold transition-all border min-h-[42px] ${
                    paperMode === 'scanner'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Camera size={15} className="flex-shrink-0" />
                  <span className="truncate">
                    Scan Pages{scannedPages.length > 0 ? ` (${scannedPages.length})` : ''}
                  </span>
                </button>
              </div>
            )}

            {/* ── CAMERA / PHOTO DOCUMENT SCANNER (Past Papers) ── */}
            {activeTab === 'papers' && paperMode === 'scanner' && (
              <section className="bg-white rounded-2xl p-3.5 sm:p-5 border border-slate-200/90 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 m-0">
                      <Camera size={17} className="text-indigo-600 flex-shrink-0" />
                      <span>2. Scan Past Paper Pages</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Auto-crops edges, flattens shadows, keeps equations & diagrams crisp, and builds an A4 PDF.
                    </p>
                  </div>

                  {/* Direct-tap input overlays prevent Android WebView synthetic-click page reloads */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="relative overflow-hidden inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow-xs cursor-pointer min-h-[40px] flex-1 sm:flex-none">
                      <Camera size={15} />
                      <span>Take Picture</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        aria-label="Take a picture with camera"
                        onClick={(e) => e.stopPropagation()}
                        onChange={handleCameraInputChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>

                    <div className="relative overflow-hidden inline-flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-200 cursor-pointer min-h-[40px] flex-1 sm:flex-none">
                      <ImageIcon size={15} />
                      <span>Gallery</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        aria-label="Choose photos from gallery"
                        onClick={(e) => e.stopPropagation()}
                        onChange={handleCameraInputChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {scannerNotice && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center justify-between gap-2">
                    <span>{scannerNotice}</span>
                    <button
                      type="button"
                      onClick={() => setScannerNotice('')}
                      className="p-1 rounded hover:bg-amber-100"
                      aria-label="Dismiss notice"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                {scannedPages.length === 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="relative overflow-hidden border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer hover:bg-indigo-50/40 transition-colors flex flex-col items-center justify-center">
                      <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-2.5">
                        <Camera size={21} />
                      </div>
                      <span className="text-xs font-bold text-slate-800">Take a Picture</span>
                      <span className="text-[11px] text-slate-500 mt-1">Opens device camera directly</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        aria-label="Take a picture of exam page"
                        onClick={(e) => e.stopPropagation()}
                        onChange={handleCameraInputChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>

                    <div className="relative overflow-hidden border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-2xl p-6 text-center cursor-pointer hover:bg-slate-50 transition-colors flex flex-col items-center justify-center">
                      <div className="w-11 h-11 bg-slate-100 text-slate-700 rounded-full flex items-center justify-center mb-2.5">
                        <ImageIcon size={21} />
                      </div>
                      <span className="text-xs font-bold text-slate-800">Choose Existing Photos</span>
                      <span className="text-[11px] text-slate-500 mt-1">Select up to {MAX_SCANNED_PAGES} pages at once</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        aria-label="Choose existing paper photos"
                        onClick={(e) => e.stopPropagation()}
                        onChange={handleCameraInputChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-700">
                        {scannedPages.length} of {MAX_SCANNED_PAGES} pages
                      </span>
                      <button
                        type="button"
                        onClick={clearScannedPages}
                        className="text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg font-semibold"
                      >
                        Clear Pages
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {scannedPages.map((page, idx) => {
                        const displayUrl = (page.useOriginal || !page.showCleaned) ? page.originalUrl : page.cleanedUrl;
                        return (
                          <div
                            key={page.id}
                            className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden p-2 flex flex-col justify-between gap-2"
                          >
                            <div className="relative aspect-[3/4] bg-white rounded-lg overflow-hidden border border-slate-200/80 flex items-center justify-center">
                              <img
                                src={displayUrl}
                                alt={`Scanned page ${idx + 1}`}
                                onClick={() =>
                                  setPreviewModal({
                                    title: `Page ${idx + 1} (${page.useOriginal || !page.showCleaned ? 'Original' : 'Cleaned Scan'})`,
                                    src: displayUrl,
                                    subtitle: page.name,
                                  })
                                }
                                className="w-full h-full object-contain cursor-zoom-in"
                              />

                              {page.cleaning && (
                                <div className="absolute inset-0 bg-slate-900/65 flex flex-col items-center justify-center text-white p-2">
                                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mb-1.5" />
                                  <span className="text-[10px] text-center font-semibold leading-tight">
                                    {page.cleaningStage || 'Cleaning...'}
                                  </span>
                                </div>
                              )}

                              <span className="absolute top-1.5 left-1.5 bg-slate-900/85 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md">
                                P.{idx + 1}
                              </span>

                              <span
                                className={`absolute bottom-1.5 left-1.5 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                  page.useOriginal ? 'bg-slate-600/90' : page.showCleaned ? 'bg-indigo-600/90' : 'bg-slate-700/90'
                                }`}
                              >
                                {page.useOriginal ? 'Original' : page.showCleaned ? 'Cleaned' : 'Original'}
                              </span>

                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewModal({
                                    title: `Page ${idx + 1} (${page.useOriginal || !page.showCleaned ? 'Original' : 'Cleaned Scan'})`,
                                    src: displayUrl,
                                    subtitle: page.name,
                                  })
                                }
                                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-slate-900/75 text-white flex items-center justify-center hover:bg-slate-900"
                                title="Inspect page"
                                aria-label={`Inspect page ${idx + 1}`}
                              >
                                <Eye size={13} />
                              </button>
                            </div>

                            {/* Before/After & Rotate Controls */}
                            <div className="flex items-center gap-1">
                              {!page.useOriginal && (
                                <button
                                  type="button"
                                  disabled={page.cleaning}
                                  onClick={() => togglePageView(page.id)}
                                  className="flex-1 py-1.5 px-1.5 text-[10px] font-bold rounded-lg border border-slate-200 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 truncate"
                                >
                                  {page.showCleaned ? 'Original' : 'Cleaned'}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={page.cleaning}
                                onClick={() => handleRotatePage(page.id)}
                                className="py-1.5 px-2 text-[10px] font-bold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1"
                                title="Rotate 90 degrees"
                                aria-label={`Rotate page ${idx + 1} 90 degrees`}
                              >
                                <RotateCw size={12} />
                              </button>
                            </div>

                            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer select-none px-0.5">
                              <input
                                type="checkbox"
                                checked={page.useOriginal}
                                disabled={page.cleaning}
                                onChange={() => toggleUseOriginal(page.id)}
                                className="accent-indigo-600 rounded"
                              />
                              <span>Keep original</span>
                            </label>

                            {/* Reorder & Remove */}
                            <div className="flex items-center justify-between pt-1 border-t border-slate-200/80 text-slate-600">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => reorderScannedPage(idx, -1)}
                                  className="p-1.5 hover:bg-slate-200 rounded-lg disabled:opacity-30"
                                  title="Move earlier"
                                  aria-label="Move page earlier"
                                >
                                  <ChevronLeft size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === scannedPages.length - 1}
                                  onClick={() => reorderScannedPage(idx, 1)}
                                  className="p-1.5 hover:bg-slate-200 rounded-lg disabled:opacity-30"
                                  title="Move later"
                                  aria-label="Move page later"
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => removeScannedPage(page.id)}
                                className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"
                                title="Delete page"
                                aria-label={`Delete page ${idx + 1}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        {scannedPages.length < MAX_SCANNED_PAGES && (
                          <>
                            <div className="relative overflow-hidden inline-flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2.5 rounded-xl cursor-pointer min-h-[40px]">
                              <Camera size={14} />
                              <span>Add Photo</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                aria-label="Take another picture"
                                onClick={(e) => e.stopPropagation()}
                                onChange={handleCameraInputChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                            </div>
                            <div className="relative overflow-hidden inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2.5 rounded-xl cursor-pointer min-h-[40px]">
                              <Plus size={14} />
                              <span>From Gallery</span>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                aria-label="Add photos from gallery"
                                onClick={(e) => e.stopPropagation()}
                                onChange={handleCameraInputChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={compilingPdf || scannedPages.some((p) => p.cleaning)}
                        onClick={compileScannedPagesToPdf}
                        className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 min-h-[44px]"
                      >
                        {compilingPdf ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Building A4 PDF...</span>
                          </>
                        ) : scannedPages.some((p) => p.cleaning) ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Cleaning pages...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={15} />
                            <span>Combine {scannedPages.length} Page{scannedPages.length > 1 ? 's' : ''} to PDF</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── FILE PICKER / DROPZONE (Direct-tap overlay input prevents page reloads) ── */}
            {!(activeTab === 'papers' && paperMode === 'scanner') && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative overflow-hidden block border-2 border-dashed rounded-2xl p-5 sm:p-8 text-center cursor-pointer transition-all select-none ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/80'
                    : 'border-slate-300 hover:border-blue-400 bg-white hover:bg-slate-50/70'
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept={acceptAttribute}
                  aria-label="Select files to upload"
                  onClick={(e) => e.stopPropagation()}
                  onChange={handleFileInputChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />

                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2.5 ring-4 ring-blue-50">
                  <UploadCloud size={24} strokeWidth={2.2} />
                </div>

                <h3 className="text-sm font-black text-slate-800 m-0">
                  Tap to choose {activeTab === 'papers' ? 'past paper PDFs or photos' : activeTab === 'tutorials' ? 'tutorial files' : 'lecture notes'}
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-1 font-medium max-w-sm mx-auto">
                  {activeTab === 'papers'
                    ? 'PDFs upload directly. Selected images are automatically scanned & cleaned into a readable PDF.'
                    : activeTab === 'tutorials'
                    ? 'Supports PDF, PPTX, or DOCX tutorial files (max 50MB).'
                    : 'Supports PDF slides & PPTX presentations (max 50MB per file).'}
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100">
                  <Plus size={14} />
                  <span>Select Files</span>
                </div>
              </div>
            )}

            {/* ── UPLOAD QUEUE & RELIABLE PROGRESS ── */}
            {queue.length > 0 && (
              <section className="bg-white rounded-2xl p-3.5 sm:p-5 border border-slate-200/90 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 m-0">
                      <span>Upload Queue</span>
                      <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                        {stats.completed}/{stats.total}
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {isUploading ? 'Uploading files...' : 'Review files below before uploading'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!isUploading && stats.completed > 0 && (
                      <button
                        type="button"
                        onClick={clearCompleted}
                        className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg hover:bg-slate-100"
                      >
                        Clear Done
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetQueue}
                      className="text-[11px] font-semibold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg"
                    >
                      {isUploading ? 'Cancel All' : 'Clear All'}
                    </button>
                  </div>
                </div>

                {/* Overall Progress Bar */}
                {(isUploading || stats.completed > 0) && (
                  <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-700 gap-2">
                      <span>Batch Progress</span>
                      <span className="font-mono text-right">
                        {stats.overallProgress}% ({formatBytes(stats.totalLoadedBytes)} / {formatBytes(stats.totalBytes)})
                      </span>
                    </div>
                    <div className="w-full bg-slate-200/90 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-200 ease-out ${
                          stats.completed === stats.total && stats.total > 0
                            ? 'bg-emerald-500'
                            : 'bg-gradient-to-r from-blue-600 to-indigo-600'
                        }`}
                        style={{ width: `${stats.overallProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Individual File Items */}
                <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                  {queue.map((item) => {
                    const isDone = item.status === 'completed';
                    const isFailed = item.status === 'failed';
                    const isWorking =
                      item.status === 'preparing' ||
                      item.status === 'uploading' ||
                      item.status === 'processing' ||
                      item.status === 'retrying';
                    const statusMeta = getItemStatusMeta(item);
                    const thumbSrc = item.previewUrl || item.thumbnailDataUrl || null;

                    return (
                      <div key={item.id} className="py-3 flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {/* Preview Thumbnail / File Icon */}
                          {thumbSrc ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewModal({
                                  title: item.name,
                                  src: thumbSrc,
                                  subtitle: `${formatBytes(item.size)} · ${item.subject || ''}`,
                                })
                              }
                              className="w-11 h-12 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex-shrink-0 relative group"
                              title="Preview file"
                              aria-label={`Preview ${item.name}`}
                            >
                              <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition-colors">
                                <Eye size={13} className="text-white opacity-0 group-hover:opacity-100" />
                              </span>
                            </button>
                          ) : (
                            <div
                              className={`w-11 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                isDone
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : isFailed
                                  ? 'bg-rose-50 text-rose-600'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {isDone ? (
                                <CheckCircle2 size={20} />
                              ) : isFailed ? (
                                <AlertCircle size={20} />
                              ) : (
                                <FileText size={20} />
                              )}
                            </div>
                          )}

                          {/* File Name, Progress & State */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-xs font-bold text-slate-800 truncate" title={item.name}>
                                {item.name}
                              </p>
                              <span className="text-[10px] text-slate-400 font-medium flex-shrink-0">
                                {formatBytes(item.size)}
                              </span>
                            </div>

                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-1">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-150 ${
                                  isDone
                                    ? 'bg-emerald-500'
                                    : isFailed
                                    ? 'bg-rose-500'
                                    : item.status === 'preparing'
                                    ? 'bg-indigo-400 animate-pulse w-1/4'
                                    : 'bg-blue-600'
                                }`}
                                style={
                                  item.status === 'preparing' && item.progress === 0
                                    ? { width: '15%' }
                                    : { width: `${item.progress}%` }
                                }
                              />
                            </div>

                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className={`font-semibold truncate ${statusMeta.color}`}>
                                {statusMeta.label}
                              </span>
                              {isWorking && (
                                <span className="text-slate-400 font-mono flex-shrink-0">
                                  {formatBytes(item.loadedBytes)} / {formatBytes(item.size)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Item Actions: Replace / Retry / Cancel-Remove */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => retryFile(item.id)}
                              className="p-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-bold flex items-center gap-1"
                              title="Retry upload"
                              aria-label={`Retry ${item.name}`}
                            >
                              <RefreshCw size={13} />
                              <span className="hidden sm:inline">Retry</span>
                            </button>
                          )}

                          {(item.status === 'waiting' || item.status === 'failed') && (
                            <div
                              className="relative overflow-hidden p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg text-[11px] font-semibold cursor-pointer flex items-center"
                              title="Replace file"
                            >
                              <RefreshCw size={14} />
                              <input
                                type="file"
                                accept={acceptAttribute}
                                aria-label={`Replace ${item.name}`}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleReplaceQueueItem(item.id, e)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => removeFile(item.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
                            title={isWorking ? 'Cancel upload' : 'Remove file'}
                            aria-label={isWorking ? `Cancel ${item.name}` : `Remove ${item.name}`}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Batch Action Buttons */}
                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                  <div
                    className={`relative overflow-hidden text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-colors min-h-[42px] ${
                      isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                    }`}
                  >
                    <Plus size={15} />
                    <span>Add More Files</span>
                    <input
                      type="file"
                      multiple
                      accept={acceptAttribute}
                      disabled={isUploading}
                      aria-label="Add more files"
                      onClick={(e) => e.stopPropagation()}
                      onChange={handleFileInputChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>

                  {stats.waiting > 0 && (
                    <button
                      type="button"
                      disabled={isUploading || !courseInput.trim()}
                      onClick={() => startUpload(buildCurrentMetadata())}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-5 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 text-xs sm:text-sm transition-all disabled:opacity-50 min-h-[44px]"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Uploading ({stats.completed}/{stats.total})...</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={17} />
                          <span>Upload {stats.waiting} File{stats.waiting > 1 ? 's' : ''} Now</span>
                        </>
                      )}
                    </button>
                  )}

                  {stats.waiting === 0 && stats.completed > 0 && !isUploading && (
                    <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-xs py-2">
                      <CheckCircle2 size={16} />
                      <span>All {stats.completed} file{stats.completed > 1 ? 's' : ''} uploaded!</span>
                    </div>
                  )}
                </div>

                {!courseInput.trim() && stats.waiting > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-medium text-center">
                    Enter the Course / Subject name above to start uploading.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* Lightweight Image / First-Page Preview Modal */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
          onClick={() => setPreviewModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full max-h-[88dvh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">{previewModal.title}</p>
                {previewModal.subtitle && (
                  <p className="text-[11px] text-slate-500 truncate">{previewModal.subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0"
                aria-label="Close preview"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-3 flex items-center justify-center">
              <img
                src={previewModal.src}
                alt={previewModal.title}
                className="max-w-full max-h-[72dvh] object-contain rounded-lg shadow-sm bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
