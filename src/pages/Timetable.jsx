import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CalendarRange, Users, BookOpen, PenLine, ClipboardCheck,
  CheckCircle2, FileClock, Coffee, GraduationCap, Compass,
} from 'lucide-react';
import { format, parseISO, isBefore, differenceInCalendarDays } from 'date-fns';
import { BottomNav } from '../components/BottomNav';

// ─── Academic calendar data ───────────────────────────────────────────────
// Transcribed from the published 2026/2027 University Calendar (pages 2–3).
// This is university-wide, published content — not per-student data — so
// it lives here as a static source of truth rather than a Supabase query.
// When the rest of the calendar is published (later Semester 2 dates),
// append entries below; the list is sorted by date at render time, so
// order here doesn't matter.
const CALENDAR_EVENTS = [
  { start: '2026-08-03', end: '2026-08-07', title: '2026/2027 Academic Year Commences', category: 'academic-year' },
  { start: '2026-08-03', end: '2026-08-07', title: 'Release of Results — Appeals Window Opens', category: 'result' },
  { start: '2026-08-10', end: '2026-08-21', title: 'ODeL Orientation and Facilitation', category: 'orientation' },
  { start: '2026-08-14', title: 'Appeals Window Closes', category: 'admin' },
  { start: '2026-08-24', end: '2026-08-28', title: 'Orientation Week — Bunda, City & NRC Campuses', category: 'orientation' },
  { start: '2026-08-31', end: '2026-09-04', title: 'Teaching Commences — Bunda, City & NRC Campuses', category: 'teaching' },
  { start: '2026-08-31', end: '2026-09-04', title: 'Deferred and Supplementary Exams', category: 'exam' },
  { start: '2026-09-14', title: 'Deferred and Supplementary Assessments', category: 'assessment' },
  { start: '2026-10-02', title: 'End-Semester Examination Timetable Released', category: 'admin' },
  { start: '2026-10-19', end: '2026-10-23', title: 'Mid-Semester Examinations', category: 'exam' },
  { start: '2026-10-19', end: '2026-10-23', title: 'Submission of End-Semester Examinations', category: 'admin' },
  { start: '2026-11-09', end: '2026-11-13', title: 'Graduation (Tentative)', category: 'graduation' },
  { start: '2026-11-30', end: '2026-12-02', title: 'Grace Period', category: 'grace' },
  { start: '2026-12-03', end: '2026-12-18', title: 'End-Semester Examinations — All Campuses', category: 'exam' },
  { start: '2027-01-04', end: '2027-01-08', title: 'Semester I Deferred Examinations', category: 'exam' },
  { start: '2027-01-04', end: '2027-01-22', title: 'Block Marking', category: 'admin' },
  { start: '2027-01-25', title: 'Departmental Assessment', category: 'assessment' },
  { start: '2027-01-28', title: 'Faculty Assessment', category: 'assessment' },
  { start: '2027-02-02', title: 'College Assessment', category: 'assessment' },
  { start: '2027-02-05', title: 'Senate', category: 'admin' },
  { start: '2027-02-08', end: '2027-02-12', title: 'Release of Results — Appeals Window Opens', category: 'result' },
  { start: '2027-02-08', end: '2027-02-12', title: 'Teaching Timetable Released', category: 'admin' },
  { start: '2027-02-08', end: '2027-02-19', title: 'Appeals Window Closes', category: 'admin' },
  { start: '2027-02-08', end: '2027-02-19', title: 'ODeL Facilitation Commences', category: 'orientation' },
  { start: '2027-02-22', title: 'Semester 2 Commences — All Campuses', category: 'teaching' },
  { start: '2027-03-08', title: 'Supplementary Examinations', category: 'exam' },
  { start: '2027-03-15', end: '2027-03-19', title: 'Supplementary Assessments', category: 'assessment' },
  { start: '2027-03-22', title: 'End-Semester Examination Timetable Released', category: 'admin' },
];

