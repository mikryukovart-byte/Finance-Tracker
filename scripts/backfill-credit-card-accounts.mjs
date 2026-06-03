import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const creditCards = await prisma.loan.findMany({
    where: { debtType: "CREDIT_CARD" },
    include: { account: true },
    orderBy: { createdAt: "asc" }
  });

  if (creditCards.length === 0) {
    console.log("Кредитных карт для обновления нет.");
    return;
  }

  for (const loan of creditCards) {
    await prisma.$transaction(async (tx) => {
      const creditLimit = loan.creditLimit ?? loan.initialAmount ?? 0;

      const cardData = {
        type: "CREDIT_CARD",
        balance: 0,
        creditLimit,
        currentDebt: loan.remainingAmount,
        availableCredit: 0,
        minimalPayment: loan.minimalPayment ?? loan.monthlyPayment,
        paymentDate: loan.paymentDate,
        interestRate: loan.interestRate
      };

      if (loan.accountId) {
        await tx.account.update({
          where: { id: loan.accountId },
          data: cardData
        });
        return;
      }

      const account = await tx.account.create({
        data: {
          userId: loan.userId,
          name: `Карта: ${loan.title} ${loan.id.slice(0, 6)}`,
          currency: "RUB",
          ...cardData
        }
      });

      await tx.loan.update({
        where: { id: loan.id },
        data: { accountId: account.id }
      });
    });

    console.log(`Кредитная карта обновлена: ${loan.title}`);
  }
}

main()
  .catch((error) => {
    console.error("Не удалось обновить счета кредитных карт.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
