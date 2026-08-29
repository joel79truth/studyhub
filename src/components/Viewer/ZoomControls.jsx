import { ZoomIn, ZoomOut } from 'lucide-react';

export default function ZoomControls({ scale, onZoomIn, onZoomOut }) {
  return (
    <div style={{
      position: 'fixed', bottom: 32, right: 22,
      display: 'flex', flexDirection: 'column', gap: 8, zIndex: 20,
    }}>
      <button onClick={onZoomIn} style={zoomBtnStyle}><ZoomIn size={20} /></button>
      <button onClick={onZoomOut} style={zoomBtnStyle}><ZoomOut size={20} /></button>
      <span style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
        {Math.round(scale * 100)}%
      </span>
    </div>
  );
}

const zoomBtnStyle = {
  width: 44, height: 44, borderRadius: '50%',
  background: '#fff', border: '1px solid #e2e8f0',
  boxShadow: '0 4px 16px rgba(0,0,0,.1)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
};