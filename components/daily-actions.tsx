"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import {
  fetchJsonCached,
  invalidateClientCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatDate, toDateInputValue } from "@/lib/format";
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

const counterLabels: Record<DailyActionType, string> = {
  FIRST_TOUCH: "Первые касания",
  FOLLOW_UP: "Follow-up",
  WARM_CONTACT: "Тёплые контакты",
  CALL: "Созвоны",
  PROPOSAL: "КП",
  PRICE_NAMED: "Цена названа",
  OTHER: "Другое"
};

const actionOptions = Object.entries(actionLabels) as Array<[DailyActionType, string]>;

type DailyActionsResponse = {
  weekStartDate: string;
  weekEndDate: string;
  actions: DailyActionLog[];
  counts: Record<DailyActionType, number>;
  hypothesisCount: number;
};

type ActionForm = {
  date: string;
  type: DailyActionType;
  target: string;
  value: string;
  nextStep: string;
};

function startOfWeek(date = new Date()) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function actionCacheKey(weekStart: string) {
  return `daily-actions:${weekStart}`;
}

function dateFromInput(value: string) {
  return new Date(`${value}T12:00:00`);
}

function blankForm(date = toDateInputValue()) {
  return {
    date,
    type: "FIRST_TOUCH" as DailyActionType,
    target: "",
    value: "",
    nextStep: ""
  };
}

function normalizeForm(action: DailyActionLog): ActionForm {
  return {
    date: toDateInputValue(action.date),
    type: action.type,
    target: action.target ?? "",
    value: action.value ?? "",
    nextStep: action.nextStep ?? ""
  };
}

function payloadFromForm(form: ActionForm) {
  return {
    date: form.date,
    type: form.type,
    target: form.target || null,
    value: form.value || null,
    nextStep: form.nextStep || null
  };
}

