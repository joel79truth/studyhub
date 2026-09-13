import { ZoomIn, ZoomOut } from 'lucide-react';

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

export default function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
}) {
  const atMin = scale <= minScale;
  const atMax = scale >= maxScale;

  return (
    <div
      role="group"
      aria-label="Zoom controls"
      style={{
        position: 'fixed', bottom: 32, right: 22,
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 20,
      }}
    >
      <button
        onClick={onZoomIn}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in"
        style={{ ...zoomBtnStyle, ...(atMax ? zoomBtnDisabledStyle : null) }}
      >
        <ZoomIn size={20} />
      </button>
      <button
        onClick={onZoomOut}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out"
        style={{ ...zoomBtnStyle, ...(atMin ? zoomBtnDisabledStyle : null) }}
      >
        <ZoomOut size={20} />
      </button>
      <button
        onClick={onZoomReset}
        aria-label={`Reset zoom to 100%, currently ${Math.round(scale * 100)}%`}
        title="Reset zoom"
        style={{
          textAlign: 'center', fontSize: 10, color: '#6b7280', fontFamily: 'monospace',
          background: 'transparent', border: 'none', cursor: onZoomReset ? 'pointer' : 'default',
          padding: '2px 0',
        }}
      >
        {Math.round(scale * 100)}%
      </button>
    </div>
  );
}

const zoomBtnStyle = {
  width: 44, height: 44, borderRadius: '50%',
  background: '#fff', border: '1px solid #e2e8f0',
  boxShadow: '0 4px 16px rgba(0,0,0,.1)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#374151',
  transition: 'box-shadow .15s ease, transform .1s ease',
};

const zoomBtnDisabledStyle = {
  opacity: 0.4,
  cursor: 'default',
  boxShadow: 'none',
};