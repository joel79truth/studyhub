/**
 * LeaderboardPage.jsx
 * Full-page leaderboard — accessible from sidebar nav (/leaderboard).
 * Shows Weekly, All-Time, and My Program tabs with top-10 rankings.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Leaderboard from '../components/Leaderboard';
import { Trophy } from 'lucide-react';

export default function LeaderboardPage() {
  const [userId, setUserId] = useState(null);
  const [userProgram, setUserProgram] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setUserId(session.user.id);
      supabase
        .from('profiles')
        .select('program')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => setUserProgram(data?.program || ''));
    });
  }, []);

  return (
    <div style={{
      minHeight: '100%',
      background: '#f0f6ff',
      fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
    }}>
      {/* Page header */}
      <div style={{
        padding: '24px 20px 16px',
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Trophy size={20} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Leaderboard</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
            Top quizzers at LUANAR this week
          </div>
        </div>
      </div>

      {/* Leaderboard component — full mode (not compact) */}
      <div style={{ padding: '16px 16px 96px' }}>
        <Leaderboard
          userId={userId}
          userProgram={userProgram}
          compact={false}
        />
      </div>
    </div>
  );
}
