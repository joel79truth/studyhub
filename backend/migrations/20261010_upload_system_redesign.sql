-- ============================================================================
-- Migration: 20261010_upload_system_redesign.sql
-- Description: Minimal schema extension for StudyHub upload redesign
--
-- Real Column Types Verified:
--   - courses.id: INTEGER
--   - past_paper.id: UUID
--   - profiles.id: UUID (references auth.users.id)
--   - paper_questions.id: UUID
--   - paper_questions.course_id: INTEGER
--   - paper_questions.past_paper_id: UUID
--   - paper_questions.paper_id: UUID
--   - paper_questions.page_number: INTEGER (already present)
--
-- Note on past_papers:
--   `past_papers` is a SQL VIEW over `paper_questions`. Do NOT run ALTER TABLE on it.
--   page_number is already maintained on the underlying paper_questions table.
-- ============================================================================

-- 1. Extend `past_paper` table with content kind, title, source_type, page_count, and uploaded_by
--    This keeps the design minimal and unified without breaking old rows.
ALTER TABLE past_paper
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'paper' CHECK (kind IN ('paper', 'tutorial')),
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'pdf' CHECK (source_type IN ('photos', 'typed_pdf', 'scanned_pdf', 'pdf')),
  ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_past_paper_kind ON past_paper(kind);
CREATE INDEX IF NOT EXISTS idx_past_paper_uploaded_by ON past_paper(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_past_paper_course_year ON past_paper(course_id, semester);

-- 2. Storage Bucket for Document Files / Scanned PDFs
--    Ensure the bucket exists and is publicly readable for client document viewing.
INSERT INTO storage.buckets (id, name, public)
VALUES ('past-paper', 'past-paper', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage Bucket Policy: Authenticated/Public Read, Service-Role Write Only
--    Drop existing public select policy if needed and recreate cleanly
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
      AND policyname = 'Allow public read past-paper'
  ) THEN
    CREATE POLICY "Allow public read past-paper"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'past-paper');
  END IF;
END $$;

-- 4. Guard against privilege escalation on `profiles`
CREATE OR REPLACE FUNCTION check_no_admin_elevation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'Students cannot alter their admin status.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_elevation ON profiles;
CREATE TRIGGER trg_prevent_admin_elevation
BEFORE UPDATE ON profiles
FOR EACH ROW
WHEN (auth.role() = 'authenticated')
EXECUTE FUNCTION check_no_admin_elevation();
