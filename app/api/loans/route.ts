import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { getDebtSummary } from "@/lib/debts";
import { prisma } from "@/lib/prisma";
import { firstZodError, loanSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

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

function loanErrorResponse(error: unknown) {
  console.error("Loan API error", error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return NextResponse.json(
      {
        message:
          error.code === "P2021" || error.code === "P2022"
            ? "База данных не обновлена. Примените миграции Prisma и повторите действие"
            : "Не удалось сохранить долг"
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { message: "Не удалось сохранить долг. Проверьте данные и попробуйте снова" },
    { status: 500 }
  );
}

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const loans = await prisma.loan.findMany({
    where: { userId: auth.userId },
    include: {
      payments: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 8
      }
    },
    orderBy: [
      { status: "asc" },
      { priority: "asc" },
      { paymentDate: "asc" },
      { createdAt: "desc" }
    ]
  });
  const summary = getDebtSummary(loans);

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

  const parsed = loanSchema.safeParse(normalizeLoanBody(body as Record<string, unknown>));

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  try {
    const loan = await prisma.loan.create({
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

    return NextResponse.json(loan, { status: 201 });
  } catch (error) {
    return loanErrorResponse(error);
  }
}
