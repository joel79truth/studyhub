import { useRef, useEffect, useCallback, memo, useState } from 'react';
import TutorMarkdown from '../../common/TutorMarkdown';
import { Copy, Check, RotateCcw, Square, Sparkles } from 'lucide-react';

function safeString(content) {
  if (typeof content === 'string') return content;
  if (
    content &&
    typeof content === 'object' &&
    typeof content.token === 'string'
  ) {
    return content.token;
  }
  if (content === undefined || content === null) return '';
  return String(content);
}

// Sub-component for assistant response actions (copy, regenerate)
const AssistantActionBar = memo(({ text, onCopy, onRegenerate }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(safeString(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      onCopy?.(text);
    } catch {
      onCopy?.(text);
    }
  }, [text, onCopy]);

  return (
    <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100 text-xs text-slate-500">
      <button
        onClick={handleCopy}
        aria-label="Copy message"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer text-slate-500 font-medium"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-emerald-600">Copied</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy</span>
          </>
        )}
      </button>

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          aria-label="Regenerate response"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer text-slate-500 font-medium"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Regenerate</span>
        </button>
      )}
    </div>
  );
});

AssistantActionBar.displayName = 'AssistantActionBar';

const ChatMessages = memo(
  ({ messages, loading, error, onStop, onCopy, onRegenerate }) => {
    const containerRef = useRef(null);
    const endRef = useRef(null);
    const isNearBottomRef = useRef(true);

    const handleScroll = useCallback(() => {
      const container = containerRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      isNearBottomRef.current = distanceFromBottom < 100;
    }, []);

    useEffect(() => {
      if (endRef.current && isNearBottomRef.current) {
        endRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, [messages, loading]);

    const renderMessage = (msg, index) => {
      const key = msg.id || index;
      const isUser = msg.role === 'user';
      const textContent = isUser ? msg.text : safeString(msg.text);
      const isLastMessage = index === messages.length - 1;

      if (isUser) {
        return (
          <div key={key} className="flex justify-end w-full">
            <div className="max-w-[85%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs text-[15px] leading-relaxed break-words">
              {textContent}
            </div>
          </div>
        );
      }

      // Assistant / Tutor Message
      return (
        <div key={key} className="flex flex-col items-start w-full max-w-[98%] sm:max-w-[92%] my-1.5">
          {/* Tutor Identity Bar */}
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold text-slate-800">StudyHub Tutor</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              Verified Tutor
            </span>
          </div>

          {/* Tutor Content Canvas */}
          <div className="w-full bg-white rounded-2xl rounded-tl-xs p-4 sm:p-5 border border-slate-200/90 shadow-xs">
            <TutorMarkdown content={textContent} isStreaming={loading && isLastMessage} />

            {!loading && (
              <AssistantActionBar
                text={textContent}
                onCopy={onCopy}
                onRegenerate={onRegenerate ? () => onRegenerate(msg.id || index) : undefined}
              />
            )}
          </div>
        </div>
      );
    };

    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 flex flex-col gap-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {messages.map(renderMessage)}

        {loading && (
          <div className="flex items-center gap-3 py-2 px-1 text-slate-500 text-sm animate-pulse">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-blue-400 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '3s' }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-700">Thinking & reasoning through the concept...</span>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 text-center my-2">
            {error}
          </div>
        )}

        {loading && onStop && (
          <div className="flex justify-center pt-1">
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Square className="w-3 h-3 text-rose-500 fill-rose-500" />
              <span>Stop generating</span>
            </button>
          </div>
        )}

        <div ref={endRef} />
      </div>
    );
  }
);

ChatMessages.displayName = 'ChatMessages';

export default ChatMessages;