// Icon + tint per category. Colour is a secondary signal here — the icon
// and the title text carry the meaning on their own — so tints stay muted
// rather than bright, to match the rest of the category chips in the app.
const CATEGORY_META = {
  'academic-year': { icon: CalendarRange, tint: 'bg-slate-100 text-slate-600' },
  orientation: { icon: Users, tint: 'bg-sky-50 text-sky-600' },
  teaching: { icon: BookOpen, tint: 'bg-emerald-50 text-emerald-600' },
  exam: { icon: PenLine, tint: 'bg-red-50 text-red-600' },
  assessment: { icon: ClipboardCheck, tint: 'bg-amber-50 text-amber-600' },
  result: { icon: CheckCircle2, tint: 'bg-green-50 text-green-600' },
  admin: { icon: FileClock, tint: 'bg-slate-50 text-slate-500' },
  grace: { icon: Coffee, tint: 'bg-purple-50 text-purple-600' },
  graduation: { icon: GraduationCap, tint: 'bg-indigo-50 text-indigo-600' },
};

// ─── Study roadmap ──────────────────────────────────────────────────────────
// A simple, evidence-informed phase model: further out, focus on keeping up
// with coursework; closer in, shift to timed practice; final days, taper
// off to protect sleep and avoid last-minute cramming. This is general
// study guidance, not personalised advice, and is meant to orient a
// first-time user rather than replace their own judgement.
function getStudyPhase(daysUntil) {
  if (daysUntil === null) {
    return {
      label: 'All clear',
      message: 'There is no exam period coming up on the calendar yet — a good time to stay ahead on coursework.',
      tips: [
        'Keep up with weekly readings and assignments',
        'Review lecture notes while they are still fresh',
        'Flag topics that feel shaky so they are easier to revisit later',
      ],
    };
  }
  if (daysUntil < 0) {
    return {
      label: 'In progress',
      message: 'This exam period is underway. Focus on the paper directly ahead of you.',
      tips: [
        'Check the exact date, time and venue for your next paper',
        'Get a full night of sleep before each exam',
        'Skim your own summary notes rather than starting new topics',
      ],
    };
  }
  if (daysUntil <= 3) {
    return {
      label: 'Final stretch',
      message: `Exams start in ${daysUntil} day${daysUntil === 1 ? '' : 's'}. This is the time to consolidate, not cram.`,
      tips: [
        'Review your own summary notes, not full textbooks',
        'Sit one timed past paper per subject, then stop',
        'Prioritise sleep over an extra hour of reading',
      ],
    };
  }
  if (daysUntil <= 10) {
    return {
      label: 'Final push',
      message: `${daysUntil} days to go — shift fully into exam-condition practice.`,
      tips: [
        'Sit full past papers under timed conditions',
        'Review mistakes from practice papers in detail',
        'Rank topics by weakness and study the weakest first',
      ],
    };
  }
  if (daysUntil <= 21) {
    return {
      label: 'Focused revision',
      message: `${daysUntil} days left. Narrow in on the topics that need the most work.`,
      tips: [
        'Use past papers to spot recurring question patterns',
        'Turn weak topics into short summary sheets',
        'Space revision across subjects rather than one long session per subject',
      ],
    };
  }
  if (daysUntil <= 45) {
    return {
      label: 'Build-up phase',
      message: `${daysUntil} days out — a good point to start structured revision.`,
      tips: [
        'Draft a rough revision timetable across all subjects',
        'Start light, untimed practice with past papers',
        'Revisit topics from earlier in the semester before they fade',
      ],
    };
  }
  return {
    label: 'Foundation phase',
    message: `${daysUntil} days until exams — plenty of runway. Focus on staying on top of coursework now.`,
    tips: [
      'Keep up with lectures and assignments as they come',
      'Summarise each topic shortly after it is taught',
      'Note down anything confusing to revisit before revision starts',
    ],
  };
}

