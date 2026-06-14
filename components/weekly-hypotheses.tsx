"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import {
  fetchJsonCached,
  invalidateClientCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatDate, toDateInputValue } from "@/lib/format";
import type { WeeklyHypothesis, WeeklyHypothesisStatus } from "@/types/finance";

const statusLabels: Record<WeeklyHypothesisStatus, string> = {
  PLANNED: "Запланирована",
  ACTIVE: "В работе",
  WON: "Сработала",
  FAILED: "Не сработала",
  REPEAT: "Повторить",
  CHANGE: "Изменить",
  DROP: "Убрать"
};

const statusOptions = Object.entries(statusLabels) as Array<
  [WeeklyHypothesisStatus, string]
>;

type HypothesesResponse = {
  weekStartDate: string;
  weekEndDate: string;
  hypotheses: WeeklyHypothesis[];
};

type HypothesisForm = {
  title: string;
  actionPlan: string;
  expectedResult: string;
  actualResult: string;
  conclusion: string;
  status: WeeklyHypothesisStatus;
};

const initialForm: HypothesisForm = {
  title: "",
  actionPlan: "",
  expectedResult: "",
  actualResult: "",
  conclusion: "",
  status: "PLANNED"
};

function startOfWeek(date = new Date()) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function hypothesisCacheKey(weekStart: string) {
  return `weekly-hypotheses:${weekStart}`;
}

function normalizeForm(hypothesis: WeeklyHypothesis): HypothesisForm {
  return {
    title: hypothesis.title,
    actionPlan: hypothesis.actionPlan,
    expectedResult: hypothesis.expectedResult ?? "",
    actualResult: hypothesis.actualResult ?? "",
    conclusion: hypothesis.conclusion ?? "",
    status: hypothesis.status
  };
}

function payloadFromForm(form: HypothesisForm, weekStartDate: string) {
  return {
    weekStartDate,
    title: form.title,
    actionPlan: form.actionPlan,
    expectedResult: form.expectedResult || null,
    actualResult: form.actualResult || null,
    conclusion: form.conclusion || null,
    status: form.status
  };
}

