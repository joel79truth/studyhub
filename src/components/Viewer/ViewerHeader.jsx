import { ArrowLeft, Search, Sparkles } from 'lucide-react'
import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { saveFileOffline, getOfflineFile } from "../../utils/offlineStorage";

// ─── usePress (unchanged) ──────────────────────────────────
function usePress() {
  const [pressed, setPressed] = useState(false)
  const handlers = {
    onPointerDown:  () => setPressed(true),
    onPointerUp:    () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    onPointerCancel:() => setPressed(false),
  }
  return [pressed, handlers]
}

// ─── Download → store in shared offline cache → return blob URL ──
// Uses the same saveFileOffline/getOfflineFile as useFileLoader, keyed
// by fileId, so a save here is immediately visible to the viewer's
// cache-first load path — previously these were two separate stores
// that never saw each other's data.
async function downloadAndStore(url, filename, fileId, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const total    = parseInt(res.headers.get('Content-Length') || '0', 10)
  const reader   = res.body.getReader()
  const chunks   = []
  let   received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(total > 0 ? Math.round((received / total) * 100) : -1)
  }

  const blob = new Blob(chunks)
  await saveFileOffline(fileId, blob, { name: filename })

  return URL.createObjectURL(blob)
}

// ─── Confetti (memoised) ──────────────────────────────────
// Fixed: useMemo now runs unconditionally before the early return, so
// hook call order can never differ between renders (Rules of Hooks).
const ConfettiBurst = memo(({ active }) => {
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#a78bfa']
  const pieces = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * 360
      const dist  = 20 + Math.random() * 16
      const size  = 4 + Math.random() * 3
      const rad   = (angle * Math.PI) / 180
      return {
        tx: Math.cos(rad) * dist,
        ty: Math.sin(rad) * dist,
        size,
        color: colors[i % colors.length],
        delay: i * 28,
      }
    }), [active]
  )

  if (!active) return null

  return (
    <span className="confetti-container" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {pieces.map((p, i) => (
        <span key={i} className="confetti-piece" style={{
          position: 'absolute',
          width: p.size, height: p.size,
          borderRadius: '50%', background: p.color,
          animation: `confettiFly 0.6s cubic-bezier(0.22,1,0.36,1) ${p.delay}ms both`,
          '--tx': `${p.tx}px`, '--ty': `${p.ty}px`,
        }} />
      ))}
    </span>
  )
})

// ─── Progress ring (simplified) ──────────────────────────
const ProgressRing = memo(({ progress, size = 28, stroke = 2.5 }) => {
  const r      = (size - stroke * 2) / 2
  const circ   = 2 * Math.PI * r
  const offset = circ - (Math.max(0, Math.min(100, progress)) / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#dbeafe" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="url(#ringGrad)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.22s ease' }}
      />
    </svg>
  )
})

