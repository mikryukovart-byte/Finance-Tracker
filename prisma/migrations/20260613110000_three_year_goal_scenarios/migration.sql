CREATE TABLE "ThreeYearGoalScenario" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "pointC" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreeYearGoalScenario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreeYearGoalScenario_userId_year_speed_key"
ON "ThreeYearGoalScenario"("userId", "year", "speed");

CREATE INDEX "ThreeYearGoalScenario_userId_year_idx"
ON "ThreeYearGoalScenario"("userId", "year");

ALTER TABLE public."ThreeYearGoalScenario" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ThreeYearGoalScenario_select_own" ON public."ThreeYearGoalScenario"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

CREATE POLICY "ThreeYearGoalScenario_insert_own" ON public."ThreeYearGoalScenario"
FOR INSERT TO authenticated
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "ThreeYearGoalScenario_update_own" ON public."ThreeYearGoalScenario"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "ThreeYearGoalScenario_delete_own" ON public."ThreeYearGoalScenario"
FOR DELETE TO authenticated
USING ("userId" = auth.uid()::text);
