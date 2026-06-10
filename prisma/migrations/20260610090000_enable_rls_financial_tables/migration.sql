-- Supabase Row Level Security for user-owned financial data.
-- Do not FORCE RLS here: the Next.js server uses Prisma through DATABASE_URL
-- and already filters every API query by the authenticated userId.

ALTER TABLE public."Account" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account_select_own" ON public."Account";
DROP POLICY IF EXISTS "Account_insert_own" ON public."Account";
DROP POLICY IF EXISTS "Account_update_own" ON public."Account";
DROP POLICY IF EXISTS "Account_delete_own" ON public."Account";
CREATE POLICY "Account_select_own" ON public."Account"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);
CREATE POLICY "Account_insert_own" ON public."Account"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Account_update_own" ON public."Account"
  FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Account_delete_own" ON public."Account"
  FOR DELETE TO authenticated
  USING ("userId" = auth.uid()::text);

ALTER TABLE public."Category" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Category_select_own" ON public."Category";
DROP POLICY IF EXISTS "Category_insert_own" ON public."Category";
DROP POLICY IF EXISTS "Category_update_own" ON public."Category";
DROP POLICY IF EXISTS "Category_delete_own" ON public."Category";
CREATE POLICY "Category_select_own" ON public."Category"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);
CREATE POLICY "Category_insert_own" ON public."Category"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Category_update_own" ON public."Category"
  FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Category_delete_own" ON public."Category"
  FOR DELETE TO authenticated
  USING ("userId" = auth.uid()::text);

ALTER TABLE public."Loan" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Loan_select_own" ON public."Loan";
DROP POLICY IF EXISTS "Loan_insert_own" ON public."Loan";
DROP POLICY IF EXISTS "Loan_update_own" ON public."Loan";
DROP POLICY IF EXISTS "Loan_delete_own" ON public."Loan";
CREATE POLICY "Loan_select_own" ON public."Loan"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);
CREATE POLICY "Loan_insert_own" ON public."Loan"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Loan_update_own" ON public."Loan"
  FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Loan_delete_own" ON public."Loan"
  FOR DELETE TO authenticated
  USING ("userId" = auth.uid()::text);

ALTER TABLE public."LoanPayment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "LoanPayment_select_own" ON public."LoanPayment";
DROP POLICY IF EXISTS "LoanPayment_insert_own" ON public."LoanPayment";
DROP POLICY IF EXISTS "LoanPayment_update_own" ON public."LoanPayment";
DROP POLICY IF EXISTS "LoanPayment_delete_own" ON public."LoanPayment";
CREATE POLICY "LoanPayment_select_own" ON public."LoanPayment"
  FOR SELECT TO authenticated
  USING (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public."Loan"
      WHERE "Loan"."id" = "LoanPayment"."loanId"
        AND "Loan"."userId" = auth.uid()::text
    )
  );
CREATE POLICY "LoanPayment_insert_own" ON public."LoanPayment"
  FOR INSERT TO authenticated
  WITH CHECK (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public."Loan"
      WHERE "Loan"."id" = "LoanPayment"."loanId"
        AND "Loan"."userId" = auth.uid()::text
    )
    AND (
      "transactionId" IS NULL
      OR EXISTS (
        SELECT 1
        FROM public."Transaction"
        WHERE "Transaction"."id" = "LoanPayment"."transactionId"
          AND "Transaction"."userId" = auth.uid()::text
      )
    )
  );
CREATE POLICY "LoanPayment_update_own" ON public."LoanPayment"
  FOR UPDATE TO authenticated
  USING (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public."Loan"
      WHERE "Loan"."id" = "LoanPayment"."loanId"
        AND "Loan"."userId" = auth.uid()::text
    )
  )
  WITH CHECK (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public."Loan"
      WHERE "Loan"."id" = "LoanPayment"."loanId"
        AND "Loan"."userId" = auth.uid()::text
    )
    AND (
      "transactionId" IS NULL
      OR EXISTS (
        SELECT 1
        FROM public."Transaction"
        WHERE "Transaction"."id" = "LoanPayment"."transactionId"
          AND "Transaction"."userId" = auth.uid()::text
      )
    )
  );
CREATE POLICY "LoanPayment_delete_own" ON public."LoanPayment"
  FOR DELETE TO authenticated
  USING (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public."Loan"
      WHERE "Loan"."id" = "LoanPayment"."loanId"
        AND "Loan"."userId" = auth.uid()::text
    )
  );

ALTER TABLE public."Transaction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Transaction_select_own" ON public."Transaction";
DROP POLICY IF EXISTS "Transaction_insert_own" ON public."Transaction";
DROP POLICY IF EXISTS "Transaction_update_own" ON public."Transaction";
DROP POLICY IF EXISTS "Transaction_delete_own" ON public."Transaction";
CREATE POLICY "Transaction_select_own" ON public."Transaction"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);
CREATE POLICY "Transaction_insert_own" ON public."Transaction"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Transaction_update_own" ON public."Transaction"
  FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Transaction_delete_own" ON public."Transaction"
  FOR DELETE TO authenticated
  USING ("userId" = auth.uid()::text);

ALTER TABLE public."Transfer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Transfer_select_own" ON public."Transfer";
DROP POLICY IF EXISTS "Transfer_insert_own" ON public."Transfer";
DROP POLICY IF EXISTS "Transfer_update_own" ON public."Transfer";
DROP POLICY IF EXISTS "Transfer_delete_own" ON public."Transfer";
CREATE POLICY "Transfer_select_own" ON public."Transfer"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);
CREATE POLICY "Transfer_insert_own" ON public."Transfer"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Transfer_update_own" ON public."Transfer"
  FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Transfer_delete_own" ON public."Transfer"
  FOR DELETE TO authenticated
  USING ("userId" = auth.uid()::text);
