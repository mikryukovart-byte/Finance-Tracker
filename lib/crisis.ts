import { getAssetAccountBalance } from "@/lib/accounts";
import { getDebtSummary } from "@/lib/debts";
import { startOfMonth } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import type { CrisisControl } from "@/types/finance";

type CrisisAccount = {
  type: string;
  balance: number;
  creditLimit: number | null;
  currentDebt: number;
  availableCredit: number;
  minimalPayment: number | null;
  interestRate: number | null;
};

type CrisisLoan = {
  debtType: string;
  accountId: string | null;
  initialAmount: number | null;
  remainingAmount: number;
  monthlyPayment: number | null;
  plannedPayment: number | null;
  minimalPayment: number | null;
  interestRate: number | null;
  status: string;
  account?: {
    currentDebt: number;
    minimalPayment: number | null;
  } | null;
};

function daysElapsedInMonth(now = new Date()) {
  return Math.max(1, now.getDate());
}

function estimateInterestLeakage(accounts: CrisisAccount[], loans: CrisisLoan[]) {
  let hasInterestData = false;
  let total = 0;

  for (const account of accounts) {
    if (account.type !== "CREDIT_CARD" || !account.interestRate || account.currentDebt <= 0) {
      continue;
    }

    hasInterestData = true;
    total += (account.currentDebt * account.interestRate) / 100 / 12;
  }

  for (const loan of loans) {
    if (loan.debtType === "CREDIT_CARD" || !loan.interestRate || loan.remainingAmount <= 0) {
      continue;
    }

    hasInterestData = true;
    total += (loan.remainingAmount * loan.interestRate) / 100 / 12;
  }

  return hasInterestData ? total : null;
}

function serializeCrisisSettings(settings: Awaited<ReturnType<typeof getOrCreateCrisisSettings>>) {
  return {
    ...settings,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

export async function getOrCreateCrisisSettings(userId: string) {
  const existing = await prisma.crisisSettings.findUnique({
    where: { userId }
  });

  if (existing) {
    return existing;
  }

  return prisma.crisisSettings.create({
    data: { userId }
  });
}

export async function getCrisisControl(userId: string): Promise<CrisisControl> {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const [settings, accounts, loans, monthExpense] = await Promise.all([
    getOrCreateCrisisSettings(userId),
    prisma.account.findMany({
      where: { userId },
      select: {
        type: true,
        balance: true,
        creditLimit: true,
        currentDebt: true,
        availableCredit: true,
        minimalPayment: true,
        interestRate: true
      }
    }),
    prisma.loan.findMany({
      where: { userId, status: { not: "CLOSED" } },
      select: {
        debtType: true,
        accountId: true,
        initialAmount: true,
        remainingAmount: true,
        monthlyPayment: true,
        plannedPayment: true,
        minimalPayment: true,
        interestRate: true,
        status: true,
        account: {
          select: {
            currentDebt: true,
            minimalPayment: true
          }
        }
      }
    }),
    prisma.transaction.aggregate({
      where: {
        userId,
        type: "EXPENSE",
        date: {
          gte: monthStart,
          lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
        }
      },
      _sum: { amount: true }
    })
  ]);

  const realMoney = getAssetAccountBalance(accounts);
  const debtSummary = getDebtSummary(loans, accounts);
  const totalDebt = debtSummary.totalDebt;
  const monthlyRequiredPayments = debtSummary.paymentsThisMonth;
  const monthlyExpense = monthExpense._sum.amount ?? 0;
  const inferredDailyExpense =
    monthlyExpense > 0 ? monthlyExpense / daysElapsedInMonth(now) : null;
  const requiredDailyExpenses =
    settings.requiredDailyExpense && settings.requiredDailyExpense > 0
      ? settings.requiredDailyExpense
      : inferredDailyExpense;
  const requiredExpenses7Days =
    requiredDailyExpenses !== null ? requiredDailyExpenses * 7 : null;
  const requiredExpenses30Days =
    requiredDailyExpenses !== null ? requiredDailyExpenses * 30 : null;
  const daysUntilZero =
    requiredDailyExpenses && requiredDailyExpenses > 0
      ? realMoney / requiredDailyExpenses
      : null;
  const interestLeakage = estimateInterestLeakage(accounts, loans);
  const creditCardOverLimitAmount = accounts
    .filter((account) => account.type === "CREDIT_CARD")
    .reduce(
      (sum, account) => sum + Math.max(0, account.currentDebt - (account.creditLimit ?? 0)),
      0
    );
  const acuteReliefTarget =
    settings.acuteReliefTarget > 0
      ? settings.acuteReliefTarget
      : (requiredExpenses7Days ?? 0) + monthlyRequiredPayments;
  const normalWorkTarget =
    settings.normalWorkTarget > 0
      ? settings.normalWorkTarget
      : (requiredExpenses30Days ?? 0) + monthlyRequiredPayments;
  const isCritical =
    requiredExpenses7Days !== null ? realMoney < requiredExpenses7Days : false;
  const warnings = [
    isCritical
      ? "Антикризисный режим: сначала деньги на жизнь и обязательные платежи."
      : "",
    creditCardOverLimitAmount > 0
      ? "Кредитка выше лимита. Приоритет: закрыть превышение и минимальный платеж."
      : "",
    requiredDailyExpenses === null ? "Недостаточно данных по обязательным расходам." : "",
    interestLeakage === null ? "Данные по процентам неполные" : ""
  ].filter(Boolean);

  return {
    settings: serializeCrisisSettings(settings),
    realMoney,
    totalDebt,
    monthlyRequiredPayments,
    interestLeakage,
    interestDataStatus: interestLeakage === null ? "incomplete" : "complete",
    requiredDailyExpenses,
    requiredExpenses7Days,
    requiredExpenses30Days,
    daysUntilZero,
    acuteReliefTarget,
    normalWorkTarget,
    isCritical,
    creditCardOverLimit: creditCardOverLimitAmount > 0,
    creditCardOverLimitAmount,
    warnings
  };
}
