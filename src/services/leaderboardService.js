/**
 * leaderboardService.js
 * ─────────────────────────────────────────────────────────────────────
 * Writes a completed quiz result into the Supabase leaderboard tables.
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
  const day = now.getDay(); // 0 = Sun, 1 = Mon …
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Upsert this quiz result into both leaderboard tables.
 *
 * @param {object} p
 * @param {string}  p.userId      - Supabase auth user ID
 * @param {string}  p.displayName - User's full name (will be masked in UI)
 * @param {string}  p.program     - e.g. "BSc Agronomy"
 * @param {string}  p.campus      - e.g. "Bunda"
 * @param {number}  p.percentage  - 0–100
 */
export async function submitLeaderboardScore({ userId, displayName, program, campus, percentage }) {
  if (!userId || percentage == null) return;

  const weekStart = getWeekStart();

  // ── Weekly table: rolling average + count ─────────────────────────
  try {
    // Fetch current weekly row first (for running average calculation)
    const { data: existing } = await supabase
      .from('quiz_scores')
      .select('score, quizzes')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .single();

    let newScore, newQuizzes;
    if (existing) {
      // Update running average: (old_avg * old_n + new_score) / (old_n + 1)
      newQuizzes = existing.quizzes + 1;
      newScore = ((existing.score * existing.quizzes) + percentage) / newQuizzes;
    } else {
      newScore = percentage;
      newQuizzes = 1;
    }

    await supabase
      .from('quiz_scores')
      .upsert({
        user_id: userId,
        week_start: weekStart,
        display_name: displayName || 'Anonymous',
        program: program || '',
        campus: campus || '',
        score: Math.round(newScore * 100) / 100,
        quizzes: newQuizzes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,week_start' });
  } catch (err) {
    // Non-fatal — leaderboard is supplementary
    console.warn('Leaderboard weekly upsert failed (non-fatal):', err?.message);
  }

  // ── All-time table: same rolling average ──────────────────────────
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

    await supabase
      .from('quiz_scores_alltime')
      .upsert({
        user_id: userId,
        display_name: displayName || 'Anonymous',
        program: program || '',
        campus: campus || '',
        score: Math.round(atScore * 100) / 100,
        quizzes: atQuizzes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
  } catch (err) {
    console.warn('Leaderboard all-time upsert failed (non-fatal):', err?.message);
  }
}
