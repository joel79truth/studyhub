import { useState, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { apiGet } from '../lib/api';
import {
  BookOpen,
  FileText,
  Search,
  User,
  Calendar,
  Layers,
  ChevronRight,
  ArrowRight,
  Filter,
} from 'lucide-react';

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
      page_count,
      uploaded_by,
      uploaded_at,
      created_at,
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
    const res = await apiGet(`/api/profiles/public-names?ids=${encodeURIComponent(ids.join(','))}`);
    return res?.profiles || {};
  } catch {
    return {};
  }
}

const TutorialCard = memo(({ tutorial, uploaderName, onOpen }) => {
  const courseName = tutorial.courses?.course_name || tutorial.course || 'Course Tutorial';
  const courseCode = tutorial.courses?.course_code || null;
  const pageCount = tutorial.page_count || 1;

  return (
    <div
      onClick={onOpen}
      className="group bg-white border border-slate-200/90 hover:border-[#024927] rounded-2xl p-4 sm:p-5 flex flex-col justify-between cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {courseCode && (
              <span className="text-[11px] font-bold px-2 py-0.5 bg-[#024927]/10 text-[#024927] rounded-md tracking-wider">
                {courseCode}
              </span>
            )}
            {tutorial.year && (
              <span className="text-[11px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md">
                {tutorial.year}
              </span>
            )}
            {tutorial.semester && (
              <span className="text-[11px] font-medium px-2 py-0.5 bg-slate-50 text-slate-600 rounded-md">
                Sem {tutorial.semester}
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
            <BookOpen className="w-3 h-3 text-[#024927]" /> Tutorial
          </span>
        </div>

        <h3 className="font-bold text-slate-900 text-base leading-snug group-hover:text-[#024927] transition-colors line-clamp-2">
          {tutorial.title || courseName}
        </h3>

        {tutorial.title && tutorial.title !== courseName && (
          <p className="text-xs text-slate-500 mt-1 line-clamp-1">
            {courseName}
          </p>
        )}

        {uploaderName && (
          <p className="text-[11px] text-slate-500 mt-2.5 flex items-center gap-1 font-medium">
            <User className="w-3 h-3 text-slate-400" />
            <span>Uploaded by {uploaderName}</span>
          </p>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600">
        <span className="flex items-center gap-1 text-slate-700">
          <Layers className="w-3.5 h-3.5 text-[#024927]" />
          {pageCount} {pageCount === 1 ? 'Page' : 'Pages'}
        </span>
        <span className="text-[#024927] font-bold flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
          Read <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
});

export default function Tutorials() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');

  const { data: tutorials = [], isLoading, error, refetch } = useQuery({
    queryKey: ['tutorialsList'],
    queryFn: fetchTutorials,
    staleTime: 5 * 60 * 1000,
  });

  const uploaderIds = useMemo(() => {
    const ids = new Set();
    tutorials.forEach((t) => {
      if (t.uploaded_by) ids.add(t.uploaded_by);
    });
    return Array.from(ids);
  }, [tutorials]);

  const { data: publicNames = {} } = useQuery({
    queryKey: ['publicNames', uploaderIds],
    queryFn: () => fetchPublicNames(uploaderIds),
    enabled: uploaderIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const distinctCourses = useMemo(() => {
    const map = new Map();
    tutorials.forEach((t) => {
      const id = t.course_id || t.course;
      const name = t.courses?.course_name || t.course || 'Unknown';
      if (id && !map.has(id)) {
        map.set(id, name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tutorials]);

  const filteredTutorials = useMemo(() => {
    return tutorials.filter((t) => {
      if (selectedCourse !== 'all') {
        const id = t.course_id || t.course;
        if (String(id) !== String(selectedCourse)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = t.title?.toLowerCase().includes(q);
        const courseNameMatch = (t.courses?.course_name || t.course || '').toLowerCase().includes(q);
        const codeMatch = t.courses?.course_code?.toLowerCase().includes(q);
        if (!titleMatch && !courseNameMatch && !codeMatch) return false;
      }
      return true;
    });
  }, [tutorials, selectedCourse, searchQuery]);

  const handleOpenTutorial = (tutorial) => {
    navigate('/viewer', {
      state: {
        url: tutorial.file_url,
        filename: tutorial.title || tutorial.courses?.course_name || tutorial.file_name || 'Tutorial',
        course: tutorial.courses?.course_name || tutorial.course || '',
        fileType: tutorial.file_type === 'application/pdf' ? 'pdf' : 'pdf',
      },
    });
  };

  return (
    <div className="min-h-full bg-slate-50 flex flex-col pb-24 md:pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-[#024927]/10 flex items-center justify-center text-[#024927]">
                <BookOpen className="w-4 h-4" />
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight font-display">
                Tutorials & Sheets
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Course tutorial sheets and study materials with page-by-page AI assistance
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tutorials…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#024927] focus:border-transparent transition-all"
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 w-full">
        {/* Course Filter Chips */}
        {distinctCourses.length > 1 && (
          <div className="flex items-center gap-2 pb-4 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setSelectedCourse('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                selectedCourse === 'all'
                  ? 'bg-[#024927] border-[#024927] text-white shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              All Courses ({tutorials.length})
            </button>
            {distinctCourses.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCourse(c.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                  String(selectedCourse) === String(c.id)
                    ? 'bg-[#024927] border-[#024927] text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Status Handling */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 bg-white border border-slate-200/80 rounded-2xl animate-pulse p-4" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center max-w-md mx-auto my-12">
            <p className="text-sm font-semibold text-rose-700">Failed to load tutorials</p>
            <p className="text-xs text-slate-500 mt-1">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-4 px-4 py-2 bg-[#024927] text-white text-xs font-semibold rounded-xl"
            >
              Retry
            </button>
          </div>
        ) : filteredTutorials.length === 0 ? (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center max-w-md mx-auto my-12">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 mx-auto mb-3">
              <BookOpen className="w-6 h-6" />
            </div>
            <p className="text-base font-bold text-slate-800">No tutorials found</p>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || selectedCourse !== 'all'
                ? 'Try clearing your search query or course filters.'
                : 'No tutorials have been published yet. Check back soon.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTutorials.map((tut) => (
              <TutorialCard
                key={tut.id}
                tutorial={tut}
                uploaderName={tut.uploaded_by ? (publicNames[tut.uploaded_by] || null) : null}
                onOpen={() => handleOpenTutorial(tut)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
