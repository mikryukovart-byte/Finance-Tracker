CREATE TABLE IF NOT EXISTS "DailyActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT,
    "value" TEXT,
    "nextStep" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyActionLog_userId_date_idx"
ON "DailyActionLog"("userId", "date");

CREATE INDEX IF NOT EXISTS "DailyActionLog_userId_weekStartDate_idx"
ON "DailyActionLog"("userId", "weekStartDate");

CREATE INDEX IF NOT EXISTS "DailyActionLog_userId_type_idx"
ON "DailyActionLog"("userId", "type");

ALTER TABLE public."DailyActionLog" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DailyActionLog_select_own" ON public."DailyActionLog";
DROP POLICY IF EXISTS "DailyActionLog_insert_own" ON public."DailyActionLog";
DROP POLICY IF EXISTS "DailyActionLog_update_own" ON public."DailyActionLog";
DROP POLICY IF EXISTS "DailyActionLog_delete_own" ON public."DailyActionLog";

CREATE POLICY "DailyActionLog_select_own" ON public."DailyActionLog"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "DailyActionLog_insert_own" ON public."DailyActionLog"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "DailyActionLog_update_own" ON public."DailyActionLog"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "DailyActionLog_delete_own" ON public."DailyActionLog"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);
