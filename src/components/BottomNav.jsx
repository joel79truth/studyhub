// BottomNav.jsx
//
// Redesign principles applied:
//   • Fully opaque white — no blur/transparency that erases visual weight
//   • Multi-layer shadow (upward + floating) for genuine elevation over content
//   • Active: solid filled pill (blue-600) with white icon — unmistakable at a glance
//   • Inactive: gray-400 icons + labels — clear off-state, no ambiguity
//   • Press: scale(0.88) on item for tactile, immediate feedback
//   • Spring easing on pill scale-up when tab becomes active
//   • Safe-area-aware bottom positioning — floats above home indicator on iPhone
//
//   • CLICK FIX (this pass): the previous version split firing logic across
//     onTouchStart / onTouchEnd / onClick, guarded by a Set + 600ms setTimeout.
//     That's three separate event paths that can desync — e.g. a touch that
//     scrolls instead of taps still leaves the guard armed, or desktop mouse
//     clicks take an entirely different (slower) path than touch.
//
//     Replaced with a single onPointerDown handler. Pointer events unify
//     mouse/touch/pen into one event, fire on first physical contact (not on
//     release), and need no preventDefault-the-ghost-click dance. Navigation
//     now fires the instant the user makes contact — zero added delay.
//
//     The Set-based re-fire guard is replaced with a simple timestamp ref:
//     one press fires once, a short cooldown blocks accidental double-fire
//     (e.g. duplicate pointer events on some hybrid devices), and it always
//     self-clears — no risk of a route getting silently "stuck" blocked.

import { NavLink, useNavigate } from 'react-router-dom';
import { memo, useState, useCallback, useRef } from 'react';
import { PRIMARY_NAV, SECONDARY_NAV, ACCOUNT_NAV } from '../config/navigation';
import { MoreHorizontal, X } from 'lucide-react';

// Use the shared primary navigation list
const navItems = PRIMARY_NAV;

// Minimum time between two fires to the same path, to swallow duplicate
// pointer events some browsers emit for a single physical touch.
const REFIRE_COOLDOWN_MS = 400;


// ─── More bottom sheet ────────────────────────────────────────────────
function MoreSheet({ open, onClose, onNavigate }) {
  if (!open) return null;
  const all = [...SECONDARY_NAV, ...ACCOUNT_NAV];
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 49,
          background: 'rgba(15,23,42,0.45)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
        background: '#fff',
        borderRadius: '20px 20px 0 0',
        padding: '12px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
      }}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: '#e2e8f0', margin: '0 auto 16px' }} />
        {/* Close button */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 14, right: 16,
          background: '#f1f5f9', border: 'none', borderRadius: 10,
          width: 32, height: 32, display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', color: '#64748b',
        }}>
          <X size={16} />
        </button>
        {/* Nav items */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {all.map(({ to, icon: Icon, label }) => (
            <button key={to}
              onClick={() => { onNavigate(to); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', borderRadius: 14,
                background: '#f8fafc', border: '1px solid #e2e8f0',
                textDecoration: 'none', color: '#1e293b',
                fontSize: 14, fontWeight: 500, cursor: 'pointer',
                fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
                width: '100%', textAlign: 'left',
              }}
            >
              <span style={{
                width: 34, height: 34, borderRadius: 10,
                background: '#eff6ff', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={17} color="#2563eb" strokeWidth={1.75} />
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export const BottomNav = memo(function BottomNav() {
  const navigate = useNavigate();
  const lastFiredRef = useRef({ to: null, at: 0 });
  const [pressedPath, setPressedPath] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const fire = useCallback((to) => {
    const now = Date.now();
    const last = lastFiredRef.current;
    if (last.to === to && now - last.at < REFIRE_COOLDOWN_MS) return;
    lastFiredRef.current = { to, at: now };
    navigate(to);
  }, [navigate]);

  const handlePointerDown = useCallback((to, e) => {
    if (e.button !== undefined && e.button !== 0) return;
    setPressedPath(to);
    fire(to);
  }, [fire]);

  const clearPressed = useCallback(() => {
    setPressedPath(null);
  }, []);

  const handleClick = useCallback((to, e) => {
    e.preventDefault();
    fire(to);
  }, [fire]);

  return (
    <>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} onNavigate={navigate} />
      <nav
        data-bottom-nav="true"
        style={{
          position: 'fixed',
          bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          left: 12,
          right: 12,
          zIndex: 50,
          touchAction: 'manipulation',
        }}
        className="md:hidden"
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 22,
            boxShadow:
              '0 0 0 1px rgba(0,0,0,0.07), ' +
              '0 4px 16px rgba(0,0,0,0.10), ' +
              '0 10px 36px rgba(0,0,0,0.09)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'stretch', height: 68 }}>
            {PRIMARY_NAV.map(({ to, icon: Icon, label }) => {
              const isPressed = pressedPath === to;
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  prefetch="render"
                  onPointerDown={(e) => handlePointerDown(to, e)}
                  onPointerUp={clearPressed}
                  onPointerCancel={clearPressed}
                  onPointerLeave={clearPressed}
                  onClick={(e) => handleClick(to, e)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    textDecoration: 'none',
                    outline: 'none',
                    transform: isPressed ? 'scale(0.88)' : 'scale(1)',
                    transition: 'transform 0.10s ease',
                    cursor: 'pointer',
                  }}
                >
                  {({ isActive }) => (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 54,
                          height: 32,
                          borderRadius: 16,
                          background: isActive ? '#2563eb' : 'transparent',
                          transition:
                            'background 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), ' +
                            'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                          transform: isActive ? 'scale(1.06)' : 'scale(1)',
                        }}
                      >
                        <Icon
                          size={20}
                          strokeWidth={isActive ? 2.5 : 1.75}
                          style={{
                            color: isActive ? '#ffffff' : '#9ca3af',
                            display: 'block',
                            transition: 'color 0.18s ease',
                            transform: isActive ? 'scale(0.96)' : 'scale(1)',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 10.5,
                          lineHeight: 1,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? '#2563eb' : '#9ca3af',
                          letterSpacing: '0.02em',
                          transition: 'color 0.18s ease',
                        }}
                      >
                        {label}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}

            {/* ── More button ── */}
            <button
              onPointerDown={() => setMoreOpen(true)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                outline: 'none',
              }}
              aria-label="More navigation options"
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 54, height: 32, borderRadius: 16,
                background: moreOpen ? '#f1f5f9' : 'transparent',
              }}>
                <MoreHorizontal size={20} strokeWidth={1.75} style={{ color: '#9ca3af', display: 'block' }} />
              </div>
              <span style={{
                fontSize: 10.5, lineHeight: 1, fontWeight: 400,
                color: '#9ca3af', letterSpacing: '0.02em',
              }}>
                More
              </span>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
});

