"use client";

import {
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
import { QuickTransactionInput } from "@/components/quick-transaction-input";
import { StatCard } from "@/components/stat-card";
import {
  buildQuery,
  fetchCategories,
  invalidateCategoriesCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatCurrency, formatDate, toDateInputValue, typeLabels } from "@/lib/format";
import type { Category, Transaction, TransactionKind } from "@/types/finance";

type TransactionForm = {
  amount: string;
  categoryId: string;
  date: string;
  description: string;
  type: TransactionKind;
};

type TransactionFilters = {
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  type: "ALL" | TransactionKind;
  sortBy: "date" | "amount";
  sortDir: "asc" | "desc";
};

type FormErrors = Partial<Record<keyof TransactionForm, string>>;

const defaultFilters: TransactionFilters = {
  dateFrom: "",
  dateTo: "",
  categoryId: "",
  type: "ALL",
  sortBy: "date",
  sortDir: "desc"
};

function createInitialForm(categoryId = ""): TransactionForm {
  return {
    amount: "",
    categoryId,
    date: toDateInputValue(),
    description: "",
    type: "EXPENSE"
  };
}

function validateForm(form: TransactionForm) {
  const errors: FormErrors = {};
  const amount = Number(form.amount.trim().replace(/\s/g, "").replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Введите сумму больше нуля";
  }

  if (!form.categoryId) {
    errors.categoryId = "Выберите категорию";
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

export function TransactionsClient() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<TransactionForm>(() => createInitialForm());
  const [filters, setFilters] = useState<TransactionFilters>(defaultFilters);
  const [errors, setErrors] = useState<FormErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const loadTransactions = useCallback(async () => {
    setLoading(true);

    try {
      const query = buildQuery({
        type: filters.type === "ALL" ? "" : filters.type,
        categoryId: filters.categoryId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sortBy: filters.sortBy,
        sortDir: filters.sortDir
      });
      const response = await fetch(`/api/transactions${query}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setTransactions(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    async function loadCategories() {
      setCategoriesLoading(true);

      try {
        setCategories(await fetchCategories());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
        setMessageTone("error");
      } finally {
        setCategoriesLoading(false);
      }
    }

    loadCategories();
  }, []);

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
    setForm(createInitialForm(expenseCategory));
    setEditingId(null);
    setErrors({});
  }

  function editTransaction(transaction: Transaction) {
    setEditingId(transaction.id);
    setForm({
      amount: String(transaction.amount),
      categoryId: transaction.categoryId,
      date: toDateInputValue(transaction.date),
      description: transaction.description ?? "",
      type: transaction.type
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      await loadTransactions();

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
      await loadTransactions();
      if (editingId === id) {
        resetForm();
      }
      setMessage("Операция удалена");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Операции"
        description="Быстрое добавление, фильтры и аккуратная история движения денег."
      />

      <div className="mb-6">
        <QuickTransactionInput title="Строка быстрого ввода" onAdded={loadTransactions} />
      </div>

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
                {(["EXPENSE", "INCOME"] as TransactionKind[]).map((type) => (
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
                <Link href="/categories" className="text-sm font-medium text-accent hover:underline">
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
              disabled={saving || categoriesLoading || formCategories.length === 0}
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
          <div className="card p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
                <label className="field-label" htmlFor="dateFrom">
                  С даты
                </label>
                <input
                  id="dateFrom"
                  className="field mt-1"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                />
              </div>

              <div>
                <label className="field-label" htmlFor="dateTo">
                  По дату
                </label>
                <input
                  id="dateTo"
                  className="field mt-1"
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, dateTo: event.target.value }))
                  }
                />
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
                onClick={() => setFilters(defaultFilters)}
              >
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Сбросить фильтры
              </button>
            </div>
          </div>

          {loading ? (
            <>
              <p className="text-sm text-muted">Загрузка...</p>
              <div className="card h-80 animate-pulse bg-soft/50" />
            </>
          ) : transactions.length === 0 ? (
            <EmptyState text="Операций по выбранным условиям нет" />
          ) : (
            <div className="table-wrap overflow-x-auto">
              <table className="table-base min-w-[840px]">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th>Категория</th>
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
                            transaction.type === "INCOME"
                              ? "bg-profit/10 text-profit"
                              : "bg-loss/10 text-loss"
                          }`}
                        >
                          {typeLabels[transaction.type]}
                        </span>
                      </td>
                      <td className="font-medium text-ink">{transaction.category.name}</td>
                      <td className="max-w-72 truncate text-muted">
                        {transaction.description || "Без описания"}
                      </td>
                      <td
                        className={`text-right font-semibold ${
                          transaction.type === "INCOME" ? "text-profit" : "text-loss"
                        }`}
                      >
                        {transaction.type === "INCOME" ? "+" : "-"}
                        {formatCurrency(transaction.amount)}
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn-secondary px-2"
                            onClick={() => editTransaction(transaction)}
                            aria-label="Редактировать операцию"
                            title="Редактировать"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-danger px-2"
                            onClick={() => deleteTransaction(transaction.id)}
                            aria-label="Удалить операцию"
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
