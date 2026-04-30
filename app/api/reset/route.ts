import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { defaultAccountName } from "@/lib/accounts";
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
    const deletedTransfers = await tx.transfer.deleteMany({
      where: { userId: auth.userId }
    });
    const deletedLoans = await tx.loan.deleteMany({
      where: { userId: auth.userId }
    });
    const deletedAccounts = await tx.account.deleteMany({
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
    await tx.account.create({
      data: {
        userId: auth.userId,
        name: defaultAccountName,
        balance: 0,
        currency: "RUB"
      }
    });

    return {
      transactions: deletedTransactions.count,
      loanPayments: deletedLoanPayments.count,
      transfers: deletedTransfers.count,
      loans: deletedLoans.count,
      accounts: deletedAccounts.count,
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