export function DailyActions() {
  const currentWeekStart = toDateInputValue(startOfWeek());
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [data, setData] = useState<DailyActionsResponse | null>(() =>
    readClientCache<DailyActionsResponse>(actionCacheKey(currentWeekStart))
  );
  const [drafts, setDrafts] = useState<Record<string, ActionForm>>({});
  const [form, setForm] = useState<ActionForm>(() => blankForm());
  const [loading, setLoading] = useState(() => !data);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const weekLabel = useMemo(() => {
    if (!data) {
      return "";
    }

    return `${formatDate(data.weekStartDate)} — ${formatDate(data.weekEndDate)}`;
  }, [data]);

  const actionCount = data?.actions.length ?? 0;

  const loadActions = useCallback(async (force = false) => {
    setError("");
    const key = actionCacheKey(weekStart);
    const cached = readClientCache<DailyActionsResponse>(key);

    if (cached && !force) {
      setData(cached);
      setDrafts(
        Object.fromEntries(cached.actions.map((action) => [action.id, normalizeForm(action)]))
      );
    }

    setLoading(!cached);

    try {
      const next = await fetchJsonCached<DailyActionsResponse>(
        key,
        `/api/daily-actions?weekStartDate=${weekStart}`,
        { force, ttlMs: 10_000 }
      );
      setData(next);
      setDrafts(
        Object.fromEntries(next.actions.map((action) => [action.id, normalizeForm(action)]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить действия");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  function shiftWeek(days: number) {
    setWeekStart((current) => toDateInputValue(addDays(dateFromInput(current), days)));
  }

  async function createAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!form.date || !form.type) {
      setError("Укажите дату и тип действия");
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/daily-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(form))
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const created: DailyActionLog = await response.json();
      const createdWeekStart = toDateInputValue(startOfWeek(dateFromInput(toDateInputValue(created.date))));

      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setForm(blankForm());
      setMessage("Действие добавлено");

      if (createdWeekStart !== weekStart) {
        setWeekStart(createdWeekStart);
      } else {
        await loadActions(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить действие");
    } finally {
      setCreating(false);
    }
  }

  async function saveAction(action: DailyActionLog) {
    const draft = drafts[action.id];

    if (!draft) {
      return;
    }

    setSavingId(action.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/daily-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(draft))
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setMessage("Действие сохранено");
      await loadActions(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить действие");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteAction(action: DailyActionLog) {
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

      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setMessage("Действие удалено");
      await loadActions(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить действие");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Действия дня</h2>
          <p className="mt-1 text-sm text-muted">
            Фиксируй не только планы, но и реальные шаги к клиентам, заказчикам и проектам.
          </p>
          <p className="mt-2 text-sm text-muted">
            Задача — видеть ценность действий даже до того, как пришли деньги.
          </p>
          <p className="mt-2 text-sm text-muted">
            Действия можно фиксировать уже сейчас, даже если годовой план ещё не начался.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/strategy/actions/history" className="btn-secondary min-h-10 px-3">
            Открыть полный дневник
          </Link>
          <button type="button" className="btn-secondary min-h-10 px-3" onClick={() => shiftWeek(-7)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Предыдущая
          </button>
          <input
            className="field min-h-10 w-40"
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(toDateInputValue(startOfWeek(dateFromInput(event.target.value))))}
          />
          <button type="button" className="btn-secondary min-h-10 px-3" onClick={() => shiftWeek(7)}>
            Следующая
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {weekLabel ? <div className="mb-4 text-sm text-muted">Неделя: {weekLabel}</div> : null}
      {message ? <div className="mb-3 text-sm text-profit">{message}</div> : null}
      {error ? <div className="mb-3 text-sm text-loss">{error}</div> : null}

      <div className="mb-3 text-sm text-muted">
        Гипотезы недели: {data?.hypothesisCount ?? 0}. Действия недели: {actionCount}.
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actionOptions
          .filter(([type]) => type !== "OTHER")
          .map(([type]) => (
            <div key={type} className="rounded-md border border-line p-3">
              <div className="text-xs text-muted">{counterLabels[type]}</div>
              <div className="mt-1 text-lg font-semibold text-ink">
                {data?.counts[type] ?? 0}
              </div>
            </div>
          ))}
        <div className="rounded-md border border-line p-3">
          <div className="text-xs text-muted">Гипотезы недели</div>
          <div className="mt-1 text-lg font-semibold text-ink">
            {data?.hypothesisCount ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="text-xs text-muted">Действия недели</div>
          <div className="mt-1 text-lg font-semibold text-ink">{actionCount}</div>
        </div>
      </div>

      <form className="mb-5 grid gap-3 lg:grid-cols-[150px_180px_1fr_1fr_1fr_auto]" onSubmit={createAction}>
        <label className="text-sm">
          <span className="field-label">Дата</span>
          <input
            className="field mt-1"
            type="date"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
        </label>
        <label className="text-sm">
          <span className="field-label">Тип</span>
          <select
            className="field mt-1"
            value={form.type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type: event.target.value as DailyActionType
              }))
            }
          >
            {actionOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="field-label">Кому / куда</span>
          <input
            className="field mt-1"
            value={form.target}
            placeholder="Гаджиомар, бренд одежды, лагерь..."
            onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
          />
        </label>
        <label className="text-sm">
          <span className="field-label">Почему это было ценно</span>
          <input
            className="field mt-1"
            value={form.value}
            placeholder="Создал новый шанс на клиента..."
            onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
          />
        </label>
        <label className="text-sm">
          <span className="field-label">Следующий шаг</span>
          <input
            className="field mt-1"
            value={form.nextStep}
            placeholder="Follow-up через 3 дня..."
            onChange={(event) => setForm((current) => ({ ...current, nextStep: event.target.value }))}
          />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn-primary min-h-11 w-full justify-center" disabled={creating}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {creating ? "Добавляем" : "Добавить"}
          </button>
        </div>
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Последние действия</h3>
        {loading && data ? <span className="text-xs text-muted">Обновляем…</span> : null}
      </div>

      {loading && !data ? (
        <p className="text-sm text-muted">Загрузка...</p>
      ) : data?.actions.length ? (
        <div className="grid gap-3">
          {data.actions.map((action) => {
            const draft = drafts[action.id] ?? normalizeForm(action);

            return (
              <div key={action.id} className="rounded-md border border-line p-3">
                <div className="mb-3 text-sm font-medium text-ink">
                  {formatDate(action.date)} · {actionLabels[action.type]} ·{" "}
                  {action.target || "Без адресата"}
                </div>
                <div className="grid gap-3 lg:grid-cols-[150px_180px_1fr_1fr_1fr]">
                  <label className="text-sm">
                    <span className="field-label">Дата</span>
                    <input
                      className="field mt-1"
                      type="date"
                      value={draft.date}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: { ...draft, date: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Тип</span>
                    <select
                      className="field mt-1"
                      value={draft.type}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: {
                            ...draft,
                            type: event.target.value as DailyActionType
                          }
                        }))
                      }
                    >
                      {actionOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Кому / куда</span>
                    <input
                      className="field mt-1"
                      value={draft.target}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: { ...draft, target: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Ценность</span>
                    <input
                      className="field mt-1"
                      value={draft.value}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: { ...draft, value: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Следующий шаг</span>
                    <input
                      className="field mt-1"
                      value={draft.nextStep}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: { ...draft, nextStep: event.target.value }
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mt-3 text-sm text-muted">
                  {action.value ? <p>Ценность: {action.value}</p> : null}
                  {action.nextStep ? <p className="mt-1">Следующий шаг: {action.nextStep}</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary min-h-10"
                    onClick={() => saveAction(action)}
                    disabled={savingId === action.id}
                  >
                    {savingId === action.id ? "Сохраняем" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="btn-danger min-h-10"
                    onClick={() => deleteAction(action)}
                    disabled={savingId === action.id}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState text="На эту неделю действий пока нет." />
      )}
    </section>
  );
}