const formatEventDate = (event) => {
  const start = parseISO(event.start);
  if (event.end && event.end !== event.start) {
    const end = parseISO(event.end);
    const sameMonth = format(start, 'MMM yyyy') === format(end, 'MMM yyyy');
    return sameMonth
      ? `${format(start, 'd')} – ${format(end, 'd MMM yyyy')}`
      : `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
  }
  return format(start, 'd MMM yyyy');
};

const EventRow = ({ event, isPast, isNext }) => {
  const meta = CATEGORY_META[event.category] || CATEGORY_META.admin;
  const Icon = meta.icon;
  return (
    <div className={`flex items-start gap-3 py-2.5 ${isPast ? 'opacity-50' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.tint}`}>
        <Icon className="w-4 h-4" strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 leading-snug">{event.title}</p>
          {isNext && !isPast && (
            <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
              Next
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{formatEventDate(event)}</p>
      </div>
    </div>
  );
};

const MonthHeader = ({ label }) => (
  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide pt-4 pb-1 first:pt-0">{label}</p>
);

const TodayDivider = () => (
  <div className="flex items-center gap-2 py-1.5">
    <div className="h-px flex-1 bg-blue-200" />
    <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Today</span>
    <div className="h-px flex-1 bg-blue-200" />
  </div>
);

const Timetable = () => {
  const navigate = useNavigate();

  const sortedEvents = useMemo(
    () => [...CALENDAR_EVENTS].sort((a, b) => a.start.localeCompare(b.start)),
    [],
  );

  const now = useMemo(() => new Date(), []);

  // Nearest exam-category event that has not fully passed yet — used for
  // both the countdown hero and the roadmap phase below it.
  const nextExam = useMemo(() => {
    const upcoming = sortedEvents.filter((ev) => {
      if (ev.category !== 'exam') return false;
      const end = parseISO(ev.end || ev.start);
      return !isBefore(end, now);
    });
    return upcoming[0] || null;
  }, [sortedEvents, now]);

  const daysUntil = nextExam ? differenceInCalendarDays(parseISO(nextExam.start), now) : null;
  const phase = getStudyPhase(daysUntil);

  // Flatten into render items: month headers + a single "Today" divider
  // inserted where it chronologically belongs, so a first-time user can
  // immediately see where they stand without hunting for a date.
  const timelineItems = useMemo(() => {
    const items = [];
    let lastMonth = null;
    let todayInserted = false;
    let nextMarked = false;

    sortedEvents.forEach((ev) => {
      const start = parseISO(ev.start);
      const end = parseISO(ev.end || ev.start);
      const isPast = isBefore(end, now);

      if (!todayInserted && isBefore(now, start)) {
        items.push({ type: 'today', key: 'today' });
        todayInserted = true;
      }

      const monthLabel = format(start, 'MMMM yyyy');
      if (monthLabel !== lastMonth) {
        items.push({ type: 'header', key: `h-${monthLabel}`, label: monthLabel });
        lastMonth = monthLabel;
      }

      const isNext = !isPast && !nextMarked && ev === nextExam;
      if (isNext) nextMarked = true;

      items.push({ type: 'event', key: `${ev.start}-${ev.title}`, event: ev, isPast, isNext });
    });

    if (!todayInserted) items.push({ type: 'today', key: 'today' });
    return items;
  }, [sortedEvents, now, nextExam]);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 sticky top-0 z-30 bg-white/92 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="p-2 -ml-2 hover:bg-gray-100 active:scale-90 rounded-lg transition-colors duration-100"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" strokeWidth={1.75} />
        </button>
        <h1 className="text-base font-semibold text-slate-900 tracking-tight">Academic Calendar</h1>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="px-4 py-4 pb-32 space-y-4">

          {/* Exam countdown hero */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500">Next examination period</p>
              {nextExam && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  Examinations
                </span>
              )}
            </div>
            {nextExam ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-slate-900 tracking-tight leading-none">
                    {Math.abs(daysUntil)}
                  </span>
                  <span className="text-sm font-medium text-gray-500">
                    {daysUntil < 0 ? 'days in' : daysUntil === 1 ? 'day to go' : 'days to go'}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-2">{nextExam.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatEventDate(nextExam)}</p>
              </>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                No upcoming examination period is on the calendar right now.
              </p>
            )}
          </div>

          {/* Study roadmap */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Compass className="w-4 h-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{phase.label}</p>
                <p className="text-sm font-semibold text-gray-900 leading-tight">Your study roadmap</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 leading-snug mb-3">{phase.message}</p>
            <ul className="space-y-1.5">
              {phase.tips.map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="w-1 h-1 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          {/* Full calendar timeline */}
          <div className="bg-white border border-gray-100 rounded-2xl px-4 pb-3">
            <h2 className="text-sm font-semibold text-gray-900 pt-4 pb-1">Key dates this year</h2>
            <div className="divide-y divide-gray-50">
              {timelineItems.map((item) => {
                if (item.type === 'header') return <MonthHeader key={item.key} label={item.label} />;
                if (item.type === 'today') return <TodayDivider key={item.key} />;
                return (
                  <EventRow
                    key={item.key}
                    event={item.event}
                    isPast={item.isPast}
                    isNext={item.isNext}
                  />
                );
              })}
            </div>
          </div>

        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default Timetable;