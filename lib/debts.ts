export type DebtLike = {
  initialAmount: number | null;
  remainingAmount: number;
  monthlyPayment: number | null;
  plannedPayment?: number | null;
  minimalPayment?: number | null;
  status: string;
};

export function getPlannedDebtPayment(debt: DebtLike) {
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

export function getDebtSummary(loans: DebtLike[]) {
  const openLoans = loans.filter((loan) => loan.status !== "CLOSED");
  const totalDebt = openLoans.reduce((sum, loan) => sum + loan.remainingAmount, 0);
  const totalInitialDebt = openLoans.reduce(
    (sum, loan) => sum + (loan.initialAmount ?? 0),
    0
  );
  const paidAmount = openLoans.reduce((sum, loan) => {
    if (!loan.initialAmount) {
      return sum;
    }

    return sum + Math.max(0, loan.initialAmount - loan.remainingAmount);
  }, 0);

  return {
    totalDebt,
    paymentsThisMonth: openLoans
      .filter((loan) => loan.status === "ACTIVE")
      .reduce((sum, loan) => sum + getPlannedDebtPayment(loan), 0),
    totalInitialDebt,
    paidAmount,
    paidPercent: totalInitialDebt > 0 ? (paidAmount / totalInitialDebt) * 100 : 0
  };
}
