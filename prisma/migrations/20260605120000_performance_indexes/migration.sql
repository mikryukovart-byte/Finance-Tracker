CREATE INDEX IF NOT EXISTS "Transaction_userId_type_date_idx" ON "Transaction"("userId", "type", "date");
CREATE INDEX IF NOT EXISTS "Transaction_userId_categoryId_date_idx" ON "Transaction"("userId", "categoryId", "date");
