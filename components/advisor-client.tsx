"use client";

import {
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle2,
  CreditCard,
  Landmark,
  RefreshCw,
  Scale,
  ShieldAlert,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { readErrorMessage } from "@/lib/client-api";
import { formatCurrency, formatDate } from "@/lib/format";
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
  { key: "dontDo", title: "Что не делать", icon: Ban },
  { key: "debtPriority", title: "Приоритет по долгам", icon: CreditCard },
  { key: "spendingLimit", title: "Лимит трат", icon: WalletCards },
  { key: "hardTruth", title: "Жесткая правда", icon: AlertTriangle }
];

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

function SummaryDetails({ summary }: { summary: AdvisorSummary }) {
  const overLimitCards = summary.creditCards.filter((card) => card.overLimit > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold text-ink">Кредитные карты</h2>
        {summary.creditCards.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Кредитных карт нет.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {summary.creditCards.map((card) => (
              <div key={card.name} className="rounded-md border border-line px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{card.name}</div>
                    <div className="mt-1 text-xs text-muted">
                      Минимальный платеж:{" "}
                      {card.minimalPayment ? formatCurrency(card.minimalPayment) : "не указан"}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Оплатить до: {card.paymentDate ? formatDate(card.paymentDate) : "не указано"}
                    </div>
                  </div>
                  {card.overLimit > 0 ? (
                    <div className="rounded-md bg-loss/10 px-2 py-1 text-xs text-loss">
                      Выше лимита
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-muted">Доступно</div>
                    <div className="font-medium text-ink">{formatCurrency(card.availableCredit)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Долг</div>
                    <div className="font-medium text-loss">{formatCurrency(card.currentDebt)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Лимит</div>
                    <div className="font-medium text-ink">{formatCurrency(card.creditLimit)}</div>
                  </div>
                </div>
                {card.overLimit > 0 ? (
                  <div className="mt-2 text-sm text-loss">
                    Превышение лимита: {formatCurrency(card.overLimit)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold text-ink">Траты и утечки</h2>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted">Последние 7 дней</div>
            <div className="font-medium text-ink">
              {formatCurrency(summary.transactions.trend.last7DaysExpense)}
            </div>
          </div>
          <div>
            <div className="text-muted">Предыдущие 7 дней</div>
            <div className="font-medium text-ink">
              {formatCurrency(summary.transactions.trend.previous7DaysExpense)}
            </div>
          </div>
          <div>
            <div className="text-muted">Мелкие траты</div>
            <div className="font-medium text-ink">
              {formatCurrency(summary.transactions.leakage.totalSmallExpenses)}
            </div>
          </div>
          <div>
            <div className="text-muted">Порог утечек</div>
            <div className="font-medium text-ink">
              {formatCurrency(summary.transactions.leakage.threshold)}
            </div>
          </div>
        </div>
        {summary.transactions.topExpenseCategories.length > 0 ? (
          <div className="mt-4 space-y-2">
            <div className="text-xs uppercase tracking-normal text-muted">Топ расходов</div>
            {summary.transactions.topExpenseCategories.map((category) => (
              <div
                key={category.name}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
              >
                <span className="text-ink">{category.name}</span>
                <span className="font-medium text-ink">{formatCurrency(category.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {overLimitCards.length > 0 ? (
          <Notice
            message={`Есть превышение лимита: ${overLimitCards.map((card) => card.name).join(", ")}`}
            tone="error"
          />
        ) : null}
      </section>
    </div>
  );
}

export function AdvisorClient() {
  const [summary, setSummary] = useState<AdvisorSummary | null>(null);
  const [analysis, setAnalysis] = useState<AdvisorAnalysis | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
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
        ["todayActions", "dontDo", "debtPriority"].includes(block.key)
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
    setLoadingSummary(true);
    setMessage("");

    try {
      const response = await fetch("/api/advisor", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: AdvisorResponse = await response.json();
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

      {loadingSummary ? (
        <>
          <p className="mt-6 text-sm text-muted">Загрузка...</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="card h-28 animate-pulse bg-soft/50" />
            ))}
          </div>
        </>
      ) : summary ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Деньги сейчас"
              value={formatCurrency(summary.totals.realMoney)}
              icon={Landmark}
              tone={summary.totals.realMoney >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Общий долг"
              value={formatCurrency(summary.totals.totalDebt)}
              icon={CreditCard}
              tone="expense"
            />
            <StatCard
              label="Чистая позиция"
              value={formatCurrency(summary.totals.netPosition)}
              icon={Scale}
              tone={summary.totals.netPosition >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Расходы за месяц"
              value={formatCurrency(summary.totals.monthlyExpense)}
              icon={WalletCards}
              tone="expense"
            />
          </div>

          <section className="mt-6 card p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Финансовая сводка</h2>
                <p className="mt-1 text-sm text-muted">
                  Период: {summary.period.label}. Доступный лимит кредиток не входит в деньги.
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

          <section className="mt-6">
            <SummaryDetails summary={summary} />
          </section>
        </>
      ) : (
        <EmptyState text="Нет данных для анализа" />
      )}
    </div>
  );
}
