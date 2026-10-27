-- =====================================================================
-- Supabase Migration: Leaderboard tables for StudyHub LUANAR
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =====================================================================

-- 1. Weekly quiz scores (one row per user per week)
CREATE TABLE IF NOT EXISTS public.quiz_scores (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start    date NOT NULL,            -- Monday of the week (YYYY-MM-DD)
  display_name  text NOT NULL DEFAULT '',
  program       text DEFAULT '',
  campus        text DEFAULT '',
  score         numeric(5,2) DEFAULT 0,   -- Average % score this week
  quizzes       integer DEFAULT 0,        -- Number of quizzes taken this week
  updated_at    timestamptz DEFAULT now(),

  UNIQUE(user_id, week_start)
);

-- 2. All-time aggregated scores (one row per user, updated on each quiz)
CREATE TABLE IF NOT EXISTS public.quiz_scores_alltime (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  display_name  text NOT NULL DEFAULT '',
  program       text DEFAULT '',
  campus        text DEFAULT '',
  score         numeric(5,2) DEFAULT 0,   -- Lifetime average %
  quizzes       integer DEFAULT 0,        -- Total quizzes taken
  updated_at    timestamptz DEFAULT now()
);

-- 3. Indexes for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_quiz_scores_week ON public.quiz_scores(week_start, score DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_program ON public.quiz_scores(program, week_start, score DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_alltime_score ON public.quiz_scores_alltime(score DESC);

-- 4. Row Level Security — users can read all rows, only write their own
ALTER TABLE public.quiz_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_scores_alltime ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read (leaderboard is public within the app)
CREATE POLICY "quiz_scores_read_all"
  ON public.quiz_scores FOR SELECT USING (true);

CREATE POLICY "quiz_scores_alltime_read_all"
  ON public.quiz_scores_alltime FOR SELECT USING (true);

-- Users can only insert/update their own row
CREATE POLICY "quiz_scores_write_own"
  ON public.quiz_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "quiz_scores_update_own"
  ON public.quiz_scores FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "quiz_scores_alltime_write_own"
  ON public.quiz_scores_alltime FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "quiz_scores_alltime_update_own"
  ON public.quiz_scores_alltime FOR UPDATE USING (auth.uid() = user_id);
