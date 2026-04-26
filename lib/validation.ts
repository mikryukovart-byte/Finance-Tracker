import { z } from "zod";

import { parseDateInput } from "@/lib/date-ranges";

const transactionTypeSchema = z.enum(["INCOME", "EXPENSE"], {
  required_error: "Укажите тип операции",
  invalid_type_error: "Некорректный тип операции"
});

const loanStatusSchema = z.enum(["ACTIVE", "PAUSED", "CLOSED"], {
  required_error: "Укажите статус кредита",
  invalid_type_error: "Некорректный статус кредита"
});

const debtPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"], {
  required_error: "Укажите приоритет",
  invalid_type_error: "Некорректный приоритет"
});

function normalizeMoney(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");

    if (!trimmed) {
      return Number.NaN;
    }

    return Number(trimmed);
  }

  return value;
}

function moneySchema(message = "Укажите сумму") {
  return z.preprocess(
    normalizeMoney,
    z
      .number({ invalid_type_error: message })
      .finite("Укажите корректное число")
  );
}

function positiveMoneySchema(message: string) {
  return moneySchema(message).refine((value) => value > 0, message);
}

function nonnegativeMoneySchema(message: string) {
  return moneySchema(message).refine((value) => value >= 0, message);
}

const dateSchema = z.preprocess(
  parseDateInput,
  z.date({
    required_error: "Укажите дату",
    invalid_type_error: "Некорректная дата"
  })
);

export const categorySchema = z.object({
  name: z
    .string({ required_error: "Укажите название категории" })
    .trim()
    .min(2, "Название должно быть не короче 2 символов")
    .max(60, "Название должно быть короче 60 символов")
    .transform((value) => value.replace(/\s+/g, " ")),
  type: transactionTypeSchema
});

export const transactionSchema = z.object({
  amount: positiveMoneySchema("Сумма должна быть больше нуля"),
  categoryId: z.string().min(1, "Выберите категорию"),
  date: dateSchema,
  description: z
    .string()
    .trim()
    .max(180, "Описание должно быть короче 180 символов")
    .optional()
    .transform((value) => value || null),
  type: transactionTypeSchema
});

export const loanSchema = z
  .object({
    title: z
      .string({ required_error: "Укажите название кредита" })
      .trim()
      .min(2, "Название должно быть не короче 2 символов")
      .max(80, "Название должно быть короче 80 символов")
      .transform((value) => value.replace(/\s+/g, " ")),
    lender: z
      .preprocess(
        (value) => (value === null ? undefined : value),
        z
          .string()
          .trim()
          .max(80, "Кредитор должен быть короче 80 символов")
          .optional()
      )
      .transform((value) => value?.replace(/\s+/g, " ") || null),
    initialAmount: positiveMoneySchema("Изначальная сумма должна быть больше нуля"),
    remainingAmount: nonnegativeMoneySchema("Остаток не может быть отрицательным"),
    monthlyPayment: nonnegativeMoneySchema("Платеж не может быть отрицательным"),
    interestRate: nonnegativeMoneySchema("Процент не может быть отрицательным").refine(
      (value) => value <= 100,
      "Процент не должен быть больше 100"
    ),
    paymentDate: dateSchema,
    priority: debtPrioritySchema.default("MEDIUM"),
    status: loanStatusSchema
  })
  .superRefine((value, context) => {
    if (value.remainingAmount > value.initialAmount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingAmount"],
        message: "Остаток не может быть больше изначальной суммы"
      });
    }

    if (value.status === "ACTIVE" && value.monthlyPayment <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthlyPayment"],
        message: "Для активного кредита укажите ежемесячный платеж"
      });
    }
  });

export const backupImportSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(2),
      type: transactionTypeSchema
    })
  ),
  transactions: z.array(
    z.object({
      id: z.string().optional(),
      amount: positiveMoneySchema("Сумма должна быть больше нуля"),
      type: transactionTypeSchema,
      date: dateSchema,
      description: z.string().nullable().optional(),
      categoryId: z.string()
    })
  ),
  loans: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().trim().min(2),
      lender: z.string().trim().nullable().optional(),
      initialAmount: positiveMoneySchema("Изначальная сумма должна быть больше нуля"),
      remainingAmount: nonnegativeMoneySchema("Остаток не может быть отрицательным"),
      monthlyPayment: nonnegativeMoneySchema("Платеж не может быть отрицательным"),
      interestRate: nonnegativeMoneySchema("Процент не может быть отрицательным").refine(
        (value) => value <= 100,
        "Процент не должен быть больше 100"
      ),
      paymentDate: dateSchema,
      priority: debtPrioritySchema.default("MEDIUM"),
      status: loanStatusSchema
    })
  )
});

export function firstZodError(error: z.ZodError) {
  return error.errors[0]?.message ?? "Проверьте введенные данные";
}
