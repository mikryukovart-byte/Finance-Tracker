import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import {
  adjustmentTransactionType,
  applyTransactionEffect
} from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  balanceAdjustmentSchema,
  creditCardAdjustmentSchema,
  firstZodError
} from "@/lib/validation";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const account = await prisma.account.findFirst({
    where: { id: params.id, userId: auth.userId }
  });

  if (!account) {
    return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
  }

  if (account.type === "CREDIT_CARD") {
    const parsed = creditCardAdjustmentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
    }

    try {
      const updatedAccount = await prisma.account.update({
        where: { id: account.id },
        data: {
          creditLimit: parsed.data.creditLimit,
          currentDebt: parsed.data.currentDebt ?? 0,
          availableCredit: parsed.data.availableCredit,
          minimalPayment: parsed.data.minimalPayment,
          paymentDate: parsed.data.paymentDate,
          interestRate: parsed.data.interestRate,
          balance: 0
        }
      });

      return NextResponse.json({ account: updatedAccount, transaction: null }, { status: 200 });
    } catch (error) {
      console.error("Credit card adjustment API error", {
        accountId: params.id,
        userId: auth.userId,
        error
      });
      return NextResponse.json(
        { message: "Не удалось скорректировать кредитную карту" },
        { status: 500 }
      );
    }
  }

  const parsed = balanceAdjustmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const currentValue = account.balance;
  const difference = parsed.data.balance - currentValue;

  if (difference === 0) {
    return NextResponse.json({ account, transaction: null });
  }

  const type = adjustmentTransactionType;
  const amount = difference;
  const description =
    parsed.data.description ||
    `Корректировка баланса счета: ${account.name}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId: auth.userId,
          accountId: account.id,
          categoryId: null,
          amount,
          type,
          date: parsed.data.date,
          description
        },
        include: { category: true, account: true }
      });
      const updatedAccount = await applyTransactionEffect(
        tx,
        auth.userId,
        account.id,
        type,
        amount
      );

      return { account: updatedAccount, transaction };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Balance adjustment API error", {
      accountId: params.id,
      userId: auth.userId,
      error
    });
    return NextResponse.json(
      { message: "Не удалось скорректировать баланс" },
      { status: 500 }
    );
  }
}
