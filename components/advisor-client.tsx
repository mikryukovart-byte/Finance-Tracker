"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import {
  fetchJsonCached,
  readClientCache,
  readErrorMessage,
  setClientCache
} from "@/lib/client-api";
import { formatCurrency } from "@/lib/format";
import type { AdvisorReport, AdvisorResponse, AdvisorSummary } from "@/types/finance";

const advisorCacheKey = "advisor:overview";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPeriod(startDate: string, endDate: string) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  return `${formatter.format(new Date(startDate))} — ${formatter.format(new Date(endDate))}`;
}

function displayValue(value: number | null) {
  return value === null ? "—" : formatCurrency(value);
}

function ReportContent({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-ink" data-testid="advisor-report-content">
      {content.split("\n").map((rawLine, index) => {
        const line = rawLine.trim();

        if (!line) {
          return <div className="h-1" key={`space-${index}`} aria-hidden="true" />;
        }

        const heading = line.match(/^#{1,3}\s+(.+)$/)?.[1];

        if (heading) {
          return (
            <h3 className="pt-5 text-lg font-semibold text-ink first:pt-0" key={`heading-${index}`}>
              {heading}
            </h3>
          );
        }

        if (/^[-*]\s+/.test(line)) {
          return (
            <div className="flex gap-3 pl-1" key={`item-${index}`}>
              <span className="text-muted" aria-hidden="true">•</span>
              <p>{line.replace(/^[-*]\s+/, "")}</p>
            </div>
          );
        }

        return <p key={`paragraph-${index}`}>{line}</p>;
      })}
    </div>
  );
}

function SnapshotCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase text-muted">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold text-ink" title={value}>{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-muted">{note}</div> : null}
    </div>
  );
}

export function AdvisorClient() {
  const cached = readClientCache<AdvisorResponse>(advisorCacheKey);
  const [summary, setSummary] = useState<AdvisorSummary | null>(() => cached?.summary ?? null);
  const [report, setReport] = useState<AdvisorReport | null>(() => cached?.report ?? null);
  const [loading, setLoading] = useState(() => !cached);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");

  const snapshot = useMemo(() => {
    if (!summary) {
      return [];
    }

    const creditCardDebt = summary.creditCards.reduce(
      (sum, card) => sum + card.currentDebt,
      0
    );
    const currentTarget = summary.weeklyTakt?.monthlyTarget ??
      summary.annualGoals?.currentMonth.c2Plan ?? null;
    const currentGap = currentTarget === null
      ? null
      : Math.max(0, currentTarget - summary.totals.monthlyIncome);
    const actions = summary.weeklyExecution.actionCounts;

    return [
      {
        label: "Собственные деньги",
        value: formatCurrency(summary.totals.realMoney),
        note: "Без доступного лимита кредиток"
      },
      { label: "Общий долг", value: formatCurrency(summary.totals.totalDebt) },
      { label: "Долг по кредиткам", value: formatCurrency(creditCardDebt) },
      {
        label: "Обязательные платежи",
        value: formatCurrency(summary.totals.requiredPaymentsBeforeMonthEnd),
        note: "До конца месяца"
      },
      { label: "Доход за месяц", value: formatCurrency(summary.totals.monthlyIncome) },
      {
        label: "Цель месяца",
        value: displayValue(currentTarget),
        note: summary.weeklyTakt?.selectedScenario ?? "Активный план не определен"
      },
      { label: "Разрыв месяца", value: displayValue(currentGap) },
      {
        label: "Действия недели",
        value: String(summary.weeklyExecution.actionCount),
        note: `${actions.firstTouches} касаний · ${actions.calls} звонков · ${actions.proposals} КП`
      },
      {
        label: "Гипотезы",
        value: String(summary.weeklyExecution.hypothesisCount),
        note: `${actions.followUps} follow-up · ${actions.priceNamed} цен названо`
      }
    ];
  }, [summary]);

  async function loadOverview() {
    const current = readClientCache<AdvisorResponse>(advisorCacheKey);
    setLoading(!current);
    setMessage("");

    try {
      const data = await fetchJsonCached<AdvisorResponse>(advisorCacheKey, "/api/advisor", {
        ttlMs: 15_000
      });
      setSummary(data.summary);
      setReport(data.report ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить советника");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    setGenerating(true);
    setMessage("");

    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: AdvisorResponse = await response.json();
      setClientCache(advisorCacheKey, data, 15_000);
      setSummary(data.summary);
      setReport(data.report);
      setMessage(data.warning ?? "Стратегический разбор сохранен");
      setMessageTone(data.warning ? "neutral" : "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось собрать разбор");
      setMessageTone("error");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  return (
    <div>
      <PageHeader
        title="Советник"
        description="Еженедельный стратегический разбор денег, целей и фактических действий."
      />

      <Notice message={message} tone={messageTone} />

      {loading && !summary ? (
        <p className="mt-6 text-sm text-muted">Загрузка...</p>
      ) : summary ? (
        <>
          <section className="mt-6">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">Фактический снимок</h2>
                <p className="mt-1 text-sm text-muted">{summary.period.label}</p>
              </div>
              {loading ? <span className="text-xs text-muted">Обновляем данные…</span> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.map((item) => <SnapshotCard key={item.label} {...item} />)}
            </div>
          </section>

          <section className="mt-6 card p-5 sm:p-7" data-testid="advisor-report">
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-ink">Стратегический разбор</h2>
                <p className="mt-1 text-sm text-muted">
                  Один связный отчет по финансам, плану, действиям и рабочим записям.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary shrink-0"
                onClick={generateReport}
                disabled={generating}
                data-testid="advisor-generate"
              >
                <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} aria-hidden="true" />
                {generating ? "Собираем разбор" : report ? "Обновить разбор" : "Собрать разбор"}
              </button>
            </div>

            {report ? (
              <>
                <div className="flex flex-col gap-1 border-b border-line py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
                  <span>Период: {formatPeriod(report.periodStart, report.periodEnd)}</span>
                  <span>
                    Сформирован: {formatDateTime(report.createdAt)} · {report.source === "ai" ? report.model : "расчетный разбор"}
                  </span>
                </div>
                <article className="mx-auto mt-6 max-w-3xl">
                  <ReportContent content={report.content} />
                </article>
              </>
            ) : (
              <div className="py-8">
                <EmptyState text="Нажмите «Собрать разбор». Без явного запроса AI не вызывается." />
              </div>
            )}
          </section>
        </>
      ) : (
        <EmptyState text="Нет данных для стратегического разбора" />
      )}
    </div>
  );
}
