import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const defaultAccountName = "Основной счет";

function transactionImpact(transaction) {
  return transaction.type === "INCOME" ? transaction.amount : -transaction.amount;
}

async function getUserIds() {
  const [categories, accounts, transactions, loans, loanPayments, transfers] =
    await Promise.all([
      prisma.category.findMany({ distinct: ["userId"], select: { userId: true } }),
      prisma.account.findMany({ distinct: ["userId"], select: { userId: true } }),
      prisma.transaction.findMany({ distinct: ["userId"], select: { userId: true } }),
      prisma.loan.findMany({ distinct: ["userId"], select: { userId: true } }),
      prisma.loanPayment.findMany({ distinct: ["userId"], select: { userId: true } }),
      prisma.transfer.findMany({ distinct: ["userId"], select: { userId: true } })
    ]);

  return [
    ...new Set(
      [...categories, ...accounts, ...transactions, ...loans, ...loanPayments, ...transfers]
        .map((item) => item.userId)
        .filter(Boolean)
    )
  ];
}

async function backfillUser(userId) {
  return prisma.$transaction(async (tx) => {
    let account = await tx.account.findFirst({
      where: { userId, name: defaultAccountName }
    });

    if (!account) {
      account = await tx.account.create({
        data: {
          userId,
          name: defaultAccountName,
          balance: 0,
          currency: "RUB"
        }
      });
    }

    const unassignedTransactions = await tx.transaction.findMany({
      where: { userId, accountId: null },
      select: { id: true, amount: true, type: true }
    });
    const balanceDelta = unassignedTransactions.reduce(
      (sum, transaction) => sum + transactionImpact(transaction),
      0
    );

    const updated = await tx.transaction.updateMany({
      where: { userId, accountId: null },
      data: { accountId: account.id }
    });

    if (balanceDelta !== 0) {
      await tx.account.update({
        where: { id: account.id },
        data: { balance: { increment: balanceDelta } }
      });
    }

    return {
      userId,
      accountId: account.id,
      updatedTransactions: updated.count,
      balanceDelta
    };
  });
}

async function main() {
  const userIds = await getUserIds();

  if (userIds.length === 0) {
    console.log("Нет пользователей для обновления.");
    return;
  }

  for (const userId of userIds) {
    const result = await backfillUser(userId);
    console.log(
      `Пользователь ${result.userId}: счет ${result.accountId}, операций обновлено ${result.updatedTransactions}, изменение баланса ${result.balanceDelta}.`
    );
  }
}

main()
  .catch((error) => {
    console.error("Не удалось обновить счета для существующих операций.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
