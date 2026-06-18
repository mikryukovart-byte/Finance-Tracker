ALTER TABLE "DailyActionLog"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DailyActionLog_userId_deletedAt_idx"
ON "DailyActionLog"("userId", "deletedAt");

CREATE INDEX IF NOT EXISTS "DailyActionLog_userId_date_deletedAt_idx"
ON "DailyActionLog"("userId", "date", "deletedAt");
