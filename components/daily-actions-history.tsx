"use client";

import { Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { readErrorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import type { DailyActionLog, DailyActionType } from "@/types/finance";

const actionLabels: Record<DailyActionType, string> = {
  FIRST_TOUCH: "Первое касание",
  FOLLOW_UP: "Follow-up",
  WARM_CONTACT: "Тёплый контакт",
  CALL: "Созвон",
  PROPOSAL: "КП",
  PRICE_NAMED: "Цена названа",
  OTHER: "Другое"
};

const actionOptions = Object.entries(actionLabels) as Array<[DailyActionType, string]>;

type HistoryResponse = {
  actions: DailyActionLog[];
};

type Filters = {
  from: string;
  to: string;
  type: "ALL" | DailyActionType;
  q: string;
  includeDeleted: boolean;
};

const initialFilters: Filters = {
  from: "",
  to: "",
  type: "ALL",
  q: "",
  includeDeleted: false
};

function buildHistoryUrl(filters: Filters) {
  const params = new URLSearchParams({
    mode: "history",
    limit: "100"
  });

  if (filters.from) {
    params.set("from", filters.from);
  }

  if (filters.to) {
    params.set("to", filters.to);
  }

  if (filters.type !== "ALL") {
    params.set("type", filters.type);
  }

  if (filters.q.trim()) {
    params.set("q", filters.q.trim());
  }

  if (filters.includeDeleted) {
    params.set("includeDeleted", "true");
  }

  return `/api/daily-actions?${params.toString()}`;
}

export function DailyActionsHistory() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(initialFilters);
  const [actions, setActions] = useState<DailyActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch(buildHistoryUrl(filters), {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: HistoryResponse = await response.json();
      setActions(data.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить дневник");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draftFilters);
  }

  async function softDeleteAction(action: DailyActionLog) {
    if (!window.confirm("Удалить действие?")) {
      return;
    }

    setSavingId(action.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/daily-actions/${action.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setMessage("Действие удалено");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить действие");
    } finally {
      setSavingId(null);
    }
  }

  async function restoreAction(action: DailyActionLog) {
    setSavingId(action.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/daily-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setMessage("Действие восстановлено");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось восстановить действие");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Дневник действий"
        description="Полная история действий по поиску клиентов, заказчиков и проектов."
      />

      <Link href="/strategy/actions" className="mb-5 inline-flex text-sm text-muted transition hover:text-ink">
        ← Неделя
      </Link>

      <section className="card p-4 sm:p-5">
        <form className="grid gap-3 lg:grid-cols-[150px_150px_180px_1fr_auto]" onSubmit={applyFilters}>
          <label className="text-sm">
            <span className="field-label">С</span>
            <input
              className="field mt-1"
              type="date"
              value={draftFilters.from}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <span className="field-label">По</span>
            <input
              className="field mt-1"
              type="date"
              value={draftFilters.to}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <span className="field-label">Тип</span>
            <select
              className="field mt-1"
              value={draftFilters.type}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  type: event.target.value as Filters["type"]
                }))
              }
            >
              <option value="ALL">Все</option>
              {actionOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="field-label">Поиск</span>
            <input
              className="field mt-1"
              value={draftFilters.q}
              placeholder="Кому, ценность, следующий шаг..."
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, q: event.target.value }))
              }
            />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="inline-flex min-h-5 items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={draftFilters.includeDeleted}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    includeDeleted: event.target.checked
                  }))
                }
              />
              Показать удалённые
            </label>
            <button type="submit" className="btn-primary min-h-10 justify-center">
              <Search className="h-4 w-4" aria-hidden="true" />
              Найти
            </button>
          </div>
        </form>
      </section>

      {message ? <div className="mt-4 text-sm text-profit">{message}</div> : null}
      {error ? <div className="mt-4 text-sm text-loss">{error}</div> : null}

      <section className="mt-5 card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">История</h2>
          {loading ? <span className="text-xs text-muted">Загрузка…</span> : null}
        </div>

        {!loading && actions.length === 0 ? (
          <EmptyState text="Действий по выбранным фильтрам нет." />
        ) : (
          <div className="grid gap-3">
            {actions.map((action) => (
              <div
                key={action.id}
                className="rounded-md border border-line p-3 transition hover:bg-soft/40"
                data-testid="daily-action-history-card"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium text-ink">
                      {formatDate(action.date)} · {actionLabels[action.type]} ·{" "}
                      {action.target || "Без адресата"}
                    </div>
                    {action.deletedAt ? (
                      <div className="mt-1 text-xs text-loss">Удалено</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {action.deletedAt ? (
                      <button
                        type="button"
                        className="btn-secondary min-h-9"
                        onClick={() => restoreAction(action)}
                        disabled={savingId === action.id}
                      >
                        {savingId === action.id ? "Восстанавливаем" : "Восстановить"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-danger min-h-9"
                        onClick={() => softDeleteAction(action)}
                        disabled={savingId === action.id}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-muted lg:grid-cols-3">
                  <div>
                    <span className="text-ink">Ценность:</span>{" "}
                    {action.value || "Не указана"}
                  </div>
                  <div>
                    <span className="text-ink">Следующий шаг:</span>{" "}
                    {action.nextStep || "Не указан"}
                  </div>
                  <div>
                    <span className="text-ink">Заметка:</span>{" "}
                    {action.note || "Нет"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
