import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const defaultAccountName = "Основной счет";
export const debitAccountType = "DEBIT";
export const creditCardAccountType = "CREDIT_CARD";
export const adjustmentTransactionType = "ADJUSTMENT";

type DbClient = typeof prisma | Prisma.TransactionClient;

type AccountBalanceLike = {
  type: string;
  balance: number;
};

export function getAssetAccountBalance(accounts: AccountBalanceLike[]) {
  return accounts
    .filter((account) => account.type !== creditCardAccountType)
    .reduce((sum, account) => sum + Math.max(0, account.balance), 0);
}

export function getTransactionImpact(type: string, amount: number) {
  if (type === "INCOME") {
    return amount;
  }

  if (type === "EXPENSE") {
    return -amount;
  }

  if (type === adjustmentTransactionType) {
    return amount;
  }

  return 0;
}

function nextDebt(currentDebt: number, delta: number) {
  return Math.max(0, currentDebt + delta);
}

function nextAvailableCredit(availableCredit: number, delta: number) {
  return availableCredit + delta;
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
    const debtDelta =
      type === "EXPENSE"
        ? amount * direction
        : type === "INCOME"
          ? -amount * direction
          : type === adjustmentTransactionType
            ? -amount * direction
            : 0;
    const currentDebt = nextDebt(account.currentDebt, debtDelta);
    const availableCredit = nextAvailableCredit(account.availableCredit, -debtDelta);

    return client.account.update({
      where: { id: account.id },
      data: {
        currentDebt,
        availableCredit,
        balance: 0
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
    const availableCredit = nextAvailableCredit(fromAccount.availableCredit, -amount);
    await client.account.update({
      where: { id: fromAccount.id },
      data: {
        currentDebt,
        availableCredit,
        balance: 0
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
    const availableCredit = nextAvailableCredit(toAccount.availableCredit, amount);
    await client.account.update({
      where: { id: toAccount.id },
      data: {
        currentDebt,
        availableCredit,
        balance: 0
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

export async function rollbackTransferEffect(
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
    const currentDebt = nextDebt(fromAccount.currentDebt, -amount);
    const availableCredit = nextAvailableCredit(fromAccount.availableCredit, amount);
    await client.account.update({
      where: { id: fromAccount.id },
      data: {
        currentDebt,
        availableCredit,
        balance: 0
      }
    });
  } else {
    await client.account.update({
      where: { id: fromAccount.id },
      data: { balance: { increment: amount } }
    });
  }

  if (toAccount.type === creditCardAccountType) {
    const currentDebt = nextDebt(toAccount.currentDebt, amount);
    const availableCredit = nextAvailableCredit(toAccount.availableCredit, -amount);
    await client.account.update({
      where: { id: toAccount.id },
      data: {
        currentDebt,
        availableCredit,
        balance: 0
      }
    });
  } else {
    await client.account.update({
      where: { id: toAccount.id },
      data: { balance: { decrement: amount } }
    });
  }

  return { fromAccount, toAccount };
}
