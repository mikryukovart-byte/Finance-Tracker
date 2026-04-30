"use client";

import {
  Banknote,
  CalendarClock,
  Check,
  History,
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
  debtTypeLabels,
  formatCurrency,
  formatDate,
  formatPercent,
  loanStatusLabels,
  toDateInputValue
} from "@/lib/format";
import type {
  DebtPriority,
  DebtType,
  Loan,
  LoanPayment,
  LoanState,
  LoansResponse
} from "@/types/finance";

type LoanForm = {
  debtType: DebtType;
  title: string;
  lender: string;
  initialAmount: string;
  remainingAmount: string;
  monthlyPayment: string;
  plannedPayment: string;
  minimalPayment: string;
  creditLimit: string;
  interestRate: string;
  paymentDate: string;
  priority: DebtPriority;
  status: LoanState;
};

type PaymentForm = {
  amount: string;
  date: string;
  description: string;
};

type LoanErrors = Partial<Record<keyof LoanForm, string>>;

const initialForm: LoanForm = {
  debtType: "BANK_LOAN",
  title: "",
  lender: "",
  initialAmount: "",
  remainingAmount: "",
  monthlyPayment: "",
  plannedPayment: "",
  minimalPayment: "",
  creditLimit: "",
  interestRate: "0",
  paymentDate: "",
  priority: "MEDIUM",
  status: "ACTIVE"
};

function createInitialPaymentForm(): PaymentForm {
  return {
    amount: "",
    date: toDateInputValue(),
    description: ""
  };
}

function parseAmount(value: string) {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
}

function parseOptionalAmount(value: string) {
  const trimmed = value.trim();
  return trimmed ? parseAmount(trimmed) : null;
}

function getScheduledPayment(loan: Loan) {
  return loan.plannedPayment ?? loan.minimalPayment ?? loan.monthlyPayment ?? 0;
}

function getProgress(loan: Loan) {
  if (loan.initialAmount && loan.initialAmount > 0) {
    return {
      label: "Погашено",
      percent: Math.min(
        100,
        Math.max(0, ((loan.initialAmount - loan.remainingAmount) / loan.initialAmount) * 100)
      )
    };
  }

  if (loan.debtType === "CREDIT_CARD" && loan.creditLimit && loan.creditLimit > 0) {
    return {
      label: "Использовано лимита",
      percent: Math.min(100, Math.max(0, (loan.remainingAmount / loan.creditLimit) * 100))
    };
  }

  return null;
}

