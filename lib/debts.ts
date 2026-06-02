export type DebtLike = {
  accountId?: string | null;
  debtType?: string;
  initialAmount: number | null;
  remainingAmount: number;
  monthlyPayment: number | null;
  plannedPayment?: number | null;
  minimalPayment?: number | null;
  account?: {
    currentDebt: number;
    minimalPayment?: number | null;
  } | null;
  status: string;
};

type CreditCardAccountLike = {
  id?: string;
  type: string;
  currentDebt: number;
  minimalPayment?: number | null;
};

export function getEffectiveDebtAmount(debt: DebtLike) {
  if (debt.debtType === "CREDIT_CARD" && debt.account) {
    return debt.account.currentDebt;
  }

  return debt.remainingAmount;
}

export function getPlannedDebtPayment(debt: DebtLike) {
  if (debt.debtType === "CREDIT_CARD") {
    return debt.account?.minimalPayment ?? debt.minimalPayment ?? debt.monthlyPayment ?? 0;
  }

  return debt.plannedPayment ?? debt.minimalPayment ?? debt.monthlyPayment ?? 0;
}

export function getDebtProgress(debt: Pick<DebtLike, "initialAmount" | "remainingAmount">) {
  if (!debt.initialAmount || debt.initialAmount <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, ((debt.initialAmount - debt.remainingAmount) / debt.initialAmount) * 100)
  );
}

export function getDebtSummary(loans: DebtLike[], accounts: CreditCardAccountLike[] = []) {
  const openLoans = loans.filter((loan) => loan.status !== "CLOSED");
  const creditCardAccounts = accounts.filter((account) => account.type === "CREDIT_CARD");
  const creditCardAccountIds = new Set(
    creditCardAccounts.map((account) => account.id).filter(Boolean)
  );
  const creditCardAccountDebt = creditCardAccounts.reduce(
    (sum, account) => sum + Math.max(0, account.currentDebt),
    0
  );
  const loansForDebt = accounts.length
    ? openLoans.filter(
        (loan) =>
          loan.debtType !== "CREDIT_CARD" ||
          !loan.accountId ||
          !creditCardAccountIds.has(loan.accountId)
      )
    : openLoans;
  const totalDebt =
    loansForDebt.reduce((sum, loan) => sum + getEffectiveDebtAmount(loan), 0) +
    creditCardAccountDebt;
  const totalInitialDebt = openLoans.reduce(
    (sum, loan) => sum + (loan.initialAmount ?? 0),
    0
  );
  const paidAmount = openLoans.reduce((sum, loan) => {
    if (!loan.initialAmount) {
      return sum;
    }

    return sum + Math.max(0, loan.initialAmount - getEffectiveDebtAmount(loan));
  }, 0);

  return {
    totalDebt,
    paymentsThisMonth:
      loansForDebt
        .filter((loan) => loan.status === "ACTIVE")
        .reduce((sum, loan) => sum + getPlannedDebtPayment(loan), 0) +
      creditCardAccounts.reduce(
        (sum, account) => sum + (account.minimalPayment ?? 0),
        0
      ),
    totalInitialDebt,
    paidAmount,
    paidPercent: totalInitialDebt > 0 ? (paidAmount / totalInitialDebt) * 100 : 0
  };
}