// ─── Indeterminate spinner (memo) ─────────────────────────
const IndetermRing = memo(({ size = 28, stroke = 2.5 }) => {
  const r    = (size - stroke * 2) / 2
  const circ = 2 * Math.PI * r
  return (
    <svg width={size} height={size} style={{ animation: 'indetermSpin 0.85s linear infinite', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ringGradIndet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#dbeafe" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="url(#ringGradIndet)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ}
        strokeDashoffset={circ * 0.72}
      />
    </svg>
  )
})

// ─── SaveOfflineButton (optimised) ────────────────────────
// Now keyed by fileId (shared with useFileLoader's cache), not filename.
const SaveOfflineButton = memo(({ fileUrl, filename, fileId, isOffline, onOfflineReady }) => {
  const [phase,      setPhase]      = useState('idle')
  const [progress,   setProgress]   = useState(0)
  const [indetermin, setIndetermin] = useState(false)
  const [pressed,    pressHandlers] = usePress()
  const [hovered,    setHovered]    = useState(false)

  const mountedRef = useRef(true)
  const timeoutRef = useRef(null)

  // Combined check on mount – get blob URL if already cached
  useEffect(() => {
    if (!fileId) return

    mountedRef.current = true

    if (isOffline) {
      setPhase('success')
    }

    getOfflineFile(fileId).then(record => {
      if (!mountedRef.current) return
      if (record?.blob) {
        setPhase('success')
        onOfflineReady?.(URL.createObjectURL(record.blob))
      }
    }).catch(() => {})

    return () => { mountedRef.current = false }
  }, [fileId, isOffline]) // eslint-disable-line

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleClick = useCallback(async () => {
    if (phase === 'downloading' || phase === 'success') return
    if (!fileId || !fileUrl) return
    setPhase('downloading')
    setProgress(0)
    setIndetermin(false)

    try {
      const blobUrl = await downloadAndStore(fileUrl, filename, fileId, pct => {
        if (!mountedRef.current) return
        if (pct === -1) setIndetermin(true)
        else { setIndetermin(false); setProgress(pct) }
      })
      if (!mountedRef.current) return
      setProgress(100)
      setPhase('success')
      onOfflineReady?.(blobUrl)
    } catch {
      if (!mountedRef.current) return
      setPhase('error')
      timeoutRef.current = setTimeout(() => {
        if (mountedRef.current) setPhase('idle')
      }, 2200)
    }
  }, [phase, fileUrl, filename, fileId, onOfflineReady])

  // Memoise button styles
  const buttonStyle = useMemo(() => {
    const isDownloading = phase === 'downloading'
    const isSuccess     = phase === 'success'
    const isError       = phase === 'error'

    return {
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      padding: '7px 13px', borderRadius: 20,
      fontSize: 12, fontWeight: 600,
      cursor: isDownloading || isSuccess ? 'default' : 'pointer',
      overflow: 'visible', whiteSpace: 'nowrap',
      flexShrink: 0, userSelect: 'none',
      border: isDownloading ? '1.5px solid #bfdbfe'
            : isSuccess     ? '1.5px solid #86efac'
            : isError       ? '1.5px solid #fca5a5'
            : hovered       ? '1.5px solid #94a3b8'
            :                 '1.5px solid #e2e8f0',
      background: isDownloading ? '#eff6ff'
                : isSuccess     ? '#f0fdf4'
                : isError       ? '#fff1f2'
                : hovered       ? '#f1f5f9'
                :                 '#f8fafc',
      color: isDownloading ? '#3b82f6'
           : isSuccess     ? '#16a34a'
           : isError       ? '#dc2626'
           : hovered       ? '#374151'
           :                 '#6b7280',
      transform: pressed && !isDownloading && !isSuccess
        ? 'scale(0.91)'
        : hovered && !isDownloading && !isSuccess
          ? 'scale(1.04)'
          : 'scale(1)',
      animation: isError ? 'errorShakeOff 0.45s ease both' : 'none',
      transition: pressed
        ? 'transform 0.08s ease, background 0.1s ease, border-color 0.1s ease, color 0.1s ease'
        : 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
      boxShadow: isSuccess && !pressed ? '0 2px 10px rgba(22,163,74,.18)' : 'none',
      willChange: 'transform',
    }
  }, [phase, hovered, pressed])

  const isDownloading = phase === 'downloading'
  const isSuccess     = phase === 'success'
  const isError       = phase === 'error'

  return (
    <button
      onClick={handleClick}
      {...pressHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={buttonStyle}
      aria-label={
        isDownloading ? `Downloading ${progress}%`
        : isSuccess   ? 'Saved to device'
        : isError     ? 'Download failed — tap to retry'
        :               'Download and save to device'
      }
    >
      {isDownloading ? (
        indetermin ? <IndetermRing /> : (
          <>
            <ProgressRing progress={progress} />
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#3b82f6', minWidth: 28, textAlign: 'right' }}>
              {progress}%
            </span>
          </>
        )
      ) : isSuccess ? (
        <>
          <span style={{
            display: 'flex', position: 'relative',
            animation: 'successPop 0.42s cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M3 7.5L6.5 11L12 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <ConfettiBurst active />
          </span>
          <span className="save-label">Saved!</span>
        </>
      ) : isError ? (
        <>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="save-label">Failed</span>
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v8M4 6.5L7 9.5l3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="save-label">Save</span>
        </>
      )}
    </button>
  )
})

// ─── Icon button (memo) ──────────────────────────────────
const IconBtn = memo(({ onClick, 'aria-label': label, children }) => {
  const [pressed, pressHandlers] = usePress()
  const [hovered, setHovered]    = useState(false)

  const style = useMemo(() => ({
    width: 36, height: 36, borderRadius: '50%', border: 'none',
    background: pressed ? '#dde3ed' : hovered ? '#e2e8f0' : '#f1f5f9',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', flexShrink: 0,
    transform: pressed ? 'scale(0.87)' : hovered ? 'scale(1.07)' : 'scale(1)',
    transition: pressed
      ? 'transform 0.08s ease, background 0.08s ease'
      : 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1), background 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
    willChange: 'transform',
  }), [pressed, hovered])

  return (
    <button
      onClick={onClick}
      {...pressHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      style={style}
    >
      {children}
    </button>
  )
})

// ─── Luna button (memo) ──────────────────────────────────
const LunaBtn = memo(({ onClick }) => {
  const [pressed, pressHandlers] = usePress()
  const [hovered, setHovered]    = useState(false)

  const style = useMemo(() => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 24,
    background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)',
    fontSize: 13, fontWeight: 700, color: '#fff',
    border: 'none', cursor: 'pointer', flexShrink: 0,
    boxShadow: pressed
      ? '0 1px 6px rgba(29,78,216,.25)'
      : hovered
        ? '0 4px 22px rgba(29,78,216,.55)'
        : '0 2px 14px rgba(29,78,216,.38)',
    transform: pressed ? 'scale(0.92)' : hovered ? 'scale(1.04)' : 'scale(1)',
    animation: 'gentlePulse 3s ease-in-out infinite',
    transition: pressed
      ? 'transform 0.08s ease, box-shadow 0.08s ease'
      : 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease',
    whiteSpace: 'nowrap',
    WebkitTapHighlightColor: 'transparent',
    willChange: 'transform',
  }), [pressed, hovered])

  return (
    <button
      onClick={onClick}
      {...pressHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Ask Luna AI"
      style={style}
    >
      <span style={{ position: 'relative', display: 'inline-flex', width: 15, height: 15, alignItems: 'center', justifyContent: 'center' }}>
        <Search size={14} color="#fff" strokeWidth={2.5} />
        <Sparkles size={8} color="#fde047" fill="#fde047" style={{ position: 'absolute', bottom: -2, right: -3, filter: 'drop-shadow(0 0 3px rgba(253,224,71,.5))' }} />
      </span>
      <span className="luna-label">Ask Luna</span>
    </button>
  )
})

// ─── CSS (unchanged, but moved to a separate file if possible) ─
const HEADER_CSS = `
  @keyframes confettiFly {
    0%   { transform: translate(0,0) scale(1); opacity: 1; }
    100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
  }
  @keyframes successPop {
    0%   { transform: scale(0.5); opacity: 0; }
    55%  { transform: scale(1.4); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes errorShakeOff {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-5px); }
    40%     { transform: translateX(5px); }
    60%     { transform: translateX(-4px); }
    80%     { transform: translateX(4px); }
  }
  @keyframes indetermSpin {
    to { transform: rotate(360deg); }
  }
  @keyframes gentlePulse {
    0%,100% { box-shadow: 0 2px 14px rgba(29,78,216,.38); }
    50%     { box-shadow: 0 2px 24px rgba(29,78,216,.62); }
  }
  @keyframes headerSlideDown {
    from { transform: translateY(-100%); opacity: 0; }
    to   { transform: translateY(0);     opacity: 1; }
  }

  .viewer-header {
    display: flex; align-items: center; justify-content: space-between;
    height: 56px; background: #fff;
    border-bottom: 1px solid #e8eaf0;
    flex-shrink: 0; z-index: 30; gap: 8px;
    padding: 0 max(12px, env(safe-area-inset-left, 12px))
             0 max(12px, env(safe-area-inset-right, 12px));
    animation: headerSlideDown 0.28s cubic-bezier(0.22,1,0.36,1) both;
    will-change: transform;
  }
  .header-left {
    display: flex; align-items: center; gap: 10px;
    min-width: 0; flex: 1;
  }
  .header-right {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  }
  .file-name {
    font-size: 14px; font-weight: 700; color: #111;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: min(38vw, 200px);
  }
  .file-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .file-badge {
    font-size: 10px; font-family: monospace; font-weight: 700;
    padding: 2px 5px; border-radius: 4px; flex-shrink: 0;
  }
  .progress-track {
    width: 48px; height: 4px; background: #e8eaf0;
    border-radius: 4px; overflow: hidden; flex-shrink: 0;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg,#3b82f6,#6366f1);
    border-radius: 4px;
    transition: width 0.32s cubic-bezier(0.4,0,0.2,1);
  }
  .page-count {
    font-size: 11px; color: #6b7280;
    font-variant-numeric: tabular-nums; flex-shrink: 0;
  }
  .save-label { display: inline; }
  .luna-label { display: inline; }

  @media (max-width: 400px) { .progress-track { width: 32px; } }
  @media (max-width: 360px) {
    .file-name  { max-width: 28vw; font-size: 13px; }
    .save-label { display: none; }
    .luna-label { display: none; }
  }
`

// ─── Main ViewerHeader ──────────────────────────────────
const ViewerHeader = memo(({
  filename     = 'document.pdf',
  fileType     = 'pdf',
  fileUrl,
  fileId,
  currentPage,
  numPages,
  isOffline,
  onAskLuna,
  onBack,
  onOfflineReady,
}) => {
  const progress = numPages > 0 ? (currentPage / numPages) * 100 : 0

  // Infer file type from filename if not provided
  const displayType = useMemo(() => {
    if (fileType) return fileType
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') return 'pdf'
    if (['doc', 'docx'].includes(ext)) return 'doc'
    if (['ppt', 'pptx'].includes(ext)) return 'ppt'
    if (['xls', 'xlsx'].includes(ext)) return 'xls'
    if (['epub'].includes(ext)) return 'epub'
    return 'file'
  }, [fileType, filename])

  const badgeColor = useMemo(() => {
    switch (displayType) {
      case 'pdf':  return { bg: '#fee2e2', text: '#dc2626' }
      case 'doc':  return { bg: '#dbeafe', text: '#2563eb' }
      case 'ppt':  return { bg: '#ffedd5', text: '#c2410c' }
      case 'xls':  return { bg: '#dcfce7', text: '#16a34a' }
      case 'epub': return { bg: '#fae8ff', text: '#a855f7' }
      default:     return { bg: '#f1f5f9', text: '#64748b' }
    }
  }, [displayType])

  return (
    <>
      <style>{HEADER_CSS}</style>
      <header className="viewer-header">
        <div className="header-left">
          <IconBtn onClick={onBack} aria-label="Go back">
            <ArrowLeft size={18} color="#374151" />
          </IconBtn>
          <div style={{ minWidth: 0 }}>
            <div className="file-name">{filename}</div>
            <div className="file-meta">
              <span className="file-badge" style={{
                background: badgeColor.bg,
                color:      badgeColor.text,
              }}>
                {displayType.toUpperCase()}
              </span>
              {displayType === 'pdf' && numPages > 0 && (
                <>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="page-count">{currentPage}/{numPages}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="header-right">
          <SaveOfflineButton
            fileUrl={fileUrl}
            filename={filename}
            fileId={fileId}
            isOffline={isOffline}
            onOfflineReady={onOfflineReady}
          />
          <LunaBtn onClick={onAskLuna} />
        </div>
      </header>
    </>
  )
})

export default ViewerHeader