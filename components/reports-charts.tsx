"use client";

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
import { formatCurrency, formatPercent } from "@/lib/format";
import type { CategoryBreakdownItem } from "@/types/finance";

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

export function CategoryBreakdownCard({
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

export function MonthlyDynamicsChart({
  data
}: {
  data: Array<{ month: string; label: string; income: number; expense: number }>;
}) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 12 }}>
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
  );
}

export function IncomeExpenseChart({
  data
}: {
  data: Array<{ month: string; label: string; income: number; expense: number }>;
}) {
  return (
    <div className="h-96 overflow-x-auto">
      <div className="h-full min-w-[760px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 12 }}>
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
  );
}

