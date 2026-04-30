import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { ensureDefaultAccount } from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accountSchema, firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

function getAccounts(userId: string) {
  return prisma.account.findMany({
    where: { userId },
    include: {
      _count: {
        select: {
          transactions: true,
          linkedLoans: true,
          outgoingTransfers: true,
          incomingTransfers: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }]
  });
}

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  await ensureDefaultAccount(auth.userId);
  const accounts = await getAccounts(auth.userId);
  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);

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
    const account = await prisma.account.create({
      data: {
        ...parsed.data,
        userId: auth.userId
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
