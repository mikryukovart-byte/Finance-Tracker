"use client";

import {
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  ShieldAlert,
  WalletCards
} from "lucide-react";
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
import type {
  AdvisorAnalysis,
  AdvisorResponse,
  AdvisorSummary
} from "@/types/finance";

const analysisBlocks: Array<{
  key: keyof Omit<AdvisorAnalysis, "source">;
  title: string;
  icon: typeof Brain;
}> = [
  { key: "shortConclusion", title: "Краткий вывод", icon: Brain },
  { key: "mainRisk", title: "Главный риск", icon: ShieldAlert },
  { key: "todayActions", title: "Что сделать сегодня", icon: CheckCircle2 },
  { key: "weeklyExecution", title: "Действия недели", icon: CheckCircle2 },
  { key: "dontDo", title: "Что не делать", icon: Ban },
  { key: "debtPriority", title: "Приоритет по долгам", icon: CreditCard },
  { key: "spendingLimit", title: "Лимит трат", icon: WalletCards },
  { key: "hardTruth", title: "Жесткая правда", icon: AlertTriangle }
];
const advisorSummaryCacheKey = "advisor:summary";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Еще не обновлялся";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function AnalysisCard({
  title,
  items,
  icon: Icon
}: {
  title: string;
  items: string[];
  icon: typeof Brain;
}) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-md bg-soft p-2 text-muted">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2 text-sm leading-6 text-ink">
          {items.map((item, index) => (
            <p key={`${title}-${index}`}>{item}</p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Нет данных для вывода.</p>
      )}
    </section>
  );
}

export function AdvisorClient() {
  const [summary, setSummary] = useState<AdvisorSummary | null>(
    () => readClientCache<AdvisorResponse>(advisorSummaryCacheKey)?.summary ?? null
  );
  const [analysis, setAnalysis] = useState<AdvisorAnalysis | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(() => !summary);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const mainBlocks = useMemo(
    () =>
      analysisBlocks.filter((block) =>
        ["shortConclusion", "mainRisk"].includes(block.key)
      ),
    []
  );
  const actionBlocks = useMemo(
    () =>
      analysisBlocks.filter((block) =>
        ["todayActions", "weeklyExecution", "dontDo", "debtPriority"].includes(block.key)
      ),
    []
  );
  const otherBlocks = useMemo(
    () =>
      analysisBlocks.filter((block) =>
        ["spendingLimit", "hardTruth"].includes(block.key)
      ),
    []
  );

  async function loadSummary() {
    setMessage("");
    const cached = readClientCache<AdvisorResponse>(advisorSummaryCacheKey);

    if (cached) {
      setSummary(cached.summary);
    }

    setLoadingSummary(!cached);

    try {
      const data = await fetchJsonCached<AdvisorResponse>(
        advisorSummaryCacheKey,
        "/api/advisor",
        { ttlMs: 15_000 }
      );
      setSummary(data.summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить сводку");
      setMessageTone("error");
    } finally {
      setLoadingSummary(false);
    }
  }

  async function refreshAnalysis() {
    setRefreshing(true);
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
      setClientCache(advisorSummaryCacheKey, {
        summary: data.summary,
        analysis: null
      } satisfies AdvisorResponse);
      setSummary(data.summary);
      setAnalysis(data.analysis);
      setLastUpdated(new Date().toISOString());
      setMessage(data.warning ?? "Анализ обновлен");
      setMessageTone(data.warning ? "neutral" : "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обновить анализ");
      setMessageTone("error");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  return (
    <div>
      <PageHeader
        title="Советник"
        description="Короткий практический анализ на основе текущих данных."
      >
        <button
          type="button"
          className="btn-primary"
          onClick={refreshAnalysis}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          {refreshing ? "Обновление" : "Обновить анализ"}
        </button>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          Последнее обновление анализа: {formatDateTime(lastUpdated)}
        </div>
        {analysis ? (
          <div className="text-xs text-muted">
            Источник: {analysis.source === "ai" ? "AI" : "расчетные правила"}
          </div>
        ) : null}
      </div>

      <Notice message={message} tone={messageTone} />

      {loadingSummary && summary ? (
        <p className="mt-6 text-sm text-muted">Обновляем сводку…</p>
      ) : null}

      {loadingSummary && !summary ? (
        <>
          <p className="mt-6 text-sm text-muted">Загрузка...</p>
        </>
      ) : summary ? (
        <>
          <section className="mt-6 card p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Короткий статус</h2>
                <p className="mt-1 text-sm text-muted">
                  {summary.period.label}: деньги {formatCurrency(summary.totals.realMoney)},
                  долг {formatCurrency(summary.totals.totalDebt)}, чистая позиция{" "}
                  {formatCurrency(summary.totals.netPosition)}. Доступный лимит кредиток не
                  считается деньгами.
                </p>
              </div>
              <div className="text-sm text-muted">
                Безопасный лимит:{" "}
                <span className="font-medium text-ink">
                  {formatCurrency(summary.totals.safeDailyLimit)}
                </span>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 text-lg font-semibold text-ink">Финансовый вывод</h2>
            {analysis ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {mainBlocks.map((block) => (
                  <AnalysisCard
                    key={block.key}
                    title={block.title}
                    icon={block.icon}
                    items={analysis[block.key]}
                  />
                ))}
              </div>
            ) : (
              <div className="card p-4 sm:p-5">
                <EmptyState text="Нажмите «Обновить анализ», чтобы получить вывод советника." />
              </div>
            )}
          </section>

          {analysis ? (
            <>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {actionBlocks.map((block) => (
                  <AnalysisCard
                    key={block.key}
                    title={block.title}
                    icon={block.icon}
                    items={analysis[block.key]}
                  />
                ))}
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {otherBlocks.map((block) => (
                  <AnalysisCard
                    key={block.key}
                    title={block.title}
                    icon={block.icon}
                    items={analysis[block.key]}
                  />
                ))}
              </div>
            </>
          ) : null}

        </>
      ) : (
        <EmptyState text="Нет данных для анализа" />
      )}
    </div>
  );
}
