import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const incomeCategories = ["Доход", "Зарплата", "Фриланс", "Инвестиции"];
const expenseCategories = [
  "Еда",
  "Транспорт",
  "Дом",
  "Здоровье",
  "Развлечения",
  "Связь",
  "Покупки"
];

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function inCurrentMonth(day) {
  const date = new Date();
  date.setDate(Math.min(day, 28));
  return date;
}

async function main() {
  const userId = process.env.SEED_USER_ID;

  if (!userId) {
    console.log("SEED_USER_ID не указан. Демо-данные не добавлены.");
    return;
  }

  const existingCategoryCount = await prisma.category.count({ where: { userId } });

  for (const name of incomeCategories) {
    await prisma.category.upsert({
      where: { userId_name_type: { userId, name, type: "INCOME" } },
      create: { userId, name, type: "INCOME" },
      update: {}
    });
  }

  for (const name of expenseCategories) {
    await prisma.category.upsert({
      where: { userId_name_type: { userId, name, type: "EXPENSE" } },
      create: { userId, name, type: "EXPENSE" },
      update: {}
    });
  }

  const transactionCount = await prisma.transaction.count({ where: { userId } });
  const account = await prisma.account.upsert({
    where: { userId_name: { userId, name: "Основной счет" } },
    create: {
      userId,
      name: "Основной счет",
      balance: 0,
      currency: "RUB"
    },
    update: {}
  });

  if (existingCategoryCount === 0 && transactionCount === 0) {
    const salary = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Зарплата", type: "INCOME" }
    });
    const freelance = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Фриланс", type: "INCOME" }
    });
    const groceries = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Еда", type: "EXPENSE" }
    });
    const transport = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Транспорт", type: "EXPENSE" }
    });
    const home = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Дом", type: "EXPENSE" }
    });
    const entertainment = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Развлечения", type: "EXPENSE" }
    });

    await prisma.transaction.createMany({
      data: [
        {
          userId,
          amount: 160000,
          type: "INCOME",
          date: inCurrentMonth(5),
          description: "Основная зарплата",
          accountId: account.id,
          categoryId: salary.id
        },
        {
          userId,
          amount: 42000,
          type: "INCOME",
          date: daysAgo(12),
          description: "Проект для клиента",
          accountId: account.id,
          categoryId: freelance.id
        },
        {
          userId,
          amount: 8200,
          type: "EXPENSE",
          date: new Date(),
          description: "Покупки на неделю",
          accountId: account.id,
          categoryId: groceries.id
        },
        {
          userId,
          amount: 2100,
          type: "EXPENSE",
          date: daysAgo(2),
          description: "Такси и метро",
          accountId: account.id,
          categoryId: transport.id
        },
        {
          userId,
          amount: 38000,
          type: "EXPENSE",
          date: inCurrentMonth(10),
          description: "Аренда",
          accountId: account.id,
          categoryId: home.id
        },
        {
          userId,
          amount: 5600,
          type: "EXPENSE",
          date: daysAgo(20),
          description: "Кино и кафе",
          accountId: account.id,
          categoryId: entertainment.id
        }
      ]
    });
    await prisma.account.update({
      where: { id: account.id },
      data: {
        balance: 148100
      }
    });
  }

  const loanCount = await prisma.loan.count({ where: { userId } });

  if (existingCategoryCount === 0 && loanCount === 0) {
    await prisma.loan.createMany({
      data: [
        {
          userId,
          debtType: "BANK_LOAN",
          title: "Ипотека",
          lender: "Банк",
          initialAmount: 4200000,
          remainingAmount: 3650000,
          monthlyPayment: 68000,
          plannedPayment: 68000,
          interestRate: 8.6,
          paymentDate: inCurrentMonth(15),
          priority: "HIGH",
          status: "ACTIVE"
        },
        {
          userId,
          debtType: "BANK_LOAN",
          title: "Кредит на автомобиль",
          lender: "Банк",
          initialAmount: 980000,
          remainingAmount: 410000,
          monthlyPayment: 31500,
          plannedPayment: 31500,
          interestRate: 12.4,
          paymentDate: inCurrentMonth(23),
          priority: "MEDIUM",
          status: "ACTIVE"
        }
      ]
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
