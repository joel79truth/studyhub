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
    <div className="w-full bg-[#024927] text-white p-4 rounded-[20px] flex flex-col gap-3 font-sans shadow-md">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5 flex-1">
          <h3 className="text-[17px] font-bold tracking-wide text-[#ffffff]">
            {title}
          </h3>
          <p className="text-[11px] text-gray-200/90 font-medium leading-tight">
            {description}
          </p>
          <button
            onTouchStart={handleTouchStart}
            onClick={handleClick}
            disabled={clicked}
            style={{ touchAction: 'manipulation' }} // kills the 300ms tap delay
            className={`mt-2 w-max bg-white text-[#024927] text-[12px] font-bold px-5 py-2 rounded-full transition-colors cursor-pointer select-none ${
              clicked
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-gray-100'
            }`}
            type="button"
          >
            {clicked ? 'Processing…' : buttonText}
          </button>
        </div>
        <div className="w-[80px] h-[80px] bg-[#111c24] rounded-full flex flex-col items-center justify-center border border-[#1b2a36] shadow-inner ml-2 flex-shrink-0">
          <img
            src="/images/Ai.png"
            alt="AI Assistant Robot"
            className="w-full h-full object-contain"
            loading="lazy"
          />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
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