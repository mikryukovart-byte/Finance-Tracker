import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { applyTransferEffect } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, transferSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const transferResponseSelect = {
  id: true,
  userId: true,
  fromAccountId: true,
  toAccountId: true,
  amount: true,
  date: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  fromAccount: {
    select: {
      id: true,
      name: true,
      currency: true,
      type: true
    }
  },
  toAccount: {
    select: {
      id: true,
      name: true,
      currency: true,
      type: true
    }
  }
};

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const transfers = await prisma.transfer.findMany({
    where: { userId: auth.userId },
    select: transferResponseSelect,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 30
  });

  return NextResponse.json(transfers);
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

  const parsed = transferSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const accounts = await prisma.account.findMany({
    where: {
      userId: auth.userId,
      id: {
        in: [parsed.data.fromAccountId, parsed.data.toAccountId]
      }
    }
  });

  if (accounts.length !== 2) {
    return NextResponse.json({ message: "Выберите существующие счета" }, { status: 400 });
  }

  const transfer = await prisma.$transaction(async (tx) => {
    const saved = await tx.transfer.create({
      data: {
        ...parsed.data,
        userId: auth.userId
      },
      select: transferResponseSelect
    });
    await applyTransferEffect(
      tx,
      auth.userId,
      parsed.data.fromAccountId,
      parsed.data.toAccountId,
      parsed.data.amount
    );

    return saved;
  });

  return NextResponse.json(transfer, { status: 201 });
}
