import { Search, HardDriveDownload, FileDown, FileSearch } from 'lucide-react';

// Each real stage the Viewer can be in, with its own icon + message —
// no generic "just a moment" that's the same whether it's instant or
// stuck for 30s on a bad connection.
const STAGE_CONTENT = {
  lookup:           { icon: Search,            message: 'Looking up your document…' },
  'checking-cache': { icon: HardDriveDownload, message: 'Checking for an offline copy…' },
  downloading:      { icon: FileDown,          message: 'Downloading document…' },
  opening:          { icon: FileSearch,        message: 'Opening document…' },
};

/**
 * @param stage    'lookup' | 'checking-cache' | 'downloading' | 'opening'
 * @param progress number 0-100 (determinate bar) | 'indeterminate' | null
 */
export default function LoadingScreen({ stage = 'lookup', progress = null }) {
  const { icon: Icon, message } = STAGE_CONTENT[stage] || STAGE_CONTENT.lookup;
  const isDeterminate = typeof progress === 'number';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: '0 32px' }}>
      <Icon size={40} color="#1d4ed8" style={{ marginBottom: 20 }} />

      <div style={{ width: '100%', maxWidth: 280 }}>
        <div style={{ position: 'relative', height: 6, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
          {isDeterminate ? (
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: '#1d4ed8',
                borderRadius: 999,
                transition: 'width 0.25s ease-out',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: '40%',
                background: '#1d4ed8',
                borderRadius: 999,
                animation: 'lsIndeterminate 1.2s ease-in-out infinite',
              }}
            />
          )}
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 15, fontWeight: 600, color: '#374151', textAlign: 'center' }}>
        {message}{isDeterminate && stage === 'downloading' ? ` — ${progress}%` : ''}
      </p>
      <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
        {stage === 'downloading' && !isDeterminate
          ? 'This may take a moment on a slow connection'
          : 'Just a moment ✨'}
      </p>

      <style>{`
        @keyframes lsIndeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}