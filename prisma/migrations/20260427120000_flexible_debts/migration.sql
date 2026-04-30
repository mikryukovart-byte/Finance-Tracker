-- Make existing loans flexible without losing old records.
ALTER TABLE "Loan" ADD COLUMN "debtType" TEXT NOT NULL DEFAULT 'BANK_LOAN';
ALTER TABLE "Loan" ADD COLUMN "plannedPayment" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "minimalPayment" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "creditLimit" DOUBLE PRECISION;

UPDATE "Loan"
SET "plannedPayment" = "monthlyPayment"
WHERE "plannedPayment" IS NULL AND "monthlyPayment" IS NOT NULL;

ALTER TABLE "Loan" ALTER COLUMN "initialAmount" DROP NOT NULL;
ALTER TABLE "Loan" ALTER COLUMN "monthlyPayment" DROP NOT NULL;
ALTER TABLE "Loan" ALTER COLUMN "interestRate" DROP NOT NULL;
ALTER TABLE "Loan" ALTER COLUMN "paymentDate" DROP NOT NULL;

CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanPayment_transactionId_key" ON "LoanPayment"("transactionId");
CREATE INDEX "LoanPayment_userId_date_idx" ON "LoanPayment"("userId", "date");
CREATE INDEX "LoanPayment_userId_loanId_idx" ON "LoanPayment"("userId", "loanId");
CREATE INDEX "LoanPayment_loanId_date_idx" ON "LoanPayment"("loanId", "date");
CREATE INDEX "Loan_userId_debtType_idx" ON "Loan"("userId", "debtType");

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
