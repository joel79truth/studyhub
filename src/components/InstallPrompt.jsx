import { useState, useEffect, useCallback } from 'react';
import { Download, Smartphone, Share2, PlusSquare, X } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'studyhub_install_dismissed_at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isAlreadyInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  const ua = window.navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && !window.MSStream;
}

function isSafari() {
  const ua = window.navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua);
}

function wasDismissedRecently() {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {}
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);   // Android / Chrome
  const [showIOSGuide, setShowIOSGuide] = useState(false);  // iOS Safari
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  // Detect install eligibility once on mount
  useEffect(() => {
    if (isAlreadyInstalled() || wasDismissedRecently()) return;

    // Android / Chrome: wait for native prompt
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari: show manual guide after a short delay so it doesn't
    // appear before the page has fully loaded
    if (isIOS() && isSafari()) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => {
        window.removeEventListener('beforeinstallprompt', handler);
        clearTimeout(t);
      };
    }

    window.addEventListener('appinstalled', () => {
      setInstallEvent(null);
      setInstalled(true);
      setVisible(false);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleAndroidInstall = useCallback(() => {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(() => {
      setInstallEvent(null);
      setVisible(false);
    });
  }, [installEvent]);

  const handleDismiss = useCallback(() => {
    markDismissed();
    setDismissed(true);
    setVisible(false);
    setShowIOSGuide(false);
  }, []);

  // Nothing to show
  if (installed || dismissed || !visible) return null;

  // ── iOS Safari: manual guide sheet ────────────────────────────────────────
  if (isIOS() && isSafari() && !installEvent) {
    return (
      <>
        {/* Backdrop */}
        {showIOSGuide && (
          <div
            className="fixed inset-0 bg-black/40 z-[998] backdrop-blur-sm"
            onClick={handleDismiss}
          />
        )}

        {/* Collapsed teaser banner */}
        {!showIOSGuide && (
          <div
            style={{
              position: 'fixed',
              bottom: 72,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 999,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 999,
              padding: '10px 18px 10px 14px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
              cursor: 'pointer',
              maxWidth: 'calc(100vw - 32px)',
            }}
            onClick={() => setShowIOSGuide(true)}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
                background: '#024927',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img src="/icons/icon-192x192.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.82rem', color: '#111827', whiteSpace: 'nowrap' }}>
                Install StudyHub
              </p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                Add to Home Screen for the best experience
              </p>
            </div>
            <Smartphone size={18} style={{ color: '#024927', flexShrink: 0, marginLeft: 4 }} />
          </div>
        )}

        {/* Expanded iOS guide sheet */}
        {showIOSGuide && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 999,
              background: '#fff',
              borderRadius: '20px 20px 0 0',
              padding: '24px 20px 36px',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.2)',
            }}
          >
            {/* Handle */}
            <div style={{ width: 40, height: 4, background: '#d1d5db', borderRadius: 9999, margin: '0 auto 20px' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                  <img src="/icons/icon-192x192.png" alt="StudyHub" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Install StudyHub</p>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#6b7280' }}>Add to your Home Screen</p>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                aria-label="Dismiss"
              >
                <X size={14} color="#6b7280" />
              </button>
            </div>

            {/* Benefits row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {['Works offline', 'Instant access', 'No App Store'].map((b) => (
                <span
                  key={b}
                  style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 9999, padding: '3px 10px', fontSize: '0.7rem', fontWeight: 600 }}
                >
                  ✓ {b}
                </span>
              ))}
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Step
                num={1}
                icon={<Share2 size={18} color="#2563eb" />}
                text={
                  <>
                    Tap the <strong>Share</strong> button{' '}
                    <span style={{ display: 'inline-block', background: '#eff6ff', borderRadius: 4, padding: '1px 6px', fontSize: '0.75rem', fontWeight: 700, color: '#1d4ed8' }}>
                      ↑
                    </span>{' '}
                    at the bottom of Safari
                  </>
                }
              />
              <Step
                num={2}
                icon={<PlusSquare size={18} color="#2563eb" />}
                text={
                  <>
                    Scroll down and tap{' '}
                    <strong>"Add to Home Screen"</strong>
                  </>
                }
              />
              <Step
                num={3}
                icon={<Download size={18} color="#2563eb" />}
                text={<>Tap <strong>"Add"</strong> in the top-right corner</>}
              />
            </div>

            <p style={{ marginTop: 16, fontSize: '0.72rem', color: '#9ca3af', textAlign: 'center' }}>
              StudyHub will appear on your Home Screen like a native app.
            </p>
          </div>
        )}
      </>
    );
  }

  // ── Android / Chrome: native prompt trigger ────────────────────────────────
  if (installEvent) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 72,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 16,
          padding: '12px 14px',
          boxShadow: '0 4px 28px rgba(0,0,0,0.16)',
          maxWidth: 'calc(100vw - 32px)',
          width: 340,
        }}
      >
        <div style={{ width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <img src="/icons/icon-192x192.png" alt="StudyHub" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 1px', fontWeight: 700, fontSize: '0.85rem', color: '#111827' }}>
            Install StudyHub
          </p>
          <p style={{ margin: 0, fontSize: '0.72rem', color: '#6b7280' }}>
            Offline access · Fast · No App Store needed
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent', border: '1px solid #e5e7eb',
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
              fontSize: '0.78rem', color: '#6b7280', fontWeight: 500,
            }}
          >
            Later
          </button>
          <button
            onClick={handleAndroidInstall}
            style={{
              background: '#024927', border: 'none',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              fontSize: '0.78rem', color: '#fff', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <Download size={13} />
            Install
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Step({ num, icon, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div
        style={{
          width: 28, height: 28, borderRadius: '50%', background: '#eff6ff',
          border: '1.5px solid #bfdbfe', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.75rem', fontWeight: 700, color: '#2563eb',
        }}
      >
        {num}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
        <span style={{ flexShrink: 0 }}>{icon}</span>
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>{text}</p>
      </div>
    </div>
  );
}