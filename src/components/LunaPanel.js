import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Send, Minimize2, Maximize2, BookOpen, Menu } from 'lucide-react';
import LunaOrb from './LunaOrb';
import MiniMarkdown from './MiniMarkdown';

// ─── constants (unchanged) ─────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Explain Simply', prompt: 'Explain this page like I am a complete beginner.', color: '#3b82f6', icon: '📘' },
  { label: 'Step-by-Step',   prompt: 'Break this page content into clear numbered steps.',    color: '#22c55e', icon: '📋' },
  { label: 'Real-world Ex.', prompt: 'Give me a real-world practical example of this content.', color: '#f59e0b', icon: '🌍' },
  { label: 'Test Me',        prompt: 'Ask me one question to test my understanding of this page.', color: '#8b5cf6', icon: '✏️' },
];

const LOADING_STAGES = [
  { label: 'Reading page content…', icon: '📖' },
  { label: 'Analyzing your question…', icon: '🧠' },
  { label: 'Crafting response…', icon: '✍️' },
];

const CONTEXT_SUGGESTIONS = [
  { label: 'Summarise this page', prompt: 'Summarise the key takeaways of this page in 3 bullet points.' },
  { label: 'Ask a question', prompt: 'What is the most important concept on this page?' },
  { label: 'Give me an example', prompt: 'Give a practical example of the main idea on this page.' },
];

// ─── hooks (unchanged) ─────────────────────────────────────────────────
function useUserLevel() {
  const [level, setLevel] = useState('new');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('luna_visits');
    const count = stored ? parseInt(stored, 10) : 0;
    const newCount = count + 1;
    localStorage.setItem('luna_visits', String(newCount));
    if (newCount <= 3) setLevel('new');
    else if (newCount <= 10) setLevel('returning');
    else setLevel('power');
  }, []);
  return { level };
}

function usePrefersReducedMotion() {
  const [prefersReduced, setPrefersReduced] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setPrefersReduced(media.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);
  return prefersReduced;
}

