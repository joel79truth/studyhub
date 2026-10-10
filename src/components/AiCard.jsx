import React, { useState, useRef, useCallback } from 'react';

export default function AiStudyAssistantCard({
  onAskClick = () => {},
  onSuggestionClick = () => {},
  title = 'Study Assistant',
  description = 'Ask anything. Get answers.',
  buttonText = 'Ask now',
  suggestions = [],
}) {
  const [clicked, setClicked] = useState(false);
  const firedRef = useRef(false); // synchronous guard — no async state lag

  const fire = useCallback(() => {
    if (firedRef.current) return; // already executed → block instantly
    firedRef.current = true;      // marked synchronously, before any re-render
    setClicked(true);             // update UI (disabled/opacity/label)
    onAskClick();                 // call parent handler immediately
  }, [onAskClick]);

  const handleTouchStart = useCallback(
    (e) => {
      e.preventDefault(); // stop the ghost click that would follow ~300ms later
      fire();
    },
    [fire]
  );

  const handleClick = useCallback(
    (e) => {
      e.preventDefault();
      if (firedRef.current) return; // touch already handled it
      fire();
    },
    [fire]
  );

  return (
    <div className="w-full bg-gradient-to-r from-[#024927] via-[#035930] to-[#046c3b] text-white p-5 md:p-7 rounded-[20px] md:rounded-2xl flex flex-col gap-3 font-sans shadow-sm hover:shadow-md transition-shadow duration-200 relative overflow-hidden">
      {/* Subtle ambient glow ring on wide viewports */}
      <div className="hidden lg:block absolute -right-8 -top-8 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between relative z-10">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 pr-3">
          <span className="text-[10px] md:text-[11px] font-bold tracking-wider uppercase text-emerald-200 bg-white/10 px-2.5 py-0.5 rounded-full w-max">
            AI Study Assistant • Sage
          </span>
          <h3 className="text-lg md:text-2xl font-bold tracking-tight text-white leading-snug mt-0.5">
            {title}
          </h3>
          <p className="text-xs md:text-sm text-emerald-100/90 font-medium leading-relaxed max-w-lg">
            {description}
          </p>
          <button
            onTouchStart={handleTouchStart}
            onClick={handleClick}
            disabled={clicked}
            style={{ touchAction: 'manipulation' }} // kills the 300ms tap delay
            className={`mt-2.5 w-max bg-white text-[#024927] text-xs md:text-sm font-bold px-5 py-2.5 rounded-xl transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white shadow-xs ${
              clicked
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-emerald-50 hover:shadow active:scale-95'
            }`}
            type="button"
          >
            {clicked ? 'Processing…' : buttonText}
          </button>
        </div>

        <div className="w-[84px] h-[84px] md:w-28 md:h-28 bg-[#0b2416]/50 rounded-full flex flex-col items-center justify-center border border-emerald-500/20 shadow-inner flex-shrink-0 p-2">
          <img
            src="/images/Ai.png"
            alt="AI Assistant Robot"
            className="w-full h-full object-contain"
            loading="lazy"
          />
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 relative z-10">
          {suggestions.slice(0, 4).map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s)}
              type="button"
              className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer truncate max-w-[160px]"
              title={s}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}