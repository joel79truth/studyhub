// components/StudyBot/Header/Header.js
import { useContext } from 'react';
import { UserContext } from '../../../context/UserContext';

export default function Header({ loading, onNewChat, onToggleSidebar }) {
  const { user } = useContext(UserContext);
  const greeting = user?.name ? ` · Hi, ${user.name}` : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '14px 16px 12px', background: '#fff',
      borderBottom: '1px solid #e8edf8',
      boxShadow: '0 1px 6px rgba(60,100,200,0.07)',
      flexShrink: 0, zIndex: 10,
    }}>
      <button
        onClick={onToggleSidebar}
        style={{
          background: 'none', border: 'none', fontSize: '20px',
          cursor: 'pointer', marginRight: '4px', color: '#3b82f6',
          padding: '4px 6px', lineHeight: 1,
        }}
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      {/* AI avatar */}
      <div style={{
        width: '38px', height: '38px', borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <img
          src="/images/Ai.png"   // served from public/images
          alt="AI Tutor"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '15px', fontWeight: '700', color: '#1e2d5a', margin: 0, lineHeight: 1.2 }}>
          StudyBot{greeting}
        </p>
        <span style={{ fontSize: '11px', color: '#6b7db3', marginTop: '2px', display: 'block' }}>
          {loading ? '✦ thinking...' : 'Your AI university tutor'}
        </span>
      </div>

      <button
        onClick={onNewChat}
        style={{
          background: 'none', border: '1px solid #d1daf0', borderRadius: '8px',
          padding: '5px 10px', fontSize: '11px', color: '#3b82f6',
          cursor: 'pointer', fontWeight: '600',
        }}
        aria-label="Start new chat"
      >
        New
      </button>
    </div>
  );
}