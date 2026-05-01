import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const defaultAccountName = "Основной счет";
export const debitAccountType = "DEBIT";
export const creditCardAccountType = "CREDIT_CARD";

type DbClient = typeof prisma | Prisma.TransactionClient;

export function getTransactionImpact(type: string, amount: number) {
  return type === "INCOME" ? amount : -amount;
}

export function getCreditCardBalance(currentDebt: number) {
  return -Math.max(0, currentDebt);
}

export function getAvailableCreditLimit(account: {
  creditLimit: number | null;
  currentDebt: number;
}) {
  return Math.max(0, (account.creditLimit ?? 0) - account.currentDebt);
}

function nextDebt(currentDebt: number, delta: number) {
  return Math.max(0, currentDebt + delta);
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
      type: debitAccountType,
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

export async function applyTransactionEffect(
  client: DbClient,
  userId: string,
  accountId: string,
  type: "INCOME" | "EXPENSE" | string,
  amount: number,
  direction: 1 | -1 = 1
) {
  const account = await client.account.findFirst({
    where: { id: accountId, userId }
  });

  if (!account) {
    throw new Error("Счет не найден");
  }

  if (account.type === creditCardAccountType) {
    const debtDelta = (type === "EXPENSE" ? amount : -amount) * direction;
    const currentDebt = nextDebt(account.currentDebt, debtDelta);

    return client.account.update({
      where: { id: account.id },
      data: {
        currentDebt,
        balance: getCreditCardBalance(currentDebt)
      }
    });
  }

  return client.account.update({
    where: { id: account.id },
    data: {
      balance: {
        increment: getTransactionImpact(type, amount) * direction
      }
    }
  });
}

export async function applyTransferEffect(
  client: DbClient,
  userId: string,
  fromAccountId: string,
  toAccountId: string,
  amount: number
) {
  const [fromAccount, toAccount] = await Promise.all([
    client.account.findFirst({ where: { id: fromAccountId, userId } }),
    client.account.findFirst({ where: { id: toAccountId, userId } })
  ]);

  if (!fromAccount || !toAccount) {
    throw new Error("Выберите существующие счета");
  }

  if (fromAccount.type === creditCardAccountType) {
    const currentDebt = nextDebt(fromAccount.currentDebt, amount);
    await client.account.update({
      where: { id: fromAccount.id },
      data: {
        currentDebt,
        balance: getCreditCardBalance(currentDebt)
      }
    });
  } else {
    await client.account.update({
      where: { id: fromAccount.id },
      data: { balance: { decrement: amount } }
    });
  }

  if (toAccount.type === creditCardAccountType) {
    const currentDebt = nextDebt(toAccount.currentDebt, -amount);
    await client.account.update({
      where: { id: toAccount.id },
      data: {
        currentDebt,
        balance: getCreditCardBalance(currentDebt)
      }
    });
  } else {
    await client.account.update({
      where: { id: toAccount.id },
      data: { balance: { increment: amount } }
    });
  }

  return { fromAccount, toAccount };
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
