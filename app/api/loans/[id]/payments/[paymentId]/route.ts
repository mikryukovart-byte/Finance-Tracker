import { NextResponse } from "next/server";

import { applyTransactionEffect, getCreditCardBalance } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
    paymentId: string;
  };
};

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.loanPayment.findFirst({
      where: {
        id: params.paymentId,
        loanId: params.id,
        userId: auth.userId
      }
    });

    if (!payment) {
      return { status: 404 as const, body: { message: "Платеж не найден" } };
    }

    const loan = await tx.loan.findFirst({
      where: { id: params.id, userId: auth.userId },
      include: { account: true }
    });

    if (!loan) {
      return { status: 404 as const, body: { message: "Долг не найден" } };
    }

    const appliedAmount = payment.appliedAmount ?? payment.amount;
    const nextDebt =
      loan.debtType === "CREDIT_CARD" && loan.account
        ? loan.account.currentDebt + appliedAmount
        : loan.remainingAmount + appliedAmount;

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        remainingAmount: nextDebt
      }
    });
    await tx.loanPayment.delete({ where: { id: payment.id } });

    if (payment.transactionId) {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: payment.transactionId,
          userId: auth.userId
        }
      });

      await tx.transaction.deleteMany({
        where: {
          id: payment.transactionId,
          userId: auth.userId
        }
      });

      if (transaction) {
        if (transaction.accountId) {
          await applyTransactionEffect(
            tx,
            auth.userId,
            transaction.accountId,
            transaction.type,
            transaction.amount,
            -1
          );
        }
      }
    }

    if (updatedLoan.debtType === "CREDIT_CARD" && updatedLoan.accountId) {
      await tx.account.update({
        where: { id: updatedLoan.accountId },
        data: {
          currentDebt: nextDebt,
          balance: getCreditCardBalance(nextDebt)
        }
      });
    }

    return { status: 200 as const, body: { ok: true } };
  });

  return NextResponse.json(result.body, { status: result.status });
}