// ─── sub‑components (all unchanged from your version) ──────────────────
const LoadingProgress = ({ reducedMotion }) => {
  const [stageIndex, setStageIndex] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % LOADING_STAGES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [reducedMotion]);
  const current = LOADING_STAGES[stageIndex];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {LOADING_STAGES.map((_, i) => (
          <div
            key={i}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: i <= stageIndex ? '#3b82f6' : '#e2e8f0',
              transition: 'background 0.4s ease',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
        {current.icon} {current.label}
      </span>
    </div>
  );
};

const ContextualSuggestions = ({ onSelect, reducedMotion }) => (
  <div
    style={{
      display: 'flex', gap: 8, padding: '8px 16px 4px',
      overflowX: 'auto', scrollbarWidth: 'none',
      animation: reducedMotion ? 'none' : 'fadeInUp 0.25s ease both',
    }}
  >
    {CONTEXT_SUGGESTIONS.map((s) => (
      <button
        key={s.label}
        onClick={() => onSelect(s.prompt)}
        style={{
          whiteSpace: 'nowrap',
          padding: '5px 14px',
          borderRadius: 16,
          border: '1px solid #bfdbfe',
          background: '#eff6ff',
          fontSize: 12,
          fontWeight: 500,
          color: '#1d4ed8',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#dbeafe'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
      >
        {s.label}
      </button>
    ))}
  </div>
);

const QuickReplies = ({ options, onSelect, reducedMotion }) => {
  if (!options || options.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex', gap: 8, padding: '4px 16px 0',
        flexWrap: 'wrap',
        animation: reducedMotion ? 'none' : 'fadeInUp 0.2s ease both',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          style={{
            padding: '4px 14px',
            borderRadius: 20,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            fontSize: 12.5,
            fontWeight: 500,
            color: '#1e293b',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
};

const MessageBubble = React.memo(({ msg, index, reducedMotion }) => {
  const isUser = msg.role === 'user';
  const animation = reducedMotion
    ? 'none'
    : `msgSlideIn 0.28s cubic-bezier(0.34,1.56,0.64,1) both`;
  const delay = Math.min(index * 30, 120);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        animation,
        animationDelay: `${delay}ms`,
      }}
    >
      {isUser ? (
        <div
          style={{
            maxWidth: '78%',
            background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)',
            color: '#fff',
            borderRadius: '18px 18px 4px 18px',
            padding: '10px 14px',
            fontSize: 13.5,
            lineHeight: 1.5,
            boxShadow: '0 2px 10px rgba(29,78,216,.25)',
          }}
        >
          {msg.content}
        </div>
      ) : (
        <div
          style={{
            maxWidth: 'min(92%, 480px)',
            background: '#f8fafc',
            border: '1px solid #e8edf3',
            borderRadius: '4px 18px 18px 18px',
            padding: '11px 14px',
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          <MiniMarkdown content={msg.content} />
          {msg.isStreaming && (
            <span
              style={{
                display: 'inline-block',
                width: 2, height: 14,
                background: '#3b82f6',
                marginLeft: 3,
                borderRadius: 1,
                animation: reducedMotion ? 'none' : 'blink 0.8s step-end infinite',
                verticalAlign: 'middle',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
});

const SendButton = ({ onClick, disabled }) => {
  const [popped, setPopped] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    setPopped(true);
    setTimeout(() => setPopped(false), 350);
    onClick();
  };
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      aria-label="Send message"
      style={{
        width: 38, height: 38,
        borderRadius: '50%', border: 'none',
        background: disabled ? '#e2e8f0' : 'linear-gradient(135deg,#1d4ed8,#3b82f6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        boxShadow: disabled ? 'none' : '0 2px 10px rgba(29,78,216,.35)',
        transform: popped ? 'scale(0.88)' : 'scale(1)',
        transitionProperty: 'background, box-shadow, transform',
        transitionDuration: popped ? '0.1s' : '0.3s',
        transitionTimingFunction: popped ? 'ease' : 'cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <Send size={15} color={disabled ? '#9ca3af' : '#fff'} />
    </button>
  );
};

const EmptyState = React.memo(({ userLevel, reducedMotion }) => {
  const content = {
    new: {
      title: '👋 Welcome to Luna!',
      desc: 'I\'m here to help you understand this page. Try a quick action below or ask me anything.',
    },
    returning: {
      title: '✨ Welcome back!',
      desc: 'Ready to dive deeper? Ask a follow‑up or pick a shortcut to continue learning.',
    },
    power: {
      title: '🚀 You\'re on a roll!',
      desc: 'Let\'s push further. Try a challenging prompt or explore advanced concepts.',
    },
  };
  const { title, desc } = content[userLevel] || content.new;
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '0 24px',
        animation: reducedMotion ? 'none' : 'fadeInUp 0.4s ease both',
      }}
    >
      <div
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg,#eff6ff,#e0e7ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 18px rgba(99,102,241,.18)',
          animation: reducedMotion ? 'none' : 'orbFloat 3s ease-in-out infinite',
        }}
      >
        <BookOpen size={22} color="#4f46e5" />
      </div>
      <p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: '#111', textAlign: 'center' }}>
        {title}
      </p>
      <p style={{ fontSize: 12.5, color: '#9ca3af', textAlign: 'center', margin: 0, lineHeight: 1.6, maxWidth: '260px' }}>
        {desc}
      </p>
    </div>
  );
});

// ─── MAIN PANEL ─────────────────────────────────────────────────────────

const LunaPanel = ({
  // New props for persistence & sidebar
  messages,
  isLoading,          // true when AI is thinking
  onSendMessage,      // function(userMsg, aiMsg) => void
  onToggleSidebar,    // toggles the sidebar
  conversationTitle,  // current conversation title
  // Existing props
  currentPage,
  isTeachMode,
  setIsTeachMode,
  onClose,
  isFullscreen,
  toggleFullscreen,
  lunaMood,
  showCelebration,
}) => {
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const { level: userLevel } = useUserLevel();

  const [input, setInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);

  // ── Scroll to bottom ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Focus input on mount ──
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  // ── Detect multiple‑choice questions ──
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    if (last && last.role === 'assistant') {
      const content = last.content;
      const match = content.match(/([A-C])[\)\.]\s*([^\n]*)/g);
      if (match) {
        setQuickReplies(match.map(m => m.trim()));
      } else {
        setQuickReplies([]);
      }
    } else {
      setQuickReplies([]);
    }
  }, [messages]);

  // ── Handlers ──
  const handleSend = useCallback(
    (text) => {
      const msg = text || input;
      if (!msg.trim() || isLoading) return;
      // We need to generate an AI response – we'll simulate it.
      // In a real app, call your LLM API and then call onSendMessage(userMsg, aiMsg).
      // For demo, we'll create a dummy response.
      const dummyAIResponse = `Here's a thoughtful answer to: "${msg}"`;
      onSendMessage(msg, dummyAIResponse);
      setInput('');
      setQuickReplies([]);
    },
    [input, isLoading, onSendMessage]
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectContextSuggestion = (prompt) => {
    setInput(prompt);
    setIsInputFocused(false);
    setTimeout(() => handleSend(prompt), 100);
  };

  // ── Dynamic panel height ──
  const panelStyle = useMemo(() => {
    if (isFullscreen) {
      return { top: 0, height: '100dvh', borderRadius: 0, boxShadow: 'none' };
    }
    return {
      top: 'auto',
      height: '58dvh',
      minHeight: '340px',
      maxHeight: '72dvh',
      borderRadius: '20px 20px 0 0',
      boxShadow: '0 -8px 48px rgba(0,0,0,.14)',
    };
  }, [isFullscreen]);

  const animationClass = reducedMotion ? '' : 'slide-up';

  // ── Render ──
  return (
    <>
      <style>{`
        /* ── all your existing keyframes and styles ── */
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.6; }
          to   { transform: translateY(0);    opacity: 1;   }
        }
        @keyframes fadeInUp {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes msgSlideIn {
          from { transform: translateY(8px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0)   scale(1);    opacity: 1; }
        }
        @keyframes blink {
          0%,100% { opacity: 1; }
          50%     { opacity: 0; }
        }
        @keyframes orbFloat {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-5px); }
        }
        @keyframes teachPop {
          0%   { transform: scale(0.9); }
          55%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }

        .luna-panel {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
          background: #fff;
        }
        .luna-panel.slide-up {
          animation: slideUp 0.32s cubic-bezier(0.22,1,0.36,1) both;
        }

        .luna-drag-handle {
          width: 38px; height: 4px; border-radius: 2px;
          background: #e2e8f0; margin: 10px auto 0;
          flex-shrink: 0;
        }

        .luna-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px 12px;
          border-bottom: 1px solid #f1f5f9;
          flex-shrink: 0;
        }
        .luna-header-left { display: flex; align-items: center; gap: 10px; }
        .luna-header-right { display: flex; align-items: center; gap: 6px; }

        .circle-btn {
          width: 32px; height: 32px; border-radius: 50%; border: none;
          background: #f1f5f9;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          transition: all 0.18s cubic-bezier(0.34,1.56,0.64,1);
        }
        .circle-btn:hover { background: #e2e8f0; transform: scale(1.08); }
        .circle-btn:active { transform: scale(0.88); }

        .mode-toggle {
          font-size: 11px; font-weight: 600;
          padding: 5px 12px; border-radius: 20px;
          cursor: pointer;
          transition: all 0.22s cubic-bezier(0.34,1.56,0.64,1);
          white-space: nowrap;
        }
        .mode-toggle:active { transform: scale(0.92); }
        .mode-toggle.teach {
          border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8;
          animation: teachPop 0.3s ease;
        }
        .mode-toggle.assist {
          border: 1px solid #e2e8f0; background: #f8fafc; color: #64748b;
        }

        .luna-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .luna-messages::-webkit-scrollbar { display: none; }

        .quick-strip {
          display: flex; gap: 8px;
          padding: 8px 16px;
          overflow-x: auto; overflow-y: hidden;
          background: #f8fafc;
          border-top: 1px solid #f1f5f9;
          flex-shrink: 0;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .quick-strip::-webkit-scrollbar { display: none; }
        .quick-btn {
          white-space: nowrap;
          padding: 6px 14px 6px 10px;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 11.5px;
          font-weight: 600;
          color: #374151;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.18s cubic-bezier(0.34,1.56,0.64,1);
        }
        .quick-btn:hover {
          transform: scale(1.04);
          border-color: #94a3b8;
        }
        .quick-btn:active { transform: scale(0.93); }
        .quick-btn .icon { font-size: 14px; line-height: 1; }

        .quick-btn.teach-mode {
          padding: 8px 16px 8px 12px;
          border-radius: 12px;
          border-width: 2px;
          font-size: 12px;
        }

        .luna-input-row {
          padding: 8px 14px;
          padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));
          border-top: 1px solid #f1f5f9;
          flex-shrink: 0;
        }
        .luna-input-pill {
          display: flex; align-items: center; gap: 10px;
          background: #f1f5f9; border-radius: 24px;
          padding: 6px 6px 6px 16px;
          transition: box-shadow 0.2s ease;
        }
        .luna-input-pill:focus-within {
          box-shadow: 0 0 0 2px rgba(99,102,241,.25);
        }
        .luna-input {
          flex: 1; background: transparent; border: none; outline: none;
          font-size: 13.5px; line-height: 1.4;
          font-size: max(16px, 13.5px);
          color: #111;
          min-width: 0;
        }
        .luna-input::placeholder { color: #9ca3af; }
      `}</style>

      <div className={`luna-panel ${animationClass}`} style={panelStyle}>
        {!isFullscreen && <div className="luna-drag-handle" aria-hidden="true" />}

        {/* ── Header ── */}
        <div className="luna-header">
          <div className="luna-header-left">
            {/* Sidebar toggle button */}
            <button onClick={onToggleSidebar} className="circle-btn" aria-label="Toggle sidebar">
              <Menu size={16} color="#64748b" />
            </button>
            <button onClick={onClose} className="circle-btn" aria-label="Close Luna">
              <X size={15} color="#64748b" />
            </button>
            <LunaOrb mood={lunaMood} size={34} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#111', lineHeight: 1.2 }}>
                {conversationTitle || 'Luna'}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginTop: 1 }}>
                {isTeachMode ? 'teach mode' : 'assist mode'} · {userLevel} user
              </div>
            </div>
          </div>

          <div className="luna-header-right">
            <button
              onClick={() => setIsTeachMode(!isTeachMode)}
              className={`mode-toggle ${isTeachMode ? 'teach' : 'assist'}`}
              aria-pressed={isTeachMode}
              aria-label="Toggle teach mode"
            >
              {isTeachMode ? 'Teach Me' : 'Assist'}
            </button>
            <button
              onClick={toggleFullscreen}
              className="circle-btn"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="luna-messages" role="log" aria-live="polite">
          {messages.length === 0 && <EmptyState userLevel={userLevel} reducedMotion={reducedMotion} />}

          {messages.map((msg, i) => (
            <MessageBubble key={msg.id || i} msg={msg} index={i} reducedMotion={reducedMotion} />
          ))}

          {isLoading && <LoadingProgress reducedMotion={reducedMotion} />}
          <div ref={bottomRef} />
        </div>

        {/* ── Contextual Suggestions ── */}
        {isInputFocused && messages.length === 0 && !input.trim() && (
          <ContextualSuggestions onSelect={selectContextSuggestion} reducedMotion={reducedMotion} />
        )}

        {/* ── Quick Replies ── */}
        {quickReplies.length > 0 && !isLoading && (
          <QuickReplies options={quickReplies} onSelect={handleSend} reducedMotion={reducedMotion} />
        )}

        {/* ── Quick Actions ── */}
        <div className="quick-strip" role="toolbar" aria-label="Quick prompts">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => handleSend(action.prompt)}
              className={`quick-btn ${isTeachMode ? 'teach-mode' : ''}`}
              style={{
                borderColor: isTeachMode ? action.color : '#e2e8f0',
                background: isTeachMode ? `${action.color}10` : '#fff',
              }}
            >
              <span className="icon">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>

        {/* ── Input ── */}
        <div className="luna-input-row">
          <div className="luna-input-pill">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 200)}
              placeholder={isTeachMode ? 'Ask your tutor…' : 'Ask Luna anything…'}
              className="luna-input"
              aria-label="Message Luna"
              autoComplete="off"
              autoCorrect="on"
              spellCheck="true"
              enterKeyHint="send"
            />
            <SendButton onClick={() => handleSend()} disabled={!input.trim() || isLoading} />
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(LunaPanel);