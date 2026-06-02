import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { getAssetAccountBalance } from "@/lib/accounts";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import { getFinancialControlData } from "@/lib/financial-control";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const range = dateRangeFromSearch(url.searchParams);
  const control = await getFinancialControlData(auth.userId, 1000, range);
  const accounts = await prisma.account.findMany({
    where: { userId: auth.userId },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }]
  });
  const accountBalance = getAssetAccountBalance(accounts);

  return NextResponse.json({
    totalIncome: control.totalIncome,
    totalExpense: control.totalExpense,
    balance: control.balance,
    accountBalance,
    totalDebt: control.totalDebt,
    netPosition: accountBalance - control.totalDebt,
    accounts,
    expensesToday: control.dailyControl.todaySpending,
    expensesMonth: control.monthlyExpense,
    expensesYear: control.expensesYear,
    recentTransactions: control.recentTransactions,
    dailyControl: control.dailyControl,
    survival: control.survival
  });
}
