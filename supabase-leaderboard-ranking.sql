-- =====================================================================
-- Add computed ranking column to leaderboard tables
-- Run in Supabase SQL Editor
-- =====================================================================

-- 1. Add composite_score column to both tables
ALTER TABLE public.quiz_scores
  ADD COLUMN IF NOT EXISTS composite_score numeric(7,2) DEFAULT 0;

ALTER TABLE public.quiz_scores_alltime
  ADD COLUMN IF NOT EXISTS composite_score numeric(7,2) DEFAULT 0;

-- 2. Create a function that computes the composite score
-- Formula: (avg_score * 0.7) + LEAST(quizzes * 3, 30)
--   - Score accuracy = 70%  (max contribution: 70 pts from 100% score)
--   - Quiz volume    = 30%  (capped at 30 pts = 10 quizzes, so you can't just grind)
CREATE OR REPLACE FUNCTION public.compute_composite(p_score numeric, p_quizzes integer)
RETURNS numeric AS $$
  SELECT ROUND((p_score * 0.7) + LEAST(p_quizzes * 3.0, 30.0), 2);
$$ LANGUAGE SQL IMMUTABLE;

-- 3. Backfill existing rows
UPDATE public.quiz_scores
  SET composite_score = public.compute_composite(score, quizzes);

UPDATE public.quiz_scores_alltime
  SET composite_score = public.compute_composite(score, quizzes);

-- 4. Create indexes on composite_score for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_quiz_scores_composite
  ON public.quiz_scores(week_start, composite_score DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_scores_alltime_composite
  ON public.quiz_scores_alltime(composite_score DESC);

-- Done! The app will now order by composite_score DESC, updated_at ASC (tiebreaker)
