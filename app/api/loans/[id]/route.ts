import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, loanSchema } from "@/lib/validation";

type RouteContext = {
  params: {
    id: string;
  };
};

function normalizeLoanBody(body: Record<string, unknown>) {
  const debtType = body.debtType ?? "BANK_LOAN";
  const totalAmount = body.initialAmount ?? body.totalAmount ?? body.creditLimit;
  const remainingAmount =
    body.remainingAmount ?? body.currentDebt ?? body.balance ?? body.currentBalance;
  const plannedPayment =
    body.plannedPayment ??
    body.monthlyPayment ??
    (debtType === "CREDIT_CARD" ? undefined : body.minimalPayment);
  const minimalPayment =
    body.minimalPayment ??
    (debtType === "CREDIT_CARD" ? body.monthlyPayment ?? body.plannedPayment : undefined);

  return {
    ...body,
    debtType,
    title: body.title ?? body.name,
    initialAmount: totalAmount,
    remainingAmount,
    monthlyPayment:
      debtType === "CREDIT_CARD" ? minimalPayment ?? null : plannedPayment ?? null,
    plannedPayment: debtType === "CREDIT_CARD" ? null : plannedPayment ?? null,
    minimalPayment: debtType === "CREDIT_CARD" ? minimalPayment ?? null : null,
    creditLimit: body.creditLimit ?? (debtType === "CREDIT_CARD" ? totalAmount : null),
    interestRate: body.interestRate ?? null,
    paymentDate: body.paymentDate ?? null,
    priority: body.priority ?? "MEDIUM",
    status: body.status ?? "ACTIVE"
  };
}

export async function PUT(request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = loanSchema.safeParse(normalizeLoanBody(body as Record<string, unknown>));

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  try {
    const existing = await prisma.loan.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    const loan = await prisma.loan.update({
      where: { id: params.id },
      data: {
        ...parsed.data,
        userId: auth.userId
      },
      include: {
        payments: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 8
        }
      }
    });

    return NextResponse.json(loan);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    console.error("Loan update API error", error);
    return NextResponse.json(
      { message: "Не удалось сохранить долг. Проверьте данные и попробуйте снова" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  try {
    const existing = await prisma.loan.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    await prisma.loan.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    throw error;
  }
}
