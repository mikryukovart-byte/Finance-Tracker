"use client";

import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { buildQuery, fetchJsonCached, readClientCache } from "@/lib/client-api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import { parseSettings, storageKey } from "@/lib/settings";
import type { ReportsResponse } from "@/types/finance";

const CategoryBreakdownCard = dynamic(
  () => import("@/components/reports-charts").then((module) => module.CategoryBreakdownCard),
  {
    ssr: false,
    loading: () => <ChartLoading />
  }
);
const MonthlyDynamicsChart = dynamic(
  () => import("@/components/reports-charts").then((module) => module.MonthlyDynamicsChart),
  {
    ssr: false,
    loading: () => <ChartLoading />
  }
);
const IncomeExpenseChart = dynamic(
  () => import("@/components/reports-charts").then((module) => module.IncomeExpenseChart),
  {
    ssr: false,
    loading: () => <ChartLoading />
  }
);
const initialReportsPeriod = createPeriodState("month");

function reportsQuery(period: typeof initialReportsPeriod, threshold = 1000) {
  return buildQuery({
    leakageThreshold: String(threshold),
    ...buildPeriodQuery(period)
  });
}

function reportsCacheKey(period: typeof initialReportsPeriod, threshold = 1000) {
  return `reports:${reportsQuery(period, threshold)}`;
}

function readLeakageThreshold() {
  if (typeof window === "undefined") {
    return 1000;
  }

  const settings = parseSettings(window.localStorage.getItem(storageKey));
  return Number(settings.leakageThreshold) || 1000;
}

function ChartLoading() {
  return (
    <div className="card p-4 sm:p-5">
      <div className="space-y-3">
        <div className="h-3 w-2/3 animate-pulse rounded-md bg-soft/50" />
        <div className="h-3 w-5/6 animate-pulse rounded-md bg-soft/40" />
        <div className="h-3 w-3/4 animate-pulse rounded-md bg-soft/40" />
      </div>
    </div>
  );
}

