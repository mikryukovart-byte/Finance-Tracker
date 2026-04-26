import type { TransactionKind } from "@/types/finance";

import { prisma } from "@/lib/prisma";

export type DefaultCategory = {
  name: string;
  type: TransactionKind;
};

export const defaultSystemCategories: DefaultCategory[] = [
  { name: "Доход", type: "INCOME" },
  { name: "Зарплата", type: "INCOME" },
  { name: "Фриланс", type: "INCOME" },
  { name: "Инвестиции", type: "INCOME" },
  { name: "Еда", type: "EXPENSE" },
  { name: "Транспорт", type: "EXPENSE" },
  { name: "Дом", type: "EXPENSE" },
  { name: "Здоровье", type: "EXPENSE" },
  { name: "Развлечения", type: "EXPENSE" },
  { name: "Связь", type: "EXPENSE" },
  { name: "Покупки", type: "EXPENSE" }
];

export async function ensureDefaultCategories(userId: string) {
  for (const category of defaultSystemCategories) {
    await prisma.category.upsert({
      where: {
        userId_name_type: {
          userId,
          name: category.name,
          type: category.type
        }
      },
      create: {
        ...category,
        userId
      },
      update: {}
    });
  }
}
