-- One-time Telegram LifeContext previews. Server-only and safe for an
-- existing production database with non-baselined Prisma migration history.

BEGIN;

CREATE TABLE IF NOT EXISTS public."TelegramPendingLifeContext" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramPendingLifeContext_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TelegramPendingLifeContext_chatId_userId_expiresAt_idx"
  ON public."TelegramPendingLifeContext"("chatId", "userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "TelegramPendingLifeContext_expiresAt_idx"
  ON public."TelegramPendingLifeContext"("expiresAt");

ALTER TABLE public."TelegramPendingLifeContext" ENABLE ROW LEVEL SECURITY;

DO $security$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'TelegramPendingLifeContext'
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

REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingLifeContext" FROM PUBLIC;

DO $security$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingLifeContext" FROM %I',
        data_api_role
      );
    END IF;
  END LOOP;
END
$security$;

COMMIT;
