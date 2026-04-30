"use client";

import {
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  Scale,
  WalletCards
} from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { buildQuery, readErrorMessage } from "@/lib/client-api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import { parseSettings, storageKey } from "@/lib/settings";
import type { TruthResponse } from "@/types/finance";

export function TruthClient() {
  const [data, setData] = useState<TruthResponse | null>(null);
  const [period, setPeriod] = useState(() => createPeriodState("month"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTruth() {
      setLoading(true);
      setError("");

      try {
        const settings = parseSettings(window.localStorage.getItem(storageKey));
        const threshold = Number(settings.leakageThreshold) || 1000;
        const query = buildQuery({
          leakageThreshold: String(threshold),
          ...buildPeriodQuery(period)
        });
        const response = await fetch(`/api/truth${query}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        setData(await response.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      } finally {
        setLoading(false);
      }
    }

    loadTruth();
  }, [period]);

  return (
    <div>
      <PageHeader
        title="Правда"
        description={`Контроль денег, долгов и утечек за период: ${describePeriod(period)}.`}
      />

      <PeriodFilter value={period} onChange={setPeriod} />

      <Notice message={error} tone="error" />

      {loading ? (
        <>
          <p className="mb-3 text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="card h-28 animate-pulse bg-soft/50" />
            ))}
          </div>
        </>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Текущий баланс"
              value={formatCurrency(data.balance)}
              icon={WalletCards}
              tone={data.balance >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Доход за период"
              value={formatCurrency(data.monthlyIncome)}
              icon={CircleDollarSign}
              tone="income"
            />
            <StatCard
              label="Расходы за период"
              value={formatCurrency(data.monthlyExpense)}
              icon={CalendarDays}
              tone="expense"
            />
            <StatCard
              label="Общий долг"
              value={formatCurrency(data.totalDebt)}
              icon={Landmark}
              tone="expense"
            />
            <StatCard
              label="Чистая позиция"
              value={formatCurrency(data.netPosition)}
              icon={Scale}
              tone={data.netPosition >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="До выхода в ноль"
              value={formatCurrency(data.toZero)}
              icon={Scale}
              tone="neutral"
            />
            <StatCard
              label="До выхода в плюс"
              value={formatCurrency(data.toPositive)}
              icon={Scale}
              tone="neutral"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Контроль дня</h2>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-muted">Операции сегодня</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.hasTransactionsToday ? "Да" : "Нет"}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Расходы сегодня</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.dailyControl.todaySpending)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Расходы периода</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.dailyControl.monthSpending)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Дней подряд</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.transactionStreakDays}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-muted">Последняя операция</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.lastTransactionDate
                      ? formatDate(data.dailyControl.lastTransactionDate)
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
                    {formatCurrency(data.survival.availableBalance)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Дней осталось</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.survival.daysLeftInMonth}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Лимит в день</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.survival.safeDailyLimit)}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="card p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Утечки денег</h2>
                <p className="mt-1 text-sm text-muted">
                  Расходы меньше {formatCurrency(data.leakage.threshold)} за текущий месяц
                </p>
              </div>
              <div className="rounded-md border border-line px-3 py-2 text-sm text-ink">
                {formatCurrency(data.leakage.totalSmallExpenses)} ·{" "}
                {formatPercent(data.leakage.percentOfMonthlyIncome)}% дохода
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <h3 className="text-sm font-medium text-ink">Категории</h3>
                <div className="mt-3 space-y-2">
                  {data.leakage.topCategories.length === 0 ? (
                    <EmptyState text="Мелких расходов нет" />
                  ) : (
                    data.leakage.topCategories.map((category) => (
                      <div
                        key={category.categoryId}
                        className="rounded-md border border-line p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-ink">{category.name}</span>
                          <span className="text-muted">{category.count}</span>
                        </div>
                        <div className="mt-1 text-muted">{formatCurrency(category.amount)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                <h3 className="text-sm font-medium text-ink">Повторяющиеся мелкие расходы</h3>
                <div className="mt-3 space-y-2">
                  {data.leakage.repeatedExpenses.length === 0 ? (
                    <EmptyState text="Повторов нет" />
                  ) : (
                    data.leakage.repeatedExpenses.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-md border border-line p-3 text-sm"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">
                              {item.description}
                            </div>
                            <div className="text-muted">{item.categoryName}</div>
                          </div>
                          <div className="text-ink">
                            {formatCurrency(item.total)} · {item.count} раз
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-ink">Долги</h2>
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-muted">Остаток долга</div>
                <div className="mt-1 font-medium text-ink">
                  {formatCurrency(data.debtSummary.totalDebt)}
                </div>
              </div>
              <div>
                <div className="text-muted">Платежи в месяц</div>
                <div className="mt-1 font-medium text-ink">
                  {formatCurrency(data.debtSummary.paymentsThisMonth)}
                </div>
              </div>
              <div>
                <div className="text-muted">Погашено</div>
                <div className="mt-1 font-medium text-ink">
                  {formatPercent(data.debtSummary.paidPercent ?? 0)}%
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
