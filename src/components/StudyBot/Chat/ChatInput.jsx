// components/StudyBot/Chat/ChatInput.js
import { useRef, useState } from 'react';

export default function ChatInput({ onSend, loading, onStop, hasKey = true }) {
  const [input, setInput] = useState('');
  const taRef = useRef(null);

  const resize = (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    setInput(e.target.value);
  };

  const handleSend = () => {
    if (!input.trim() || loading || !hasKey) return;
    onSend(input.trim());
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = !loading && input.trim().length > 0 && hasKey;

  return (
    <div style={{ padding:'10px 12px 12px', background:'#fff', borderTop:'1px solid #e8edf8', display:'flex', gap:'8px', alignItems:'flex-end', flexShrink:0 }}>
      <textarea
        ref={taRef}
        value={input}
        onChange={resize}
        onKeyDown={onKey}
        placeholder={hasKey ? 'Ask anything about your studies…' : 'Add your Gemini API key to start…'}
        rows={1}
        disabled={loading || !hasKey}
        aria-label="Chat message input"
        style={{ flex:1, padding:'10px 13px', borderRadius:'20px', border:'1.5px solid #d1daf0', background:'#f4f7ff', fontSize:'14px', color:'#1e2d5a', resize:'none', outline:'none', maxHeight:'120px', lineHeight:'1.5', fontFamily:'inherit', minHeight:'40px', overflowY:'auto', boxSizing:'border-box' }}
      />
      {loading ? (
        <button onClick={onStop} aria-label="Stop"
          style={{ width:'40px', height:'40px', borderRadius:'50%', background:'#f43f5e', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, boxShadow:'0 2px 10px rgba(244,63,94,0.3)' }}>
          <div style={{ width: 12, height: 12, background: '#fff', borderRadius: 2 }} />
        </button>
      ) : (
        <button onClick={handleSend} disabled={!canSend} aria-label="Send"
          style={{ width:'40px', height:'40px', borderRadius:'50%', background: canSend ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#dde5f5', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor: canSend ? 'pointer' : 'default', flexShrink:0, boxShadow: canSend ? '0 2px 10px rgba(59,130,246,0.32)' : 'none', transition:'all 0.15s' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}