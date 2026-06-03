ALTER TABLE "Account"
ADD COLUMN "availableCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "interestRate" DOUBLE PRECISION;

UPDATE "Account"
SET "availableCredit" = 0,
    "balance" = 0
WHERE "type" = 'CREDIT_CARD';
