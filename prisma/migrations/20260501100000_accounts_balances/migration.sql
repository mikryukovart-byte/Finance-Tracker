CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEBIT',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "creditLimit" DOUBLE PRECISION,
    "currentDebt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimalPayment" DOUBLE PRECISION,
    "paymentDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Account_id_userId_key" ON "Account"("id", "userId");
CREATE UNIQUE INDEX "Account_userId_name_key" ON "Account"("userId", "name");
CREATE INDEX "Account_userId_type_idx" ON "Account"("userId", "type");
CREATE INDEX "Account_userId_currency_idx" ON "Account"("userId", "currency");

WITH users AS (
    SELECT DISTINCT "userId" FROM "Category"
    UNION
    SELECT DISTINCT "userId" FROM "Transaction"
    UNION
    SELECT DISTINCT "userId" FROM "Loan"
),
balances AS (
    SELECT
        "userId",
        COALESCE(SUM(CASE WHEN "type" = 'INCOME' THEN "amount" ELSE -"amount" END), 0) AS "balance"
    FROM "Transaction"
    GROUP BY "userId"
)
INSERT INTO "Account" ("id", "userId", "name", "balance", "currency", "updatedAt")
SELECT
    'default_' || md5(users."userId"),
    users."userId",
    'Основной счет',
    COALESCE(balances."balance", 0),
    'RUB',
    CURRENT_TIMESTAMP
FROM users
LEFT JOIN balances ON balances."userId" = users."userId";

ALTER TABLE "Transaction" ADD COLUMN "accountId" TEXT;

UPDATE "Transaction"
SET "accountId" = 'default_' || md5("userId")
WHERE "accountId" IS NULL;

CREATE INDEX "Transaction_userId_accountId_idx" ON "Transaction"("userId", "accountId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_userId_fkey"
FOREIGN KEY ("accountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Loan" ADD COLUMN "accountId" TEXT;
CREATE INDEX "Loan_userId_accountId_idx" ON "Loan"("userId", "accountId");

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_accountId_userId_fkey"
FOREIGN KEY ("accountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Transfer_userId_date_idx" ON "Transfer"("userId", "date");
CREATE INDEX "Transfer_userId_fromAccountId_idx" ON "Transfer"("userId", "fromAccountId");
CREATE INDEX "Transfer_userId_toAccountId_idx" ON "Transfer"("userId", "toAccountId");

ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromAccountId_userId_fkey"
FOREIGN KEY ("fromAccountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toAccountId_userId_fkey"
FOREIGN KEY ("toAccountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