export function WeeklyHypotheses() {
  const [weekStart, setWeekStart] = useState(() => toDateInputValue(startOfWeek()));
  const [data, setData] = useState<HypothesesResponse | null>(() =>
    readClientCache<HypothesesResponse>(hypothesisCacheKey(toDateInputValue(startOfWeek())))
  );
  const [drafts, setDrafts] = useState<Record<string, HypothesisForm>>({});
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(() => !data);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const weekLabel = useMemo(() => {
    if (!data) {
      return "";
    }

    return `${formatDate(data.weekStartDate)} — ${formatDate(data.weekEndDate)}`;
  }, [data]);

  const loadHypotheses = useCallback(async (force = false) => {
    setError("");
    const key = hypothesisCacheKey(weekStart);
    const cached = readClientCache<HypothesesResponse>(key);

    if (cached && !force) {
      setData(cached);
      setDrafts(
        Object.fromEntries(
          cached.hypotheses.map((hypothesis) => [hypothesis.id, normalizeForm(hypothesis)])
        )
      );
    }

    setLoading(!cached);

    try {
      const next = await fetchJsonCached<HypothesesResponse>(
        key,
        `/api/weekly-hypotheses?weekStartDate=${weekStart}`,
        { force, ttlMs: 10_000 }
      );
      setData(next);
      setDrafts(
        Object.fromEntries(
          next.hypotheses.map((hypothesis) => [hypothesis.id, normalizeForm(hypothesis)])
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить гипотезы");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    loadHypotheses();
  }, [loadHypotheses]);

  function shiftWeek(days: number) {
    setWeekStart((current) => toDateInputValue(addDays(new Date(`${current}T12:00:00`), days)));
  }

  async function createHypothesis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!form.title.trim() || !form.actionPlan.trim()) {
      setError("Укажите гипотезу и что делаете");
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/weekly-hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(form, weekStart))
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateClientCache("weekly-hypotheses:");
      invalidateClientCache("advisor:");
      setForm(initialForm);
      setMessage("Гипотеза добавлена");
      await loadHypotheses(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить гипотезу");
    } finally {
      setCreating(false);
    }
  }

  async function saveHypothesis(hypothesis: WeeklyHypothesis) {
    const draft = drafts[hypothesis.id];

    if (!draft) {
      return;
    }

    setSavingId(hypothesis.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/weekly-hypotheses/${hypothesis.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(draft, weekStart))
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateClientCache("weekly-hypotheses:");
      invalidateClientCache("advisor:");
      setMessage("Гипотеза сохранена");
      await loadHypotheses(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить гипотезу");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteHypothesis(hypothesis: WeeklyHypothesis) {
    if (!window.confirm("Удалить гипотезу недели?")) {
      return;
    }

    setSavingId(hypothesis.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/weekly-hypotheses/${hypothesis.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateClientCache("weekly-hypotheses:");
      invalidateClientCache("advisor:");
      setMessage("Гипотеза удалена");
      await loadHypotheses(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить гипотезу");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Гипотезы недели</h2>
          <p className="mt-1 text-sm text-muted">
            Правильная гипотеза — та, которую можно проверить за одну неделю.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary min-h-10 px-3" onClick={() => shiftWeek(-7)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Предыдущая
          </button>
          <input
            className="field min-h-10 w-40"
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(toDateInputValue(startOfWeek(new Date(`${event.target.value}T12:00:00`))))}
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

      <form className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={createHypothesis}>
        <input
          className="field"
          value={form.title}
          placeholder="20 холодных сообщений владельцам брендов"
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
        />
        <input
          className="field"
          value={form.actionPlan}
          placeholder="Что делаю"
          onChange={(event) => setForm((current) => ({ ...current, actionPlan: event.target.value }))}
        />
        <input
          className="field"
          value={form.expectedResult}
          placeholder="Ожидаемый результат"
          onChange={(event) => setForm((current) => ({ ...current, expectedResult: event.target.value }))}
        />
        <button type="submit" className="btn-primary min-h-11 justify-center" disabled={creating}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {creating ? "Добавляем" : "Добавить"}
        </button>
      </form>

      {loading && data ? <p className="mb-3 text-sm text-muted">Обновляем гипотезы…</p> : null}
      {loading && !data ? (
        <p className="text-sm text-muted">Загрузка...</p>
      ) : data?.hypotheses.length ? (
        <div className="grid gap-3">
          {data.hypotheses.map((hypothesis) => {
            const draft = drafts[hypothesis.id] ?? normalizeForm(hypothesis);

            return (
              <div key={hypothesis.id} className="rounded-md border border-line p-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <label className="text-sm">
                    <span className="field-label">Гипотеза</span>
                    <input
                      className="field mt-1"
                      value={draft.title}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: { ...draft, title: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Что делаю</span>
                    <input
                      className="field mt-1"
                      value={draft.actionPlan}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: { ...draft, actionPlan: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Ожидаемый результат</span>
                    <input
                      className="field mt-1"
                      value={draft.expectedResult}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: { ...draft, expectedResult: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Факт</span>
                    <input
                      className="field mt-1"
                      value={draft.actualResult}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: { ...draft, actualResult: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Вывод</span>
                    <input
                      className="field mt-1"
                      value={draft.conclusion}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: { ...draft, conclusion: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="field-label">Статус</span>
                    <select
                      className="field mt-1"
                      value={draft.status}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [hypothesis.id]: {
                            ...draft,
                            status: event.target.value as WeeklyHypothesisStatus
                          }
                        }))
                      }
                    >
                      {statusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary min-h-10"
                    onClick={() => saveHypothesis(hypothesis)}
                    disabled={savingId === hypothesis.id}
                  >
                    {savingId === hypothesis.id ? "Сохраняем" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="btn-danger min-h-10"
                    onClick={() => deleteHypothesis(hypothesis)}
                    disabled={savingId === hypothesis.id}
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
        <EmptyState text="На эту неделю гипотез пока нет" />
      )}
    </section>
  );
}
