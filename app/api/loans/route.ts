import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, loanSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type LoanSummarySource = {
  initialAmount: number;
  remainingAmount: number;
  monthlyPayment: number;
  status: string;
};

function getLoanSummary(loans: LoanSummarySource[]) {
  const openLoans = loans.filter((loan) => loan.status !== "CLOSED");
  const totalDebt = openLoans.reduce((sum, loan) => sum + loan.remainingAmount, 0);
  const totalInitialDebt = openLoans.reduce((sum, loan) => sum + loan.initialAmount, 0);
  const paidAmount = Math.max(0, totalInitialDebt - totalDebt);

  return {
    totalDebt,
    paymentsThisMonth: openLoans
      .filter((loan) => loan.status === "ACTIVE")
      .reduce((sum, loan) => sum + loan.monthlyPayment, 0),
    totalInitialDebt,
    paidAmount,
    paidPercent: totalInitialDebt > 0 ? (paidAmount / totalInitialDebt) * 100 : 0
  };
}

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const loans = await prisma.loan.findMany({
    where: { userId: auth.userId },
    orderBy: [
      { status: "asc" },
      { priority: "asc" },
      { paymentDate: "asc" },
      { createdAt: "desc" }
    ]
  });
  const summary = getLoanSummary(loans);

  return NextResponse.json({ loans, summary });
}

export async function POST(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = loanSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const loan = await prisma.loan.create({
    data: {
      ...parsed.data,
      userId: auth.userId
    }
  });

  return NextResponse.json(loan, { status: 201 });
}
