/**
 * Leaderboard.jsx
 * ─────────────────────────────────────────────────────────────────────
 * Weekly quiz score leaderboard for StudyHub LUANAR.
 *
 * Design principles:
 *  • BJ Fogg — social proof + peer comparison drives daily return visits.
 *  • Nielsen Norman — show the user's own rank prominently (ego reference).
 *  • Nir Eyal (Hooked) — variable reward (rank can change daily) creates
 *    a hook that pulls students back each morning.
 *  • Privacy-safe — only display names + first letter of surname (no email).
 *
 * Data source: Supabase `quiz_scores` table (upserted per user per week).
 * Fallback: if Supabase unavailable, shows local-only placeholder.
 *
 * Tabs:
 *   "This Week"  — top 10 by weekly_score (SUM of scores this Mon–Sun)
 *   "All Time"   — top 10 by total_score (all-time SUM)
 *   "My Program" — same as This Week but filtered to user's program
 * ─────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase';
import { Trophy, Medal, Flame, RefreshCw, ChevronRight, Users } from 'lucide-react';

// ─── Design tokens (match Quiz.jsx palette) ──────────────────────────
const C = {
  bg: '#f0f6ff',
  card: '#ffffff',
  primary: '#2563eb',
  primaryLight: '#dbeafe',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  success: '#16a34a',
  warning: '#d97706',
  gold: '#f59e0b',
  silver: '#94a3b8',
  bronze: '#b45309',
};
const FONT = "'Inter','Segoe UI',system-ui,sans-serif";
const TABS = ['This Week', 'All Time', 'My Program'];

// ─── Rank medal config ────────────────────────────────────────────────
const RANK_META = [
  { bg: '#fffbeb', border: '#f59e0b', color: '#92400e', icon: '🥇' },
  { bg: '#f8fafc', border: '#94a3b8', color: '#475569', icon: '🥈' },
  { bg: '#fff7ed', border: '#b45309', color: '#7c2d12', icon: '🥉' },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function getWeekRange() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

function maskName(name = '') {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function getInitials(name = '') {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0][0].toUpperCase();
}

function avatarColor(name = '') {
  const colors = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#dc2626', '#0891b2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Row component ────────────────────────────────────────────────────
function LeaderRow({ rank, entry, isCurrentUser }) {
  const meta = RANK_META[rank - 1];
  const initials = getInitials(entry.display_name);
  const aColor = avatarColor(entry.display_name);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px',
      borderRadius: 14,
      background: isCurrentUser ? C.primaryLight : (meta ? meta.bg : C.card),
      border: `1.5px solid ${isCurrentUser ? C.primary : (meta ? meta.border : C.border)}`,
      marginBottom: 8,
      transition: 'all 0.15s',
      fontFamily: FONT,
    }}>
      {/* Rank */}
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: meta ? 18 : 13, fontWeight: 700,
        color: meta ? undefined : C.textMuted,
        background: meta ? 'transparent' : '#f1f5f9',
      }}>
        {meta ? meta.icon : `#${rank}`}
      </div>

      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: aColor, color: '#fff',
        fontSize: 13, fontWeight: 700,
      }}>
        {initials}
      </div>

      {/* Name + program */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: isCurrentUser ? 700 : 600,
          color: isCurrentUser ? C.primary : C.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {maskName(entry.display_name)}{isCurrentUser ? ' (You)' : ''}
        </div>
        {entry.program && (
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entry.program}
          </div>
        )}
      </div>

      {/* Score + quizzes */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: meta ? meta.color : C.text }}>
          {entry.composite_score ?? entry.score}
          <span style={{ fontSize: 10, fontWeight: 500, color: C.textMuted, marginLeft: 2 }}>pts</span>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
          avg {entry.score}% · {entry.quizzes} quiz{entry.quizzes !== 1 ? 'zes' : ''}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px', borderRadius: 14,
      background: C.card, border: `1.5px solid ${C.border}`,
      marginBottom: 8,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: '#f1f5f9' }} />
      <div style={{ width: 36, height: 36, borderRadius: 12, background: '#f1f5f9' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 13, width: '55%', borderRadius: 6, background: '#f1f5f9', marginBottom: 6 }} />
        <div style={{ height: 10, width: '35%', borderRadius: 6, background: '#f1f5f9' }} />
      </div>
      <div style={{ width: 40, height: 20, borderRadius: 6, background: '#f1f5f9' }} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────
