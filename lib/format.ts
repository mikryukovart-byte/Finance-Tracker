import type { DebtPriority, DebtType, LoanState, TransactionKind } from "@/types/finance";

export const typeLabels: Record<TransactionKind, string> = {
  INCOME: "Доход",
  EXPENSE: "Расход"
};

export const loanStatusLabels: Record<LoanState, string> = {
  ACTIVE: "Активен",
  PAUSED: "Пауза",
  CLOSED: "Закрыт"
};

export const debtPriorityLabels: Record<DebtPriority, string> = {
  HIGH: "Высокий",
  MEDIUM: "Средний",
  LOW: "Низкий"
};

export const debtTypeLabels: Record<DebtType, string> = {
  BANK_LOAN: "Банковский кредит",
  CREDIT_CARD: "Кредитная карта",
  PERSONAL_DEBT: "Личный долг"
};

export function formatCurrency(value: number, currency = "RUB") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "Не указана";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function toDateInputValue(value: string | Date = new Date()) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function normalizeNumberInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return 0;
  }

  return Number(value.replace(",", "."));
}
