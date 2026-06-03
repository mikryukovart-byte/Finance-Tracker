import { z } from "zod";

import { parseDateInput } from "@/lib/date-ranges";

const categoryTypeSchema = z.enum(["INCOME", "EXPENSE"], {
  required_error: "Укажите тип операции",
  invalid_type_error: "Некорректный тип операции"
});

const transactionTypeSchema = z.enum(["INCOME", "EXPENSE", "ADJUSTMENT"], {
  required_error: "Укажите тип операции",
  invalid_type_error: "Некорректный тип операции"
});

const loanStatusSchema = z.enum(["ACTIVE", "PAUSED", "CLOSED"], {
  required_error: "Укажите статус кредита",
  invalid_type_error: "Некорректный статус кредита"
});

const debtTypeSchema = z.enum(["BANK_LOAN", "CREDIT_CARD", "PERSONAL_DEBT"], {
  required_error: "Укажите тип долга",
  invalid_type_error: "Некорректный тип долга"
});

const debtPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"], {
  required_error: "Укажите приоритет",
  invalid_type_error: "Некорректный приоритет"
});

const currencySchema = z.enum(["RUB", "USD", "EUR"], {
  required_error: "Укажите валюту",
  invalid_type_error: "Некорректная валюта"
});

const accountTypeSchema = z.enum(["DEBIT", "CREDIT_CARD"], {
  required_error: "Укажите тип счета",
  invalid_type_error: "Некорректный тип счета"
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

function optionalPositiveMoneySchema(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    return normalizeMoney(value);
  }, z.number({ invalid_type_error: message }).finite("Укажите корректное число").positive(message).nullable());
}

function optionalNonnegativeMoneySchema(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    return normalizeMoney(value);
  }, z.number({ invalid_type_error: message }).finite("Укажите корректное число").min(0, message).nullable());
}

function optionalNonnegativeIntegerSchema(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      return Number(value.trim().replace(/\s/g, ""));
    }

    return value;
  }, z.number({ invalid_type_error: message }).int(message).min(0, message).nullable());
}

const dateSchema = z.preprocess(
  parseDateInput,
  z.date({
    required_error: "Укажите дату",
    invalid_type_error: "Некорректная дата"
  })
);

const optionalDateSchema = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  return parseDateInput(value);
}, z.date({ invalid_type_error: "Некорректная дата" }).nullable());

export const categorySchema = z.object({
  name: z
    .string({ required_error: "Укажите название категории" })
    .trim()
    .min(2, "Название должно быть не короче 2 символов")
    .max(60, "Название должно быть короче 60 символов")
    .transform((value) => value.replace(/\s+/g, " ")),
  type: categoryTypeSchema
});

export const accountSchema = z
  .object({
    name: z
      .string({ required_error: "Укажите название счета" })
      .trim()
      .min(2, "Название должно быть не короче 2 символов")
      .max(60, "Название должно быть короче 60 символов")
      .transform((value) => value.replace(/\s+/g, " ")),
    type: accountTypeSchema.default("DEBIT"),
    balance: moneySchema("Укажите баланс").default(0),
    currency: currencySchema.default("RUB"),
    creditLimit: optionalPositiveMoneySchema("Лимит должен быть больше нуля"),
    currentDebt: optionalNonnegativeMoneySchema("Текущая задолженность не может быть отрицательной"),
    availableCredit: optionalNonnegativeMoneySchema("Доступно сейчас не может быть отрицательным"),
    minimalPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
    paymentDate: optionalDateSchema,
    interestRate: optionalNonnegativeMoneySchema("Процент не может быть отрицательным")
  })
  .superRefine((value, context) => {
    if (value.type === "CREDIT_CARD" && !value.creditLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditLimit"],
        message: "Укажите кредитный лимит"
      });
    }

  });

export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Выберите счет списания"),
    toAccountId: z.string().min(1, "Выберите счет зачисления"),
    amount: positiveMoneySchema("Сумма перевода должна быть больше нуля"),
    date: dateSchema,
    description: z
      .string()
      .trim()
      .max(180, "Комментарий должен быть короче 180 символов")
      .optional()
      .transform((value) => value || null)
  })
  .superRefine((value, context) => {
    if (value.fromAccountId === value.toAccountId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toAccountId"],
        message: "Выберите разные счета"
      });
    }
  });

export const balanceAdjustmentSchema = z.object({
  balance: moneySchema("Укажите новый баланс"),
  date: dateSchema,
  description: z
    .string()
    .trim()
    .max(180, "Комментарий должен быть короче 180 символов")
    .optional()
    .transform((value) => value || null)
});

export const creditCardAdjustmentSchema = z.object({
  creditLimit: optionalPositiveMoneySchema("Лимит должен быть больше нуля"),
  currentDebt: optionalNonnegativeMoneySchema("Текущая задолженность не может быть отрицательной"),
  availableCredit: nonnegativeMoneySchema("Доступно сейчас не может быть отрицательным"),
  minimalPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
  paymentDate: optionalDateSchema,
  interestRate: optionalNonnegativeMoneySchema("Процент не может быть отрицательным")
});

export const transactionSchema = z.object({
  amount: positiveMoneySchema("Сумма должна быть больше нуля"),
  accountId: z.string().min(1, "Выберите счет"),
  categoryId: z.string().min(1, "Выберите категорию"),
  date: dateSchema,
  description: z
    .string()
    .trim()
    .max(180, "Описание должно быть короче 180 символов")
    .optional()
    .transform((value) => value || null),
  type: categoryTypeSchema
});

