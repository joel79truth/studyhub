import React from 'react';

export default function AiStudyAssistantCard({
  onAskClick = () => {},
  onSuggestionClick = () => {},
  title = 'AI Study Assistant',
  description = 'Ask anything. Get answers.', // default
  buttonText = 'Ask now',
  suggestions = [], // e.g. ['Explain photosynthesis', 'Summarize Chapter 3']
}) {
  return (
    <div className="w-full bg-[#024927] text-white p-4 rounded-[20px] flex flex-col gap-3 font-sans shadow-md">

      <div className="flex items-center justify-between">
        {/* Left column */}
        <div className="flex flex-col gap-1.5 flex-1">
          {/* Pure white title */}
          <h3 className="text-[17px] font-bold tracking-wide text-[#ffffff]">
            {title}
          </h3>

          {/* Dynamic description – short, bold, personal */}
          <p className="text-[11px] text-gray-200/90 font-medium leading-tight">
            {description}
          </p>

          <button
            onClick={onAskClick}
            className="mt-2 w-max bg-white text-[#024927] text-[12px] font-bold px-5 py-2 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
            type="button"
          >
            {buttonText}
          </button>
        </div>

        {/* Larger Robot Avatar */}
        <div className="w-[80px] h-[80px] bg-[#111c24] rounded-full flex flex-col items-center justify-center border border-[#1b2a36] shadow-inner ml-2 flex-shrink-0">
          <img
            src="/images/Ai.png"
            alt="AI Assistant Robot"
            className="w-full h-full object-contain"
            loading="lazy"
          />
        </div>
      </div>

      {/* Quick-ask suggestions — gives the user somewhere to start instead
          of a bare button that opens onto a blank chat, mirroring the
          "search with suggestions beats a blank search bar" idea. Purely
          optional: renders nothing if the caller doesn't pass any. */}
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