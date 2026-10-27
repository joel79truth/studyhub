-- =====================================================================
-- Seed test data for Leaderboard (run in Supabase SQL Editor)
-- This puts dummy entries so the leaderboard renders while real
-- students start submitting quiz scores.
-- =====================================================================

-- STEP 1: Temporarily drop FK constraint so we can seed with fake UUIDs
ALTER TABLE public.quiz_scores DROP CONSTRAINT IF EXISTS quiz_scores_user_id_fkey;
ALTER TABLE public.quiz_scores_alltime DROP CONSTRAINT IF EXISTS quiz_scores_alltime_user_id_fkey;

-- STEP 2: Seed weekly scores (week of Oct 27, 2026)
INSERT INTO public.quiz_scores (user_id, week_start, display_name, program, campus, score, quizzes)
VALUES
  (gen_random_uuid(), '2026-10-27', 'Chisomo Banda',      'BSc Agronomy',                    'Bunda', 92.5, 8),
  (gen_random_uuid(), '2026-10-27', 'Takondwa Phiri',     'BSc Agricultural Economics',      'Bunda', 88.0, 6),
  (gen_random_uuid(), '2026-10-27', 'Kondwani Mwale',     'BSc Food Technology',             'NRC',   85.3, 7),
  (gen_random_uuid(), '2026-10-27', 'Mphatso Chirwa',     'BSc Natural Resources Mgmt',      'NRC',   81.0, 5),
  (gen_random_uuid(), '2026-10-27', 'Tiyamike Gondwe',    'BSc Agribusiness Management',     'Bunda', 78.5, 9),
  (gen_random_uuid(), '2026-10-27', 'Pemphero Nyasulu',   'BSc Animal Science',              'Bunda', 75.0, 4),
  (gen_random_uuid(), '2026-10-27', 'Lusungu Tembo',      'BSc Human Nutrition & Dietetics', 'NRC',   72.3, 6),
  (gen_random_uuid(), '2026-10-27', 'Dalitso Kamanga',    'BSc Agricultural Engineering',    'Bunda', 68.8, 5),
  (gen_random_uuid(), '2026-10-27', 'Chimwemwe Mbewe',    'BSc Fisheries & Aquatic Sci',     'Bunda', 65.0, 3),
  (gen_random_uuid(), '2026-10-27', 'Fyness Kayira',      'BSc Horticulture',                'Bunda', 61.5, 4);

-- STEP 3: Seed all-time from the weekly rows
INSERT INTO public.quiz_scores_alltime (user_id, display_name, program, campus, score, quizzes)
SELECT user_id, display_name, program, campus, score, quizzes
FROM public.quiz_scores
WHERE week_start = '2026-10-27'
ON CONFLICT (user_id) DO NOTHING;

-- STEP 4: Re-add FK constraints (only validates new rows, not seed data)
-- Skip re-adding if you want seed data to persist without real auth users.
-- To re-add later when real users exist, run:
-- ALTER TABLE public.quiz_scores ADD CONSTRAINT quiz_scores_user_id_fkey
--   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- ALTER TABLE public.quiz_scores_alltime ADD CONSTRAINT quiz_scores_alltime_user_id_fkey
--   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
