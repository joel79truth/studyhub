/**
 * Tutorials.jsx
 * Product-grade tutorial library matching Files.jsx card layout and design system.
 */

import React, { useState, useMemo, memo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { API_BASE_URL } from '../lib/apiConfig';
import PDFThumbnail from '../components/PDFThumbnail';
import {
  BookOpen,
  Search,
  FileText,
  ChevronRight,
  RefreshCw,
  WifiOff,
  Upload,
  ArrowLeft,
  X,
} from 'lucide-react';

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchTutorials() {
  const { data, error } = await supabase
    .from('past_paper')
    .select(`
      id,
      title,
      course,
      course_id,
      semester,
      year,
      file_url,
      file_type,
      file_name,
      original_filename,
      storage_path,
      file_path,
      page_count,
      uploaded_by,
      uploaded_at,
      created_at,
      processing_status,
      kind,
      courses:course_id ( id, course_name, course_code )
    `)
    .eq('kind', 'tutorial')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function fetchPublicNames(ids) {
  if (!ids?.length) return {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
    const res = await fetch(
      `${API_BASE_URL}/api/profiles/public-names?ids=${encodeURIComponent(ids.join(','))}`,
      { headers }
    );
    if (!res.ok) return {};
    const json = await res.json();
    return json?.profiles || {};
  } catch {
    return {};
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

function getFileLabel(fileType, fileName) {
  const name = (fileName || '').toLowerCase();
  const type = (fileType || '').toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
  if (type.includes('pptx') || name.endsWith('.pptx') || type.includes('presentation')) return 'PPTX';
  if (type.includes('word') || name.endsWith('.docx')) return 'DOCX';
  return 'FILE';
}

/**
 * Extracts and displays the real original file name.
 * Priority:
 *   1. original_filename
 *   2. file_name (UUID prefix stripped if present)
 *   3. storage_path / file_url filename
 *   4. fallback to title or course
 */
export function getDisplayFilename(tutorial) {
  if (tutorial?.original_filename && typeof tutorial.original_filename === 'string' && tutorial.original_filename.trim()) {
    return tutorial.original_filename.trim();
  }
  const name = tutorial?.file_name;
  if (name && typeof name === 'string' && name.trim()) {
    const base = name.split('/').pop().split('\\').pop();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
    const cleaned = base.replace(uuidPattern, '').trim();
    if (cleaned && !cleaned.includes('pages.pdf')) return cleaned;
    if (cleaned) return cleaned;
  }
  const path = tutorial?.storage_path || tutorial?.file_path || tutorial?.file_url;
  if (path && typeof path === 'string') {
    try {
      const decoded = decodeURIComponent(path.split('?')[0]);
      const base = decoded.split('/').pop().split('\\').pop();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
      const cleaned = base.replace(uuidPattern, '').trim();
      if (cleaned) return cleaned;
    } catch (_) {}
  }
  return tutorial?.title || tutorial?.courses?.course_name || tutorial?.course || 'Tutorial.pdf';
}

// ─── Single Tutorial Card (matching Files.jsx layout and alignment) ──────────

const TutorialCard = memo(({ tutorial, uploaderName, onOpen }) => {
  const courseName = tutorial.courses?.course_name || tutorial.course || 'General';
  const courseCode = tutorial.courses?.course_code || null;
  const pageCount  = tutorial.page_count || 0;
  const fileName   = getDisplayFilename(tutorial);
  const fileLabel  = getFileLabel(tutorial.file_type, fileName);
  const dateLabel  = formatDate(tutorial.uploaded_at || tutorial.created_at);
  const isProcessing = tutorial.processing_status === 'processing';

  const pdfUrl = useMemo(() => {
    if (tutorial?.file_url && (tutorial.file_url.startsWith('http://') || tutorial.file_url.startsWith('https://'))) {
      return tutorial.file_url;
    }
    const path = tutorial?.storage_path || tutorial?.file_path;
    if (path) {
      const { data } = supabase.storage.from('past-papers').getPublicUrl(path);
      if (data?.publicUrl) return data.publicUrl;
    }
    return null;
  }, [tutorial?.file_url, tutorial?.storage_path, tutorial?.file_path]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`Open ${fileName}`}
      className="relative bg-white rounded-2xl border-2 border-slate-100 hover:border-blue-200 transition-all cursor-pointer flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:bg-slate-50/80"
    >
      <div className="p-3 flex-1 flex flex-col">
        {/* Aspect-[4/3] Thumbnail Container — exact same as Files.jsx */}
        <div className="relative aspect-[4/3] bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex-shrink-0">
          {fileLabel === 'PDF' && pdfUrl ? (
            <PDFThumbnail url={pdfUrl} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileText size={32} className="text-slate-300" />
            </div>
          )}

          {/* File type badge */}
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase bg-blue-50 text-blue-700 border-blue-200">
            {fileLabel}
          </span>

          {isProcessing && (
            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              Processing…
            </span>
          )}
        </div>

        {/* Card Body */}
        <div className="mt-3 flex-1 flex flex-col justify-between">
          <div>
            {/* Real original file name — single line truncate matching Files.jsx */}
            <h4 className="text-sm font-bold text-slate-900 truncate" title={fileName}>
              {fileName}
            </h4>

            {/* Course label and page count */}
            <div className="flex items-center justify-between mt-1 gap-1">
              <p className="text-[10px] text-slate-500 font-medium truncate" title={courseName}>
                {courseCode ? `${courseCode} · ` : ''}{courseName}
              </p>
              {pageCount > 0 && (
                <span className="text-[10px] text-slate-400 font-semibold tabular-nums flex-shrink-0">
                  {pageCount}p
                </span>
              )}
            </div>
          </div>

          {/* Footer: uploader / date metadata */}
          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate max-w-[130px]" title={uploaderName || dateLabel || ''}>
              {uploaderName || dateLabel || ''}
            </span>
            <span className="text-blue-600 font-bold flex items-center gap-0.5 flex-shrink-0">
              Open <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── Skeleton Card (matching Files.jsx pulse skeleton) ─────────────────────────

const SkeletonCard = () => (
  <div className="bg-white rounded-2xl border-2 border-slate-100 p-3 space-y-3 animate-pulse">
    <div className="aspect-[4/3] bg-slate-100 rounded-xl" />
    <div className="h-4 bg-slate-100 rounded w-4/5" />
    <div className="flex justify-between items-center">
      <div className="h-3 bg-slate-100 rounded w-1/2" />
      <div className="h-3 bg-slate-100 rounded w-6" />
    </div>
  </div>
);

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ hasFilter, onClear, onUpload, isAdmin }) => (
  <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
    <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-4 text-blue-600">
      <BookOpen className="w-7 h-7" />
    </div>
    <p className="text-base font-bold text-slate-800">
      {hasFilter ? 'No tutorials match' : 'No tutorials yet'}
    </p>
    <p className="text-sm text-slate-500 mt-1 max-w-[260px]">
      {hasFilter
        ? 'Try clearing the search or switching course.'
        : 'Tutorial PDFs uploaded by instructors will appear here.'}
    </p>
    {hasFilter ? (
      <button
        onClick={onClear}
        className="mt-5 min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold active:bg-slate-800 transition-colors"
      >
        Clear filters
      </button>
    ) : isAdmin ? (
      <button
        onClick={onUpload}
        className="mt-5 min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold active:bg-blue-700 transition-colors flex items-center gap-2"
      >
        <Upload className="w-4 h-4" /> Upload tutorial
      </button>
    ) : null}
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Tutorials() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery]       = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [isAdmin, setIsAdmin]               = useState(false);

  // ── Admin check ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin, role')
          .eq('id', user.id)
          .maybeSingle();
        if (!cancelled) setIsAdmin(Boolean(data?.is_admin || data?.role === 'admin'));
      } catch { /* stay false */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Data Query ──
  const { data: tutorials = [], isLoading, error, refetch } = useQuery({
    queryKey: ['tutorialsList'],
    queryFn: fetchTutorials,
    staleTime: 60 * 1000,
    retry: 2,
  });

  // Re-fetch when page mounts to ensure fresh items after upload
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['tutorialsList'] });
  }, [queryClient]);

  const uploaderIds = useMemo(() => {
    const ids = new Set();
    tutorials.forEach((t) => { if (t.uploaded_by) ids.add(t.uploaded_by); });
    return Array.from(ids);
  }, [tutorials]);

  const { data: publicNames = {} } = useQuery({
    queryKey: ['publicNames', uploaderIds],
    queryFn: () => fetchPublicNames(uploaderIds),
    enabled: uploaderIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  // ── Course filter chips ──
  const distinctCourses = useMemo(() => {
    const map = new Map();
    tutorials.forEach((t) => {
      const id   = t.course_id || t.course;
      const code = t.courses?.course_code;
      const name = t.courses?.course_name || t.course || 'Unknown';
      if (id && !map.has(id)) map.set(id, { name, code });
    });
    return Array.from(map.entries()).map(([id, { name, code }]) => ({ id, name, code }));
  }, [tutorials]);

  // ── Filtered list ──
  const filteredTutorials = useMemo(() => {
    return tutorials.filter((t) => {
      if (selectedCourse !== 'all') {
        const id = t.course_id || t.course;
        if (String(id) !== String(selectedCourse)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const fileName        = getDisplayFilename(t).toLowerCase();
        const titleMatch      = t.title?.toLowerCase().includes(q) || fileName.includes(q);
        const courseNameMatch = (t.courses?.course_name || t.course || '').toLowerCase().includes(q);
        const codeMatch       = t.courses?.course_code?.toLowerCase().includes(q);
        if (!titleMatch && !courseNameMatch && !codeMatch) return false;
      }
      return true;
    });
  }, [tutorials, selectedCourse, searchQuery]);

  const hasFilter = searchQuery.trim() !== '' || selectedCourse !== 'all';

  // ── Navigation ──
  const handleOpenTutorial = useCallback((tutorial) => {
    const fileName = getDisplayFilename(tutorial);
    navigate('/viewer', {
      state: {
        url:      tutorial.file_url,
        filename: fileName,
        course:   tutorial.courses?.course_name || tutorial.course || '',
        fileType: tutorial.file_type?.includes('pptx') || fileName.endsWith('.pptx') ? 'pptx' : 'pdf',
        kind:     'tutorial',
      },
    });
  }, [navigate]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCourse('all');
  }, []);

  const handleGoToUpload = useCallback(() => {
    navigate('/admin/upload', {
      state: { defaultKind: 'tutorial', defaultType: 'pdf' },
    });
  }, [navigate]);

  return (
    <div className="min-h-full bg-slate-50 flex flex-col pb-24 md:pb-12">

      {/* ── Sticky Header with Back Button ── */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3.5 pb-3 flex flex-col gap-3">

          {/* Title Row with Back Button */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(-1)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl transition-all active:scale-95 text-slate-700"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">
                  Tutorials
                </h1>
                <p className="text-[11px] text-slate-500 leading-tight">
                  {isLoading ? 'Loading…' : `${tutorials.length} file${tutorials.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            {/* Upload Shortcut for Admins */}
            {isAdmin && (
              <button
                onClick={handleGoToUpload}
                className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold active:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </button>
            )}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title, filename, or course…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] pl-9 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="min-w-[44px] min-h-[44px] absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Course Chips */}
          {distinctCourses.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-0.5">
              <button
                onClick={() => setSelectedCourse('all')}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all flex-shrink-0 ${
                  selectedCourse === 'all'
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 active:bg-slate-50 hover:border-slate-300'
                }`}
              >
                All ({tutorials.length})
              </button>
              {distinctCourses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCourse(c.id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all flex-shrink-0 ${
                    String(selectedCourse) === String(c.id)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 active:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  {c.code || c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 w-full flex-1">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center max-w-sm mx-auto my-12">
            <WifiOff className="w-8 h-8 text-rose-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-rose-700">Failed to load tutorials</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-5 min-h-[44px] px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl active:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        ) : filteredTutorials.length === 0 ? (
          <EmptyState
            hasFilter={hasFilter}
            onClear={clearFilters}
            onUpload={handleGoToUpload}
            isAdmin={isAdmin}
          />
        ) : (
          <>
            {hasFilter && (
              <p className="text-xs text-slate-500 mb-3 font-medium">
                {filteredTutorials.length} result{filteredTutorials.length !== 1 ? 's' : ''}
                {searchQuery && <> for &ldquo;<strong className="text-slate-700">{searchQuery}</strong>&rdquo;</>}
              </p>
            )}

            {/* Grid matching Files.jsx layout and alignment */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {filteredTutorials.map((tut) => (
                <TutorialCard
                  key={tut.id}
                  tutorial={tut}
                  uploaderName={tut.uploaded_by ? (publicNames[tut.uploaded_by] || null) : null}
                  onOpen={() => handleOpenTutorial(tut)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
