import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  Loader2,
  X,
  Sparkles,
  Send,
  BookOpen,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  Download,
  CheckCircle,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../supabase';
import { saveFileOffline, getOfflineFile, deleteOfflineFile } from '../utils/offlineStorage';

// ─── pdfjs worker ─────────────────────────────────────────────────────────────
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ─── Keyframe animations ──────────────────────────────────────────────────────
const STYLES = `
@keyframes lunaIdle   { 0%,100%{transform:scale(1) rotate(0deg);opacity:.9} 50%{transform:scale(1.12) rotate(5deg);opacity:1} }
@keyframes lunaThink  { 0%,100%{transform:translateY(0)} 33%{transform:translateY(-4px)} 66%{transform:translateY(2px)} }
@keyframes lunaReply  { 0%,100%{transform:scale(1);filter:drop-shadow(0 0 0px #3b82f6)} 50%{transform:scale(1.2);filter:drop-shadow(0 0 8px #3b82f6)} }
@keyframes lunaHappy  { 0%{transform:scale(1) rotate(0deg)} 25%{transform:scale(1.25) rotate(-10deg)} 50%{transform:scale(1.3) rotate(10deg)} 75%{transform:scale(1.15) rotate(-5deg)} 100%{transform:scale(1) rotate(0deg)} }
@keyframes fadeUp     { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes popIn      { 0%{transform:scale(.6);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
@keyframes starBurst  { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0} }
@keyframes breathe    { 0%,100%{box-shadow:0 2px 12px rgba(29,78,216,.35)} 50%{box-shadow:0 2px 12px rgba(29,78,216,.35),0 0 0 8px rgba(59,130,246,.15)} }
@keyframes shake      { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-4px)} 40%{transform:translateX(4px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes slideUp    { from{transform:translateY(100%)} to{transform:translateY(0)} }
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes spin       { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes progressBar{ 0%{background-position:200% 0} 100%{background-position:-200% 0} }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};

const getProxiedUrl = (rawUrl) => {
  if (!rawUrl) return rawUrl;
  const isExternal =
    rawUrl.includes('drive.google.com') || rawUrl.includes('supabase.co');
  if (isExternal) {
    const direct = rawUrl.replace(
      /drive\.google\.com\/file\/d\/([^/]+)\/view/,
      'drive.google.com/uc?export=download&id=$1'
    );
    return `/api/file-proxy?url=${encodeURIComponent(direct)}`;
  }
  return rawUrl;
};

// ─── Emotional design sub-components ─────────────────────────────────────────

const LunaOrb = ({ mood = 'idle', size = 38 }) => {
  const anim = {
    idle:     'lunaIdle 3s ease-in-out infinite',
    thinking: 'lunaThink .8s ease-in-out infinite',
    replying: 'lunaReply 1s ease-in-out infinite',
    happy:    'lunaHappy .6s ease-in-out 1',
  };
  const color = {
    idle: '#3b82f6', thinking: '#8b5cf6', replying: '#06b6d4', happy: '#10b981',
  };
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `radial-gradient(circle at 35% 35%, ${color[mood]}dd, ${color[mood]}88)`,
      boxShadow: `0 2px 12px ${color[mood]}55`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: anim[mood],
      transition: 'background .4s, box-shadow .4s',
    }}>
      <Sparkles size={size * .45} color="#fff" fill="#fff" />
    </div>
  );
};

const ThinkingDots = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
    <div style={{ display: 'flex', gap: 4 }}>
      {[0, 150, 300].map((d) => (
        <span key={d} style={{
          width: 7, height: 7, borderRadius: '50%', background: '#3b82f6',
          display: 'inline-block', animation: `lunaThink .9s ease-in-out infinite`,
          animationDelay: `${d}ms`,
        }} />
      ))}
    </div>
    <span style={{ fontSize: 11.5, color: '#9ca3af', fontStyle: 'italic', fontFamily: 'monospace' }}>
      Luna is reasoning…
    </span>
  </div>
);

const CelebrationStars = () => (
  <div style={{ position: 'absolute', top: -8, right: -4, pointerEvents: 'none', zIndex: 10 }}>
    {[
      { tx: '-24px', ty: '-32px', color: '#fbbf24', d: '0ms' },
      { tx: '28px',  ty: '-28px', color: '#f472b6', d: '60ms' },
      { tx: '-30px', ty: '16px',  color: '#34d399', d: '30ms' },
      { tx: '32px',  ty: '20px',  color: '#60a5fa', d: '90ms' },
      { tx: '0px',   ty: '-38px', color: '#a78bfa', d: '15ms' },
    ].map((s, i) => (
      <span key={i} style={{
        position: 'absolute', fontSize: 10, color: s.color,
        '--tx': s.tx, '--ty': s.ty,
        animation: 'starBurst .7s ease-out forwards',
        animationDelay: s.d,
      }}>✦</span>
    ))}
  </div>
);

const PopButton = ({ children, onClick, disabled, style, className }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        setPressed(true);
        setTimeout(() => setPressed(false), 180);
        onClick?.(e);
      }}
      style={{
        transform: pressed ? 'scale(.88)' : 'scale(1)',
        transition: 'transform .15s cubic-bezier(.34,1.56,.64,1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', background: 'none', padding: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

// ─── Markdown-lite renderer ───────────────────────────────────────────────────
const renderInline = (text) => {
  const out = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} style={{ fontWeight: 700 }}>{m[1]}</strong>);
    if (m[2]) out.push(
      <code key={m.index} style={{
        background: '#f1f5f9', padding: '1px 5px', borderRadius: 3,
        fontFamily: 'monospace', fontSize: '.9em',
      }}>{m[2]}</code>
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
};

const MiniMarkdown = ({ content }) => (
  <div style={{ lineHeight: 1.7 }}>
    {content.split('\n').map((line, i) => {
      if (line.startsWith('> '))
        return (
          <blockquote key={i} style={{
            borderLeft: '3px solid #1d4ed8', paddingLeft: 12,
            margin: '8px 0', color: '#374151', fontStyle: 'italic',
          }}>
            <span style={{ fontSize: 13.5 }}>{renderInline(line.slice(2))}</span>
          </blockquote>
        );
      if (line === '') return <div key={i} style={{ height: 7 }} />;
      return (
        <p key={i} style={{ margin: '2px 0', fontSize: 13.5, color: '#374151' }}>
          {renderInline(line)}
        </p>
      );
    })}
  </div>
);

// ─── PDF Page renderer ────────────────────────────────────────────────────────
const PDFPage = memo(({ pdf, pageNum, scale, containerRef, onTextExtracted }) => {
  const canvasRef = useRef(null);
  const wrapRef   = useRef(null);
  const [visible, setVisible]     = useState(false);
  const extracted = useRef(false);
  const renderTask = useRef(null);
  const rendering  = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: '500px' }
    );
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf) return;
    let cancelled = false;

    const render = async () => {
      if (rendering.current && renderTask.current) {
        renderTask.current.cancel();
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;
      rendering.current = true;

      try {
        const page     = await pdf.getPage(pageNum);
        const base     = page.getViewport({ scale: 1 });
        const maxW     = Math.min(containerRef?.current?.clientWidth || window.innerWidth - 40, 900);
        const dynScale = (scale * maxW) / base.width;
        const vp       = page.getViewport({ scale: dynScale });
        const canvas   = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        const dpr = window.devicePixelRatio || 1;
        canvas.width        = vp.width  * dpr;
        canvas.height       = vp.height * dpr;
        canvas.style.width  = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        ctx.scale(dpr, dpr);

        const task = page.render({ canvasContext: ctx, viewport: vp });
        renderTask.current = task;
        await task.promise;

        if (!extracted.current && !cancelled) {
          const content = await page.getTextContent();
          onTextExtracted(pageNum, content.items.map((it) => it.str).join(' '));
          extracted.current = true;
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled)
          console.error(`Page ${pageNum}:`, err);
      } finally {
        if (!cancelled) rendering.current = false;
      }
    };

    render();
    return () => {
      cancelled = true;
      renderTask.current?.cancel();
      renderTask.current = null;
      rendering.current = false;
    };
  }, [visible, pdf, pageNum, scale, containerRef, onTextExtracted]);

  return (
    <div ref={wrapRef} className="shadow-2xl bg-white rounded-sm overflow-hidden">
      {visible
        ? <canvas ref={canvasRef} style={{ willChange: 'transform', display: 'block' }} />
        : <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
            <Loader2 size={28} color="#cbd5e1" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
      }
    </div>
  );
});
PDFPage.displayName = 'PDFPage';

// ─── PPTX Viewer ─────────────────────────────────────────────────────────────
const PPTXViewer = ({ url, scale }) => (
  <div style={{
    height: '100%',
    transform: `scale(${scale})`,
    transformOrigin: 'top center',
    transition: 'transform .2s',
  }}>
    <iframe
      src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="PPTX Viewer"
      allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    />
  </div>
);

// ─── Luna Chat Panel ──────────────────────────────────────────────────────────
const LunaChatPanel = ({
  messages, isLoading, input, setInput, sendMessage,
  currentPage, isTeachMode, setIsTeachMode,
  onClose, isFullscreen, toggleFullscreen,
  lunaMood, showCelebration,
}) => {
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const ACTIONS = [
    { label: 'Explain Simply',    prompt: 'Explain this page like I am a complete beginner.' },
    { label: 'Step-by-Step',      prompt: 'Break this page content into clear numbered steps.' },
    { label: 'Real-world Example', prompt: 'Give me a real-world practical example of this content.' },
    { label: 'Test Me',           prompt: 'Ask me one question to test my understanding of this page.' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, left: 0, right: 0, bottom: 0,
      top: isFullscreen ? 0 : 'auto',
      height: isFullscreen ? '100%' : '58vh',
      background: '#fff',
      borderRadius: isFullscreen ? 0 : '20px 20px 0 0',
      boxShadow: '0 -8px 48px rgba(0,0,0,.14)',
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
      animation: 'slideUp .3s cubic-bezier(.32,.72,0,1) both',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid #f1f5f9', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: '#f1f5f9', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer',
          }}>
            <X size={15} color="#64748b" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <LunaOrb mood={lunaMood} size={34} />
              {showCelebration && <CelebrationStars />}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#111318', lineHeight: 1 }}>Luna</div>
              <div style={{ fontSize: 10.5, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }}>
                {isTeachMode ? 'teach mode' : 'assist mode'} · page {currentPage}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setIsTeachMode(!isTeachMode)}
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
              border: `1px solid ${isTeachMode ? '#bfdbfe' : '#e2e8f0'}`,
              background: isTeachMode ? '#eff6ff' : '#f8fafc',
              color: isTeachMode ? '#1d4ed8' : '#64748b',
              cursor: 'pointer',
            }}
          >
            {isTeachMode ? 'Teach Me' : 'Assist'}
          </button>
          <button onClick={toggleFullscreen} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: '#f1f5f9', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer',
          }}>
            {isFullscreen ? <Minimize2 size={14} color="#64748b" /> : <Maximize2 size={14} color="#64748b" />}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '18px 18px 8px',
        display: 'flex', flexDirection: 'column', gap: 14,
        scrollbarWidth: 'none',
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '32px 0', animation: 'fadeUp .4s ease both',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', background: '#eff6ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <BookOpen size={22} color="#1d4ed8" />
            </div>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#111318', margin: 0 }}>
              Your Personal AI Tutor
            </p>
            <p style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 4, maxWidth: 240, lineHeight: 1.5, textAlign: 'center' }}>
              Ask me anything about the current page or use a quick shortcut below.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            animation: 'fadeUp .3s ease both',
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            position: 'relative',
          }}>
            {msg.role === 'user' ? (
              <div style={{
                maxWidth: '78%', background: '#1d4ed8', color: '#fff',
                borderRadius: '18px 18px 4px 18px', padding: '10px 14px',
                fontSize: 13.5, fontWeight: 500, lineHeight: 1.55,
                animation: 'popIn .25s cubic-bezier(.34,1.56,.64,1) both',
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{
                maxWidth: '92%', background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '4px 18px 18px 18px',
                padding: '12px 15px', position: 'relative',
              }}>
                <MiniMarkdown content={msg.content} />
                {msg.isStreaming && (
                  <span style={{
                    display: 'inline-block', width: 2, height: 14,
                    background: '#1d4ed8', marginLeft: 3, verticalAlign: 'middle',
                    animation: 'blink .8s step-end infinite',
                  }} />
                )}
                {i === messages.length - 1 && !msg.isStreaming && showCelebration && (
                  <CelebrationStars />
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && <div style={{ animation: 'fadeUp .25s ease both' }}><ThinkingDots /></div>}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 18px',
        overflowX: 'auto', background: '#f8fafc',
        borderTop: '1px solid #f1f5f9', flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {ACTIONS.map((a) => (
          <PopButton
            key={a.label}
            onClick={() => sendMessage(a.prompt)}
            style={{
              whiteSpace: 'nowrap', padding: '6px 14px', borderRadius: 20,
              border: '1px solid #e2e8f0', background: '#fff',
              fontSize: 12, fontWeight: 600, color: '#374151', flexShrink: 0,
            }}
          >
            {a.label}
          </PopButton>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#f1f5f9', borderRadius: 24,
            padding: '8px 8px 8px 16px',
            border: '1.5px solid transparent',
            transition: 'border-color .2s, background .2s',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.background = '#fff'; }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = '#f1f5f9'; }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={isTeachMode ? 'Ask your tutor…' : 'Ask Luna anything…'}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              outline: 'none', fontSize: 13.5, color: '#111318',
            }}
          />
          <PopButton
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: !input.trim() || isLoading ? '#e2e8f0' : '#1d4ed8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .2s',
            }}
          >
            <Send size={15} color={!input.trim() || isLoading ? '#9ca3af' : '#fff'} />
          </PopButton>
        </div>
      </div>
    </div>
  );
};

// ─── Main Viewer ──────────────────────────────────────────────────────────────
export default function Viewer() {
  const navigate = useNavigate();
  const { state } = useLocation();

  const filename = state?.filename || 'Document';
  const rawUrl   = state?.url      || null;
  const fileId   = state?.fileId   || null;
  const fileType = state?.fileType || null; // 'pdf' | 'pptx'
  const context  = state?.context  || {};

  const proxiedUrl = useMemo(() => getProxiedUrl(rawUrl), [rawUrl]);

  // ── File state ──
  const [pdf,         setPdf]         = useState(null);
  const [numPages,    setNumPages]    = useState(0);
  const [fileLoading, setFileLoading] = useState(true);
  const [fileError,   setFileError]   = useState(null);
  const [blobUrl,     setBlobUrl]     = useState(null);

  // ── Viewer state ──
  const [scale,      setScale]      = useState(1.0);
  const [zoomBounce, setZoomBounce] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  currentPageRef.current = currentPage;
  const [pageTexts, setPageTexts] = useState({});

  // ── Offline state ──
  const [isOffline,     setIsOffline]     = useState(false);
  const [isSaving,      setIsSaving]      = useState(false);

  // ── Luna state ──
  const [showLuna,       setShowLuna]       = useState(false);
  const [isFullscreen,   setIsFullscreen]   = useState(false);
  const [isTeachMode,    setIsTeachMode]    = useState(false);
  const [messages,       setMessages]       = useState([]);
  const [input,          setInput]          = useState('');
  const [isLoading,      setIsLoading]      = useState(false);
  const [lunaMood,       setLunaMood]       = useState('idle');
  const [showCelebration,setShowCelebration]= useState(false);
  const messagesRef = useRef([]);

  const containerRef = useRef(null);
  const pageRefs     = useRef({});

  // ── Inject keyframes ──
  useEffect(() => {
    const tag = document.createElement('style');
    tag.textContent = STYLES;
    document.head.appendChild(tag);
    return () => document.head.removeChild(tag);
  }, []);

  // ── Keep messagesRef in sync ──
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Check offline availability ──
  useEffect(() => {
    if (!fileId) return;
    getOfflineFile(fileId).then((cached) => setIsOffline(!!cached));
  }, [fileId]);

  // ── Load file ──
  useEffect(() => {
    setFileLoading(true);
    setFileError(null);
    setPdf(null);
    setNumPages(0);
    setPageTexts({});
    setCurrentPage(1);
    if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }

    if (!rawUrl) {
      setFileError('No file URL provided. Please go back and select a file.');
      setFileLoading(false);
      return;
    }

    if (!['pdf', 'pptx'].includes(fileType)) {
      setFileError(`File type "${fileType}" cannot be previewed. Only PDF and PPTX are supported.`);
      setFileLoading(false);
      return;
    }

    // ── Offline first ──
    if (!navigator.onLine) {
      getOfflineFile(fileId).then((cached) => {
        if (cached?.blob) {
          setBlobUrl(URL.createObjectURL(cached.blob));
          setFileLoading(false);
        } else {
          setFileError('You are offline and this file has not been saved for offline use.');
          setFileLoading(false);
        }
      });
      return;
    }

    if (fileType === 'pptx') {
      setFileLoading(false);
      return;
    }

    // ── PDF: fetch with auth then hand to pdfjs ──
    let mounted = true;
    const load = async () => {
      try {
        const token = await getAuthToken();
        const apiUrl = proxiedUrl.startsWith('/api/')
          ? `${import.meta.env.VITE_API_URL}${proxiedUrl}`
          : proxiedUrl;

        const res = await fetch(apiUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);

        const blob = await res.blob();
        if (!mounted) return;

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);

        const doc = await pdfjs.getDocument({ url }).promise;
        if (!mounted) { URL.revokeObjectURL(url); return; }

        setPdf(doc);
        setNumPages(doc.numPages);
        setFileLoading(false);
      } catch (err) {
        if (mounted) {
          setFileError(err.message || 'Failed to load file.');
          setFileLoading(false);
        }
      }
    };
    load();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawUrl, fileType, fileId, proxiedUrl]);

  // ── Page tracker (PDF) ──
  useEffect(() => {
    if (fileType !== 'pdf' || !pdf) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let best = { ratio: 0, page: currentPageRef.current };
        entries.forEach((e) => {
          if (e.intersectionRatio > best.ratio)
            best = { ratio: e.intersectionRatio, page: parseInt(e.target.dataset.page) };
        });
        if (best.ratio > 0.1) setCurrentPage(best.page);
      },
      { threshold: [0.1, 0.5, 0.9] }
    );
    Object.values(pageRefs.current).filter(Boolean).forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [fileType, pdf, numPages]);

  // ── Cleanup blobUrl on unmount ──
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, []);

  // ── Zoom ──
  const handleZoomIn = () => {
    setScale((p) => {
      const n = Math.min(2.5, parseFloat((p + 0.2).toFixed(1)));
      if (n >= 2.5) { setZoomBounce(true); setTimeout(() => setZoomBounce(false), 400); }
      return n;
    });
  };
  const handleZoomOut = () => {
    setScale((p) => {
      const n = Math.max(0.5, parseFloat((p - 0.2).toFixed(1)));
      if (n <= 0.5) { setZoomBounce(true); setTimeout(() => setZoomBounce(false), 400); }
      return n;
    });
  };

  // ── Offline save / remove ──
  const handleToggleOffline = async () => {
    if (!fileId) return;
    if (isOffline) {
      await deleteOfflineFile(fileId);
      setIsOffline(false);
      return;
    }
    setIsSaving(true);
    try {
      const token  = await getAuthToken();
      const apiUrl = proxiedUrl.startsWith('/api/')
        ? `${import.meta.env.VITE_API_URL}${proxiedUrl}`
        : proxiedUrl;
      const res  = await fetch(apiUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await res.blob();
      await saveFileOffline(fileId, blob, { name: filename, fileType, originalUrl: rawUrl });
      setIsOffline(true);
    } catch {
      alert('Could not save file for offline use.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Context window for Luna ──
  const getContextWindow = useCallback(() => {
    const prev = pageTexts[currentPage - 1] ? `[Previous page]: ${pageTexts[currentPage - 1]}\n` : '';
    const curr = pageTexts[currentPage]     ? `[Current page]: ${pageTexts[currentPage]}\n`       : '';
    const next = pageTexts[currentPage + 1] ? `[Next page]: ${pageTexts[currentPage + 1]}`        : '';
    return `${prev}${curr}${next}`.trim();
  }, [currentPage, pageTexts]);

  // ── Luna send ──
  const sendMessage = useCallback(async (userMessage) => {
    const text = (typeof userMessage === 'string' ? userMessage : input).trim();
    if (!text || isLoading) return;

    const updated = [...messagesRef.current, { role: 'user', content: text }];
    setMessages(updated);
    messagesRef.current = updated;
    setInput('');
    setIsLoading(true);
    setLunaMood('thinking');

    const history     = updated.slice(-6).filter((m) => m.content.trim());
    const token       = await getAuthToken();
    const contextText = getContextWindow() || 'No text extracted yet.';

    const payload = {
      fileId,
      pageNumber: currentPage,
      pageText:   contextText,
      question:   text,
      history,
      mode:       isTeachMode ? 'teach' : 'assist',
      context,
    };

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/luna/chat`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = '';

      setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
      setLunaMood('replying');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n\n')) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') continue;
          try { const d = JSON.parse(json); if (d.token) reply += d.token; } catch {}
        }
        setMessages((prev) => {
          const arr  = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role === 'assistant') arr[arr.length - 1] = { ...last, content: reply };
          return arr;
        });
      }

      setMessages((prev) => {
        const arr  = [...prev];
        const last = arr[arr.length - 1];
        if (last?.role === 'assistant') arr[arr.length - 1] = { ...last, content: reply, isStreaming: false };
        return arr;
      });

      setLunaMood('happy');
      setShowCelebration(true);
      setTimeout(() => { setShowCelebration(false); setLunaMood('idle'); }, 2500);
    } catch {
      setLunaMood('idle');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, input, currentPage, getContextWindow, isTeachMode, fileId, context]);

  // ── Progress ──
  const progressPct = numPages > 1 ? ((currentPage - 1) / (numPages - 1)) * 100 : 0;

  // ── Loading screen ──
  if (fileLoading) return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fff',
      animation: 'fadeUp .4s ease both',
    }}>
      <div style={{ position: 'relative', width: 64, height: 64, marginBottom: 24 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'linear-gradient(135deg,#dbeafe,#eff6ff)',
          animation: 'breathe 2s ease-in-out infinite',
        }} />
        <Loader2
          size={32} color="#1d4ed8"
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            animation: 'spin 1s linear infinite',
          }}
        />
      </div>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>
        Preparing your material
      </p>
      <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>Just a moment ✨</p>
    </div>
  );

  // ── Error screen ──
  if (fileError) return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: 24, textAlign: 'center',
      animation: 'fadeUp .4s ease both',
    }}>
      <AlertCircle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111318', marginBottom: 8 }}>
        Unable to load document
      </h2>
      <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 380, lineHeight: 1.6, marginBottom: 24 }}>
        {fileError}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <PopButton
          onClick={() => navigate(-1)}
          style={{
            padding: '10px 24px', borderRadius: 12,
            background: '#111318', color: '#fff',
            fontSize: 14, fontWeight: 700,
          }}
        >
          Go Back
        </PopButton>
        {rawUrl?.includes('drive.google.com') && (
          <a
            href={rawUrl} target="_blank" rel="noopener noreferrer"
            style={{
              padding: '10px 24px', borderRadius: 12,
              background: '#1d4ed8', color: '#fff',
              fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={16} /> Open in Drive
          </a>
        )}
        <PopButton
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px', borderRadius: 12,
            background: '#f1f5f9', color: '#374151',
            fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <RefreshCw size={16} /> Retry
        </PopButton>
      </div>
    </div>
  );

  const viewUrl = blobUrl || (fileType === 'pptx' ? rawUrl : null);

  // ── Main render ──
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#f6f7f9', fontFamily: "'Inter', sans-serif", overflow: 'hidden',
    }}>
      {/* Reading progress bar */}
      {fileType === 'pdf' && numPages > 0 && (
        <div style={{ height: 3, background: '#e8eaf0', flexShrink: 0, position: 'relative' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${progressPct}%`,
            background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)',
            borderRadius: '0 2px 2px 0',
            transition: 'width .6s cubic-bezier(.4,0,.2,1)',
          }} />
        </div>
      )}

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 18px', height: 60, background: '#fff',
        borderBottom: '1px solid #e8eaf0', flexShrink: 0, zIndex: 30,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none',
              background: '#f1f5f9', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} color="#374151" />
          </button>

          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#111318',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
            }}>
              {filename}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{
                fontSize: 9.5, fontFamily: 'monospace',
                background: fileType === 'pdf' ? '#fee2e2' : '#ffedd5',
                color: fileType === 'pdf' ? '#dc2626' : '#c2410c',
                padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '.05em',
              }}>
                {fileType}
              </span>
              {fileType === 'pdf' && numPages > 0 && (
                <span style={{ fontSize: 10.5, color: '#9ca3af', fontFamily: 'monospace' }}>
                  Page {currentPage} / {numPages}
                </span>
              )}
              {context.course && (
                <span style={{
                  fontSize: 10.5, color: '#6b7280',
                  maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {context.course}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <PopButton
            onClick={handleToggleOffline}
            disabled={isSaving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 13px', borderRadius: 20,
              border: `1px solid ${isOffline ? '#bbf7d0' : '#e2e8f0'}`,
              background: isOffline ? '#f0fdf4' : '#f8fafc',
              fontSize: 11.5, fontWeight: 600,
              color: isOffline ? '#16a34a' : '#6b7280',
            }}
          >
            {isSaving
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : isOffline
              ? <CheckCircle size={13} color="#16a34a" />
              : <Download size={13} />
            }
            {isSaving ? 'Saving…' : isOffline ? 'Saved' : 'Save Offline'}
          </PopButton>

          <PopButton
            onClick={() => setShowLuna(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 18px', borderRadius: 24,
              background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
              fontSize: 13, fontWeight: 700, color: '#fff',
              animation: showLuna ? 'none' : 'breathe 2.5s ease-in-out infinite',
              boxShadow: '0 2px 12px rgba(29,78,216,.35)',
            }}
          >
            <Sparkles size={15} fill="#fff" color="#fff" />
            Ask Luna
          </PopButton>
        </div>
      </header>

      {/* Document area */}
      <main
        ref={containerRef}
        style={{
          flex: 1, overflowY: fileType === 'pptx' ? 'hidden' : 'auto',
          overflowX: 'hidden',
          background: fileType === 'pdf' ? '#e2e5ea' : '#f6f7f9',
          scrollbarWidth: 'none',
          position: 'relative',
        }}
      >
        {/* ── PDF ── */}
        {fileType === 'pdf' && pdf && (
          <div style={{
            padding: '28px 20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i + 1}
                ref={(el) => (pageRefs.current[i + 1] = el)}
                data-page={i + 1}
                style={{
                  marginBottom: 20, width: '100%', display: 'flex', justifyContent: 'center',
                  animation: `zoomBounce ${zoomBounce ? 'shake .35s ease' : 'none'}`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center',
                  transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
                }}
              >
                <PDFPage
                  pdf={pdf}
                  pageNum={i + 1}
                  scale={scale}
                  containerRef={containerRef}
                  onTextExtracted={(p, t) =>
                    setPageTexts((prev) => ({ ...prev, [p]: t }))
                  }
                />
              </div>
            ))}
            <div style={{ height: 80 }} />
          </div>
        )}

        {/* ── PPTX (online) ── */}
        {fileType === 'pptx' && navigator.onLine && viewUrl && (
          <PPTXViewer url={viewUrl} scale={scale} />
        )}

        {/* ── PPTX offline unavailable ── */}
        {fileType === 'pptx' && !navigator.onLine && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#6b7280', textAlign: 'center', padding: 24,
          }}>
            <div>
              <AlertCircle size={40} color="#d1d5db" style={{ margin: '0 auto 16px' }} />
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                PPTX preview requires an internet connection.<br />
                Save this file offline first.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Zoom controls (PDF only) */}
      {fileType === 'pdf' && (
        <div style={{
          position: 'fixed', bottom: 32, right: 22,
          display: 'flex', flexDirection: 'column', gap: 8, zIndex: 20,
        }}>
          {[{ Icon: ZoomIn, action: handleZoomIn }, { Icon: ZoomOut, action: handleZoomOut }].map(({ Icon, action }, idx) => (
            <PopButton
              key={idx}
              onClick={action}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: '#fff', border: '1px solid #e2e8f0',
                boxShadow: '0 4px 16px rgba(0,0,0,.10)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: zoomBounce ? 'shake .35s ease' : 'none',
              }}
            >
              <Icon size={20} color="#374151" />
            </PopButton>
          ))}
          <div style={{
            textAlign: 'center', fontFamily: 'monospace',
            fontSize: 10, color: '#9ca3af', fontWeight: 500,
          }}>
            {Math.round(scale * 100)}%
          </div>
        </div>
      )}

      {/* Luna panel */}
      {showLuna && (
        <LunaChatPanel
          messages={messages}
          isLoading={isLoading}
          input={input}
          setInput={setInput}
          sendMessage={sendMessage}
          currentPage={currentPage}
          isTeachMode={isTeachMode}
          setIsTeachMode={setIsTeachMode}
          onClose={() => { setShowLuna(false); setIsFullscreen(false); }}
          isFullscreen={isFullscreen}
          toggleFullscreen={() => setIsFullscreen((p) => !p)}
          lunaMood={lunaMood}
          showCelebration={showCelebration}
        />
      )}
    </div>
  );
}