export const adjustmentTransactionSchema = z.object({
  amount: moneySchema("Введите сумму корректировки").refine(
    (value) => value !== 0,
    "Сумма корректировки не может быть нулевой"
  ),
  accountId: z.string().min(1, "Выберите счет"),
  date: dateSchema,
  description: z
    .string()
    .trim()
    .max(180, "Описание должно быть короче 180 символов")
    .optional()
    .transform((value) => value || null),
  type: transactionTypeSchema.optional()
});

export const loanSchema = z
  .object({
    debtType: debtTypeSchema.default("BANK_LOAN"),
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
    initialAmount: optionalPositiveMoneySchema("Общая сумма должна быть больше нуля"),
    remainingAmount: nonnegativeMoneySchema("Остаток не может быть отрицательным"),
    monthlyPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
    plannedPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
    minimalPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
    creditLimit: optionalPositiveMoneySchema("Лимит должен быть больше нуля"),
    interestRate: optionalNonnegativeMoneySchema("Процент не может быть отрицательным").refine(
      (value) => value === null || value <= 100,
      "Процент не должен быть больше 100"
    ),
    gracePeriodDays: optionalNonnegativeIntegerSchema("Льготный период должен быть целым числом"),
    paymentDate: optionalDateSchema,
    accountId: z
      .preprocess(
        (value) => (value === "" || value === null ? undefined : value),
        z.string().min(1, "Выберите счет").optional()
      )
      .transform((value) => value ?? null),
    priority: debtPrioritySchema.default("MEDIUM"),
    status: loanStatusSchema
  })
  .superRefine((value, context) => {
    if (
      value.debtType !== "CREDIT_CARD" &&
      (!Number.isFinite(value.initialAmount) || !value.initialAmount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialAmount"],
        message: "Укажите общую сумму долга"
      });
    }

    if (
      value.initialAmount &&
      value.remainingAmount > value.initialAmount &&
      value.debtType !== "CREDIT_CARD"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingAmount"],
        message: "Остаток не может быть больше общей суммы"
      });
    }

  });

export const loanPaymentSchema = z.object({
  amount: positiveMoneySchema("Сумма платежа должна быть больше нуля"),
  date: dateSchema,
  description: z
    .string()
    .trim()
    .max(180, "Описание должно быть короче 180 символов")
    .optional()
    .transform((value) => value || null)
});

export const backupImportSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(2),
      type: categoryTypeSchema
    })
  ),
  accounts: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(2),
        type: accountTypeSchema.default("DEBIT"),
        balance: moneySchema("Укажите баланс"),
        currency: currencySchema.default("RUB"),
        creditLimit: optionalPositiveMoneySchema("Лимит должен быть больше нуля").optional(),
        currentDebt: optionalNonnegativeMoneySchema("Текущая задолженность не может быть отрицательной").optional(),
        availableCredit: optionalNonnegativeMoneySchema(
          "Доступно сейчас не может быть отрицательным"
        ).optional(),
        minimalPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным").optional(),
        paymentDate: optionalDateSchema.optional(),
        interestRate: optionalNonnegativeMoneySchema("Процент не может быть отрицательным").optional()
      })
    )
    .optional(),
  transactions: z.array(
    z.object({
      id: z.string().optional(),
      amount: moneySchema("Укажите сумму").refine(
        (value) => value !== 0,
        "Сумма не должна быть равна нулю"
      ),
      type: transactionTypeSchema,
      date: dateSchema,
      description: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      accountId: z.string().nullable().optional()
    })
  ),
  loans: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().trim().min(2),
      debtType: debtTypeSchema.default("BANK_LOAN"),
      lender: z.string().trim().nullable().optional(),
      initialAmount: optionalPositiveMoneySchema("Общая сумма должна быть больше нуля"),
      remainingAmount: nonnegativeMoneySchema("Остаток не может быть отрицательным"),
      monthlyPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным"),
      plannedPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным").optional(),
      minimalPayment: optionalNonnegativeMoneySchema("Платеж не может быть отрицательным").optional(),
      creditLimit: optionalPositiveMoneySchema("Лимит должен быть больше нуля").optional(),
      interestRate: optionalNonnegativeMoneySchema("Процент не может быть отрицательным").refine(
        (value) => value === null || value <= 100,
        "Процент не должен быть больше 100"
      ),
      gracePeriodDays: optionalNonnegativeIntegerSchema("Льготный период должен быть целым числом").optional(),
      paymentDate: optionalDateSchema,
      accountId: z.string().nullable().optional(),
      priority: debtPrioritySchema.default("MEDIUM"),
      status: loanStatusSchema
    })
  ),
  loanPayments: z
    .array(
      z.object({
        id: z.string().optional(),
        loanId: z.string(),
        amount: positiveMoneySchema("Сумма платежа должна быть больше нуля"),
        appliedAmount: optionalNonnegativeMoneySchema("Сумма погашения не может быть отрицательной").optional(),
        date: dateSchema,
        description: z.string().nullable().optional(),
        transactionId: z.string().nullable().optional()
      })
    )
    .optional(),
  transfers: z
    .array(
      z.object({
        id: z.string().optional(),
        fromAccountId: z.string(),
        toAccountId: z.string(),
        amount: positiveMoneySchema("Сумма перевода должна быть больше нуля"),
        date: dateSchema,
        description: z.string().nullable().optional()
      })
    )
    .optional()
});

export function firstZodError(error: z.ZodError) {
  return error.errors[0]?.message ?? "Проверьте введенные данные";
}
