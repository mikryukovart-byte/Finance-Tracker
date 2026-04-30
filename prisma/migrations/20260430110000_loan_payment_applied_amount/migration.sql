ALTER TABLE "LoanPayment" ADD COLUMN "appliedAmount" DOUBLE PRECISION;

UPDATE "LoanPayment"
SET "appliedAmount" = "amount"
WHERE "appliedAmount" IS NULL;
