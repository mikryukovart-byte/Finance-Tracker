import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { rollbackTransferEffect } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  try {
    const existing = await prisma.transfer.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Перевод не найден" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transfer.delete({ where: { id: existing.id } });
      await rollbackTransferEffect(
        tx,
        auth.userId,
        existing.fromAccountId,
        existing.toAccountId,
        existing.amount
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Перевод не найден" }, { status: 404 });
    }

    throw error;
  }
}
