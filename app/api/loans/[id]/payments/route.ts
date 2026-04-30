import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, loanPaymentSchema } from "@/lib/validation";

type RouteContext = {
  params: {
    id: string;
  };
};

function toDateInputValue(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

async function getDebtCategory(tx: Prisma.TransactionClient, userId: string) {
  const categories = await tx.category.findMany({
    where: { userId, type: "EXPENSE" }
  });
  const existing = categories.find(
    (category) => category.name.toLocaleLowerCase("ru-RU") === "долги"
  );

  if (existing) {
    return existing;
  }

  return tx.category.create({
    data: {
      userId,
      name: "Долги",
      type: "EXPENSE"
    }
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = loanPaymentSchema.safeParse({
    ...(body as Record<string, unknown>),
    date: (body as Record<string, unknown>).date ?? toDateInputValue()
  });

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!loan) {
      return { status: 404 as const, body: { message: "Долг не найден" } };
    }

    const category = await getDebtCategory(tx, auth.userId);
    const description =
      parsed.data.description?.trim() || `Платеж по долгу: ${loan.title}`;
    const appliedAmount = Math.min(parsed.data.amount, loan.remainingAmount);
    const transaction = await tx.transaction.create({
      data: {
        userId: auth.userId,
        amount: parsed.data.amount,
        type: "EXPENSE",
        date: parsed.data.date,
        description,
        categoryId: category.id
      }
    });

    const payment = await tx.loanPayment.create({
      data: {
        userId: auth.userId,
        loanId: loan.id,
        amount: parsed.data.amount,
        appliedAmount,
        date: parsed.data.date,
        description,
        transactionId: transaction.id
      }
    });

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        remainingAmount: Math.max(0, loan.remainingAmount - appliedAmount)
      },
      include: {
        payments: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 8
        }
      }
    });

    return {
      status: 201 as const,
      body: {
        payment,
        transaction,
        loan: updatedLoan
      }
    };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Loan payment API error", error);
    return NextResponse.json(
      { message: "Не удалось внести платеж. Проверьте данные и попробуйте снова" },
      { status: 500 }
    );
  }
}
