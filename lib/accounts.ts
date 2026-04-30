import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const defaultAccountName = "Основной счет";

type DbClient = typeof prisma | Prisma.TransactionClient;

export function getTransactionImpact(type: string, amount: number) {
  return type === "INCOME" ? amount : -amount;
}

export async function ensureDefaultAccount(userId: string, client: DbClient = prisma) {
  const existing = await client.account.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });

  if (existing) {
    return existing;
  }

  return client.account.create({
    data: {
      userId,
      name: defaultAccountName,
      balance: 0,
      currency: "RUB"
    }
  });
}

export async function findOwnedAccount(
  userId: string,
  accountId: string | null | undefined,
  client: DbClient = prisma
) {
  if (!accountId) {
    return ensureDefaultAccount(userId, client);
  }

  return client.account.findFirst({
    where: { id: accountId, userId }
  });
}

export async function ensureAdjustmentCategory(userId: string, type: "INCOME" | "EXPENSE") {
  const name = "Корректировка";
  const existingCategories = await prisma.category.findMany({
    where: { userId, type }
  });
  const existing = existingCategories.find(
    (category) => category.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")
  );

  if (existing) {
    return existing;
  }

  return prisma.category.create({
    data: {
      userId,
      name,
      type
    }
  });
}
