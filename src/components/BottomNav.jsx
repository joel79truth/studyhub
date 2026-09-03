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
import { Home, FileText, BookOpen, Brain } from 'lucide-react';
import { memo, useState, useCallback, useRef } from 'react';

const navItems = [
  { to: '/',         icon: Home,     label: 'Home'   },
  { to: '/papers',   icon: FileText, label: 'Papers' },
  { to: '/programs', icon: BookOpen, label: 'Notes'  },
  { to: '/quiz',     icon: Brain,    label: 'Quiz'   },
];

// Minimum time between two fires to the same path, to swallow duplicate
// pointer events some browsers emit for a single physical touch.
const REFIRE_COOLDOWN_MS = 400;

export const BottomNav = memo(function BottomNav() {
  const navigate = useNavigate();
  const lastFiredRef = useRef({ to: null, at: 0 });
  const [pressedPath, setPressedPath] = useState(null);

  const fire = useCallback((to) => {
    const now = Date.now();
    const last = lastFiredRef.current;
    if (last.to === to && now - last.at < REFIRE_COOLDOWN_MS) return;
    lastFiredRef.current = { to, at: now };
    navigate(to);
  }, [navigate]);

  // Single entry point for every pointer type (touch, mouse, pen).
  // Fires on first contact — no waiting for release, no click-event delay.
  const handlePointerDown = useCallback((to, e) => {
    // Ignore non-primary buttons (e.g. right-click) so context menus still work.
    if (e.button !== undefined && e.button !== 0) return;
    setPressedPath(to);
    fire(to);
  }, [fire]);

  const clearPressed = useCallback(() => {
    setPressedPath(null);
  }, []);

  // Native click still needs a handler so keyboard "Enter"/"Space" activation
  // and assistive tech (which dispatch click, not pointerdown) keep working.
  // If pointerdown already handled this exact interaction, the cooldown in
  // fire() naturally no-ops the duplicate — no separate guard needed.
  const handleClick = useCallback((to, e) => {
    e.preventDefault();
    fire(to);
  }, [fire]);

  return (
    <nav
      style={{
        position: 'fixed',
        // Float above the iPhone home indicator instead of overlapping it
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        left: 12,
        right: 12,
        zIndex: 50,
        touchAction: 'manipulation', // kills the 300ms tap delay
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 22,
          // Three-layer shadow: tight crisp edge + mid lift + wide ambient float
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.07), ' +
            '0 4px 16px rgba(0,0,0,0.10), ' +
            '0 10px 36px rgba(0,0,0,0.09)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', height: 68 }}>
          {navItems.map(({ to, icon: Icon, label }) => {
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
                  // Whole-item scale on press — immediate tactile signal
                  transform: isPressed ? 'scale(0.88)' : 'scale(1)',
                  transition: 'transform 0.10s ease',
                  cursor: 'pointer',
                }}
              >
                {({ isActive }) => (
                  <>
                    {/*
                      Active icon pill — solid blue-600 background with white icon.
                      This is the core fix: the original bg-blue-50 pill was nearly
                      invisible on white. A filled solid pill is unmistakable at a
                      glance from any angle or lighting condition.
                    */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 54,
                        height: 32,
                        borderRadius: 16,
                        // Solid fill vs transparent — the entire visual presence difference
                        background: isActive ? '#2563eb' : 'transparent',
                        // Spring easing: overshoot slightly on activation for life
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
                          // White on filled pill vs gray on empty — max contrast in both states
                          color: isActive ? '#ffffff' : '#9ca3af',
                          display: 'block',
                          transition: 'color 0.18s ease',
                          // Slight counter-scale so icon feels stable as pill grows
                          transform: isActive ? 'scale(0.96)' : 'scale(1)',
                        }}
                      />
                    </div>

                    {/*
                      Label — always visible (per research: labeled tabs reduce errors
                      by ~25% vs icon-only). Active: blue-600 semibold. Inactive: gray-400
                      regular. The contrast gap between states makes the active tab
                      immediately locatable without scanning all four.
                    */}
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
        </div>
      </div>
    </nav>
  );
});