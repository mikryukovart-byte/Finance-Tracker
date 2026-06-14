CREATE TABLE "AnnualGoalPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "pointA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointAMode" TEXT NOT NULL DEFAULT 'AUTO',
    "c1Target" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "c2Target" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "c3Target" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthMode" TEXT NOT NULL DEFAULT 'LINEAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualGoalPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnualGoalRow" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "month" INTEGER,
    "c1Value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "c2Value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "c3Value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kpiText" TEXT,
    "signatureText" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualGoalRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlyTaktLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyTaktLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnualGoalPlan_userId_year_key" ON "AnnualGoalPlan"("userId", "year");
CREATE INDEX "AnnualGoalPlan_userId_year_idx" ON "AnnualGoalPlan"("userId", "year");
CREATE UNIQUE INDEX "AnnualGoalRow_planId_rowKey_key" ON "AnnualGoalRow"("planId", "rowKey");
CREATE INDEX "AnnualGoalRow_planId_month_idx" ON "AnnualGoalRow"("planId", "month");
CREATE UNIQUE INDEX "MonthlyTaktLevel_userId_year_level_key" ON "MonthlyTaktLevel"("userId", "year", "level");
CREATE INDEX "MonthlyTaktLevel_userId_year_idx" ON "MonthlyTaktLevel"("userId", "year");

ALTER TABLE "AnnualGoalRow"
ADD CONSTRAINT "AnnualGoalRow_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "AnnualGoalPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."AnnualGoalPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnnualGoalRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MonthlyTaktLevel" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AnnualGoalPlan_select_own" ON public."AnnualGoalPlan"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "AnnualGoalPlan_insert_own" ON public."AnnualGoalPlan"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "AnnualGoalPlan_update_own" ON public."AnnualGoalPlan"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "AnnualGoalPlan_delete_own" ON public."AnnualGoalPlan"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "AnnualGoalRow_select_own" ON public."AnnualGoalRow"
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public."AnnualGoalPlan"
        WHERE "AnnualGoalPlan"."id" = "AnnualGoalRow"."planId"
          AND "AnnualGoalPlan"."userId" = auth.uid()::text
    )
);

CREATE POLICY "AnnualGoalRow_insert_own" ON public."AnnualGoalRow"
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public."AnnualGoalPlan"
        WHERE "AnnualGoalPlan"."id" = "AnnualGoalRow"."planId"
          AND "AnnualGoalPlan"."userId" = auth.uid()::text
    )
);

CREATE POLICY "AnnualGoalRow_update_own" ON public."AnnualGoalRow"
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public."AnnualGoalPlan"
        WHERE "AnnualGoalPlan"."id" = "AnnualGoalRow"."planId"
          AND "AnnualGoalPlan"."userId" = auth.uid()::text
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public."AnnualGoalPlan"
        WHERE "AnnualGoalPlan"."id" = "AnnualGoalRow"."planId"
          AND "AnnualGoalPlan"."userId" = auth.uid()::text
    )
);

CREATE POLICY "AnnualGoalRow_delete_own" ON public."AnnualGoalRow"
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public."AnnualGoalPlan"
        WHERE "AnnualGoalPlan"."id" = "AnnualGoalRow"."planId"
          AND "AnnualGoalPlan"."userId" = auth.uid()::text
    )
);

CREATE POLICY "MonthlyTaktLevel_select_own" ON public."MonthlyTaktLevel"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "MonthlyTaktLevel_insert_own" ON public."MonthlyTaktLevel"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "MonthlyTaktLevel_update_own" ON public."MonthlyTaktLevel"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "MonthlyTaktLevel_delete_own" ON public."MonthlyTaktLevel"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);
