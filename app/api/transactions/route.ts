import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { applyTransactionEffect, findOwnedAccount } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import { firstZodError, transactionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const categoryId = url.searchParams.get("categoryId");
  const sortBy = url.searchParams.get("sortBy") === "amount" ? "amount" : "date";
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const { from, to } = dateRangeFromSearch(url.searchParams);

  const where: Prisma.TransactionWhereInput = { userId: auth.userId };

  if (type === "INCOME" || type === "EXPENSE") {
    where.type = type;
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (from || to) {
    where.date = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {})
    };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, account: true },
    orderBy:
      sortBy === "amount"
        ? [{ amount: sortDir }, { date: "desc" }, { createdAt: "desc" }]
        : [{ date: sortDir }, { createdAt: "desc" }]
  });

  return NextResponse.json(transactions);
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
    const saved = await tx.transaction.create({
      data: {
        ...parsed.data,
        userId: auth.userId
      },
      include: { category: true, account: true }
    });
    await applyTransactionEffect(
      tx,
      auth.userId,
      parsed.data.accountId,
      parsed.data.type,
      parsed.data.amount
    );

    return saved;
  });

  return NextResponse.json(transaction, { status: 201 });
}
