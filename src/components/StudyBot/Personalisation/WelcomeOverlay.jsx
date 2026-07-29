import { useState, useContext } from 'react';
import { UserContext } from '../../../context/UserContext';

export default function WelcomeOverlay({ onFinish }) {
  const { user, updateUser } = useContext(UserContext);
  const [name, setName] = useState(user.name || '');
  const [subject, setSubject] = useState(user.subject || '');
  const [error, setError] = useState('');

  if (user.hasCompletedOnboarding) return null;

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }
    updateUser({ name: trimmedName, subject: subject.trim(), hasCompletedOnboarding: true });
    onFinish?.();
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(248,250,255,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', zIndex: 20, backdropFilter: 'blur(6px)'
    }}>
      <div style={{
        background: '#fff', borderRadius: '22px', padding: '28px 24px 24px',
        width: '100%', maxWidth: '340px',
        boxShadow: '0 8px 36px rgba(59,130,246,0.13)',
        border: '1px solid #e8edf8',
        display: 'flex', flexDirection: 'column', gap: '14px'
      }}>
        <div style={{ textAlign: 'center', fontSize: '32px' }}>🎓</div>
        <p style={{ fontSize: '18px', fontWeight: '700', color: '#1e2d5a', margin: 0, textAlign: 'center' }}>
          Welcome! I’m StudyBot.
        </p>
        <p style={{ fontSize: '13px', color: '#6b7db3', textAlign: 'center', lineHeight: 1.55, margin: 0 }}>
          Tell me your name so I can personalise your study experience.
        </p>
        <input
          placeholder="Your name"
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          autoFocus
          style={{
            padding: '11px 14px', borderRadius: '12px', border: '1.5px solid #d1daf0',
            background: '#f4f7ff', fontSize: '14px', color: '#1e2d5a',
            outline: 'none', width: '100%', boxSizing: 'border-box',
            fontFamily: 'inherit'
          }}
        />
        <input
          placeholder="Favourite subject (optional)"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          style={{
            padding: '11px 14px', borderRadius: '12px', border: '1.5px solid #d1daf0',
            background: '#f4f7ff', fontSize: '14px', color: '#1e2d5a',
            outline: 'none', width: '100%', boxSizing: 'border-box',
            fontFamily: 'inherit'
          }}
        />
        {error && (
          <div style={{ fontSize:'12px', color:'#ef4444', textAlign:'center', padding:'7px 10px', background:'#fff0f0', borderRadius:'8px', border:'1px solid #fca5a5' }}>
            {error}
          </div>
        )}
        <button onClick={handleSave}
          style={{
            padding: '12px', borderRadius: '12px',
            background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
            color: '#fff', border: 'none', fontSize: '14px', fontWeight: '700',
            cursor: 'pointer', boxShadow: '0 2px 10px rgba(59,130,246,0.3)',
            width: '100%'
          }}>
          Start Learning 🚀
        </button>
      </div>
    </div>
  );
}