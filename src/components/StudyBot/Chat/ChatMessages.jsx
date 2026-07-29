// components/StudyBot/Chat/ChatMessages.js
import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Bubble from './Bubble';

/**
 * Ensure the content passed to ReactMarkdown is a string.
 * If it's an object (like {token: "..."}), extract the token string,
 * otherwise convert to string or fallback to empty.
 */
function safeString(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && content.token) return content.token;
  if (content === undefined || content === null) return '';
  return String(content);
}

export default function ChatMessages({
  messages,
  loading,
  error,
  onStop,
  onCopy,
  onRegenerate,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadingAnimation = `
    @keyframes sb-bounce {
      0%,80%,100%{transform:translateY(0)}
      40%{transform:translateY(-5px)}
    }
  `;

  const markdownStyles = {
    h1: { fontSize: '1.4em', margin: '10px 0 6px', fontWeight: 700 },
    h2: { fontSize: '1.2em', margin: '8px 0 4px', fontWeight: 700 },
    h3: { fontSize: '1.1em', margin: '6px 0 3px', fontWeight: 600 },
    p: { margin: '4px 0' },
    ul: { paddingLeft: '20px', margin: '4px 0' },
    ol: { paddingLeft: '20px', margin: '4px 0' },
    li: { marginBottom: '2px' },
    code: {
      background: '#f1f5f9',
      padding: '1px 4px',
      borderRadius: '4px',
      fontSize: '0.9em',
    },
    pre: {
      background: '#f1f5f9',
      padding: '10px',
      borderRadius: '8px',
      overflowX: 'auto',
      margin: '6px 0',
    },
    blockquote: {
      borderLeft: '3px solid #93c5fd',
      paddingLeft: '12px',
      color: '#475569',
      margin: '6px 0',
    },
  };

  return (
    <>
      <style>{loadingAnimation}</style>
      <div
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
        {messages.map((msg, index) => {
          const key = msg.id || index;
          const isUser = msg.role === 'user';
          const textContent = isUser ? msg.text : safeString(msg.text);

          return (
            <div key={key} style={{ position: 'relative' }}>
              <Bubble isUser={isUser}>
                {isUser ? (
                  textContent
                ) : (
                  <div style={{ fontSize: '0.95em' }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ node, ...props }) => (
                          <h1 style={markdownStyles.h1} {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 style={markdownStyles.h2} {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 style={markdownStyles.h3} {...props} />
                        ),
                        p: ({ node, ...props }) => (
                          <p style={markdownStyles.p} {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul style={markdownStyles.ul} {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol style={markdownStyles.ol} {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li style={markdownStyles.li} {...props} />
                        ),
                        code: ({ node, inline, ...props }) =>
                          inline ? (
                            <code style={markdownStyles.code} {...props} />
                          ) : (
                            <pre style={markdownStyles.pre}>
                              <code {...props} />
                            </pre>
                          ),
                        blockquote: ({ node, ...props }) => (
                          <blockquote
                            style={markdownStyles.blockquote}
                            {...props}
                          />
                        ),
                      }}
                    >
                      {textContent}
                    </ReactMarkdown>
                  </div>
                )}
              </Bubble>

              {!isUser && !loading && (
                <div
                  style={{
                    display: 'flex',
                    gap: '4px',
                    marginTop: '4px',
                    paddingLeft: '32px',
                  }}
                >
                  <button
                    onClick={() => onCopy(msg.text)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6b7db3',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={onRegenerate}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6b7db3',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Regenerate
                  </button>
                </div>
              )}
            </div>
          );
        })}

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

        {error && (
          <div
            style={{
              fontSize: '12px',
              color: '#ef4444',
              textAlign: 'center',
              padding: '7px 10px',
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
              style={{
                marginTop: '8px',
                padding: '6px 16px',
                borderRadius: '12px',
                border: '1px solid #d1daf0',
                background: '#fff',
                color: '#3b82f6',
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