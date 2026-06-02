import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const adjustmentName = "корректировка";

async function main() {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true }
  });
  const adjustmentCategoryIds = categories
    .filter(
      (category) =>
        category.name.trim().toLocaleLowerCase("ru-RU") === adjustmentName
    )
    .map((category) => category.id);

  if (adjustmentCategoryIds.length === 0) {
    console.log("Категории корректировок не найдены.");
    return;
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      categoryId: { in: adjustmentCategoryIds },
      type: { in: ["INCOME", "EXPENSE"] }
    },
    select: {
      id: true,
      amount: true,
      type: true
    }
  });

  if (transactions.length === 0) {
    console.log("Операции корректировок уже обновлены.");
    return;
  }

  for (const transaction of transactions) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        amount:
          transaction.type === "INCOME"
            ? transaction.amount
            : -transaction.amount,
        type: "ADJUSTMENT",
        categoryId: null
      }
    });
  }

  console.log(`Обновлено операций корректировки: ${transactions.length}.`);
}

main()
  .catch((error) => {
    console.error("Не удалось обновить операции корректировки.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
