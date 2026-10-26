/**
 * ScoreShareCard.jsx
 * ─────────────────────────────────────────────────────────────────────
 * Screenshot-optimised visual score card for WhatsApp Status / Stories.
 *
 * Design principles applied:
 *  • Nielsen Norman: Recognition over recall — grade letter is the hero
 *    element so the user immediately knows the outcome at a glance.
 *  • BJ Fogg / Keller ARCS: Only shown on ≥60% so it never feels like
 *    rubbing in failure; the card is the celebration, not an advert.
 *  • Material / iOS HIG: 16px grid, 4px radius multiple, safe corner
 *    radius for screenshots on rounded-display phones.
 *  • Viral loop design (Andrew Chen): Card carries brand mark + URL so
 *    every screenshot is a self-contained referral artefact.
 *
 * Flow:
 *  1. User finishes quiz ≥60% → card appears below results header.
 *  2. "Save Image" → html2canvas captures div → triggers download.
 *  3. "Share on WhatsApp" → opens wa.me with pre-written text (fallback
 *     for devices where Clipboard/share sheet is unavailable).
 *
 * Props:
 *   percentage  {number}  0–100
 *   gradeLetter {string}  A / B / C / D / F
 *   gradeLabel  {string}  e.g. "Excellent"
 *   gradeColor  {string}  hex color
 *   correct     {number}
 *   total       {number}
 *   subjectName {string}
 *   userName    {string|null}
 * ─────────────────────────────────────────────────────────────────────
 */

import { useRef, useState, useCallback } from 'react';
import { Download, Share2, Check, Loader2 } from 'lucide-react';

// ─── Lazy-load html2canvas to keep initial bundle small ───────────────
let html2canvasPromise = null;
const getHtml2Canvas = () => {
  if (!html2canvasPromise) {
    html2canvasPromise = import('html2canvas').then(m => m.default);
  }
  return html2canvasPromise;
};

// ─── Grade tier metadata ───────────────────────────────────────────────
const GRADE_META = {
  A: { emoji: '🏆', bg: 'linear-gradient(135deg,#1a472a 0%,#2d6a4f 60%,#40916c 100%)', accent: '#b7e4c7' },
  B: { emoji: '🎓', bg: 'linear-gradient(135deg,#1b3a6e 0%,#2d6a9f 60%,#4a90d9 100%)', accent: '#bee9ff' },
  C: { emoji: '📚', bg: 'linear-gradient(135deg,#4a3a00 0%,#7a6000 60%,#b38e00 100%)', accent: '#ffe066' },
  D: { emoji: '💪', bg: 'linear-gradient(135deg,#3a1a00 0%,#7a3800 60%,#b35900 100%)', accent: '#ffcc88' },
  F: { emoji: '🔥', bg: 'linear-gradient(135deg,#3a0a0a 0%,#7a1a1a 60%,#b32a2a 100%)', accent: '#ffaaaa' },
};

const FONT = "'Inter','Segoe UI',system-ui,sans-serif";

