import { NextResponse } from "next/server";

import {
  endOfMonth,
  endOfYear,
  monthKey,
  monthLabel,
  startOfMonth,
  startOfYear
} from "@/lib/date-ranges";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  buildFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ReportTransaction = Awaited<
  ReturnType<typeof prisma.transaction.findMany>
>[number] & {
  category: {
    id: string;
    name: string;
  };
};

function buildCategoryBreakdown(transactions: ReportTransaction[], type: "INCOME" | "EXPENSE") {
  const categoryMap = new Map<string, { categoryId: string; name: string; amount: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== type) {
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
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const currentMonthStart = startOfMonth(now);
  const currentMonthEnd = endOfMonth(now);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = currentMonthStart;

  const allTransactions = await prisma.transaction.findMany({
    where: { userId: auth.userId },
    include: { category: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }]
  });
  const loans = await prisma.loan.findMany({
    where: { userId: auth.userId, status: { not: "CLOSED" } }
  });
  const control = buildFinancialControlData(allTransactions, loans, threshold, now);
  const yearTransactions = allTransactions.filter(
    (transaction) => transaction.date >= yearStart && transaction.date < yearEnd
  );
  const monthlyTransactions = allTransactions.filter(
    (transaction) => transaction.date >= monthStart
  );

  const byExpenseCategory = buildCategoryBreakdown(yearTransactions, "EXPENSE");
  const byIncomeCategory = buildCategoryBreakdown(yearTransactions, "INCOME");

  const months = new Map<
    string,
    {
      month: string;
      label: string;
      income: number;
      expense: number;
    }
  >();

  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = monthKey(date);
    months.set(key, {
      month: key,
      label: monthLabel(date),
      income: 0,
      expense: 0
    });
  }

  for (const transaction of monthlyTransactions) {
    const key = monthKey(transaction.date);
    const bucket = months.get(key);

    if (!bucket) {
      continue;
    }

    if (transaction.type === "INCOME") {
      bucket.income += transaction.amount;
    } else {
      bucket.expense += transaction.amount;
    }
  }

  const totalIncome = yearTransactions
    .filter((transaction) => transaction.type === "INCOME")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpense = yearTransactions
    .filter((transaction) => transaction.type === "EXPENSE")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const currentMonthTransactions = allTransactions.filter(
    (transaction) => transaction.date >= currentMonthStart && transaction.date < currentMonthEnd
  );
  const previousMonthTransactions = allTransactions.filter(
    (transaction) => transaction.date >= previousMonthStart && transaction.date < previousMonthEnd
  );
  const currentMonth = {
    income: currentMonthTransactions
      .filter((transaction) => transaction.type === "INCOME")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    expense: currentMonthTransactions
      .filter((transaction) => transaction.type === "EXPENSE")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    balance: 0
  };
  currentMonth.balance = currentMonth.income - currentMonth.expense;
  const previousMonth = {
    income: previousMonthTransactions
      .filter((transaction) => transaction.type === "INCOME")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    expense: previousMonthTransactions
      .filter((transaction) => transaction.type === "EXPENSE")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
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