export function ReportsClient() {
  const [reports, setReports] = useState<ReportsResponse | null>(() =>
    readClientCache<ReportsResponse>(reportsCacheKey(initialReportsPeriod))
  );
  const [period, setPeriod] = useState(() => initialReportsPeriod);
  const [loading, setLoading] = useState(() => !reports);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReports() {
      setError("");
      const threshold = readLeakageThreshold();
      const key = reportsCacheKey(period, threshold);
      const cached = readClientCache<ReportsResponse>(key);

      if (cached) {
        setReports(cached);
      }

      setLoading(!cached);

      try {
        setReports(
          await fetchJsonCached<ReportsResponse>(
            key,
            `/api/reports${reportsQuery(period, threshold)}`,
            { ttlMs: 12_000 }
          )
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      } finally {
        setLoading(false);
      }
    }

    loadReports();
  }, [period]);

  const hasMonthlyData = useMemo(() => {
    if (!reports) {
      return false;
    }

    return reports.byMonth.some((item) => item.income > 0 || item.expense > 0);
  }, [reports]);

  return (
    <div>
      <PageHeader
        title="Отчеты"
        description={`Структура расходов и доходов за период: ${describePeriod(period)}.`}
      />

      <PeriodFilter value={period} onChange={setPeriod} />

      <Link
        href="/strategy"
        className="mb-4 mt-2 flex items-center justify-between rounded-md border border-line bg-paper px-4 py-3 text-sm text-ink transition hover:bg-soft"
      >
        <span>
          <span className="font-medium">Годовые цели</span>
          <span className="ml-2 text-muted">План роста дохода по месяцам</span>
        </span>
        <span className="text-muted">→</span>
      </Link>

      <Notice message={error} tone="error" />

      {loading && reports ? <p className="mb-3 text-sm text-muted">Обновляем данные…</p> : null}

      {loading && !reports ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Доходы за период" value="" icon={ArrowUpCircle} loading />
            <StatCard label="Расходы за период" value="" icon={ArrowDownCircle} loading />
            <StatCard label="Разница за период" value="" icon={Scale} loading />
          </div>
          <div className="card p-4 sm:p-5">
            <div className="space-y-3">
              <div className="h-3 w-3/4 animate-pulse rounded-md bg-soft/50" />
              <div className="h-3 w-2/3 animate-pulse rounded-md bg-soft/40" />
              <div className="h-3 w-5/6 animate-pulse rounded-md bg-soft/40" />
            </div>
          </div>
        </div>
      ) : reports ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Доходы за период"
              value={formatCurrency(reports.comparison.totalIncome)}
              icon={ArrowUpCircle}
              tone="income"
            />
            <StatCard
              label="Расходы за период"
              value={formatCurrency(reports.comparison.totalExpense)}
              icon={ArrowDownCircle}
              tone="expense"
            />
            <StatCard
              label="Разница за период"
              value={formatCurrency(reports.comparison.balance)}
              icon={Scale}
              tone={reports.comparison.balance >= 0 ? "income" : "expense"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Выбранный период</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Доходы</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.currentMonth.income)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Расходы</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.currentMonth.expense)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Разница</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.currentMonth.balance)}
                  </span>
                </div>
              </div>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">К предыдущему периоду</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Доходы</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.monthChange.income)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Расходы</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.monthChange.expense)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Разница</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.monthChange.balance)}
                  </span>
                </div>
              </div>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Долг</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Остаток</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.debtProgress.totalDebt)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Платежи в месяц</span>
                  <span className="font-medium text-ink">
                    {formatCurrency(reports.debtProgress.paymentsThisMonth)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Погашено</span>
                  <span className="font-medium text-ink">
                    {formatPercent(reports.debtProgress.paidPercent ?? 0)}%
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Где утекли деньги</h2>
              <p className="mt-1 text-sm text-muted">
                Мелкие расходы меньше {formatCurrency(reports.leakage.threshold)}
              </p>
              <div className="mt-4 text-2xl font-semibold text-ink">
                {formatCurrency(reports.leakage.totalSmallExpenses)}
              </div>
              <div className="mt-1 text-sm text-muted">
                {formatPercent(reports.leakage.percentOfMonthlyIncome)}% дохода месяца
              </div>
              <div className="mt-4 space-y-2">
                {reports.leakage.topCategories.length === 0 ? (
                  <EmptyState text="Мелких расходов нет" />
                ) : (
                  reports.leakage.topCategories.map((category) => (
                    <div
                      key={category.categoryId}
                      className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-ink">{category.name}</span>
                      <span className="text-muted">
                        {formatCurrency(category.amount)} · {category.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Топ-5 расходов</h2>
              <div className="mt-4 space-y-2">
                {reports.topExpenseCategories.length === 0 ? (
                  <EmptyState text="Расходов пока нет" />
                ) : (
                  reports.topExpenseCategories.map((category) => (
                    <div
                      key={category.categoryId}
                      className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-ink">{category.name}</span>
                      <span className="text-muted">
                        {formatCurrency(category.amount)} · {formatPercent(category.percent)}%
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-6">
              <CategoryBreakdownCard
                title="Расходы по категориям"
                items={reports.byExpenseCategory}
                emptyText="Расходов пока нет"
              />
              <CategoryBreakdownCard
                title="Доходы по категориям"
                items={reports.byIncomeCategory}
                emptyText="Доходов пока нет"
              />
            </div>

            <section className="card p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-ink">Динамика по месяцам</h2>
                <p className="mt-1 text-sm text-muted">Последние 12 месяцев</p>
              </div>

              {!hasMonthlyData ? (
                <EmptyState text="Недостаточно данных для графика" />
              ) : (
                <MonthlyDynamicsChart data={reports.byMonth} />
              )}
            </section>
          </div>

          <section className="card p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink">Доходы vs расходы</h2>
              <p className="mt-1 text-sm text-muted">Сравнение по каждому месяцу</p>
            </div>

            {!hasMonthlyData ? (
              <EmptyState text="Добавьте операции, чтобы увидеть сравнение" />
            ) : (
              <IncomeExpenseChart data={reports.byMonth} />
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
