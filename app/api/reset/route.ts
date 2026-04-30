import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { defaultSystemCategories } from "@/lib/default-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body || body.confirmation !== "СБРОС") {
    return badRequest("Введите СБРОС для подтверждения");
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedLoanPayments = await tx.loanPayment.deleteMany({
      where: { userId: auth.userId }
    });
    const deletedTransactions = await tx.transaction.deleteMany({
      where: { userId: auth.userId }
    });
    const deletedLoans = await tx.loan.deleteMany({
      where: { userId: auth.userId }
    });
    const deletedCategories = await tx.category.deleteMany({
      where: { userId: auth.userId }
    });

    await tx.category.createMany({
      data: defaultSystemCategories.map((category) => ({
        ...category,
        userId: auth.userId
      }))
    });

    return {
      transactions: deletedTransactions.count,
      loanPayments: deletedLoanPayments.count,
      loans: deletedLoans.count,
      categories: deletedCategories.count,
      defaultCategories: defaultSystemCategories.length
    };
  });

  return NextResponse.json({
    ok: true,
    message: "Все данные сброшены",
    reset: result
  });
}
