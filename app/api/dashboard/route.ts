import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { getFinancialControlData } from "@/lib/financial-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const control = await getFinancialControlData(auth.userId);

  return NextResponse.json({
    totalIncome: control.totalIncome,
    totalExpense: control.totalExpense,
    balance: control.balance,
    expensesToday: control.dailyControl.todaySpending,
    expensesMonth: control.monthlyExpense,
    expensesYear: control.expensesYear,
    recentTransactions: control.recentTransactions,
    dailyControl: control.dailyControl,
    survival: control.survival
  });
}
