import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import { getFinancialControlData } from "@/lib/financial-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const range = dateRangeFromSearch(url.searchParams);
  const control = await getFinancialControlData(auth.userId, 1000, range);

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
