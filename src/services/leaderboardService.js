/**
 * leaderboardService.js
 * ─────────────────────────────────────────────────────────────────────
 * Writes a completed quiz result into the Supabase leaderboard tables.
 *
 * Ranking formula:
 *   composite_score = (avg_score × 0.7) + LEAST(quizzes × 3, 30)
 *   - 70% accuracy + 30% volume (volume capped at 10 quizzes = 30pts)
 *   - Tiebreaker: earliest updated_at (first to achieve the score wins)
 *
 * Called from Quiz.jsx alongside recordQuizResult() — fire-and-forget,
 * never blocks the results screen. Fails silently on network issues
 * so offline students are unaffected.
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from '../supabase';

// Get Monday of the current ISO week (YYYY-MM-DD)
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

// Composite score: 70% accuracy + 30% volume (volume capped at 30pts)
function computeComposite(avgScore, quizzes) {
  return Math.round(((avgScore * 0.7) + Math.min(quizzes * 3, 30)) * 100) / 100;
}

/**
 * Upsert this quiz result into both leaderboard tables.
 */
export async function submitLeaderboardScore({ userId, displayName, program, campus, percentage }) {
  if (!userId || percentage == null) return;

  const weekStart = getWeekStart();

  // ── Weekly table ──────────────────────────────────────────────────
  try {
    const { data: existing } = await supabase
      .from('quiz_scores')
      .select('score, quizzes')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .single();

    let newScore, newQuizzes;
    if (existing) {
      newQuizzes = existing.quizzes + 1;
      newScore = ((existing.score * existing.quizzes) + percentage) / newQuizzes;
    } else {
      newScore = percentage;
      newQuizzes = 1;
    }

    const roundedScore = Math.round(newScore * 100) / 100;
    const composite = computeComposite(roundedScore, newQuizzes);

    await supabase
      .from('quiz_scores')
      .upsert({
        user_id: userId,
        week_start: weekStart,
        display_name: displayName || 'Anonymous',
        program: program || '',
        campus: campus || '',
        score: roundedScore,
        quizzes: newQuizzes,
        composite_score: composite,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,week_start' });
  } catch (err) {
    console.warn('Leaderboard weekly upsert failed (non-fatal):', err?.message);
  }

  // ── All-time table ────────────────────────────────────────────────
  try {
    const { data: atExisting } = await supabase
      .from('quiz_scores_alltime')
      .select('score, quizzes')
      .eq('user_id', userId)
      .single();

    let atScore, atQuizzes;
    if (atExisting) {
      atQuizzes = atExisting.quizzes + 1;
      atScore = ((atExisting.score * atExisting.quizzes) + percentage) / atQuizzes;
    } else {
      atScore = percentage;
      atQuizzes = 1;
    }

    const roundedAtScore = Math.round(atScore * 100) / 100;
    const atComposite = computeComposite(roundedAtScore, atQuizzes);

    await supabase
      .from('quiz_scores_alltime')
      .upsert({
        user_id: userId,
        display_name: displayName || 'Anonymous',
        program: program || '',
        campus: campus || '',
        score: roundedAtScore,
        quizzes: atQuizzes,
        composite_score: atComposite,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
  } catch (err) {
    console.warn('Leaderboard all-time upsert failed (non-fatal):', err?.message);
  }
}
