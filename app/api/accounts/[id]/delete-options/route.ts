import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  creditCardAccountType,
  getCreditCardBalance,
  rollbackTransferEffect
} from "@/lib/accounts";
import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
  };
};

type DeleteMode = "MOVE_DATA" | "DELETE_WITH_DATA";

function accountInclude() {
  return {
    _count: {
      select: {
        transactions: true,
        linkedLoans: true,
        outgoingTransfers: true,
        incomingTransfers: true
      }
    }
  };
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

  const mode = typeof body.mode === "string" ? (body.mode as DeleteMode) : null;
  const targetAccountId =
    typeof body.targetAccountId === "string" ? body.targetAccountId.trim() : "";
  const confirmed = body.confirm === true;
  const confirmLastAccount = body.confirmLastAccount === true;

  if (mode !== "MOVE_DATA" && mode !== "DELETE_WITH_DATA") {
    return NextResponse.json({ message: "Выберите способ удаления" }, { status: 400 });
  }

  const [account, accountCount] = await Promise.all([
    prisma.account.findFirst({
      where: { id: params.id, userId: auth.userId },
      include: accountInclude()
    }),
    prisma.account.count({ where: { userId: auth.userId } })
  ]);

  if (!account) {
    return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
  }

  if (accountCount <= 1 && !confirmLastAccount) {
    return NextResponse.json(
      { message: "Это последний счет. Подтвердите удаление явно." },
      { status: 400 }
    );
  }

  if (mode === "MOVE_DATA") {
    if (!targetAccountId || targetAccountId === account.id) {
      return NextResponse.json({ message: "Выберите другой счет" }, { status: 400 });
    }

    const targetAccount = await prisma.account.findFirst({
      where: { id: targetAccountId, userId: auth.userId }
    });

    if (!targetAccount) {
      return NextResponse.json({ message: "Счет для переноса не найден" }, { status: 404 });
    }

    if (targetAccount.type !== account.type) {
      return NextResponse.json(
        { message: "Переносить данные можно только на счет того же типа" },
        { status: 400 }
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { userId: auth.userId, accountId: account.id },
          data: { accountId: targetAccount.id }
        });

        await tx.loan.updateMany({
          where: { userId: auth.userId, accountId: account.id },
          data: { accountId: targetAccount.id }
        });

        await tx.transfer.deleteMany({
          where: {
            userId: auth.userId,
            OR: [
              { fromAccountId: account.id, toAccountId: targetAccount.id },
              { fromAccountId: targetAccount.id, toAccountId: account.id }
            ]
          }
        });

        await tx.transfer.updateMany({
          where: {
            userId: auth.userId,
            fromAccountId: account.id
          },
          data: { fromAccountId: targetAccount.id }
        });

        await tx.transfer.updateMany({
          where: {
            userId: auth.userId,
            toAccountId: account.id
          },
          data: { toAccountId: targetAccount.id }
        });

        if (account.type === creditCardAccountType) {
          const currentDebt = targetAccount.currentDebt + account.currentDebt;
          await tx.account.update({
            where: { id: targetAccount.id },
            data: {
              currentDebt,
              balance: getCreditCardBalance(currentDebt)
            }
          });
        } else {
          await tx.account.update({
            where: { id: targetAccount.id },
            data: {
              balance: { increment: account.balance }
            }
          });
        }

        await tx.account.delete({ where: { id: account.id } });
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
      }

      throw error;
    }
  }

  if (!confirmed) {
    return NextResponse.json({ message: "Подтвердите удаление связанных данных" }, { status: 400 });
  }

  if (account._count.linkedLoans > 0) {
    return NextResponse.json(
      {
        message:
          "У счета есть связанные долги. Сначала перенесите данные на другой счет или отвяжите долг."
      },
      { status: 409 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const transfers = await tx.transfer.findMany({
        where: {
          userId: auth.userId,
          OR: [{ fromAccountId: account.id }, { toAccountId: account.id }]
        }
      });

      for (const transfer of transfers) {
        await rollbackTransferEffect(
          tx,
          auth.userId,
          transfer.fromAccountId,
          transfer.toAccountId,
          transfer.amount
        );
      }

      await tx.transfer.deleteMany({
        where: {
          userId: auth.userId,
          OR: [{ fromAccountId: account.id }, { toAccountId: account.id }]
        }
      });

      await tx.transaction.deleteMany({
        where: { userId: auth.userId, accountId: account.id }
      });

      await tx.account.delete({ where: { id: account.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Счет не найден" }, { status: 404 });
    }

    throw error;
  }
}
