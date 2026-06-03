import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accountSchema, firstZodError } from "@/lib/validation";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PUT(request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = accountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const existing = await prisma.account.findFirst({
    where: { id: params.id, userId: auth.userId }
  });

  if (!existing) {
    return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
  }

  try {
    const account = await prisma.account.update({
      where: { id: params.id },
      data: {
        name: parsed.data.name,
        currency: parsed.data.currency,
        creditLimit:
          existing.type === "CREDIT_CARD"
            ? parsed.data.creditLimit ?? existing.creditLimit
            : null,
        minimalPayment:
          existing.type === "CREDIT_CARD" ? parsed.data.minimalPayment : null,
        paymentDate: existing.type === "CREDIT_CARD" ? parsed.data.paymentDate : null,
        interestRate: existing.type === "CREDIT_CARD" ? parsed.data.interestRate : null,
        balance: existing.type === "CREDIT_CARD" ? 0 : existing.balance
      },
      include: {
        _count: {
          select: {
            transactions: true,
            linkedLoans: true,
            outgoingTransfers: true,
            incomingTransfers: true
          }
        }
      }
    });

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { message: "Счет с таким названием уже есть" },
        { status: 409 }
      );
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const account = await prisma.account.findFirst({
    where: { id: params.id, userId: auth.userId },
    include: {
      _count: {
        select: {
          transactions: true,
          linkedLoans: true,
          outgoingTransfers: true,
          incomingTransfers: true
        }
      }
    }
  });

  if (!account) {
    return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
  }

  const usedCount =
    account._count.transactions +
    account._count.linkedLoans +
    account._count.outgoingTransfers +
    account._count.incomingTransfers;

  if (usedCount > 0) {
    return NextResponse.json(
      { message: "Нельзя удалить счет, у которого есть операции, переводы или связанные долги" },
      { status: 409 }
    );
  }

  await prisma.account.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
