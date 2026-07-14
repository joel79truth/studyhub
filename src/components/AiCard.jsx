import React from 'react';

export default function AiStudyAssistantCard({
  onAskClick = () => {},
  title = 'AI Study Assistant',
  description = 'Ask anything. Get answers.', // default
  buttonText = 'Ask now',
}) {
  return (
    <div className="w-full bg-[#024927] text-white p-4 rounded-[20px] flex items-center justify-between font-sans shadow-md">
      
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
  );
}