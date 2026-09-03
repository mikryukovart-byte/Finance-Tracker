-- Personal operating-system journal, life context and weekly delivery settings.
-- This migration is idempotent and is safe to apply with `prisma db execute`.

BEGIN;

ALTER TABLE public."AdvisorReport"
  ADD COLUMN IF NOT EXISTS "reportKind" TEXT NOT NULL DEFAULT 'ON_DEMAND',
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "AdvisorReport_idempotencyKey_key"
  ON public."AdvisorReport"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AdvisorReport_userId_reportKind_createdAt_idx"
  ON public."AdvisorReport"("userId", "reportKind", "createdAt");
CREATE INDEX IF NOT EXISTS "AdvisorReport_userId_reportKind_periodStart_periodEnd_idx"
  ON public."AdvisorReport"("userId", "reportKind", "periodStart", "periodEnd");

CREATE TABLE IF NOT EXISTS public."JournalEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryDate" DATE NOT NULL,
  "source" TEXT NOT NULL,
  "cleanedText" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "domains" JSONB NOT NULL,
  "keyEvents" JSONB,
  "tensions" JSONB,
  "decisions" JSONB,
  "questions" JSONB,
  "nextStep" TEXT,
  "importance" TEXT NOT NULL DEFAULT 'NORMAL',
  "dailyFeedback" TEXT,
  "feedbackModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JournalEntry_userId_entryDate_idx"
  ON public."JournalEntry"("userId", "entryDate");
CREATE INDEX IF NOT EXISTS "JournalEntry_userId_createdAt_idx"
  ON public."JournalEntry"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "JournalEntry_userId_deletedAt_idx"
  ON public."JournalEntry"("userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "JournalEntry_userId_entryDate_deletedAt_idx"
  ON public."JournalEntry"("userId", "entryDate", "deletedAt");

CREATE TABLE IF NOT EXISTS public."TelegramPendingJournal" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramPendingJournal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TelegramPendingJournal_chatId_expiresAt_idx"
  ON public."TelegramPendingJournal"("chatId", "expiresAt");
CREATE INDEX IF NOT EXISTS "TelegramPendingJournal_expiresAt_idx"
  ON public."TelegramPendingJournal"("expiresAt");

CREATE TABLE IF NOT EXISTS public."LifeContext" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currentSituation" TEXT NOT NULL DEFAULT '',
  "priorities" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "constraints" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "activeProjects" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "deliberatePauses" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "activeDecisions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LifeContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LifeContext_userId_key"
  ON public."LifeContext"("userId");
CREATE INDEX IF NOT EXISTS "LifeContext_userId_idx"
  ON public."LifeContext"("userId");

CREATE TABLE IF NOT EXISTS public."WeeklyDeliverySettings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timezone" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "localTime" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeeklyDeliverySettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyDeliverySettings_userId_key"
  ON public."WeeklyDeliverySettings"("userId");
CREATE INDEX IF NOT EXISTS "WeeklyDeliverySettings_userId_idx"
  ON public."WeeklyDeliverySettings"("userId");

ALTER TABLE public."JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TelegramPendingJournal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LifeContext" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WeeklyDeliverySettings" ENABLE ROW LEVEL SECURITY;

DO $security$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'JournalEntry',
        'TelegramPendingJournal',
        'LifeContext',
        'WeeklyDeliverySettings'
      )
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

REVOKE ALL PRIVILEGES ON TABLE public."JournalEntry" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingJournal" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."LifeContext" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."WeeklyDeliverySettings" FROM PUBLIC;

DO $security$
DECLARE
  data_api_role text;
  protected_table text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      FOREACH protected_table IN ARRAY ARRAY[
        'JournalEntry',
        'TelegramPendingJournal',
        'LifeContext',
        'WeeklyDeliverySettings'
      ]
      LOOP
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          protected_table,
          data_api_role
        );
      END LOOP;
    END IF;
  END LOOP;
END
$security$;

COMMIT;
