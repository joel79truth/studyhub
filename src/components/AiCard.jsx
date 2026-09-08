import React, { useState, useRef, useCallback } from 'react';
import { Camera, Sparkles, Lightbulb } from 'lucide-react';

export default function AiStudyAssistantCard({
  onAskClick = () => {},
  onSnapClick = () => {},
  onSuggestionClick = () => {},
  title = 'StudyHub AI Companion',
  description = 'Ask anything or snap a photo of any question to get guided help.',
  buttonText = 'Ask now',
  snapButtonText = 'Snap Question',
  suggestions = [],
  recommendedTopic = null,
}) {
  const [clicked, setClicked] = useState(false);
  const firedRef = useRef(false);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setClicked(true);
    onAskClick();
  }, [onAskClick]);

  return (
    <div className="w-full bg-gradient-to-br from-[#064e3b] to-[#022c22] text-white p-4 sm:p-5 rounded-[24px] flex flex-col gap-3 font-sans shadow-lg border border-emerald-800/40 relative overflow-hidden">
      {/* Subtle Background Glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Adaptive Weak-Spot Banner if student has a recent topic */}
      {recommendedTopic && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 text-xs text-emerald-100 mb-0.5">
          <div className="flex items-center gap-1.5 truncate">
            <Lightbulb className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
            <span className="truncate">
              Focus topic: <strong className="text-white font-semibold">{recommendedTopic.topic}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSuggestionClick(recommendedTopic.prompt || `Explain ${recommendedTopic.topic} simply.`)}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-[#064e3b] hover:bg-emerald-50 transition-colors flex-shrink-0"
          >
            Review 2 min
          </button>
        </div>
      )}

      {/* Main Row: Header Info & Mascot */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
              LUANAR AI Tutor
            </span>
          </div>
          <h3 className="text-[17px] font-bold tracking-tight text-white leading-snug">
            {title}
          </h3>
          <p className="text-[11px] text-emerald-100/80 font-medium leading-relaxed max-w-xs">
            {description}
          </p>

          {/* Dual Action Buttons: Snap & Ask */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button
              onClick={onSnapClick}
              type="button"
              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-400 to-emerald-300 hover:from-emerald-300 hover:to-emerald-200 text-[#022c22] text-[12px] font-bold px-4 py-2 rounded-full shadow-md transition-all active:scale-[0.97] cursor-pointer select-none"
            >
              <Camera className="w-3.5 h-3.5 text-[#022c22]" />
              {snapButtonText}
            </button>

            <button
              onClick={fire}
              disabled={clicked}
              type="button"
              className={`text-white bg-white/15 hover:bg-white/25 border border-white/10 text-[12px] font-semibold px-4 py-2 rounded-full transition-all active:scale-[0.97] cursor-pointer select-none ${
                clicked ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-300" />
                {clicked ? 'Opening…' : buttonText}
              </span>
            </button>
          </div>
        </div>

        {/* Mascot / Avatar */}
        <div className="w-[72px] h-[72px] sm:w-[84px] sm:h-[84px] bg-[#033425] rounded-2xl flex items-center justify-center border border-emerald-700/50 shadow-inner flex-shrink-0 relative overflow-hidden">
          <img
            src="/images/Ai.png"
            alt="StudyHub Assistant"
            className="w-full h-full object-contain p-1"
            loading="lazy"
          />
        </div>
      </div>

      {/* Suggestion Chips */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-emerald-800/40">
          {suggestions.slice(0, 3).map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s)}
              type="button"
              className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-emerald-100 transition-colors cursor-pointer truncate max-w-[170px]"
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