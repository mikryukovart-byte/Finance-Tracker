import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import {
  adjustmentTransactionType,
  applyTransactionEffect,
  ensureDefaultAccount,
  getAssetAccountBalance
} from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { createApiTimer } from "@/lib/perf";
import { prisma } from "@/lib/prisma";
import { accountSchema, firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

function getAccounts(userId: string, withCounts: boolean) {
  const accountArgs = {
    where: { userId },
    orderBy: [{ createdAt: "asc" as const }, { name: "asc" as const }]
  };

  if (!withCounts) {
    return prisma.account.findMany(accountArgs);
  }

  return prisma.account.findMany({
    ...accountArgs,
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
}

export async function GET(request: Request) {
  const timer = createApiTimer("/api/accounts");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const url = new URL(request.url);
  const withCounts = url.searchParams.get("withCounts") === "1";
  const dbStarted = Date.now();
  let accounts = await getAccounts(auth.userId, withCounts);

  if (accounts.length === 0) {
    await ensureDefaultAccount(auth.userId);
    accounts = await getAccounts(auth.userId, withCounts);
  }
  timer.mark("db", dbStarted);
  timer.done({ withCounts });

  const totalBalance = getAssetAccountBalance(accounts);

  return NextResponse.json({ accounts, totalBalance });
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

  const parsed = accountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  try {
    const currentDebt =
      parsed.data.type === "CREDIT_CARD" ? parsed.data.currentDebt ?? 0 : 0;
    const openingAmount = parsed.data.type === "CREDIT_CARD" ? 0 : parsed.data.balance;
    const account = await prisma.$transaction(async (tx) => {
      const saved = await tx.account.create({
        data: {
          userId: auth.userId,
          name: parsed.data.name,
          type: parsed.data.type,
          balance: 0,
          currency: parsed.data.currency,
          creditLimit: parsed.data.type === "CREDIT_CARD" ? parsed.data.creditLimit : null,
          currentDebt,
          availableCredit:
            parsed.data.type === "CREDIT_CARD" ? parsed.data.availableCredit ?? 0 : 0,
          minimalPayment: parsed.data.type === "CREDIT_CARD" ? parsed.data.minimalPayment : null,
          paymentDate: parsed.data.type === "CREDIT_CARD" ? parsed.data.paymentDate : null,
          interestRate: parsed.data.type === "CREDIT_CARD" ? parsed.data.interestRate : null
        }
      });

      if (openingAmount !== 0) {
        await tx.transaction.create({
          data: {
            userId: auth.userId,
            accountId: saved.id,
            categoryId: null,
            amount: openingAmount,
            type: adjustmentTransactionType,
            date: new Date(),
            description:
              parsed.data.type === "CREDIT_CARD"
                ? `Начальный долг по карте: ${saved.name}`
                : `Начальный баланс счета: ${saved.name}`
          }
        });
        await applyTransactionEffect(
          tx,
          auth.userId,
          saved.id,
          adjustmentTransactionType,
          openingAmount
        );
      }

      return tx.account.findUniqueOrThrow({
        where: { id: saved.id },
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
    });

    return NextResponse.json(account, { status: 201 });
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
