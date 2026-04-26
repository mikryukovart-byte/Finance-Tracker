"use client";

import {
  Banknote,
  CalendarClock,
  Check,
  Pencil,
  Plus,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FieldError, Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { readErrorMessage } from "@/lib/client-api";
import {
  debtPriorityLabels,
  formatCurrency,
  formatDate,
  formatPercent,
  loanStatusLabels,
  toDateInputValue
} from "@/lib/format";
import type { DebtPriority, Loan, LoanState, LoansResponse } from "@/types/finance";

type LoanForm = {
  title: string;
  lender: string;
  initialAmount: string;
  remainingAmount: string;
  monthlyPayment: string;
  interestRate: string;
  paymentDate: string;
  priority: DebtPriority;
  status: LoanState;
};

type LoanErrors = Partial<Record<keyof LoanForm, string>>;

const initialForm: LoanForm = {
  title: "",
  lender: "",
  initialAmount: "",
  remainingAmount: "",
  monthlyPayment: "",
  interestRate: "0",
  paymentDate: toDateInputValue(),
  priority: "MEDIUM",
  status: "ACTIVE"
};

function parseAmount(value: string) {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
}

function validateForm(form: LoanForm) {
  const errors: LoanErrors = {};
  const payload = {
    title: form.title.trim().replace(/\s+/g, " "),
    lender: form.lender.trim().replace(/\s+/g, " ") || null,
    initialAmount: parseAmount(form.initialAmount),
    remainingAmount: parseAmount(form.remainingAmount),
    monthlyPayment: parseAmount(form.monthlyPayment),
    interestRate: parseAmount(form.interestRate || "0"),
    paymentDate: form.paymentDate,
    priority: form.priority,
    status: form.status
  };

  if (payload.title.length < 2) {
    errors.title = "Название должно быть не короче 2 символов";
  }

  if (!Number.isFinite(payload.initialAmount) || payload.initialAmount <= 0) {
    errors.initialAmount = "Введите изначальную сумму больше нуля";
  }

  if (!Number.isFinite(payload.remainingAmount) || payload.remainingAmount < 0) {
    errors.remainingAmount = "Остаток не может быть отрицательным";
  }

  if (
    Number.isFinite(payload.initialAmount) &&
    Number.isFinite(payload.remainingAmount) &&
    payload.remainingAmount > payload.initialAmount
  ) {
    errors.remainingAmount = "Остаток не может быть больше изначальной суммы";
  }

  if (!Number.isFinite(payload.monthlyPayment) || payload.monthlyPayment < 0) {
    errors.monthlyPayment = "Платеж не может быть отрицательным";
  }

  if (payload.status === "ACTIVE" && payload.monthlyPayment <= 0) {
    errors.monthlyPayment = "Для активного кредита укажите ежемесячный платеж";
  }

  if (
    !Number.isFinite(payload.interestRate) ||
    payload.interestRate < 0 ||
    payload.interestRate > 100
  ) {
    errors.interestRate = "Процент должен быть от 0 до 100";
  }

  if (!payload.paymentDate) {
    errors.paymentDate = "Укажите дату платежа";
  }

  return {
    errors,
    payload,
    valid: Object.keys(errors).length === 0
  };
}

export function LoansClient() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<LoansResponse["summary"]>({
    totalDebt: 0,
    paymentsThisMonth: 0
  });
  const [form, setForm] = useState<LoanForm>(initialForm);
  const [errors, setErrors] = useState<LoanErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");

  const closedDebt = useMemo(
    () =>
      loans
        .filter((loan) => loan.status === "CLOSED")
        .reduce((sum, loan) => sum + loan.initialAmount, 0),
    [loans]
  );

  const nearestPayment = useMemo(() => {
    const activeLoans = loans
      .filter((loan) => loan.status === "ACTIVE")
      .sort(
        (a, b) =>
          new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
      );

    return activeLoans[0] ?? null;
  }, [loans]);

  async function loadLoans(showLoader = true) {
    if (showLoader) {
      setLoading(true);
    }
    setMessage("");

    try {
      const response = await fetch("/api/loans", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: LoansResponse = await response.json();
      setLoans(data.loans);
      setSummary(data.summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLoans();
  }, []);

  function resetForm() {
    setForm({ ...initialForm, paymentDate: toDateInputValue() });
    setErrors({});
    setEditingId(null);
  }

  function editLoan(loan: Loan) {
    setEditingId(loan.id);
    setForm({
      title: loan.title,
      lender: loan.lender ?? "",
      initialAmount: String(loan.initialAmount),
      remainingAmount: String(loan.remainingAmount),
      monthlyPayment: String(loan.monthlyPayment),
      interestRate: String(loan.interestRate),
      paymentDate: toDateInputValue(loan.paymentDate),
      priority: loan.priority,
      status: loan.status
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

    const url = editingId ? `/api/loans/${editingId}` : "/api/loans";
    const method = editingId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.payload)
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      await loadLoans(false);
      resetForm();
      setMessage(editingId ? "Кредит обновлен" : "Кредит добавлен");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLoan(loan: Loan) {
    const confirmed = window.confirm(`Удалить кредит «${loan.title}»?`);

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const response = await fetch(`/api/loans/${loan.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      await loadLoans(false);
      if (editingId === loan.id) {
        resetForm();
      }
      setMessage("Кредит удален");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Кредиты"
        description="Контролируйте остатки, платежи и статус долгов."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard
          label="Общий долг"
          value={formatCurrency(summary.totalDebt)}
          icon={Banknote}
          tone="expense"
        />
        <StatCard
          label="Обязательные платежи в месяц"
          value={formatCurrency(summary.paymentsThisMonth)}
          icon={WalletCards}
          tone="neutral"
        />
        <StatCard
          label="Погашено по активным"
          value={formatCurrency(summary.paidAmount ?? closedDebt)}
          icon={Check}
          tone="income"
        />
      </div>

      {nearestPayment ? (
        <section className="mb-6 card p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-soft p-2 text-ink">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-ink">Ближайший платеж</h2>
                <p className="text-sm text-muted">
                  {nearestPayment.title} · {formatDate(nearestPayment.paymentDate)}
                </p>
              </div>
            </div>
            <div className="text-lg font-semibold text-ink">
              {formatCurrency(nearestPayment.monthlyPayment)}
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">
              {editingId ? "Редактирование" : "Новый кредит"}
            </h2>
            {editingId ? (
              <button type="button" className="btn-secondary" onClick={resetForm}>
                <X className="h-4 w-4" aria-hidden="true" />
                Отмена
              </button>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="loanTitle">
                Название
              </label>
              <input
                id="loanTitle"
                className="field mt-1"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Например, Ипотека"
                autoComplete="off"
              />
              <FieldError message={errors.title} />
            </div>

            <div>
              <label className="field-label" htmlFor="loanLender">
                Кредитор
              </label>
              <input
                id="loanLender"
                className="field mt-1"
                value={form.lender}
                onChange={(event) =>
                  setForm((current) => ({ ...current, lender: event.target.value }))
                }
                placeholder="Например, банк или человек"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="initialAmount">
                  Общая сумма долга
                </label>
                <input
                  id="initialAmount"
                  className="field mt-1"
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={form.initialAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      initialAmount: event.target.value
                    }))
                  }
                  placeholder="Например, 1000000"
                />
                <FieldError message={errors.initialAmount} />
              </div>

              <div>
                <label className="field-label" htmlFor="remainingAmount">
                  Остаток
                </label>
                <input
                  id="remainingAmount"
                  className="field mt-1"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.remainingAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      remainingAmount: event.target.value
                    }))
                  }
                  placeholder="Например, 740000"
                />
                <FieldError message={errors.remainingAmount} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="monthlyPayment">
                  Минимальный платеж
                </label>
                <input
                  id="monthlyPayment"
                  className="field mt-1"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.monthlyPayment}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      monthlyPayment: event.target.value
                    }))
                  }
                  placeholder="Например, 32000"
                />
                <FieldError message={errors.monthlyPayment} />
              </div>

              <div>
                <label className="field-label" htmlFor="interestRate">
                  Процент годовых
                </label>
                <input
                  id="interestRate"
                  className="field mt-1"
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={form.interestRate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      interestRate: event.target.value
                    }))
                  }
                  placeholder="Например, 11.5"
                />
                <FieldError message={errors.interestRate} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="paymentDate">
                  Дата платежа
                </label>
                <input
                  id="paymentDate"
                  className="field mt-1"
                  type="date"
                  value={form.paymentDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      paymentDate: event.target.value
                    }))
                  }
                />
                <FieldError message={errors.paymentDate} />
              </div>

              <div>
                <label className="field-label" htmlFor="loanStatus">
                  Статус
                </label>
                <select
                  id="loanStatus"
                  className="field mt-1"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as LoanState
                    }))
                  }
                >
                  <option value="ACTIVE">Активен</option>
                  <option value="PAUSED">Пауза</option>
                  <option value="CLOSED">Закрыт</option>
                </select>
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="loanPriority">
                Приоритет
              </label>
              <select
                id="loanPriority"
                className="field mt-1"
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as DebtPriority
                  }))
                }
              >
                <option value="HIGH">Высокий</option>
                <option value="MEDIUM">Средний</option>
                <option value="LOW">Низкий</option>
              </select>
            </div>

            <Notice message={message} tone={messageTone} />

            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {editingId ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Сохранение" : editingId ? "Сохранить" : "Добавить"}
            </button>
          </form>
        </section>

        <section className="min-w-0">
          {loading ? (
            <>
              <p className="mb-3 text-sm text-muted">Загрузка...</p>
              <div className="card h-80 animate-pulse bg-soft/50" />
            </>
          ) : loans.length === 0 ? (
            <EmptyState text="Кредитов пока нет" />
          ) : (
            <div className="grid gap-4">
              {loans.map((loan) => {
                const paidPercent =
                  loan.initialAmount > 0
                    ? Math.min(
                        100,
                        Math.max(
                          0,
                          ((loan.initialAmount - loan.remainingAmount) /
                            loan.initialAmount) *
                            100
                        )
                      )
                    : 0;
                const statusTone =
                  loan.status === "ACTIVE"
                    ? "bg-profit/10 text-profit"
                    : loan.status === "PAUSED"
                      ? "bg-warning/10 text-warning"
                      : "bg-soft text-muted";
                const priorityTone =
                  loan.priority === "HIGH"
                    ? "bg-loss/10 text-loss"
                    : loan.priority === "MEDIUM"
                      ? "bg-warning/10 text-warning"
                      : "bg-soft text-muted";

                return (
                  <article key={loan.id} className="card p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-ink">{loan.title}</h2>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone}`}>
                            {loanStatusLabels[loan.status]}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${priorityTone}`}>
                            {debtPriorityLabels[loan.priority]}
                          </span>
                        </div>
                        {loan.lender ? (
                          <div className="mt-1 text-sm text-muted">
                            Кредитор: {loan.lender}
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <div className="text-xs text-muted">Общая сумма долга</div>
                            <div className="font-medium text-ink">
                              {formatCurrency(loan.initialAmount)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">Остаток</div>
                            <div className="font-medium text-loss">
                              {formatCurrency(loan.remainingAmount)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">Минимальный платеж</div>
                            <div className="font-medium text-ink">
                              {formatCurrency(loan.monthlyPayment)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">Процент</div>
                            <div className="font-medium text-ink">
                              {formatPercent(loan.interestRate)}%
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="mb-2 flex justify-between text-xs text-muted">
                            <span>Погашено</span>
                            <span>{formatPercent(paidPercent)}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-soft">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${paidPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-3 text-sm text-muted">
                          Дата платежа: {formatDate(loan.paymentDate)}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-secondary px-2"
                          onClick={() => editLoan(loan)}
                          aria-label="Редактировать кредит"
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-danger px-2"
                          onClick={() => deleteLoan(loan)}
                          aria-label="Удалить кредит"
                          title="Удалить"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
