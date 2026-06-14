import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import { getFinancialControlData } from "@/lib/financial-control";
import { createApiTimer } from "@/lib/perf";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const timer = createApiTimer("/api/dashboard");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const url = new URL(request.url);
  const range = dateRangeFromSearch(url.searchParams);
  const dbStarted = Date.now();
  const control = await getFinancialControlData(auth.userId, 1000, range);
  timer.mark("db", dbStarted);
  timer.done();

  return NextResponse.json({
    totalIncome: control.totalIncome,
    totalExpense: control.totalExpense,
    balance: control.balance,
    accountBalance: control.assetBalance,
    totalDebt: control.totalDebt,
    netPosition: control.netPosition,
    accounts: control.accounts,
    expensesToday: control.dailyControl.todaySpending,
    expensesMonth: control.monthlyExpense,
    expensesYear: control.expensesYear,
    recentTransactions: control.recentTransactions,
    dailyControl: control.dailyControl,
    survival: control.survival
  });
}
