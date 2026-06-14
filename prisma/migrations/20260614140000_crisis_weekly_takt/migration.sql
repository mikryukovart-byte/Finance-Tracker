CREATE TABLE IF NOT EXISTS "CrisisSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acuteReliefTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "normalWorkTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiredDailyExpense" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrisisSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WeeklyHypothesis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "actionPlan" TEXT NOT NULL,
    "expectedResult" TEXT,
    "actualResult" TEXT,
    "conclusion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyHypothesis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrisisSettings_userId_key"
ON "CrisisSettings"("userId");

CREATE INDEX IF NOT EXISTS "CrisisSettings_userId_idx"
ON "CrisisSettings"("userId");

CREATE INDEX IF NOT EXISTS "WeeklyHypothesis_userId_weekStartDate_idx"
ON "WeeklyHypothesis"("userId", "weekStartDate");

CREATE INDEX IF NOT EXISTS "WeeklyHypothesis_userId_status_idx"
ON "WeeklyHypothesis"("userId", "status");

ALTER TABLE public."CrisisSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WeeklyHypothesis" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CrisisSettings_select_own" ON public."CrisisSettings"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "CrisisSettings_insert_own" ON public."CrisisSettings"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "CrisisSettings_update_own" ON public."CrisisSettings"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "CrisisSettings_delete_own" ON public."CrisisSettings"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "WeeklyHypothesis_select_own" ON public."WeeklyHypothesis"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "WeeklyHypothesis_insert_own" ON public."WeeklyHypothesis"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "WeeklyHypothesis_update_own" ON public."WeeklyHypothesis"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "WeeklyHypothesis_delete_own" ON public."WeeklyHypothesis"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);

