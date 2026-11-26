import { memo, useRef, useEffect, useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';

const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const ITEM_WIDTH = 52; // px per semester slot

/**
 * Alarm-clock-inspired horizontal rotary dial + stepper for Semester 1–8.
 * Lightweight, one-handed, touch-snap friendly, and keyboard accessible.
 */
export const SemesterDial = memo(function SemesterDial({
  value = 1,
  onChange,
  accent = 'blue',
}) {
  const numValue = Math.min(8, Math.max(1, Number(value) || 1));
  const scrollerRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimerRef = useRef(null);

  const scrollToSemester = useCallback((sem, smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    const targetLeft = (sem - 1) * ITEM_WIDTH;
    if (Math.abs(el.scrollLeft - targetLeft) < 2) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTo({
      left: targetLeft,
      behavior: smooth ? 'smooth' : 'auto',
    });
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, smooth ? 280 : 40);
  }, []);

  // Keep dial scroll position synced whenever value changes externally
  useEffect(() => {
    scrollToSemester(numValue, true);
  }, [numValue, scrollToSemester]);

  // Set initial position without animation on mount
  useEffect(() => {
    scrollToSemester(numValue, false);
    return () => clearTimeout(scrollTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;

    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const idx = Math.round(el.scrollLeft / ITEM_WIDTH);
      const nextSem = Math.min(8, Math.max(1, idx + 1));
      if (nextSem !== numValue) {
        onChange?.(nextSem);
      }
    }, 70);
  }, [numValue, onChange]);

  const stepBy = useCallback(
    (delta) => {
      const next = Math.min(8, Math.max(1, numValue + delta));
      if (next !== numValue) onChange?.(next);
    },
    [numValue, onChange]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        stepBy(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        stepBy(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onChange?.(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        onChange?.(8);
      } else if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        onChange?.(Number(e.key));
      }
    },
    [stepBy, onChange]
  );

  const accentText = accent === 'indigo' ? 'text-indigo-600 dark:text-indigo-400' : 'text-blue-600 dark:text-blue-400';
  const accentRing = accent === 'indigo' ? 'border-indigo-300/80 dark:border-indigo-700' : 'border-blue-300/80 dark:border-blue-700';

  return (
    <div
      className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700 select-none"
      role="spinbutton"
      tabIndex={0}
      aria-label="Select semester from 1 to 8"
      aria-valuemin={1}
      aria-valuemax={8}
      aria-valuenow={numValue}
      aria-valuetext={`Semester ${numValue}`}
      onKeyDown={handleKeyDown}
    >
      {/* Decrement Stepper */}
      <button
        type="button"
        onClick={() => stepBy(-1)}
        disabled={numValue <= 1}
        aria-label="Previous semester"
        className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center flex-shrink-0 shadow-2xs active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <Minus size={17} strokeWidth={2.5} />
      </button>

      {/* Center Rotary Snap Dial */}
      <div className="relative flex-1 min-w-0 h-14 overflow-hidden">
        {/* Center Active Lens Pill */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[52px] h-12 rounded-xl bg-white dark:bg-slate-900 border ${accentRing} shadow-sm z-0`}
        />

        {/* Subtle Edge Fades */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-slate-100 dark:from-slate-800/90 to-transparent z-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-slate-100 dark:from-slate-800/90 to-transparent z-20"
        />

        {/* Scrollable Snap Track */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          style={{
            scrollSnapType: 'x mandatory',
            touchAction: 'pan-x',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingLeft: `calc(50% - ${ITEM_WIDTH / 2}px)`,
            paddingRight: `calc(50% - ${ITEM_WIDTH / 2}px)`,
          }}
          className="relative z-10 flex items-center h-full overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          {SEMESTERS.map((sem) => {
            const distance = Math.abs(sem - numValue);
            const isActive = sem === numValue;
            return (
              <button
                key={sem}
                type="button"
                tabIndex={-1}
                onClick={() => onChange?.(sem)}
                style={{
                  width: ITEM_WIDTH,
                  minWidth: ITEM_WIDTH,
                  scrollSnapAlign: 'center',
                }}
                aria-label={`Semester ${sem}`}
                aria-pressed={isActive}
                className={`h-12 flex flex-col items-center justify-center transition-all duration-150 cursor-pointer ${
                  isActive
                    ? `${accentText} scale-105`
                    : distance === 1
                    ? 'text-slate-600 dark:text-slate-300 opacity-75 scale-95'
                    : 'text-slate-400 dark:text-slate-500 opacity-45 scale-85'
                }`}
              >
                <span className={`leading-none font-black ${isActive ? 'text-lg' : 'text-sm'}`}>
                  {sem}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5 leading-none opacity-80">
                  {isActive ? 'SEM' : `S${sem}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Increment Stepper */}
      <button
        type="button"
        onClick={() => stepBy(1)}
        disabled={numValue >= 8}
        aria-label="Next semester"
        className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center flex-shrink-0 shadow-2xs active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <Plus size={17} strokeWidth={2.5} />
      </button>
    </div>
  );
});

export default SemesterDial;
