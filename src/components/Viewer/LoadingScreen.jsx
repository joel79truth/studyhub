import { Loader2 } from 'lucide-react';

export default function LoadingScreen() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
      <Loader2 size={48} color="#1d4ed8" style={{ animation: 'spin 1s linear infinite' }} />
      <p style={{ marginTop: 20, fontSize: 16, fontWeight: 600, color: '#374151' }}>Preparing your material</p>
      <p style={{ fontSize: 13, color: '#9ca3af' }}>Just a moment ✨</p>
    </div>
  );
}