function validateForm(form: LoanForm) {
  const errors: LoanErrors = {};
  const plannedPayment = parseOptionalAmount(form.plannedPayment);
  const minimalPayment = parseOptionalAmount(form.minimalPayment);
  const fallbackPayment = form.debtType === "CREDIT_CARD" ? minimalPayment : plannedPayment;
  const payload = {
    debtType: form.debtType,
    title: form.title.trim().replace(/\s+/g, " "),
    lender: form.lender.trim().replace(/\s+/g, " ") || null,
    initialAmount: parseOptionalAmount(form.initialAmount),
    remainingAmount: parseAmount(form.remainingAmount),
    monthlyPayment: fallbackPayment,
    plannedPayment,
    minimalPayment,
    creditLimit: parseOptionalAmount(form.creditLimit),
    interestRate: parseOptionalAmount(form.interestRate),
    paymentDate: form.paymentDate || null,
    priority: form.priority,
    status: form.status
  };

  if (payload.title.length < 2) {
    errors.title = "Название должно быть не короче 2 символов";
  }

  if (
    form.debtType !== "CREDIT_CARD" &&
    (!Number.isFinite(payload.initialAmount) || !payload.initialAmount || payload.initialAmount <= 0)
  ) {
    errors.initialAmount = "Введите общую сумму долга";
  }

  if (!Number.isFinite(payload.remainingAmount) || payload.remainingAmount < 0) {
    errors.remainingAmount = "Остаток не может быть отрицательным";
  }

  if (
    payload.initialAmount &&
    Number.isFinite(payload.remainingAmount) &&
    payload.remainingAmount > payload.initialAmount &&
    form.debtType !== "CREDIT_CARD"
  ) {
    errors.remainingAmount = "Остаток не может быть больше общей суммы";
  }

  if (plannedPayment !== null && (!Number.isFinite(plannedPayment) || plannedPayment < 0)) {
    errors.plannedPayment = "Платеж не может быть отрицательным";
  }

  if (minimalPayment !== null && (!Number.isFinite(minimalPayment) || minimalPayment < 0)) {
    errors.minimalPayment = "Платеж не может быть отрицательным";
  }

  if (
    payload.creditLimit !== null &&
    (!Number.isFinite(payload.creditLimit) || payload.creditLimit <= 0)
  ) {
    errors.creditLimit = "Лимит должен быть больше нуля";
  }

  if (
    payload.creditLimit &&
    Number.isFinite(payload.remainingAmount) &&
    payload.remainingAmount > payload.creditLimit
  ) {
    errors.remainingAmount = "Долг не может быть больше кредитного лимита";
  }

  if (
    payload.interestRate !== null &&
    (!Number.isFinite(payload.interestRate) ||
      payload.interestRate < 0 ||
      payload.interestRate > 100)
  ) {
    errors.interestRate = "Процент должен быть от 0 до 100";
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
  const [paymentForms, setPaymentForms] = useState<Record<string, PaymentForm>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");

  const closedDebt = useMemo(
    () =>
      loans
        .filter((loan) => loan.status === "CLOSED")
        .reduce((sum, loan) => sum + (loan.initialAmount ?? 0), 0),
    [loans]
  );

  const nearestPayment = useMemo(() => {
    const activeLoans = loans
      .filter((loan) => loan.status === "ACTIVE" && loan.paymentDate && getScheduledPayment(loan) > 0)
      .sort(
        (a, b) =>
          new Date(a.paymentDate ?? 0).getTime() - new Date(b.paymentDate ?? 0).getTime()
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
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
  }

  function editLoan(loan: Loan) {
    const plannedPayment = loan.plannedPayment ?? loan.monthlyPayment;

    setEditingId(loan.id);
    setForm({
      debtType: loan.debtType,
      title: loan.title,
      lender: loan.lender ?? "",
      initialAmount: loan.initialAmount ? String(loan.initialAmount) : "",
      remainingAmount: String(loan.remainingAmount),
      monthlyPayment: loan.monthlyPayment ? String(loan.monthlyPayment) : "",
      plannedPayment: plannedPayment ? String(plannedPayment) : "",
      minimalPayment: loan.minimalPayment ? String(loan.minimalPayment) : "",
      creditLimit: loan.creditLimit ? String(loan.creditLimit) : "",
      interestRate: loan.interestRate !== null ? String(loan.interestRate) : "",
      paymentDate: loan.paymentDate ? toDateInputValue(loan.paymentDate) : "",
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

  function updatePaymentForm(loanId: string, patch: Partial<PaymentForm>) {
    setPaymentForms((current) => ({
      ...current,
      [loanId]: {
        ...(current[loanId] ?? createInitialPaymentForm()),
        ...patch
      }
    }));
  }

  async function addPayment(loan: Loan) {
    const paymentForm = paymentForms[loan.id] ?? createInitialPaymentForm();
    const amount = parseAmount(paymentForm.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Введите сумму платежа больше нуля");
      setMessageTone("error");
      return;
    }

    setPayingId(loan.id);
    setMessage("");

    try {
      const response = await fetch(`/api/loans/${loan.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          date: paymentForm.date || toDateInputValue(),
          description: paymentForm.description
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPaymentForms((current) => ({
        ...current,
        [loan.id]: createInitialPaymentForm()
      }));
      await loadLoans(false);
      setMessage("Платеж добавлен и учтен как расход");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить платеж");
      setMessageTone("error");
    } finally {
      setPayingId(null);
    }
  }

  async function deletePayment(loan: Loan, payment: LoanPayment) {
    const confirmed = window.confirm("Удалить этот платеж и связанную расходную операцию?");

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const response = await fetch(`/api/loans/${loan.id}/payments/${payment.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      await loadLoans(false);
      setMessage("Платеж удален");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить платеж");
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
              {formatCurrency(getScheduledPayment(nearestPayment))}
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

            <div>
              <label className="field-label" htmlFor="debtType">
                Тип долга
              </label>
              <select
                id="debtType"
                className="field mt-1"
                value={form.debtType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    debtType: event.target.value as DebtType,
                    plannedPayment:
                      event.target.value === "CREDIT_CARD" ? "" : current.plannedPayment,
                    minimalPayment:
                      event.target.value === "CREDIT_CARD" ? current.minimalPayment : ""
                  }))
                }
              >
                <option value="BANK_LOAN">Банковский кредит</option>
                <option value="CREDIT_CARD">Кредитная карта</option>
                <option value="PERSONAL_DEBT">Личный долг / гибкий долг</option>
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {form.debtType === "CREDIT_CARD" ? (
                <div>
                  <label className="field-label" htmlFor="creditLimit">
                    Кредитный лимит
                  </label>
                  <input
                    id="creditLimit"
                    className="field mt-1"
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={form.creditLimit}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        creditLimit: event.target.value
                      }))
                    }
                    placeholder="Можно оставить пустым"
                  />
                  <FieldError message={errors.creditLimit} />
                </div>
              ) : (
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
              )}

              <div>
                <label className="field-label" htmlFor="remainingAmount">
                  {form.debtType === "CREDIT_CARD" ? "Текущий долг" : "Остаток"}
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
                  Плановый / минимальный платеж
                </label>
                <input
                  id="monthlyPayment"
                  className="field mt-1"
                  min="0"
                  step="0.01"
                  type="number"
                  value={
                    form.debtType === "CREDIT_CARD"
                      ? form.minimalPayment
                      : form.plannedPayment
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      monthlyPayment: event.target.value,
                      plannedPayment:
                        current.debtType === "CREDIT_CARD" ? "" : event.target.value,
                      minimalPayment:
                        current.debtType === "CREDIT_CARD" ? event.target.value : ""
                    }))
                  }
                  placeholder="Можно оставить пустым"
                />
                <p className="mt-1 text-xs text-muted">
                  Можно оставить пустым, если платеж нерегулярный
                </p>
                <FieldError
                  message={
                    form.debtType === "CREDIT_CARD"
                      ? errors.minimalPayment
                      : errors.plannedPayment
                  }
                />
              </div>

              {form.debtType !== "PERSONAL_DEBT" ? (
                <div>
                <label className="field-label" htmlFor="interestRate">
                  Процент
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
              ) : null}
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
                const progress = getProgress(loan);
                const scheduledPayment = getScheduledPayment(loan);
                const paymentForm = paymentForms[loan.id] ?? createInitialPaymentForm();
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
                          <span className="rounded-full bg-soft px-2 py-0.5 text-xs text-muted">
                            {debtTypeLabels[loan.debtType]}
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
                            <div className="text-xs text-muted">
                              {loan.debtType === "CREDIT_CARD" ? "Кредитный лимит" : "Общая сумма долга"}
                            </div>
                            <div className="font-medium text-ink">
                              {loan.debtType === "CREDIT_CARD"
                                ? loan.creditLimit
                                  ? formatCurrency(loan.creditLimit)
                                  : "Не указан"
                                : loan.initialAmount
                                  ? formatCurrency(loan.initialAmount)
                                  : "Не указана"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">
                              {loan.debtType === "CREDIT_CARD" ? "Текущий долг" : "Остаток"}
                            </div>
                            <div className="font-medium text-loss">
                              {formatCurrency(loan.remainingAmount)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">
                              Плановый / минимальный платеж
                            </div>
                            <div className="font-medium text-ink">
                              {scheduledPayment > 0 ? formatCurrency(scheduledPayment) : "Не указан"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted">Процент</div>
                            <div className="font-medium text-ink">
                              {loan.interestRate !== null
                                ? `${formatPercent(loan.interestRate)}%`
                                : "Не указан"}
                            </div>
                          </div>
                        </div>

                        {progress ? (
                          <div className="mt-4">
                            <div className="mb-2 flex justify-between text-xs text-muted">
                              <span>{progress.label}</span>
                              <span>{formatPercent(progress.percent)}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-soft">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

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

                    {loan.status !== "CLOSED" ? (
                      <div className="mt-5 border-t border-line pt-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Внести сумму
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[1fr_150px_1.3fr_auto]">
                          <input
                            className="field"
                            min="0.01"
                            step="0.01"
                            type="number"
                            value={paymentForm.amount}
                            onChange={(event) =>
                              updatePaymentForm(loan.id, { amount: event.target.value })
                            }
                            placeholder="Сумма"
                            aria-label="Сумма платежа"
                          />
                          <input
                            className="field"
                            type="date"
                            value={paymentForm.date}
                            onChange={(event) =>
                              updatePaymentForm(loan.id, { date: event.target.value })
                            }
                            aria-label="Дата платежа"
                          />
                          <input
                            className="field"
                            value={paymentForm.description}
                            onChange={(event) =>
                              updatePaymentForm(loan.id, {
                                description: event.target.value
                              })
                            }
                            placeholder="Описание платежа"
                            aria-label="Описание платежа"
                          />
                          <button
                            type="button"
                            className="btn-secondary justify-center"
                            disabled={payingId === loan.id}
                            onClick={() => addPayment(loan)}
                          >
                            {payingId === loan.id ? "Сохранение" : "Внести сумму"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {loan.payments && loan.payments.length > 0 ? (
                      <div className="mt-5 border-t border-line pt-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                          <History className="h-4 w-4" aria-hidden="true" />
                          История платежей
                        </div>
                        <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
                          {loan.payments.map((payment) => (
                            <div
                              key={payment.id}
                              className="flex flex-col gap-2 px-3 py-2 text-sm hover:bg-hover sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <div className="font-medium text-ink">
                                  {formatCurrency(payment.amount)}
                                </div>
                                <div className="text-xs text-muted">
                                  {formatDate(payment.date)}
                                  {payment.description ? ` · ${payment.description}` : ""}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn-danger self-start px-2 sm:self-auto"
                                onClick={() => deletePayment(loan, payment)}
                                aria-label="Удалить платеж"
                                title="Удалить платеж"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
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
