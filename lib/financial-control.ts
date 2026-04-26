import {
  endOfDay,
  endOfMonth,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfYear
} from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";

const dayMs = 24 * 60 * 60 * 1000;

type TransactionWithCategory = {
  id: string;
  amount: number;
  type: string;
  date: Date;
  description: string | null;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    userId: string;
    name: string;
    type: string;
    createdAt: Date;
    updatedAt: Date;
  };
};

type LoanForControl = {
  initialAmount: number;
  remainingAmount: number;
  monthlyPayment: number;
  status: string;
};

function toDayKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function normalizeDescription(value: string | null) {
  return (value || "Без описания").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export function parseLeakageThreshold(value: string | null) {
  const parsed = Number(value?.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function buildDailyControl(transactions: TransactionWithCategory[], now: Date) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const dateKeys = new Set(transactions.map((transaction) => toDayKey(transaction.date)));
  let streak = 0;
  let cursor = todayStart;

  while (dateKeys.has(toDayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - dayMs);
  }

  const todaySpending = transactions
    .filter(
      (transaction) =>
        transaction.type === "EXPENSE" &&
        transaction.date >= todayStart &&
        transaction.date < todayEnd
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    hasTransactionsToday: transactions.some(
      (transaction) => transaction.date >= todayStart && transaction.date < todayEnd
    ),
    todaySpending,
    transactionStreakDays: streak,
    lastTransactionDate: transactions[0]?.date.toISOString() ?? null
  };
}

function buildLeakage(
  monthTransactions: TransactionWithCategory[],
  monthlyIncome: number,
  threshold: number
) {
  const smallExpenses = monthTransactions
    .filter((transaction) => transaction.type === "EXPENSE" && transaction.amount < threshold)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalSmallExpenses = smallExpenses.reduce(
    (sum, transaction) => sum + transaction.amount,
    0
  );
  const categoryMap = new Map<
    string,
    { categoryId: string; name: string; amount: number; count: number }
  >();
  const repeatedMap = new Map<
    string,
    {
      key: string;
      description: string;
      categoryName: string;
      count: number;
      total: number;
      lastDate: string;
    }
  >();

  for (const transaction of smallExpenses) {
    const category = categoryMap.get(transaction.categoryId) ?? {
      categoryId: transaction.categoryId,
      name: transaction.category.name,
      amount: 0,
      count: 0
    };
    category.amount += transaction.amount;
    category.count += 1;
    categoryMap.set(transaction.categoryId, category);

    const description = normalizeDescription(transaction.description);
    const key = `${transaction.categoryId}:${description}`;
    const repeated = repeatedMap.get(key) ?? {
      key,
      description,
      categoryName: transaction.category.name,
      count: 0,
      total: 0,
      lastDate: transaction.date.toISOString()
    };
    repeated.count += 1;
    repeated.total += transaction.amount;
    if (new Date(repeated.lastDate) < transaction.date) {
      repeated.lastDate = transaction.date.toISOString();
    }
    repeatedMap.set(key, repeated);
  }

  return {
    threshold,
    totalSmallExpenses,
    percentOfMonthlyIncome:
      monthlyIncome > 0 ? (totalSmallExpenses / monthlyIncome) * 100 : 0,
    transactions: smallExpenses.slice(0, 30),
    topCategories: Array.from(categoryMap.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    repeatedExpenses: Array.from(repeatedMap.values())
      .filter((item) => item.count > 1)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  };
}

export function buildFinancialControlData(
  transactions: TransactionWithCategory[],
  loans: LoanForControl[],
  threshold = 1000,
  now = new Date()
) {
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const daysLeftInMonth = Math.max(
    1,
    Math.ceil((monthEnd.getTime() - startOfDay(now).getTime()) / dayMs)
  );
  const monthTransactions = transactions.filter(
    (transaction) => transaction.date >= monthStart && transaction.date < monthEnd
  );
  const totalIncome = transactions
    .filter((transaction) => transaction.type === "INCOME")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpense = transactions
    .filter((transaction) => transaction.type === "EXPENSE")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthlyIncome = monthTransactions
    .filter((transaction) => transaction.type === "INCOME")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthlyExpense = monthTransactions
    .filter((transaction) => transaction.type === "EXPENSE")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expensesYear = transactions
    .filter(
      (transaction) =>
        transaction.type === "EXPENSE" &&
        transaction.date >= yearStart &&
        transaction.date < yearEnd
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const balance = totalIncome - totalExpense;
  const totalDebt = loans.reduce((sum, loan) => sum + loan.remainingAmount, 0);
  const totalInitialDebt = loans.reduce((sum, loan) => sum + loan.initialAmount, 0);
  const paidAmount = Math.max(0, totalInitialDebt - totalDebt);
  const netPosition = balance - totalDebt;
  const dailyControl = buildDailyControl(transactions, now);

  return {
    totalIncome,
    totalExpense,
    balance,
    monthlyIncome,
    monthlyExpense,
    expensesYear,
    totalDebt,
    netPosition,
    toZero: Math.max(0, -netPosition),
    toPositive: Math.max(0, 1 - netPosition),
    dailyControl: {
      ...dailyControl,
      monthSpending: monthlyExpense
    },
    survival: {
      availableBalance: balance,
      daysLeftInMonth,
      safeDailyLimit: balance / daysLeftInMonth
    },
    recentTransactions: transactions.slice(0, 6),
    leakage: buildLeakage(monthTransactions, monthlyIncome, threshold),
    debtSummary: {
      totalDebt,
      paymentsThisMonth: loans
        .filter((loan) => loan.status === "ACTIVE")
        .reduce((sum, loan) => sum + loan.monthlyPayment, 0),
      totalInitialDebt,
      paidAmount,
      paidPercent: totalInitialDebt > 0 ? (paidAmount / totalInitialDebt) * 100 : 0
    }
  };
}

export async function getFinancialControlData(userId: string, threshold = 1000) {
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    include: {
      category: true
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }]
  });
  const loans = await prisma.loan.findMany({
    where: { userId, status: { not: "CLOSED" } }
  });

  return buildFinancialControlData(transactions, loans, threshold);
}
