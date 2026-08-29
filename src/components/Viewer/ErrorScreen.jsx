import { AlertCircle, RefreshCw } from 'lucide-react';

export default function ErrorScreen({ message, onRetry, onBack }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: 24, textAlign: 'center' }}>
      <AlertCircle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111318' }}>Unable to load document</h2>
      <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 380, lineHeight: 1.6, marginBottom: 24 }}>{message}</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={onBack} style={btnStyle('#111318', '#fff')}>Go Back</button>
        <button onClick={onRetry} style={btnStyle('#f1f5f9', '#374151')}><RefreshCw size={16} style={{ marginRight: 6 }} /> Retry</button>
      </div>
    </div>
  );
}

const btnStyle = (bg, color) => ({
  padding: '10px 24px', borderRadius: 12, border: 'none',
  background: bg, color, fontSize: 14, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
});