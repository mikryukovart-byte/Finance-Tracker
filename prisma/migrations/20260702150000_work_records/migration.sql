-- Work records and their Telegram confirmation drafts are server-only.
-- This migration is idempotent and may also be applied in Supabase SQL Editor.

BEGIN;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkRecordType') THEN
    CREATE TYPE "WorkRecordType" AS ENUM (
      'NOTE',
      'DECISION',
      'RISK',
      'IDEA',
      'DAILY_REFLECTION',
      'WEEKLY_PLAN_DRAFT',
      'HYPOTHESIS_DRAFT',
      'ACTION_CANDIDATE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkRecordSource') THEN
    CREATE TYPE "WorkRecordSource" AS ENUM (
      'TELEGRAM_TEXT',
      'TELEGRAM_VOICE',
      'WEB_MANUAL'
    );
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS public."WorkRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "recordType" "WorkRecordType" NOT NULL,
  "summary" TEXT NOT NULL,
  "insight" TEXT,
  "risk" TEXT,
  "nextStep" TEXT,
  "relatedWeekStart" DATE,
  "source" "WorkRecordSource" NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."TelegramPendingWorkRecord" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramPendingWorkRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkRecord_userId_createdAt_idx"
  ON public."WorkRecord"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkRecord_userId_recordType_createdAt_idx"
  ON public."WorkRecord"("userId", "recordType", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkRecord_userId_recordType_deletedAt_idx"
  ON public."WorkRecord"("userId", "recordType", "deletedAt");
CREATE INDEX IF NOT EXISTS "WorkRecord_userId_relatedWeekStart_idx"
  ON public."WorkRecord"("userId", "relatedWeekStart");
CREATE INDEX IF NOT EXISTS "WorkRecord_userId_deletedAt_idx"
  ON public."WorkRecord"("userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "TelegramPendingWorkRecord_chatId_expiresAt_idx"
  ON public."TelegramPendingWorkRecord"("chatId", "expiresAt");
CREATE INDEX IF NOT EXISTS "TelegramPendingWorkRecord_expiresAt_idx"
  ON public."TelegramPendingWorkRecord"("expiresAt");

ALTER TABLE public."WorkRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TelegramPendingWorkRecord" ENABLE ROW LEVEL SECURITY;

-- No browser Data API policy is created. Server Prisma access continues via its
-- privileged database role, while anon/authenticated requests are denied.
DO $security$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('WorkRecord', 'TelegramPendingWorkRecord')
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

REVOKE ALL PRIVILEGES ON TABLE public."WorkRecord" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingWorkRecord" FROM PUBLIC;

DO $security$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."WorkRecord" FROM %I',
        data_api_role
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingWorkRecord" FROM %I',
        data_api_role
      );
    END IF;
  END LOOP;
END
$security$;

COMMIT;
