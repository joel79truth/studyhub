// components/StudyBot/Chat/ChatMessages.js
import { useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Bubble from './Bubble';

// ---------- Helpers ----------
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

// ---------- Extra styles for elements NOT covered by .ai-response ----------
const extraStyles = {
  h4: {
    fontSize: '16px',
    lineHeight: 1.45,
    margin: '15px 0 7px',
    fontWeight: 600,
    color: '#374151',
  },
  blockquote: {
    borderLeft: '3px solid #93c5fd',
    paddingLeft: '13px',
    color: '#475569',
    margin: '10px 0 16px',
    lineHeight: 1.6,
  },
  pre: {
    background: '#f1f5f9',
    padding: '12px',
    borderRadius: '10px',
    overflowX: 'auto',
    margin: '10px 0 16px',
    WebkitOverflowScrolling: 'touch',
    border: '1px solid #e2e8f0',
  },
  a: {
    color: '#4f46e5',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    fontWeight: 500,
  },
  hr: {
    border: 0,
    borderTop: '1px solid #e5e7eb',
    margin: '18px 0',
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    margin: '12px 0 16px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    margin: 0,
    fontSize: '15px',
    lineHeight: 1.5,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '2px solid #dbe3f0',
    background: '#f8fafc',
    fontWeight: 700,
    color: '#374151',
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #e5e7eb',
    verticalAlign: 'top',
    color: '#374151',
  },
  del: {
    color: '#64748b',
  },
};

// ---------- Loading animation keyframes (injected once) ----------
const loadingKeyframes = `
  @-webkit-keyframes sb-bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-5px); }
  }
  @-moz-keyframes sb-bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-5px); }
  }
  @keyframes sb-bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-5px); }
  }
`;

// ---------- Sub-component for AI message content ----------
const AIMessageContent = memo(({ text }) => {
  const content = safeString(text);

  return (
    <div className="ai-response">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Elements covered by .ai-response – just render default tags
          h1: ({ node, ...props }) => <h1 {...props} />,
          h2: ({ node, ...props }) => <h2 {...props} />,
          h3: ({ node, ...props }) => <h3 {...props} />,
          p: ({ node, ...props }) => <p {...props} />,
          ul: ({ node, ...props }) => <ul {...props} />,
          ol: ({ node, ...props }) => <ol {...props} />,
          li: ({ node, ...props }) => <li {...props} />,
          strong: ({ node, ...props }) => <strong {...props} />,

          // Inline code – uses .ai-response code styling
          code: ({ node, inline, className, children, ...props }) => {
            if (inline) {
              return <code className={className} {...props}>{children}</code>;
            }
            // Block code: wrap in <pre> with extra styles
            return (
              <pre style={extraStyles.pre}>
                <code
                  className={className}
                  style={{
                    fontSize: '14px',
                    lineHeight: 1.55,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  }}
                  {...props}
                >
                  {children}
                </code>
              </pre>
            );
          },

          // Elements NOT covered by .ai-response – apply extra inline styles
          h4: ({ node, ...props }) => <h4 style={extraStyles.h4} {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote style={extraStyles.blockquote} {...props} />
          ),
          a: ({ node, ...props }) => (
            <a
              style={extraStyles.a}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          hr: ({ node, ...props }) => <hr style={extraStyles.hr} {...props} />,
          table: ({ node, ...props }) => (
            <div style={extraStyles.tableWrapper}>
              <table style={extraStyles.table} {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th style={extraStyles.th} {...props} />,
          td: ({ node, ...props }) => <td style={extraStyles.td} {...props} />,
          del: ({ node, ...props }) => <del style={extraStyles.del} {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

AIMessageContent.displayName = 'AIMessageContent';

// ---------- Main Component ----------
const ChatMessages = memo(
  ({ messages, loading, error, onStop, onCopy, onRegenerate }) => {
    const containerRef = useRef(null);
    const endRef = useRef(null);
    const isNearBottomRef = useRef(true);

    // Inject keyframes once
    useEffect(() => {
      if (!document.getElementById('sb-bounce-style')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'sb-bounce-style';
        styleTag.textContent = loadingKeyframes;
        document.head.appendChild(styleTag);
      }
    }, []);

    // Scroll logic
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

    const handleCopy = useCallback(
      (text) => {
        onCopy?.(safeString(text));
      },
      [onCopy]
    );

    const handleRegenerate = useCallback(
      (msgId) => {
        onRegenerate?.(msgId);
      },
      [onRegenerate]
    );

    const renderMessage = (msg, index) => {
      const key = msg.id || index;
      const isUser = msg.role === 'user';
      const textContent = isUser ? msg.text : safeString(msg.text);

      return (
        <div key={key} style={{ position: 'relative', minWidth: 0 }}>
          <Bubble isUser={isUser}>
            {isUser ? textContent : <AIMessageContent text={msg.text} />}
          </Bubble>

          {!isUser && !loading && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                marginTop: '5px',
                paddingLeft: '32px',
                alignItems: 'center',
              }}
            >
              <button
                onClick={() => handleCopy(msg.text)}
                aria-label="Copy message"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '12px',
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '6px 4px',
                  borderRadius: '6px',
                  minHeight: '32px',
                }}
              >
                📋 Copy
              </button>
              <button
                onClick={() => handleRegenerate(msg.id || index)}
                aria-label="Regenerate response"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '12px',
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '6px 4px',
                  borderRadius: '6px',
                  minHeight: '32px',
                }}
              >
                🔄 Regenerate
              </button>
            </div>
          )}
        </div>
      );
    };

    return (
      <>
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {messages.map(renderMessage)}

          {loading && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'flex-end',
                alignSelf: 'flex-start',
              }}
            >
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg,#3b82f6,#60a5fa)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '13px',
                  marginBottom: '2px',
                }}
              >
                🎓
              </div>
              <div
                style={{
                  padding: '11px 14px',
                  background: '#fff',
                  borderRadius: '16px 16px 16px 4px',
                  border: '1px solid #e8edf8',
                  boxShadow: '0 1px 4px rgba(60,100,200,0.09)',
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center',
                }}
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#93c5fd',
                      animation: `sb-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                fontSize: '12px',
                lineHeight: 1.45,
                color: '#dc2626',
                textAlign: 'center',
                padding: '8px 10px',
                background: '#fff0f0',
                borderRadius: '8px',
                border: '1px solid #fca5a5',
              }}
            >
              {error}
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={onStop}
                aria-label="Stop generating"
                style={{
                  marginTop: '8px',
                  padding: '7px 16px',
                  minHeight: '34px',
                  borderRadius: '12px',
                  border: '1px solid #d1daf0',
                  background: '#fff',
                  color: '#3b82f6',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                ⏹ Stop generating
              </button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </>
    );
  }
);

ChatMessages.displayName = 'ChatMessages';

export default ChatMessages;