export default function Leaderboard({ userId, userProgram, compact = false }) {
  const [activeTab, setActiveTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [myEntry, setMyEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [isOfflineSnapshot, setIsOfflineSnapshot] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getWeekRange();

      let query = supabase
        .from('quiz_scores')
        .select('user_id, display_name, program, campus, score, quizzes, composite_score, updated_at')
        .order('composite_score', { ascending: false })
        .order('updated_at', { ascending: true })
        .limit(compact ? 5 : 10);

      if (activeTab === 0) {
        // This Week — filter by week range
        query = query.gte('week_start', from.split('T')[0]);
      } else if (activeTab === 2 && userProgram) {
        // My Program
        query = query.eq('program', userProgram).gte('week_start', from.split('T')[0]);
      } else if (activeTab === 1) {
        // Tab 1 = All Time — no date filter
        query = supabase
          .from('quiz_scores_alltime')
          .select('user_id, display_name, program, campus, score, quizzes, composite_score')
          .order('composite_score', { ascending: false })
          .order('updated_at', { ascending: true })
          .limit(compact ? 5 : 10);
      }

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      setRows(data || []);
      setIsOfflineSnapshot(false);
      try {
        localStorage.setItem('sh_leaderboard_' + activeTab, JSON.stringify({
          rows: data || [],
          count,
          cachedAt: Date.now(),
        }));
      } catch {}

      // Find current user rank
      if (userId && data) {
        const idx = data.findIndex(r => r.user_id === userId);
        if (idx !== -1) {
          setMyRank(idx + 1);
          setMyEntry(data[idx]);
        } else {
          // User not in top 10 — fetch their own row
          const { data: mine } = await supabase
            .from(activeTab === 1 ? 'quiz_scores_alltime' : 'quiz_scores')
            .select('user_id, display_name, program, score, quizzes')
            .eq('user_id', userId)
            .single();
          setMyEntry(mine || null);
          setMyRank(null); // not in top 10
        }
      }

      // Total participant count
      const { count } = await supabase
        .from(activeTab === 1 ? 'quiz_scores_alltime' : 'quiz_scores')
        .select('*', { count: 'exact', head: true });
      setTotalParticipants(count || 0);

    } catch (err) {
      console.warn('Leaderboard fetch failed, checking offline cache:', err);
      try {
        const cached = localStorage.getItem('sh_leaderboard_' + activeTab);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.rows && parsed.rows.length > 0) {
            setRows(parsed.rows);
            setTotalParticipants(parsed.count || parsed.rows.length);
            setIsOfflineSnapshot(true);
            setError(null);
            return;
          }
        }
      } catch {}
      setError(!navigator.onLine ? 'You are offline with no saved leaderboard yet.' : 'Could not load leaderboard right now.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, userId, userProgram, compact]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT, background: C.bg }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trophy size={20} color={C.gold} />
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Leaderboard</span>
          {isOfflineSnapshot && (
            <span style={{
              fontSize: 10, color: '#d97706', background: '#fef3c7',
              borderRadius: 20, padding: '2px 8px', fontWeight: 600,
            }}>
              ⚡ Offline Snapshot
            </span>
          )}
          {totalParticipants > 0 && (
            <span style={{
              fontSize: 11, color: C.textMuted, background: '#f1f5f9',
              borderRadius: 20, padding: '2px 8px', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <Users size={11} /> {totalParticipants} students
            </span>
          )}
        </div>
        <button onClick={fetchLeaderboard} disabled={loading}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }}
          aria-label="Refresh leaderboard">
          <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Tabs */}
      {!compact && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none',
                background: activeTab === i ? C.primary : C.card,
                color: activeTab === i ? '#fff' : C.textMuted,
                fontWeight: activeTab === i ? 700 : 500, fontSize: 12,
                cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: FONT,
              }}>
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Rows */}
      {loading ? (
        Array.from({ length: compact ? 3 : 5 }).map((_, i) => <SkeletonRow key={i} />)
      ) : error ? (
        <div style={{
          textAlign: 'center', padding: '24px 16px',
          background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
          color: C.textMuted, fontSize: 13,
        }}>
          <Trophy size={28} color={C.border} style={{ display: 'block', margin: '0 auto 8px' }} />
          {error}
          <br />
          <button onClick={fetchLeaderboard}
            style={{ marginTop: 10, color: C.primary, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '28px 16px',
          background: C.card, borderRadius: 14, border: `1px dashed ${C.border}`,
          color: C.textMuted, fontSize: 13, lineHeight: 1.6,
        }}>
          <Flame size={28} color={C.gold} style={{ display: 'block', margin: '0 auto 8px' }} />
          <strong style={{ color: C.text }}>No scores yet this week!</strong>
          <br />Take a quiz to claim the #1 spot.
        </div>
      ) : (
        <>
          {rows.map((entry, i) => (
            <LeaderRow
              key={entry.user_id}
              rank={i + 1}
              entry={entry}
              isCurrentUser={entry.user_id === userId}
            />
          ))}

          {/* Show user's own rank if not in top 10 */}
          {myEntry && myRank === null && (
            <>
              <div style={{ textAlign: 'center', fontSize: 11, color: C.textMuted, margin: '6px 0' }}>
                · · ·
              </div>
              <LeaderRow rank="?" entry={myEntry} isCurrentUser />
              <div style={{ textAlign: 'center', fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                You're outside the top 10. Keep quizzing! 💪
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
