"use client";

import {
  ArrowRightLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  Check,
  FilterX,
  Pencil,
  Plus,
  Scale,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FieldError, Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { QuickTransactionInput } from "@/components/quick-transaction-input";
import { StatCard } from "@/components/stat-card";
import {
  buildQuery,
  fetchAccounts,
  fetchCategories,
  fetchJsonCached,
  invalidateCategoriesCache,
  invalidateFinancialDataCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatCurrency, formatDate, toDateInputValue, typeLabels } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import type { Account, Category, CategoryKind, Transaction } from "@/types/finance";

type TransactionForm = {
  accountId: string;
  amount: string;
  categoryId: string;
  date: string;
  description: string;
  type: CategoryKind;
};

type AdjustmentEditForm = {
  accountId: string;
  amount: string;
  date: string;
  description: string;
};

type TransactionFilters = {
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  type: "ALL" | CategoryKind;
  sortBy: "date" | "amount";
  sortDir: "asc" | "desc";
};

type FormErrors = Partial<Record<keyof TransactionForm | keyof AdjustmentEditForm, string>>;

const defaultFilters: TransactionFilters = {
  dateFrom: "",
  dateTo: "",
  categoryId: "",
  type: "ALL",
  sortBy: "date",
  sortDir: "desc"
};
const initialTransactionsPeriod = createPeriodState("month");

function createInitialForm(categoryId = "", accountId = ""): TransactionForm {
  return {
    accountId,
    amount: "",
    categoryId,
    date: toDateInputValue(),
    description: "",
    type: "EXPENSE"
  };
}

function parseAmountInput(value: string) {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
}

function validateForm(form: TransactionForm) {
  const errors: FormErrors = {};
  const amount = parseAmountInput(form.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Введите сумму больше нуля";
  }

  if (!form.categoryId) {
    errors.categoryId = "Выберите категорию";
  }

  if (!form.accountId) {
    errors.accountId = "Выберите счет";
  }

  if (!form.date) {
    errors.date = "Укажите дату";
  }

  return {
    amount,
    errors,
    valid: Object.keys(errors).length === 0
  };
}

function validateAdjustmentForm(form: AdjustmentEditForm) {
  const errors: FormErrors = {};
  const amount = parseAmountInput(form.amount);

  if (!Number.isFinite(amount) || amount === 0) {
    errors.amount = "Введите ненулевую сумму корректировки";
  }

  if (!form.accountId) {
    errors.accountId = "Выберите счет";
  }

  if (!form.date) {
    errors.date = "Укажите дату";
  }

  return {
    amount,
    errors,
    valid: Object.keys(errors).length === 0
  };
}

function transactionCategoryName(transaction: Transaction) {
  if (transaction.type === "ADJUSTMENT") {
    return "Корректировка";
  }

  return transaction.category?.name ?? "Без категории";
}

function transactionAmountClass(transaction: Transaction) {
  if (transaction.type === "INCOME") {
    return "text-profit";
  }

  if (transaction.type === "EXPENSE") {
    return "text-loss";
  }

  return "text-muted";
}

function transactionAmountPrefix(transaction: Transaction) {
  if (transaction.type === "INCOME") {
    return "+";
  }

  if (transaction.type === "EXPENSE") {
    return "-";
  }

  return transaction.amount > 0 ? "+" : "";
}

function transactionBadgeClass(transaction: Transaction) {
  if (transaction.type === "INCOME") {
    return "bg-profit/10 text-profit";
  }

  if (transaction.type === "EXPENSE") {
    return "bg-loss/10 text-loss";
  }

  return "bg-soft text-muted";
}

export function TransactionsClient() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<TransactionForm>(() => createInitialForm());
  const [filters, setFilters] = useState<TransactionFilters>(defaultFilters);
  const [period, setPeriod] = useState(() => initialTransactionsPeriod);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movingTransaction, setMovingTransaction] = useState<Transaction | null>(null);
  const [moveAccountId, setMoveAccountId] = useState("");
  const [adjustmentEdit, setAdjustmentEdit] = useState<{
    id: string;
    form: AdjustmentEditForm;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");

  const formCategories = useMemo(
    () => categories.filter((category) => category.type === form.type),
    [categories, form.type]
  );

  const filterCategories = useMemo(() => {
    if (filters.type === "ALL") {
      return categories;
    }

    return categories.filter((category) => category.type === filters.type);
  }, [categories, filters.type]);

  const totals = useMemo(() => {
    const income = transactions
      .filter((transaction) => transaction.type === "INCOME")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = transactions
      .filter((transaction) => transaction.type === "EXPENSE")
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    return {
      income,
      expense,
      balance: income - expense
    };
  }, [transactions]);

  const loadTransactions = useCallback(async (force = false) => {
    const query = buildQuery({
      type: filters.type === "ALL" ? "" : filters.type,
      categoryId: filters.categoryId,
      ...buildPeriodQuery(period),
      sortBy: filters.sortBy,
      sortDir: filters.sortDir
    });
    const cacheKey = `transactions:${query}`;
    const cached = readClientCache<Transaction[]>(cacheKey);

    if (cached && !force) {
      setTransactions(cached);
    }

    setLoading(!cached);
    try {
      setTransactions(
        await fetchJsonCached<Transaction[]>(cacheKey, `/api/transactions${query}`, {
          force,
          ttlMs: 8_000
        })
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [filters, period]);

  useEffect(() => {
    async function loadDictionaries() {
      setCategoriesLoading(true);
      setAccountsLoading(true);

      try {
        const [categoryData, accountData] = await Promise.all([
          fetchCategories(),
          fetchAccounts()
        ]);
        setCategories(categoryData);
        setAccounts(accountData.accounts);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
        setMessageTone("error");
      } finally {
        setCategoriesLoading(false);
        setAccountsLoading(false);
      }
    }

    loadDictionaries();
  }, []);

  useEffect(() => {
    if (accounts.length === 0) {
      setForm((current) => ({ ...current, accountId: "" }));
      return;
    }

    if (!accounts.some((account) => account.id === form.accountId)) {
      setForm((current) => ({ ...current, accountId: accounts[0].id }));
    }
  }, [accounts, form.accountId]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (formCategories.length === 0) {
      setForm((current) => ({ ...current, categoryId: "" }));
      return;
    }

    if (!formCategories.some((category) => category.id === form.categoryId)) {
      setForm((current) => ({ ...current, categoryId: formCategories[0].id }));
    }
  }, [formCategories, form.categoryId]);

  useEffect(() => {
    if (
      filters.categoryId &&
      !filterCategories.some((category) => category.id === filters.categoryId)
    ) {
      setFilters((current) => ({ ...current, categoryId: "" }));
    }
  }, [filterCategories, filters.categoryId]);

  function resetForm(nextCategoryId?: string) {
    const expenseCategory =
      nextCategoryId ??
      categories.find((category) => category.type === "EXPENSE")?.id ??
      "";
    setForm(createInitialForm(expenseCategory, accounts[0]?.id ?? ""));
    setEditingId(null);
    setAdjustmentEdit(null);
    setErrors({});
  }

  function editTransaction(transaction: Transaction) {
    if (transaction.type === "ADJUSTMENT") {
      setEditingId(null);
      setAdjustmentEdit({
        id: transaction.id,
        form: {
          accountId: transaction.accountId ?? "",
          amount: String(transaction.amount),
          date: toDateInputValue(transaction.date),
          description: transaction.description ?? ""
        }
      });
      setErrors({});
      setMessage("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setAdjustmentEdit(null);
    setEditingId(transaction.id);
    setForm({
      accountId: transaction.accountId ?? "",
      amount: String(transaction.amount),
      categoryId: transaction.categoryId ?? "",
      date: toDateInputValue(transaction.date),
      description: transaction.description ?? "",
      type: transaction.type
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startMoveTransaction(transaction: Transaction) {
    const nextAccount =
      accounts.find((account) => account.id !== transaction.accountId) ??
      accounts.find((account) => account.id === transaction.accountId) ??
      accounts[0];

    setMovingTransaction(transaction);
    setMoveAccountId(nextAccount?.id ?? "");
    setMessage("");
  }

  async function saveAdjustmentEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!adjustmentEdit) {
      return;
    }

    const validation = validateAdjustmentForm(adjustmentEdit.form);
    setErrors(validation.errors);

    if (!validation.valid) {
      setMessage("Проверьте поля корректировки");
      setMessageTone("error");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/transactions/${adjustmentEdit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...adjustmentEdit.form,
          amount: validation.amount,
          type: "ADJUSTMENT"
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      const accountData = await fetchAccounts({ force: true });
      setAccounts(accountData.accounts);
      await loadTransactions(true);
      setAdjustmentEdit(null);
      setMessage("Корректировка обновлена");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обновить корректировку");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function moveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!movingTransaction || !moveAccountId) {
      setMessage("Выберите счет для переноса");
      setMessageTone("error");
      return;
    }

    if (movingTransaction.accountId === moveAccountId) {
      setMessage("Операция уже находится на этом счете");
      setMessageTone("error");
      return;
    }

    setMoving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/transactions/${movingTransaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: moveAccountId })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      const accountData = await fetchAccounts({ force: true });
      setAccounts(accountData.accounts);
      await loadTransactions(true);
      setMovingTransaction(null);
      setMoveAccountId("");
      setMessage("Операция перенесена на другой счет");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось перенести операцию");
      setMessageTone("error");
    } finally {
      setMoving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const validation = validateForm(form);
    setErrors(validation.errors);

    if (!validation.valid) {
      setMessage("Проверьте поля формы");
      setMessageTone("error");
      return;
    }

    setSaving(true);

    const payload = {
      amount: validation.amount,
      accountId: form.accountId,
      categoryId: form.categoryId,
      date: form.date,
      description: form.description,
      type: form.type
    };
    const url = editingId ? `/api/transactions/${editingId}` : "/api/transactions";
    const method = editingId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateCategoriesCache();
      invalidateFinancialDataCache();
      const accountData = await fetchAccounts({ force: true });
      setAccounts(accountData.accounts);
      await loadTransactions(true);

      if (editingId) {
        resetForm();
        setMessage("Операция обновлена");
      } else {
        setForm((current) => ({
          ...current,
          amount: "",
          description: "",
          date: toDateInputValue()
        }));
        setMessage("Операция добавлена");
      }

      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction(id: string) {
    const confirmed = window.confirm("Удалить операцию?");

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const response = await fetch(`/api/transactions/${id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateCategoriesCache();
      invalidateFinancialDataCache();
      const accountData = await fetchAccounts({ force: true });
      setAccounts(accountData.accounts);
      await loadTransactions(true);
      if (editingId === id) {
        resetForm();
      }
      if (movingTransaction?.id === id) {
        setMovingTransaction(null);
        setMoveAccountId("");
      }
      if (adjustmentEdit?.id === id) {
        setAdjustmentEdit(null);
      }
      setMessage("Операция удалена");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    }
  }

  function renderTransactionActions(transaction: Transaction, showLabels = false) {
    const secondaryClass = showLabels
      ? "btn-secondary min-h-9 px-3 py-1.5"
      : "btn-secondary h-9 w-9 min-h-0 p-0";
    const dangerClass = showLabels
      ? "btn-danger min-h-9 px-3 py-1.5"
      : "btn-danger h-9 w-9 min-h-0 p-0";

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className={secondaryClass}
          onClick={() => editTransaction(transaction)}
          aria-label="Редактировать операцию"
          title="Редактировать"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {showLabels ? <span>Редактировать</span> : null}
        </button>
        {accounts.length > 1 ? (
          <button
            type="button"
            className={secondaryClass}
            onClick={() => startMoveTransaction(transaction)}
            aria-label="Перенести на другой счет"
            title="Перенести на другой счет"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            {showLabels ? <span>Перенести</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          className={dangerClass}
          onClick={() => deleteTransaction(transaction.id)}
          aria-label="Удалить операцию"
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {showLabels ? <span>Удалить</span> : null}
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Операции"
        description={`Быстрое добавление, фильтры и история за период: ${describePeriod(period)}.`}
      />

      <div className="mb-6">
        <QuickTransactionInput
          title="Строка быстрого ввода"
          accounts={accounts}
          categories={categories}
          onAdded={async () => {
            const accountData = await fetchAccounts({ force: true });
            setAccounts(accountData.accounts);
            await loadTransactions(true);
          }}
        />
      </div>

      <PeriodFilter value={period} onChange={setPeriod} />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard
          label="Доходы в выборке"
          value={formatCurrency(totals.income)}
          icon={ArrowUpCircle}
          tone="income"
        />
        <StatCard
          label="Расходы в выборке"
          value={formatCurrency(totals.expense)}
          icon={ArrowDownCircle}
          tone="expense"
        />
        <StatCard
          label="Итог выборки"
          value={formatCurrency(totals.balance)}
          icon={Scale}
          tone={totals.balance >= 0 ? "income" : "expense"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">
              {editingId ? "Редактирование" : "Новая операция"}
            </h2>
            {editingId ? (
              <button type="button" className="btn-secondary" onClick={() => resetForm()}>
                <X className="h-4 w-4" aria-hidden="true" />
                Отмена
              </button>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <span className="field-label">Тип</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["EXPENSE", "INCOME"] as CategoryKind[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                      form.type === type
                        ? "border-line bg-soft text-ink"
                        : "border-line bg-transparent text-muted hover:bg-soft hover:text-ink"
                    }`}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        type
                      }))
                    }
                  >
                    {typeLabels[type]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="amount">
                Сумма
              </label>
              <input
                id="amount"
                className="field mt-1"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                type="number"
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: event.target.value }))
                }
                placeholder="Например, 1200"
                autoComplete="off"
              />
              <FieldError message={errors.amount} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="field-label" htmlFor="categoryId">
                  Категория
                </label>
                <Link href="/settings" className="text-sm font-medium text-accent hover:underline">
                  Создать
                </Link>
              </div>
              {formCategories.length === 0 && !categoriesLoading ? (
                <div className="mt-1 rounded-md border border-dashed border-line bg-paper/40 px-3 py-3 text-sm text-muted">
                  Для типа «{typeLabels[form.type]}» пока нет категорий. Создайте категорию,
                  чтобы добавить операцию.
                </div>
              ) : (
                <select
                  id="categoryId"
                  className="field mt-1"
                  value={form.categoryId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, categoryId: event.target.value }))
                  }
                  disabled={categoriesLoading}
                >
                  {categoriesLoading ? (
                    <option value="">Загрузка категорий</option>
                  ) : (
                    formCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))
                  )}
                </select>
              )}
              <FieldError message={errors.categoryId} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="field-label" htmlFor="accountId">
                  Счет
                </label>
                <Link href="/wallet" className="text-sm font-medium text-accent hover:underline">
                  Кошелёк
                </Link>
              </div>
              {accounts.length === 0 && !accountsLoading ? (
                <div className="mt-1 rounded-md border border-dashed border-line bg-paper/40 px-3 py-3 text-sm text-muted">
                  Создайте счет, чтобы добавить операцию.
                </div>
              ) : (
                <select
                  id="accountId"
                  className="field mt-1"
                  value={form.accountId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, accountId: event.target.value }))
                  }
                  disabled={accountsLoading}
                >
                  {accountsLoading ? (
                    <option value="">Загрузка счетов</option>
                  ) : (
                    accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.type === "CREDIT_CARD"
                          ? `${account.name} · доступно ${formatCurrency(
                              account.availableCredit,
                              account.currency
                            )} · долг ${formatCurrency(account.currentDebt, account.currency)}`
                          : `${account.name} · ${formatCurrency(account.balance, account.currency)}`}
                      </option>
                    ))
                  )}
                </select>
              )}
              <FieldError message={errors.accountId} />
            </div>

            <div>
              <label className="field-label" htmlFor="date">
                Дата
              </label>
              <input
                id="date"
                className="field mt-1"
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
              />
              <FieldError message={errors.date} />
            </div>

            <div>
              <label className="field-label" htmlFor="description">
                Описание
              </label>
              <textarea
                id="description"
                className="field mt-1 min-h-20 resize-y"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Например, кофе, доставка, аванс"
                maxLength={180}
              />
            </div>

            <Notice message={message} tone={messageTone} />

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={
                saving ||
                categoriesLoading ||
                accountsLoading ||
                formCategories.length === 0 ||
                accounts.length === 0
              }
            >
              {editingId ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Сохранение" : editingId ? "Сохранить" : "Добавить"}
            </button>
          </form>
        </section>

        <section className="min-w-0 space-y-4">
          {adjustmentEdit ? (
            <div className="card p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Редактирование корректировки
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Корректировка влияет только на баланс счета.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setAdjustmentEdit(null);
                    setErrors({});
                  }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Отмена
                </button>
              </div>

              <form className="grid gap-3 md:grid-cols-2" onSubmit={saveAdjustmentEdit}>
                <div>
                  <label className="field-label" htmlFor="adjustmentAmount">
                    Сумма корректировки
                  </label>
                  <input
                    id="adjustmentAmount"
                    className="field mt-1"
                    inputMode="decimal"
                    value={adjustmentEdit.form.amount}
                    onChange={(event) =>
                      setAdjustmentEdit((current) =>
                        current
                          ? {
                              ...current,
                              form: { ...current.form, amount: event.target.value }
                            }
                          : current
                      )
                    }
                    placeholder="Например, -500 или 1200"
                  />
                  <FieldError message={errors.amount} />
                </div>

                <div>
                  <label className="field-label" htmlFor="adjustmentAccountId">
                    Счет
                  </label>
                  <select
                    id="adjustmentAccountId"
                    className="field mt-1"
                    value={adjustmentEdit.form.accountId}
                    onChange={(event) =>
                      setAdjustmentEdit((current) =>
                        current
                          ? {
                              ...current,
                              form: { ...current.form, accountId: event.target.value }
                            }
                          : current
                      )
                    }
                    disabled={accountsLoading}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors.accountId} />
                </div>

                <div>
                  <label className="field-label" htmlFor="adjustmentDate">
                    Дата
                  </label>
                  <input
                    id="adjustmentDate"
                    className="field mt-1"
                    type="date"
                    value={adjustmentEdit.form.date}
                    onChange={(event) =>
                      setAdjustmentEdit((current) =>
                        current
                          ? {
                              ...current,
                              form: { ...current.form, date: event.target.value }
                            }
                          : current
                      )
                    }
                  />
                  <FieldError message={errors.date} />
                </div>

                <div>
                  <label className="field-label" htmlFor="adjustmentDescription">
                    Комментарий
                  </label>
                  <input
                    id="adjustmentDescription"
                    className="field mt-1"
                    value={adjustmentEdit.form.description}
                    onChange={(event) =>
                      setAdjustmentEdit((current) =>
                        current
                          ? {
                              ...current,
                              form: { ...current.form, description: event.target.value }
                            }
                          : current
                      )
                    }
                    placeholder="Причина корректировки"
                    maxLength={180}
                  />
                </div>

                <div className="md:col-span-2">
                  <button type="submit" className="btn-primary" disabled={saving}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {saving ? "Сохранение" : "Сохранить корректировку"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {movingTransaction ? (
            <div className="card p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Перенести на другой счет
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {typeLabels[movingTransaction.type]} ·{" "}
                    {transactionCategoryName(movingTransaction)} ·{" "}
                    {formatCurrency(movingTransaction.amount)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setMovingTransaction(null);
                    setMoveAccountId("");
                  }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Отмена
                </button>
              </div>

              <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={moveTransaction}>
                <div>
                  <label className="field-label" htmlFor="moveAccountId">
                    Новый счет
                  </label>
                  <select
                    id="moveAccountId"
                    className="field mt-1"
                    value={moveAccountId}
                    onChange={(event) => setMoveAccountId(event.target.value)}
                    disabled={moving || accountsLoading}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.type === "CREDIT_CARD"
                          ? `${account.name} · доступно ${formatCurrency(
                              account.availableCredit,
                              account.currency
                            )} · долг ${formatCurrency(account.currentDebt, account.currency)}`
                          : `${account.name} · ${formatCurrency(account.balance, account.currency)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="btn-primary self-end"
                  disabled={moving || accounts.length === 0 || movingTransaction.accountId === moveAccountId}
                >
                  <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                  {moving ? "Перенос" : "Перенести"}
                </button>
              </form>
            </div>
          ) : null}

          <div className="card p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="field-label" htmlFor="filterType">
                  Тип
                </label>
                <select
                  id="filterType"
                  className="field mt-1"
                  value={filters.type}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      type: event.target.value as TransactionFilters["type"],
                      categoryId: ""
                    }))
                  }
                >
                  <option value="ALL">Все</option>
                  <option value="EXPENSE">Расходы</option>
                  <option value="INCOME">Доходы</option>
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="filterCategory">
                  Категория
                </label>
                <select
                  id="filterCategory"
                  className="field mt-1"
                  value={filters.categoryId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      categoryId: event.target.value
                    }))
                  }
                >
                  <option value="">Все категории</option>
                  {filterCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="sortBy">
                  Сортировка
                </label>
                <select
                  id="sortBy"
                  className="field mt-1"
                  value={filters.sortBy}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      sortBy: event.target.value as TransactionFilters["sortBy"]
                    }))
                  }
                >
                  <option value="date">По дате</option>
                  <option value="amount">По сумме</option>
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="sortDir">
                  Порядок
                </label>
                <select
                  id="sortDir"
                  className="field mt-1"
                  value={filters.sortDir}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      sortDir: event.target.value as TransactionFilters["sortDir"]
                    }))
                  }
                >
                  <option value="desc">Сначала новые</option>
                  <option value="asc">Сначала старые</option>
                </select>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-sm text-muted">Найдено: {transactions.length}</div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setFilters(defaultFilters);
                  setPeriod(createPeriodState("month"));
                }}
              >
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Сбросить фильтры
              </button>
            </div>
          </div>

          {loading && transactions.length > 0 ? (
            <p className="text-sm text-muted">Обновляем данные…</p>
          ) : null}

          {loading && transactions.length === 0 ? (
            <>
              <p className="text-sm text-muted">Загрузка...</p>
              <div className="card p-4 sm:p-5">
                <div className="space-y-3">
                  <div className="h-3 w-3/4 animate-pulse rounded-md bg-soft/50" />
                  <div className="h-3 w-2/3 animate-pulse rounded-md bg-soft/40" />
                  <div className="h-3 w-5/6 animate-pulse rounded-md bg-soft/40" />
                  <div className="h-3 w-1/2 animate-pulse rounded-md bg-soft/30" />
                </div>
              </div>
            </>
          ) : transactions.length === 0 ? (
            <EmptyState text="Операций по выбранным условиям нет" />
          ) : (
            <div>
              <div className="hidden lg:block">
                <div className="table-wrap">
                  <table className="table-base table-fixed">
                    <colgroup>
                      <col className="w-[108px]" />
                      <col className="w-[104px]" />
                      <col className="w-[16%]" />
                      <col className="w-[16%]" />
                      <col />
                      <col className="w-[128px]" />
                      <col className="w-[132px]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Тип</th>
                        <th>Категория</th>
                        <th>Счет</th>
                        <th>Описание</th>
                        <th className="text-right">Сумма</th>
                        <th className="text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td className="whitespace-nowrap">{formatDate(transaction.date)}</td>
                          <td>
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-medium ${
                                transactionBadgeClass(transaction)
                              }`}
                            >
                              {typeLabels[transaction.type]}
                            </span>
                          </td>
                          <td>
                            <div className="truncate font-medium text-ink">
                              {transactionCategoryName(transaction)}
                            </div>
                          </td>
                          <td>
                            <div className="truncate text-muted">
                              {transaction.account?.name ?? "Счет"}
                            </div>
                          </td>
                          <td>
                            <div className="truncate text-muted">
                              {transaction.description || "Без описания"}
                            </div>
                          </td>
                          <td
                            className={`whitespace-nowrap text-right font-semibold ${
                              transactionAmountClass(transaction)
                            }`}
                          >
                            {transactionAmountPrefix(transaction)}
                            {formatCurrency(transaction.amount)}
                          </td>
                          <td>{renderTransactionActions(transaction)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3 lg:hidden">
                {transactions.map((transaction) => (
                  <article key={transaction.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">
                            {formatDate(transaction.date)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${
                              transactionBadgeClass(transaction)
                            }`}
                          >
                            {typeLabels[transaction.type]}
                          </span>
                        </div>
                        <div className="mt-2 truncate font-medium text-ink">
                          {transactionCategoryName(transaction)}
                        </div>
                        <div className="mt-1 text-sm text-muted">
                          {transaction.account?.name ?? "Счет"}
                          {transaction.description ? ` · ${transaction.description}` : ""}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 whitespace-nowrap text-right font-semibold ${
                          transactionAmountClass(transaction)
                        }`}
                      >
                        {transactionAmountPrefix(transaction)}
                        {formatCurrency(transaction.amount)}
                      </div>
                    </div>
                    <div className="mt-3 border-t border-line pt-3">
                      {renderTransactionActions(transaction, true)}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
