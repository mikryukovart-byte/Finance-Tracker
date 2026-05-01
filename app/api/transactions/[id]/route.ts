import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { applyTransactionEffect, findOwnedAccount } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, transactionSchema } from "@/lib/validation";

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

  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Операция не найдена" }, { status: 404 });
    }

    const parsed = transactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
    }

    const account = await findOwnedAccount(auth.userId, parsed.data.accountId);

    if (!account) {
      return NextResponse.json({ message: "Выберите существующий счет" }, { status: 400 });
    }

    const category = await prisma.category.findFirst({
      where: {
        userId: auth.userId,
        id: parsed.data.categoryId,
        type: parsed.data.type
      }
    });

    if (!category) {
      return NextResponse.json(
        { message: "Выберите категорию подходящего типа" },
        { status: 400 }
      );
    }

    const transaction = await prisma.$transaction(async (tx) => {
      if (existing.accountId) {
        await applyTransactionEffect(
          tx,
          auth.userId,
          existing.accountId,
          existing.type,
          existing.amount,
          -1
        );
      }
      await applyTransactionEffect(
        tx,
        auth.userId,
        parsed.data.accountId,
        parsed.data.type,
        parsed.data.amount
      );

      return tx.transaction.update({
        where: { id: params.id },
        data: {
          ...parsed.data,
          userId: auth.userId
        },
        include: { category: true, account: true }
      });
    });

    return NextResponse.json(transaction);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Операция не найдена" }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Операция не найдена" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id: params.id } });
      if (existing.accountId) {
        await applyTransactionEffect(
          tx,
          auth.userId,
          existing.accountId,
          existing.type,
          existing.amount,
          -1
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Операция не найдена" }, { status: 404 });
    }

    throw error;
  }
}
