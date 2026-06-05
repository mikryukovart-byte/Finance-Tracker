import { NextResponse } from "next/server";

import {
  dateRangeFromSearch,
  monthKey,
  monthLabel,
  startOfMonth
} from "@/lib/date-ranges";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  buildFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const dayMs = 24 * 60 * 60 * 1000;

type ReportTransaction = {
  id: string;
  amount: number;
  type: string;
  date: Date;
  description: string | null;
  categoryId: string | null;
  createdAt: Date;
  category: {
    id: string;
    name: string;
    type: string;
  } | null;
};

function sumByType(transactions: ReportTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.type === "INCOME") {
        totals.income += transaction.amount;
      } else if (transaction.type === "EXPENSE") {
        totals.expense += transaction.amount;
      }

      return totals;
    },
    { income: 0, expense: 0 }
  );
}

function buildCategoryBreakdown(transactions: ReportTransaction[], type: "INCOME" | "EXPENSE") {
  const categoryMap = new Map<string, { categoryId: string; name: string; amount: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== type || !transaction.categoryId || !transaction.category) {
      continue;
    }

    const current = categoryMap.get(transaction.categoryId) ?? {
      categoryId: transaction.categoryId,
      name: transaction.category.name,
      amount: 0
    };

    current.amount += transaction.amount;
    categoryMap.set(transaction.categoryId, current);
  }

  const total = Array.from(categoryMap.values()).reduce(
    (sum, item) => sum + item.amount,
    0
  );

  return Array.from(categoryMap.values())
    .map((item) => ({
      ...item,
      percent: total > 0 ? (item.amount / total) * 100 : 0
    }))
    .sort((a, b) => b.amount - a.amount);
}

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const threshold = parseLeakageThreshold(url.searchParams.get("leakageThreshold"));
  const now = new Date();
  const range = dateRangeFromSearch(url.searchParams);
  const periodStart = range.from ?? startOfMonth(now);
  const periodEnd = range.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const periodDuration = Math.max(dayMs, periodEnd.getTime() - periodStart.getTime());
  const previousPeriodStart = new Date(periodStart.getTime() - periodDuration);
  const previousPeriodEnd = periodStart;

  const allTransactions = await prisma.transaction.findMany({
    where: {
      userId: auth.userId,
      date: {
        gte: previousPeriodStart,
        lt: periodEnd
      }
    },
    select: {
      id: true,
      amount: true,
      type: true,
      date: true,
      description: true,
      categoryId: true,
      createdAt: true,
      category: {
        select: {
          id: true,
          name: true,
          type: true
        }
      }
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }]
  });
  const [loans, accounts] = await Promise.all([
    prisma.loan.findMany({
      where: { userId: auth.userId, status: { not: "CLOSED" } },
      select: {
        debtType: true,
        accountId: true,
        initialAmount: true,
        remainingAmount: true,
        monthlyPayment: true,
        plannedPayment: true,
        minimalPayment: true,
        status: true,
        account: {
          select: {
            currentDebt: true,
            minimalPayment: true
          }
        }
      }
    }),
    prisma.account.findMany({
      where: { userId: auth.userId },
      select: {
        id: true,
        type: true,
        balance: true,
        currentDebt: true,
        minimalPayment: true
      }
    })
  ]);
  const periodTransactions = allTransactions.filter(
    (transaction) => transaction.date >= periodStart && transaction.date < periodEnd
  );
  const previousPeriodTransactions = allTransactions.filter(
    (transaction) =>
      transaction.date >= previousPeriodStart && transaction.date < previousPeriodEnd
  );
  const control = buildFinancialControlData(
    periodTransactions,
    loans,
    threshold,
    now,
    accounts
  );

  const byExpenseCategory = buildCategoryBreakdown(periodTransactions, "EXPENSE");
  const byIncomeCategory = buildCategoryBreakdown(periodTransactions, "INCOME");

  const months = new Map<
    string,
    {
      month: string;
      label: string;
      income: number;
      expense: number;
    }
  >();

  const firstMonth = startOfMonth(periodStart);
  const lastMonthDate = new Date(periodEnd.getTime() - 1);
  const lastMonth = startOfMonth(lastMonthDate);

  for (
    let date = firstMonth;
    date <= lastMonth;
    date = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  ) {
    const key = monthKey(date);
    months.set(key, {
      month: key,
      label: monthLabel(date),
      income: 0,
      expense: 0
    });
  }

  for (const transaction of periodTransactions) {
    const key = monthKey(transaction.date);
    const bucket = months.get(key);

    if (!bucket) {
      continue;
    }

    if (transaction.type === "INCOME") {
      bucket.income += transaction.amount;
    } else if (transaction.type === "EXPENSE") {
      bucket.expense += transaction.amount;
    }
  }

  const currentTotals = sumByType(periodTransactions);
  const previousTotals = sumByType(previousPeriodTransactions);
  const totalIncome = currentTotals.income;
  const totalExpense = currentTotals.expense;
  const currentMonth = {
    income: currentTotals.income,
    expense: currentTotals.expense,
    balance: 0
  };
  currentMonth.balance = currentMonth.income - currentMonth.expense;
  const previousMonth = {
    income: previousTotals.income,
    expense: previousTotals.expense,
    balance: 0
  };
  previousMonth.balance = previousMonth.income - previousMonth.expense;

  return NextResponse.json({
    byCategory: byExpenseCategory,
    byExpenseCategory,
    byIncomeCategory,
    byMonth: Array.from(months.values()),
    comparison: {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense
    },
    currentMonth,
    previousMonth,
    monthChange: {
      income: currentMonth.income - previousMonth.income,
      expense: currentMonth.expense - previousMonth.expense,
      balance: currentMonth.balance - previousMonth.balance
    },
    topExpenseCategories: byExpenseCategory.slice(0, 5),
    leakage: control.leakage,
    debtProgress: control.debtSummary
  });
}
