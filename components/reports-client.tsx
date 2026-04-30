"use client";

import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { buildQuery, readErrorMessage } from "@/lib/client-api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import { parseSettings, storageKey } from "@/lib/settings";
import type { CategoryBreakdownItem, ReportsResponse } from "@/types/finance";

const chartColors = ["#e68a8a", "#8bc99a", "#d6b66d", "#9ca3af", "#b8a5e8", "#8fbfc2"];
const chartGrid = "#2a2a2a";
const chartTick = "#9ca3af";
const chartIncome = "#8bc99a";
const chartExpense = "#e68a8a";
const tooltipStyle = {
  backgroundColor: "#202020",
  border: "1px solid #2a2a2a",
  borderRadius: "6px",
  color: "#e5e5e5"
};
const tooltipLabelStyle = {
  color: "#e5e5e5"
};

function shortCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    return `${formatPercent(value / 1_000_000)} млн`;
  }

  if (Math.abs(value) >= 1_000) {
    return `${formatPercent(value / 1_000)} тыс.`;
  }

  return formatPercent(value);
}

function CategoryBreakdownCard({
  items,
  title,
  emptyText
}: {
  items: CategoryBreakdownItem[];
  title: string;
  emptyText: string;
}) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">Выбранный период</p>
      </div>

      {items.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={items}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {items.map((entry, index) => (
                    <Cell
                      key={entry.categoryId}
                      fill={chartColors[index % chartColors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value) => formatCurrency(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={item.categoryId} className="rounded-md border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: chartColors[index % chartColors.length] }}
                    />
                    <span className="truncate text-sm font-medium text-ink">
                      {item.name}
                    </span>
                  </div>
                  <span className="text-sm text-muted">{formatPercent(item.percent)}%</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-ink">
                  {formatCurrency(item.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function ReportsClient() {
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [period, setPeriod] = useState(() => createPeriodState("month"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReports() {
      setLoading(true);
      setError("");

      try {
        const settings = parseSettings(window.localStorage.getItem(storageKey));
        const threshold = Number(settings.leakageThreshold) || 1000;
        const query = buildQuery({
          leakageThreshold: String(threshold),
          ...buildPeriodQuery(period)
        });
        const response = await fetch(`/api/reports${query}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        setReports(await response.json());
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

      <Notice message={error} tone="error" />

      {loading ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card h-28 animate-pulse bg-soft/50" />
            <div className="card h-28 animate-pulse bg-soft/50" />
            <div className="card h-28 animate-pulse bg-soft/50" />
          </div>
          <div className="card h-96 animate-pulse bg-soft/50" />
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
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={reports.byMonth} margin={{ left: 0, right: 12 }}>
                      <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: chartTick }}
                        tickFormatter={(value) => String(value).slice(0, 3)}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: chartTick }}
                        tickFormatter={(value) => shortCurrency(Number(value))}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        formatter={(value) => formatCurrency(Number(value))}
                      />
                      <Legend wrapperStyle={{ color: chartTick }} />
                      <Area
                        type="monotone"
                        dataKey="income"
                        name="Доходы"
                        stroke={chartIncome}
                        fill={chartIncome}
                        fillOpacity={0.14}
                      />
                      <Area
                        type="monotone"
                        dataKey="expense"
                        name="Расходы"
                        stroke={chartExpense}
                        fill={chartExpense}
                        fillOpacity={0.12}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
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
              <div className="h-96 overflow-x-auto">
                <div className="h-full min-w-[760px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reports.byMonth} margin={{ left: 0, right: 12 }}>
                      <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: chartTick }}
                        tickFormatter={(value) => String(value).slice(0, 3)}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: chartTick }}
                        tickFormatter={(value) => shortCurrency(Number(value))}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        formatter={(value) => formatCurrency(Number(value))}
                      />
                      <Legend wrapperStyle={{ color: chartTick }} />
                      <Bar
                        dataKey="income"
                        name="Доходы"
                        fill={chartIncome}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="expense"
                        name="Расходы"
                        fill={chartExpense}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
