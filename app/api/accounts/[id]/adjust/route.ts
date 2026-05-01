import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import {
  applyTransactionEffect,
  ensureAdjustmentCategory,
  getCreditCardBalance
} from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { balanceAdjustmentSchema, firstZodError } from "@/lib/validation";

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

  const parsed = balanceAdjustmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const account = await prisma.account.findFirst({
    where: { id: params.id, userId: auth.userId }
  });

  if (!account) {
    return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
  }

  const currentValue =
    account.type === "CREDIT_CARD" ? getCreditCardBalance(account.currentDebt) : account.balance;
  const difference = parsed.data.balance - currentValue;

  if (difference === 0) {
    return NextResponse.json({ account, transaction: null });
  }

  const type = difference > 0 ? "INCOME" : "EXPENSE";
  const amount = Math.abs(difference);
  const description =
    parsed.data.description ||
    `Корректировка баланса счета: ${account.name}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const category = await ensureAdjustmentCategory(auth.userId, type, tx);
      const transaction = await tx.transaction.create({
        data: {
          userId: auth.userId,
          accountId: account.id,
          categoryId: category.id,
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
