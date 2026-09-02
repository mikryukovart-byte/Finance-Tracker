-- Persisted Advisor V2 reviews are server-only.
-- This migration is idempotent and may also be applied in Supabase SQL Editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public."AdvisorReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'ai',
  "contextSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdvisorReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdvisorReport_userId_createdAt_idx"
  ON public."AdvisorReport"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdvisorReport_userId_periodStart_periodEnd_idx"
  ON public."AdvisorReport"("userId", "periodStart", "periodEnd");

ALTER TABLE public."AdvisorReport" ENABLE ROW LEVEL SECURITY;

-- No browser Data API policy is created. Prisma uses the server database role;
-- public, anon and authenticated Data API roles cannot access this table.
DO $security$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AdvisorReport'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END
$security$;

REVOKE ALL PRIVILEGES ON TABLE public."AdvisorReport" FROM PUBLIC;

DO $security$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."AdvisorReport" FROM %I',
        data_api_role
      );
    END IF;
  END LOOP;
END
$security$;

COMMIT;
