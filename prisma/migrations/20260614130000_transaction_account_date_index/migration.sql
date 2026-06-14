CREATE INDEX IF NOT EXISTS "Transaction_userId_accountId_date_idx"
ON "Transaction"("userId", "accountId", "date");

