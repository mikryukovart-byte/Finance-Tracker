"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Landmark,
  PiggyBank,
  Plus,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { QuickTransactionInput } from "@/components/quick-transaction-input";
import { StatCard } from "@/components/stat-card";
import {
  buildQuery,
  fetchCategories,
  fetchJsonCached,
  invalidateCategoriesCache,
  invalidateFinancialDataCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatCurrency, formatDate, toDateInputValue, typeLabels } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import { parseSettings, storageKey } from "@/lib/settings";
import type { Account, Category, CategoryKind, DashboardStats, Transaction } from "@/types/finance";

type QuickAddForm = {
  accountId: string;
  amount: string;
  categoryId: string;
  type: CategoryKind;
};

type QuickAddStatus = {
  message: string;
  tone: "success" | "error";
};

const initialQuickAdd: QuickAddForm = {
  accountId: "",
  amount: "",
  categoryId: "",
  type: "EXPENSE"
};

const initialDashboardPeriod = createPeriodState("month");

function dashboardCacheKey(periodState: typeof initialDashboardPeriod) {
  return `dashboard:${buildQuery(buildPeriodQuery(periodState))}`;
}

function parseAmount(value: string) {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
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

export function DashboardClient() {
  const [stats, setStats] = useState<DashboardStats | null>(() =>
    readClientCache<DashboardStats>(dashboardCacheKey(initialDashboardPeriod))
  );
  const [accounts, setAccounts] = useState<Account[]>(
    () =>
      readClientCache<DashboardStats>(dashboardCacheKey(initialDashboardPeriod))?.accounts ?? []
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [period, setPeriod] = useState(() => initialDashboardPeriod);
  const [quickAdd, setQuickAdd] = useState<QuickAddForm>(initialQuickAdd);
  const [quickStatus, setQuickStatus] = useState<QuickAddStatus | null>(null);
  const [successPulse, setSuccessPulse] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState(0);
  const [loading, setLoading] = useState(() => !stats);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const quickAddRef = useRef<HTMLElement | null>(null);
  const quickAddFormRef = useRef<HTMLFormElement | null>(null);

  const loadStats = useCallback(async (showLoader = true, force = false) => {
    try {
      if (showLoader) {
        setLoading(true);
      }
      const query = buildQuery(buildPeriodQuery(period));
      const data = await fetchJsonCached<DashboardStats>(
        dashboardCacheKey(period),
        `/api/dashboard${query}`,
        { force, ttlMs: 12_000 }
      );
      setStats(data);
      setAccounts(data.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить главную");
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [period]);

  const loadCategories = useCallback(async () => {
    try {
      const categoryData = await fetchCategories();
      setCategories(categoryData);
    } catch (err) {
      setQuickStatus({
        message: err instanceof Error ? err.message : "Не удалось загрузить категории",
        tone: "error"
      });
    }
  }, []);

  useEffect(() => {
    if (accounts.length === 0) {
      setQuickAdd((current) => ({ ...current, accountId: "" }));
      return;
    }

    if (!accounts.some((account) => account.id === quickAdd.accountId)) {
      setQuickAdd((current) => ({ ...current, accountId: accounts[0].id }));
    }
  }, [accounts, quickAdd.accountId]);

  useEffect(() => {
    loadStats();
    loadCategories();
  }, [loadCategories, loadStats]);

  useEffect(() => {
    async function refreshFinancialData() {
      await Promise.all([loadStats(false, true), loadCategories()]);
    }

    window.addEventListener("finance-data-changed", refreshFinancialData);
    window.addEventListener("finance-data-reset", refreshFinancialData);

    return () => {
      window.removeEventListener("finance-data-changed", refreshFinancialData);
      window.removeEventListener("finance-data-reset", refreshFinancialData);
    };
  }, [loadCategories, loadStats]);

  useEffect(() => {
    amountInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function loadSettings() {
      const settings = parseSettings(window.localStorage.getItem(storageKey));
      const parsedLimit = Number(settings.monthlyLimit);
      setMonthlyLimit(Number.isFinite(parsedLimit) ? parsedLimit : 0);
    }

    loadSettings();
    window.addEventListener("finance-settings-changed", loadSettings);
    window.addEventListener("storage", loadSettings);

    return () => {
      window.removeEventListener("finance-settings-changed", loadSettings);
      window.removeEventListener("storage", loadSettings);
    };
  }, []);

  const quickCategories = useMemo(
    () =>
      categories
        .filter((category) => category.type === quickAdd.type)
        .sort((a, b) => {
          const usageDiff =
            (b._count?.transactions ?? 0) - (a._count?.transactions ?? 0);

          if (usageDiff !== 0) {
            return usageDiff;
          }

          return a.name.localeCompare(b.name, "ru");
        }),
    [categories, quickAdd.type]
  );

  useEffect(() => {
    if (quickCategories.length === 0) {
      setQuickAdd((current) => ({ ...current, categoryId: "" }));
      return;
    }

    if (!quickCategories.some((category) => category.id === quickAdd.categoryId)) {
      setQuickAdd((current) => ({ ...current, categoryId: quickCategories[0].id }));
    }
  }, [quickAdd.categoryId, quickCategories]);

  async function submitQuickAdd(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setQuickStatus(null);

    const amount = parseAmount(quickAdd.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setQuickStatus({ message: "Введите сумму больше нуля", tone: "error" });
      amountInputRef.current?.focus();
      return;
    }

    if (!quickAdd.categoryId) {
      setQuickStatus({ message: "Выберите категорию", tone: "error" });
      return;
    }

    setAdding(true);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          accountId: quickAdd.accountId,
          categoryId: quickAdd.categoryId,
          date: toDateInputValue(),
          description: "",
          type: quickAdd.type
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setQuickAdd((current) => ({ ...current, amount: "" }));
      setQuickStatus({ message: "Операция добавлена", tone: "success" });
      setSuccessPulse(true);
      window.setTimeout(() => setSuccessPulse(false), 900);
      invalidateCategoriesCache();
      invalidateFinancialDataCache();
      await loadStats(false, true);
      await loadCategories();
      window.requestAnimationFrame(() => amountInputRef.current?.focus());
    } catch (err) {
      setQuickStatus({
        message: err instanceof Error ? err.message : "Не удалось добавить операцию",
        tone: "error"
      });
    } finally {
      setAdding(false);
    }
  }

  function focusQuickAdd() {
    quickAddRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (quickAdd.amount.trim() && quickAdd.categoryId) {
      quickAddFormRef.current?.requestSubmit();
      return;
    }

    window.setTimeout(() => amountInputRef.current?.focus(), 200);
  }

  const monthLimitPercent =
    stats && monthlyLimit > 0 ? (stats.totalExpense / monthlyLimit) * 100 : 0;
  const isOverspending = Boolean(stats && monthlyLimit > 0 && stats.totalExpense > monthlyLimit);
  const periodDays = Math.max(
    1,
    Math.ceil(
      (new Date(`${period.endDate}T12:00:00`).getTime() -
        new Date(`${period.startDate}T12:00:00`).getTime()) /
        86_400_000
    ) + 1
  );

  return (
    <div className="pb-24 md:pb-0">
      <PageHeader
        title="Главная"
        description={`Быстрый ввод и обзор денег за период: ${describePeriod(period)}.`}
      />

      <PeriodFilter value={period} onChange={setPeriod} />

      <div className="mb-6">
        <QuickTransactionInput
          title="Строка быстрого ввода"
          accounts={accounts}
          categories={categories}
          onAdded={async () => {
            invalidateCategoriesCache();
            await loadStats(false, true);
            await loadCategories();
          }}
        />
      </div>

      <section
        ref={quickAddRef}
        className={`mb-6 card p-4 transition sm:p-5 ${
          successPulse ? "ring-2 ring-profit/30" : ""
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Быстро добавить</h2>
            <p className="mt-1 text-sm text-muted">Сумма, категория, Enter. Дата: сегодня.</p>
          </div>
          {quickStatus?.tone === "success" ? (
            <div className="rounded-full bg-profit/10 p-2 text-profit">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        <form ref={quickAddFormRef} className="space-y-4" onSubmit={submitQuickAdd}>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <label className="field-label" htmlFor="quickAmount">
                Сумма
              </label>
              <input
                ref={amountInputRef}
                id="quickAmount"
                className="field mt-1 text-xl font-semibold sm:text-lg"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                type="number"
                value={quickAdd.amount}
                onChange={(event) =>
                  setQuickAdd((current) => ({ ...current, amount: event.target.value }))
                }
                placeholder="0"
                autoComplete="off"
              />
            </div>

            <div>
              <span className="field-label">Тип</span>
              <div className="mt-1 grid grid-cols-2 gap-2 md:w-52">
                {(["EXPENSE", "INCOME"] as CategoryKind[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition ${
                      quickAdd.type === type
                        ? "border-line bg-soft text-ink"
                        : "border-line bg-transparent text-muted hover:bg-soft hover:text-ink"
                    }`}
                    onClick={() =>
                      setQuickAdd((current) => ({
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
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="field-label">Категория</span>
              <Link href="/settings" className="text-sm font-medium text-accent hover:underline">
                Управлять
              </Link>
            </div>

            {quickCategories.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-soft px-3 py-3 text-sm text-muted">
                Создайте категорию, чтобы добавлять операции быстрее.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {quickCategories.slice(0, 10).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
                      quickAdd.categoryId === category.id
                        ? "border-line bg-soft text-ink"
                        : "border-line bg-transparent text-muted hover:bg-soft hover:text-ink"
                    }`}
                    onClick={() =>
                      setQuickAdd((current) => ({ ...current, categoryId: category.id }))
                    }
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="field-label" htmlFor="quickAccount">
                Счет
              </label>
              <Link href="/wallet" className="text-sm font-medium text-accent hover:underline">
                Управлять
              </Link>
            </div>
            <select
              id="quickAccount"
              className="field"
              value={quickAdd.accountId}
              onChange={(event) =>
                setQuickAdd((current) => ({ ...current, accountId: event.target.value }))
              }
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

          {quickStatus ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                quickStatus.tone === "success"
                  ? "border-profit/30 bg-profit/10 text-profit"
                  : "border-loss/30 bg-loss/10 text-loss"
              }`}
              aria-live="polite"
            >
              {quickStatus.message}
            </div>
          ) : null}

          <button
            type="submit"
            className="btn-primary w-full md:w-auto"
            disabled={adding || quickCategories.length === 0 || accounts.length === 0}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {adding ? "Добавляем" : "Добавить"}
          </button>
        </form>
      </section>

      {error ? (
        <div className="mb-6 card border-loss/30 bg-loss/10 p-4 text-sm text-loss">
          {error}
        </div>
      ) : null}

      {loading && stats ? (
        <p className="mb-3 text-sm text-muted">Обновляем данные…</p>
      ) : null}

      {loading && !stats ? (
        <>
          <p className="mb-3 text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Деньги на счетах" value="" icon={Landmark} loading />
            <StatCard label="Общий долг" value="" icon={WalletCards} loading />
            <StatCard label="Чистая позиция" value="" icon={PiggyBank} loading />
            <StatCard label="Баланс за период" value="" icon={PiggyBank} loading />
            <StatCard label="Расходы за период" value="" icon={WalletCards} loading />
            <StatCard label="Доходы за период" value="" icon={ArrowUpCircle} loading />
          </div>
        </>
      ) : stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Деньги на счетах"
              value={formatCurrency(stats.accountBalance)}
              icon={Landmark}
              tone={stats.accountBalance >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Общий долг"
              value={formatCurrency(stats.totalDebt)}
              icon={WalletCards}
              tone="expense"
            />
            <StatCard
              label="Чистая позиция"
              value={formatCurrency(stats.netPosition)}
              icon={PiggyBank}
              tone={stats.netPosition >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Баланс за период"
              value={formatCurrency(stats.balance)}
              icon={PiggyBank}
              tone={stats.balance >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Расходы за период"
              value={formatCurrency(stats.totalExpense)}
              icon={WalletCards}
              tone="expense"
            />
            <StatCard
              label="Доходы за период"
              value={formatCurrency(stats.totalIncome)}
              icon={ArrowUpCircle}
              tone="income"
            />
            <StatCard
              label="Расходы сегодня"
              value={formatCurrency(stats.expensesToday)}
              icon={ArrowDownCircle}
              tone="expense"
            />
            <StatCard
              label="Средний расход в день"
              value={formatCurrency(stats.totalExpense / periodDays)}
              icon={WalletCards}
              tone="expense"
            />
          </div>

          {stats.accounts.length > 0 ? (
            <section className="mt-6 card p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink">Счета</h2>
                <Link href="/wallet" className="text-sm font-medium text-accent hover:underline">
                  Управлять
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {stats.accounts.map((account) => {
                  const availableCredit = account.availableCredit ?? 0;
                  const overLimit = Math.max(0, account.currentDebt - (account.creditLimit ?? 0));

                  return (
                  <div key={account.id} className="rounded-md border border-line p-3">
                    <div className="text-sm text-muted">
                      {account.name}
                      {account.type === "CREDIT_CARD" ? " · кредитная карта" : ""}
                    </div>
                    {account.type === "CREDIT_CARD" ? (
                      <div className="mt-3">
                        <div
                          className="text-xs font-medium uppercase tracking-normal text-muted"
                        >
                          Доступно сейчас
                        </div>
                        <div className="mt-1 text-lg font-semibold text-ink">
                          {formatCurrency(availableCredit, account.currency)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-lg font-semibold text-ink">
                        {formatCurrency(account.balance, account.currency)}
                      </div>
                    )}
                    {account.type === "CREDIT_CARD" ? (
                      <div className="mt-2 space-y-1 text-xs text-muted">
                        <div>Долг: {formatCurrency(account.currentDebt, account.currency)}</div>
                        <div>
                          Лимит: {formatCurrency(account.creditLimit ?? 0, account.currency)}
                        </div>
                        {overLimit > 0 ? (
                          <div className="text-loss">
                            Превышение лимита: {formatCurrency(overLimit, account.currency)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {stats.dailyControl && stats.survival ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <section className="card p-4 sm:p-5">
                <h2 className="text-lg font-semibold text-ink">Контроль дня</h2>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-muted">Операции сегодня</div>
                    <div className="mt-1 font-medium text-ink">
                      {stats.dailyControl.hasTransactionsToday ? "Да" : "Нет"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Расходы сегодня</div>
                    <div className="mt-1 font-medium text-ink">
                      {formatCurrency(stats.dailyControl.todaySpending)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Расходы периода</div>
                    <div className="mt-1 font-medium text-ink">
                      {formatCurrency(stats.dailyControl.monthSpending)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Дней подряд</div>
                    <div className="mt-1 font-medium text-ink">
                      {stats.dailyControl.transactionStreakDays}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-muted">Последняя операция</div>
                    <div className="mt-1 font-medium text-ink">
                      {stats.dailyControl.lastTransactionDate
                        ? formatDate(stats.dailyControl.lastTransactionDate)
                        : "Нет операций"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="card p-4 sm:p-5">
                <h2 className="text-lg font-semibold text-ink">Расчет до конца месяца</h2>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-muted">Доступно сейчас</div>
                    <div className="mt-1 font-medium text-ink">
                      {formatCurrency(stats.survival.availableBalance)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Дней осталось</div>
                    <div className="mt-1 font-medium text-ink">
                      {stats.survival.daysLeftInMonth}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Лимит в день</div>
                    <div className="mt-1 font-medium text-ink">
                      {formatCurrency(stats.survival.safeDailyLimit)}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          <section
            className={`mt-6 card p-4 sm:p-5 ${
              isOverspending ? "border-loss/40 bg-loss/10" : ""
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Быстрый обзор периода</h2>
                <p className="mt-1 text-sm text-muted">
                  Расходы: {formatCurrency(stats.totalExpense)}
                  {monthlyLimit > 0 ? ` из ${formatCurrency(monthlyLimit)}` : ""}
                </p>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  isOverspending ? "bg-loss/10 text-loss" : "bg-soft text-ink"
                }`}
              >
                {monthlyLimit > 0
                  ? `${Math.round(Math.min(100, monthLimitPercent))}%`
                  : "Лимит не задан"}
              </div>
            </div>

            {monthlyLimit > 0 ? (
              <>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-soft">
                  <div
                    className={`h-full rounded-full ${
                      isOverspending ? "bg-loss" : "bg-accent"
                    }`}
                    style={{ width: `${Math.min(100, monthLimitPercent)}%` }}
                  />
                </div>
                {isOverspending ? (
                  <p className="mt-3 text-sm font-medium text-loss">
                    Лимит месяца превышен. Сегодня лучше притормозить расходы.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Задайте лимит в настройках, чтобы видеть перерасход сразу.
              </p>
            )}
          </section>

          <section className="mt-6 card p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Последние операции</h2>
              <Link
                href="/operations"
                className="text-sm font-medium text-accent hover:underline"
              >
                Все операции
              </Link>
            </div>

            {stats.recentTransactions.length === 0 ? (
              <EmptyState text="Операций пока нет" />
            ) : (
              <div className="space-y-2">
                {stats.recentTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex flex-col gap-2 rounded-md border border-line px-3 py-3 transition hover:bg-soft/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">
                          {transactionCategoryName(transaction)}
                        </span>
                        <span className="rounded-full bg-soft px-2 py-0.5 text-xs text-muted">
                          {typeLabels[transaction.type]}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {formatDate(transaction.date)}
                        {transaction.description ? ` · ${transaction.description}` : ""}
                      </div>
                    </div>
                    <div
                      className={`text-base font-semibold ${
                        transactionAmountClass(transaction)
                      }`}
                    >
                      {transactionAmountPrefix(transaction)}
                      {formatCurrency(transaction.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.24)] backdrop-blur md:hidden">
        <button type="button" className="btn-primary w-full text-base" onClick={focusQuickAdd}>
          <Plus className="h-5 w-5" aria-hidden="true" />
          Добавить
        </button>
      </div>
    </div>
  );
}