export default function ScoreShareCard({
  percentage,
  gradeLetter,
  gradeLabel,
  gradeColor,
  correct,
  total,
  subjectName,
  userName,
}) {
  const cardRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Only render for ≥60 %
  if (percentage < 60) return null;

  const meta = GRADE_META[gradeLetter] || GRADE_META['B'];
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const displayName = userName ? userName.split(' ')[0] : null;

  // ─── Capture card as PNG ──────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (saving || !cardRef.current) return;
    setSaving(true);
    try {
      const h2c = await getHtml2Canvas();
      const canvas = await h2c(cardRef.current, {
        scale: 3,           // Retina-quality
        useCORS: true,
        backgroundColor: null,
        logging: false,
        // Ensure fonts render correctly
        onclone: (doc) => {
          doc.querySelectorAll('*').forEach(el => {
            el.style.fontFamily = FONT;
          });
        },
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `StudyHub_Score_${percentage}pct.png`;
      a.click();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error('ScoreShareCard capture failed:', e);
    } finally {
      setSaving(false);
    }
  }, [saving, percentage]);

  // ─── WhatsApp share (text fallback) ──────────────────────────────
  const handleWhatsApp = useCallback(async () => {
    setSharing(true);
    const msg = encodeURIComponent(
      `🎓 I just scored ${percentage}% on *${subjectName}* using StudyHub LUANAR!\n\n` +
      `📚 Free past papers, AI tutor, practice quizzes & notes — all in one app.\n\n` +
      `Get it 👉 https://studyhub-luanar.web.app`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
    setTimeout(() => setSharing(false), 2000);
  }, [percentage, subjectName]);

  // ─── Card (this is what html2canvas captures) ─────────────────────
  return (
    <div style={{ marginBottom: 24 }}>
      {/* ── Shareable visual card ── */}
      <div
        ref={cardRef}
        style={{
          background: meta.bg,
          borderRadius: 24,
          padding: '32px 28px 24px',
          fontFamily: FONT,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {/* Decorative blur circles */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 160, height: 160,
          background: 'rgba(255,255,255,0.07)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -30, left: -30,
          width: 120, height: 120,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />

        {/* Header: brand */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.7, textTransform: 'uppercase' }}>
              StudyHub LUANAR
            </div>
            {displayName && (
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{displayName}'s result</div>
            )}
          </div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{today}</div>
        </div>

        {/* Hero: grade + score */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 88, height: 88, borderRadius: 20,
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 48, fontWeight: 800, lineHeight: 1,
            border: `2px solid ${meta.accent}44`,
            flexShrink: 0,
          }}>
            {gradeLetter}
          </div>
          <div>
            <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, letterSpacing: '-1px' }}>
              {percentage}%
            </div>
            <div style={{
              display: 'inline-block', marginTop: 6,
              background: meta.accent + '22',
              border: `1px solid ${meta.accent}55`,
              borderRadius: 8, padding: '3px 10px',
              fontSize: 12, fontWeight: 600, color: meta.accent,
              letterSpacing: '0.06em',
            }}>
              {meta.emoji} {gradeLabel}
            </div>
          </div>
        </div>

        {/* Subject pill */}
        <div style={{
          background: 'rgba(255,255,255,0.12)',
          borderRadius: 10, padding: '8px 14px',
          fontSize: 13, fontWeight: 600,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20,
          border: '1px solid rgba(255,255,255,0.15)',
        }}>
          <span style={{ opacity: 0.8 }}>📖 {subjectName}</span>
          <span style={{ color: meta.accent, fontWeight: 700 }}>{correct}/{total} correct</span>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 6, borderRadius: 3,
          background: 'rgba(255,255,255,0.15)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${percentage}%`,
            background: meta.accent,
            borderRadius: 3,
            transition: 'width 1s ease',
          }} />
        </div>

        {/* Footer: CTA */}
        <div style={{
          marginTop: 18, textAlign: 'center',
          fontSize: 11, opacity: 0.55, letterSpacing: '0.05em',
        }}>
          studyhub-luanar.web.app — Free for all LUANAR students
        </div>
      </div>

      {/* ── Action buttons (NOT captured in screenshot) ── */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        {/* Save Image */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 0', borderRadius: 14, border: '1.5px solid #e2e8f0',
            background: '#fff', color: saved ? '#2d6a4f' : '#1a202c',
            fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            fontFamily: FONT,
          }}
          aria-label="Save score card as image"
        >
          {saving ? (
            <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
          ) : saved ? (
            <Check size={17} color="#2d6a4f" />
          ) : (
            <Download size={17} />
          )}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Image'}
        </button>

        {/* Share on WhatsApp */}
        <button
          onClick={handleWhatsApp}
          disabled={sharing}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 0', borderRadius: 14, border: 'none',
            background: sharing ? '#1ea552' : '#25D366', color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: sharing ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            fontFamily: FONT,
          }}
          aria-label="Share score card on WhatsApp"
        >
          {sharing ? (
            <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          )}
          {sharing ? 'Opening…' : 'Share on WhatsApp'}
        </button>
      </div>

      {/* Subtle prompt — tells user what to do, doesn't nag */}
      <div style={{
        textAlign: 'center', marginTop: 8,
        fontSize: 11, color: '#94a3b8',
        fontFamily: FONT,
      }}>
        Save the image → post to WhatsApp Status to flex on your classmates 😄
      </div>
    </div>
  );
}
