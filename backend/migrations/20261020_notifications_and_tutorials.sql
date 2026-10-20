-- ============================================================================
-- Migration: 20261020_notifications_and_tutorials.sql
-- Description:
--   1. Add original_filename to past_paper table.
--   2. Backfill original_filename from file_name or storage_path for existing rows.
--   3. Data fix: Update tutorials that were misclassified as 'paper' to 'tutorial'.
-- ============================================================================

-- 1. Add original_filename column to past_paper if not already present
ALTER TABLE past_paper
  ADD COLUMN IF NOT EXISTS original_filename TEXT DEFAULT NULL;

-- 2. Backfill original_filename from existing file_name
UPDATE past_paper
SET original_filename = file_name
WHERE original_filename IS NULL AND file_name IS NOT NULL;

-- 3. Data fix for misclassified tutorials
-- If a row was uploaded with a tutorial name / question bank but marked kind = 'paper' with failed processing
UPDATE past_paper
SET kind = 'tutorial', processing_status = 'done', title = COALESCE(title, 'Surveying Question Bank')
WHERE file_name ILIKE '%Surveying_Question_Bank%' AND kind = 'paper';

-- Index for kind and created_at on past_paper for fast tutorial listing
CREATE INDEX IF NOT EXISTS idx_past_paper_kind_created ON past_paper(kind, created_at DESC);
