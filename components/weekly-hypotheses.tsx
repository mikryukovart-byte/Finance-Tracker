"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import {
  fetchJsonCached,
  invalidateClientCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
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

export function WeeklyHypotheses({ weekStart }: { weekStart: string }) {
  const [data, setData] = useState<HypothesesResponse | null>(() =>
    readClientCache<HypothesesResponse>(hypothesisCacheKey(weekStart))
  );
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem("strategyHypothesesCollapsed") !== "true";
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, HypothesisForm>>({});
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(() => !data);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hypothesisCount = data?.hypotheses.length ?? 0;

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
    setIsCreateOpen(false);
    setEditingId(null);
    setForm(initialForm);
    loadHypotheses();
  }, [loadHypotheses]);

  useEffect(() => {
    window.localStorage.setItem("strategyHypothesesCollapsed", String(!isExpanded));
  }, [isExpanded]);

  function openCreateForm() {
    setIsExpanded(true);
    setEditingId(null);
    setIsCreateOpen(true);
  }

  function openEditForm(hypothesis: WeeklyHypothesis) {
    setIsCreateOpen(false);
    setDrafts((current) => ({
      ...current,
      [hypothesis.id]: normalizeForm(hypothesis)
    }));
    setEditingId(hypothesis.id);
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
      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setForm(initialForm);
      setIsCreateOpen(false);
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
      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setEditingId(null);
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
      invalidateClientCache("daily-actions:");
      invalidateClientCache("advisor:");
      setEditingId(null);
      setMessage("Гипотеза удалена");
      await loadHypotheses(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить гипотезу");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section
      className="card p-4 sm:p-5"
      data-testid="weekly-hypotheses"
      data-week-start={weekStart}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Гипотезы недели</h2>
          <p className="mt-1 text-sm text-muted">
            Проверяемые идеи и конкретные действия на выбранную неделю.
          </p>
          <p className="mt-2 text-sm text-muted">Гипотез: {hypothesisCount}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary min-h-10 px-3"
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? "Скрыть гипотезы" : "Показать гипотезы"}
          </button>
          <button
            type="button"
            className="btn-primary min-h-10 px-3"
            onClick={openCreateForm}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить гипотезу
          </button>
        </div>
      </div>

      {message ? <div className="mb-3 text-sm text-profit">{message}</div> : null}
      {error ? <div className="mb-3 text-sm text-loss">{error}</div> : null}

      {isExpanded ? (
        <>
          {isCreateOpen ? (
            <form
              className="mb-5 rounded-md border border-line bg-soft/20 p-3"
              onSubmit={createHypothesis}
            >
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
                <input
                  className="field"
                  aria-label="Новая гипотеза"
                  value={form.title}
                  placeholder="20 холодных сообщений владельцам брендов"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
                <input
                  className="field"
                  aria-label="Что делаю в новой гипотезе"
                  value={form.actionPlan}
                  placeholder="Что делаю"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, actionPlan: event.target.value }))
                  }
                />
                <input
                  className="field"
                  aria-label="Ожидаемый результат новой гипотезы"
                  value={form.expectedResult}
                  placeholder="Ожидаемый результат"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      expectedResult: event.target.value
                    }))
                  }
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="btn-primary min-h-10"
                  disabled={creating}
                >
                  {creating ? "Добавляем" : "Добавить"}
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-10"
                  onClick={() => {
                    setForm(initialForm);
                    setIsCreateOpen(false);
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : null}

          {loading && data ? (
            <p className="mb-3 text-sm text-muted">Обновляем гипотезы…</p>
          ) : null}
          {loading && !data ? (
            <p className="text-sm text-muted">Загрузка...</p>
          ) : data?.hypotheses.length ? (
            <div className="grid gap-3">
              {data.hypotheses.map((hypothesis) => {
                const draft = drafts[hypothesis.id] ?? normalizeForm(hypothesis);
                const isEditing = editingId === hypothesis.id;

                return (
                  <article
                    key={hypothesis.id}
                    className="rounded-md border border-line p-3"
                    data-testid="weekly-hypothesis-card"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{hypothesis.title}</div>
                        <div className="mt-1 text-xs text-muted">
                          {statusLabels[hypothesis.status]}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary min-h-9 px-3"
                          onClick={() =>
                            isEditing ? setEditingId(null) : openEditForm(hypothesis)
                          }
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          {isEditing ? "Закрыть" : "Редактировать"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger min-h-9 px-3"
                          onClick={() => deleteHypothesis(hypothesis)}
                          disabled={savingId === hypothesis.id}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Удалить
                        </button>
                      </div>
                    </div>

                    {!isEditing ? (
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <p className="text-muted">
                          <span className="text-ink">Что делаю:</span>{" "}
                          {hypothesis.actionPlan}
                        </p>
                        <p className="text-muted">
                          <span className="text-ink">Ожидаемый результат:</span>{" "}
                          {hypothesis.expectedResult || "Не указан"}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 border-t border-line pt-3">
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
                                  [hypothesis.id]: {
                                    ...draft,
                                    actionPlan: event.target.value
                                  }
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
                                  [hypothesis.id]: {
                                    ...draft,
                                    expectedResult: event.target.value
                                  }
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
                                  [hypothesis.id]: {
                                    ...draft,
                                    actualResult: event.target.value
                                  }
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
                                  [hypothesis.id]: {
                                    ...draft,
                                    conclusion: event.target.value
                                  }
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
                            className="btn-secondary min-h-10"
                            onClick={() => setEditingId(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState text="На эту неделю гипотез пока нет" />
          )}
        </>
      ) : (
        <div className="rounded-md border border-line bg-soft/20 px-3 py-3 text-sm text-muted">
          Гипотез: {hypothesisCount}.{loading ? " Загружаем данные..." : ""}
        </div>
      )}
    </section>
  );
}
