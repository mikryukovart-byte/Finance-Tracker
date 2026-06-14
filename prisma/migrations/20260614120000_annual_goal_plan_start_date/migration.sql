ALTER TABLE "AnnualGoalPlan"
ADD COLUMN IF NOT EXISTS "planStartDate" TIMESTAMP(3);

UPDATE "AnnualGoalPlan"
SET "planStartDate" = "createdAt"
WHERE "planStartDate" IS NULL;

ALTER TABLE "AnnualGoalPlan"
ALTER COLUMN "planStartDate" SET NOT NULL,
ALTER COLUMN "planStartDate" SET DEFAULT CURRENT_TIMESTAMP;
