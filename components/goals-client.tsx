"use client";

import {
  CalendarDays,
  Gauge,
  Save,
  Sigma,
  Target,
  TrendingUp
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  fetchJsonCached,
  readClientCache,
  readErrorMessage,
  setClientCache
} from "@/lib/client-api";
import { formatCurrency, formatPercent } from "@/lib/format";
import type {
  AnnualGoalRow,
  GoalsResponse,
  MonthlyTaktLevel,
  ThreeYearGoalScenario
} from "@/types/finance";

const monthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь"
];

function goalsCacheKey(year: number) {
  return `goals:${year}`;
}

function rowIndex(row: AnnualGoalRow) {
  return row.rowKey === "A" ? 0 : Number(row.rowKey.replace("B", ""));
}

function rowLabel(row: AnnualGoalRow) {
  const calendarMonth = row.calendarMonth ?? row.month ?? 1;
  const calendarYear = row.calendarYear ? ` ${row.calendarYear}` : "";
  const monthLabel = `${monthNames[calendarMonth - 1]}${calendarYear}`;
  const startLabel = row.rowKey === "A" ? " · старт" : "";
  const reserveLabel = row.isReserve || (row.month && row.month > 10) ? " · резерв" : "";

  return `${row.rowKey} · ${monthLabel}${startLabel}${reserveLabel}`;
}

function numberInputValue(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}

function parseMoneyInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function dateInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value);

  return dateOnlyMatch?.[1] ?? "";
}

function formatCurrencyInline(value: number) {
  return formatCurrency(value).replace(/\s/g, "\u00A0");
}

function calculateScenario(pointC: number, speed: number) {
  const pointD = pointC * speed;
  return {
    pointD,
    pointE: pointD * speed
  };
}

function progressPercent(actual: number, target: number) {
  if (target <= 0) {
    return actual > 0 ? 100 : 0;
  }

  return Math.min(999, (actual / target) * 100);
}

function progressClass(actual: number, target: number, tier: "c1" | "c2" | "c3") {
  if (target <= 0) {
    return "text-muted";
  }

  if (actual >= target) {
    return tier === "c3" ? "font-semibold text-profit" : "text-profit";
  }

  return tier === "c1" ? "text-loss" : "text-muted";
}

function monthStatus(row: AnnualGoalRow, actual: number) {
  if (row.isClosed) {
    return "Закрыто";
  }

  if (actual >= row.c3Value && row.c3Value > 0) {
    return "C3 достигнут";
  }

  if (actual >= row.c2Value && row.c2Value > 0) {
    return "C2 достигнут";
  }

  if (actual >= row.c1Value && row.c1Value > 0) {
    return "C1 достигнут";
  }

  return "Ниже C1";
}

function findCurrentCycleState(rows: AnnualGoalRow[], now: Date) {
  const rowsWithDates = rows.filter((row) => row.calendarMonth && row.calendarYear);

  if (!rowsWithDates.length) {
    const selectedRow = rows[0] ?? null;
    return {
      selectedRow,
      nextRow: rows[1] ?? null,
      isBeforeStart: false
    };
  }

  const currentMonthKey = now.getFullYear() * 12 + now.getMonth();
  const current = rowsWithDates.find((row) => {
    const rowMonthKey = (row.calendarYear ?? 0) * 12 + (row.calendarMonth ?? 1) - 1;
    return rowMonthKey === currentMonthKey;
  });

  if (current) {
    const currentIndex = rowsWithDates.findIndex((row) => row.id === current.id);
    return {
      selectedRow: current,
      nextRow: currentIndex >= 0 ? rowsWithDates[currentIndex + 1] ?? null : null,
      isBeforeStart: false
    };
  }

  const first = rowsWithDates[0];
  const last = rowsWithDates[rowsWithDates.length - 1];
  const firstMonthKey =
    (first.calendarYear ?? 0) * 12 + (first.calendarMonth ?? 1) - 1;

  if (currentMonthKey < firstMonthKey) {
    return {
      selectedRow: first,
      nextRow: first,
      isBeforeStart: true
    };
  }

  return {
    selectedRow: last,
    nextRow: null,
    isBeforeStart: false
  };
}

export function GoalsClient() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<GoalsResponse | null>(() =>
    readClientCache<GoalsResponse>(goalsCacheKey(currentYear))
  );
  const [loading, setLoading] = useState(() => !data);
  const [saving, setSaving] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [savingTaktLevel, setSavingTaktLevel] = useState<number | null>(null);
  const [savingScenarioSpeed, setSavingScenarioSpeed] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");
  const [settings, setSettings] = useState({
    pointA: 0,
    pointAMode: "AUTO",
    planStartDate: "",
    c1Target: 0,
    c2Target: 0,
    c3Target: 0
  });

  useEffect(() => {
    async function loadGoals() {
      setMessage("");
      const key = goalsCacheKey(year);
      const cached = readClientCache<GoalsResponse>(key);

      if (cached) {
        setData(cached);
      }

      setLoading(!cached);

      try {
        const next = await fetchJsonCached<GoalsResponse>(
          key,
          `/api/goals?year=${year}`,
          { ttlMs: 12_000 }
        );
        setData(next);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось загрузить цели");
        setTone("error");
      } finally {
        setLoading(false);
      }
    }

    loadGoals();
  }, [year]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setSettings({
      pointA: data.plan.pointA,
      pointAMode: data.plan.pointAMode,
      planStartDate: dateInputValue(data.plan.planStartDate),
      c1Target: data.plan.c1Target,
      c2Target: data.plan.c2Target,
      c3Target: data.plan.c3Target
    });
  }, [data]);

  const rows = useMemo(
    () => [...(data?.plan.rows ?? [])].sort((a, b) => rowIndex(a) - rowIndex(b)),
    [data]
  );
  const factsByRowKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const fact of data?.facts ?? []) {
      if (fact.rowKey) {
        map.set(fact.rowKey, fact.actualIncome);
      }
    }
    return map;
  }, [data]);
  const cycleState = findCurrentCycleState(rows, now);
  const selectedRow = cycleState.selectedRow;
  const selectedActual = selectedRow ? factsByRowKey.get(selectedRow.rowKey) ?? 0 : 0;
  const selectedC1 = selectedRow?.c1Value ?? 0;
  const selectedC2 = selectedRow?.c2Value ?? 0;
  const selectedC3 = selectedRow?.c3Value ?? 0;
  const gapToC2 = Math.max(0, selectedC2 - selectedActual);
  const selectedRowLabel = selectedRow ? rowLabel(selectedRow) : "—";
  const nextRowLabel = cycleState.nextRow ? rowLabel(cycleState.nextRow) : null;
  const effectivePointA =
    settings.pointAMode === "AUTO" ? data?.autoPointA ?? settings.pointA : settings.pointA;
  const lowerTargetNames = useMemo(() => {
    return [
      { name: "C1", value: settings.c1Target },
      { name: "C2", value: settings.c2Target },
      { name: "C3", value: settings.c3Target }
    ]
      .filter((target) => target.value <= effectivePointA)
      .map((target) => target.name);
  }, [effectivePointA, settings.c1Target, settings.c2Target, settings.c3Target]);

  function cacheGoals(next: GoalsResponse) {
    setData(next);
    setClientCache(goalsCacheKey(next.plan.year), next, 12_000);
  }

  function updateRowLocal(id: string, patch: Partial<AnnualGoalRow>) {
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        plan: {
          ...current.plan,
          rows: current.plan.rows.map((row) =>
            row.id === id ? { ...row, ...patch } : row
          )
        }
      };
    });
  }

  function updateTaktLocal(level: number, patch: Partial<MonthlyTaktLevel>) {
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        taktLevels: current.taktLevels.map((item) =>
          item.level === level ? { ...item, ...patch } : item
        )
      };
    });
  }

  function updateScenarioLocal(speed: number, patch: Partial<ThreeYearGoalScenario>) {
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        threeYearScenarios: current.threeYearScenarios.map((scenario) => {
          if (scenario.speed !== speed) {
            return scenario;
          }

          const pointC = patch.pointC ?? scenario.pointC;
          return {
            ...scenario,
            ...patch,
            ...calculateScenario(pointC, scenario.speed)
          };
        })
      };
    });
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (lowerTargetNames.length > 0) {
      setMessage("Цель должна быть выше точки А, иначе это план снижения дохода.");
      setTone("error");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          ...settings,
          growthMode: "LINEAR",
          confirmLowerTargets: lowerTargetNames.length > 0
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      cacheGoals(await response.json());
      setMessage("Годовые цели сохранены");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить цели");
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(rowId: string, patch: Partial<AnnualGoalRow>) {
    setSavingRowId(rowId);
    setMessage("");

    try {
      const response = await fetch(`/api/goals/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updated: AnnualGoalRow = await response.json();
      updateRowLocal(rowId, updated);
      setMessage("Строка сохранена");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить строку");
      setTone("error");
    } finally {
      setSavingRowId(null);
    }
  }

  async function saveTakt(level: MonthlyTaktLevel) {
    setSavingTaktLevel(level.level);
    setMessage("");

    try {
      const response = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          taktLevels: [
            {
              level: level.level,
              description: level.description,
              amount: level.amount
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      cacheGoals(await response.json());
      setMessage("Месячный такт сохранен");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить такт");
      setTone("error");
    } finally {
      setSavingTaktLevel(null);
    }
  }

  async function saveThreeYearScenario(scenario: ThreeYearGoalScenario) {
    setSavingScenarioSpeed(scenario.speed);
    setMessage("");

    try {
      const response = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          threeYearScenarios: [
            {
              speed: scenario.speed,
              pointC: scenario.pointC,
              score: scenario.score
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      cacheGoals(await response.json());
      setMessage("План 3–2–1 сохранен");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить план 3–2–1");
      setTone("error");
    } finally {
      setSavingScenarioSpeed(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Годовые цели"
        description="План роста дохода по месяцам."
      />

      <Notice message={message} tone={tone} />

      {loading && !data ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Точка А" value="" icon={Target} loading showIcon={false} />
            <StatCard label="Факт за месяц" value="" icon={CalendarDays} loading showIcon={false} />
            <StatCard label="Разрыв" value="" icon={Sigma} loading showIcon={false} />
          </div>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <form className="card p-4 sm:p-5" onSubmit={saveSettings}>
            <div>
              <h2 className="text-lg font-semibold text-ink">Настройки плана</h2>
              <p className="mt-1 text-sm text-muted">
                Введите точку А и три цели к B10. План считается от даты
                старта, а не с января.
              </p>
            </div>

            <div className="mt-5 space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[120px_minmax(320px,1.4fr)_minmax(190px,1fr)_minmax(190px,1fr)_auto] xl:items-end">
                <div>
                  <label className="field-label" htmlFor="goalsYear">
                    Год
                  </label>
                  <input
                    id="goalsYear"
                    className="field mt-1 min-h-11"
                    type="number"
                    min={2000}
                    max={2100}
                    value={year}
                    onChange={(event) => setYear(Number(event.target.value) || currentYear)}
                  />
                </div>

                <div>
                  <span className="field-label">Точка А</span>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <button
                      type="button"
                      className={settings.pointAMode === "AUTO" ? "btn-primary min-h-11 justify-center whitespace-nowrap px-3 text-sm" : "btn-secondary min-h-11 justify-center whitespace-nowrap px-3 text-sm"}
                      onClick={() => setSettings((current) => ({ ...current, pointAMode: "AUTO" }))}
                    >
                      Рассчитать автоматически
                    </button>
                    <button
                      type="button"
                      className={settings.pointAMode === "MANUAL" ? "btn-primary min-h-11 justify-center whitespace-nowrap px-3 text-sm" : "btn-secondary min-h-11 justify-center whitespace-nowrap px-3 text-sm"}
                      onClick={() => setSettings((current) => ({ ...current, pointAMode: "MANUAL" }))}
                    >
                      Ввести вручную
                    </button>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="planStartDate">
                    Дата старта плана
                  </label>
                  <input
                    id="planStartDate"
                    className="field mt-1 min-h-11"
                    type="date"
                    value={settings.planStartDate}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        planStartDate: event.target.value
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="pointA">
                    Значение точки А
                  </label>
                  <input
                    id="pointA"
                    className="field mt-1 min-h-11"
                    type="number"
                    min={0}
                    step="0.01"
                    value={numberInputValue(
                      settings.pointAMode === "AUTO" ? data.autoPointA : settings.pointA
                    )}
                    disabled={settings.pointAMode === "AUTO"}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        pointA: parseMoneyInput(event.target.value)
                      }))
                    }
                  />
                </div>

                <div className="flex md:col-span-2 xl:col-span-1 xl:justify-end">
                  <button type="submit" className="btn-primary min-h-11 w-full justify-center whitespace-nowrap xl:w-auto" disabled={saving}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {saving ? "Сохраняем" : "Сохранить"}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="field-label" htmlFor="c1Target">
                    Цель C1 к B10
                  </label>
                  <input
                    id="c1Target"
                    className="field mt-1 min-h-11"
                    type="number"
                    min={0}
                    step="0.01"
                    value={numberInputValue(settings.c1Target)}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        c1Target: parseMoneyInput(event.target.value)
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="c2Target">
                    Цель C2 к B10
                  </label>
                  <input
                    id="c2Target"
                    className="field mt-1 min-h-11"
                    type="number"
                    min={0}
                    step="0.01"
                    value={numberInputValue(settings.c2Target)}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        c2Target: parseMoneyInput(event.target.value)
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="c3Target">
                    Цель C3 к B10
                  </label>
                  <input
                    id="c3Target"
                    className="field mt-1 min-h-11"
                    type="number"
                    min={0}
                    step="0.01"
                    value={numberInputValue(settings.c3Target)}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        c3Target: parseMoneyInput(event.target.value)
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            {lowerTargetNames.length > 0 ? (
              <p className="mt-4 text-sm text-warning">
                Цель должна быть выше точки А, иначе это план снижения дохода.
                {" "}Проверьте: {lowerTargetNames.join(", ")}.
              </p>
            ) : null}
          </form>

          {loading ? <p className="text-sm text-muted">Обновляем данные…</p> : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard
              label="Точка А"
              value={formatCurrencyInline(data.plan.pointA)}
              icon={Target}
              description="в месяц"
              showIcon={false}
              valueNoWrap
              valueSize="compact"
            />
            <StatCard
              label="Факт"
              value={formatCurrencyInline(selectedActual)}
              icon={CalendarDays}
              description={selectedRowLabel}
              tone={selectedActual >= selectedC1 && selectedC1 > 0 ? "income" : "neutral"}
              showIcon={false}
              valueNoWrap
              valueSize="compact"
            />
            <StatCard label="План C1" value={formatCurrencyInline(selectedC1)} icon={TrendingUp} description={selectedRow?.rowKey ?? "—"} showIcon={false} valueNoWrap valueSize="compact" />
            <StatCard label="План C2" value={formatCurrencyInline(selectedC2)} icon={TrendingUp} description={selectedRow?.rowKey ?? "—"} showIcon={false} valueNoWrap valueSize="compact" />
            <StatCard label="План C3" value={formatCurrencyInline(selectedC3)} icon={TrendingUp} description={selectedRow?.rowKey ?? "—"} showIcon={false} valueNoWrap valueSize="compact" />
            <StatCard
              label="Разрыв до C2"
              value={formatCurrencyInline(gapToC2)}
              icon={Sigma}
              description={selectedRowLabel}
              tone={gapToC2 === 0 ? "income" : "expense"}
              showIcon={false}
              valueNoWrap
              valueSize="compact"
            />
          </div>
          <p className="text-sm text-muted">
            {cycleState.isBeforeStart
              ? `Текущий статус: План еще не начался. Следующая цель: ${nextRowLabel ?? selectedRowLabel}.`
              : `Текущий уровень: ${selectedRowLabel}${nextRowLabel ? `. Следующая цель: ${nextRowLabel}.` : "."}`}
          </p>

          <section className="card p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink">Годовой план</h2>
              <p className="mt-1 text-sm text-muted">
                C1 — нормально, но можно лучше. C2 — хорошо. C3 — сверхусилие.
                B1-B10 — рост, B11-B12 — буфер и удержание уровня.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-normal text-muted">
                  <tr>
                    <th className="px-3 py-3 font-medium">Уровень</th>
                    <th className="px-3 py-3 font-medium">C1</th>
                    <th className="px-3 py-3 font-medium">C2</th>
                    <th className="px-3 py-3 font-medium">C3</th>
                    <th className="px-3 py-3 font-medium">КП</th>
                    <th className="px-3 py-3 font-medium">Факт</th>
                    <th className="px-3 py-3 font-medium">Подпись / Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const actual = factsByRowKey.get(row.rowKey) ?? 0;

                    return (
                      <tr key={row.id} className="border-b border-line/70 transition hover:bg-soft/40">
                        <td className="px-3 py-3 align-top font-medium text-ink">
                          {rowLabel(row)}
                        </td>
                        {(["c1Value", "c2Value", "c3Value"] as const).map((key, index) => {
                          const tier = index === 0 ? "c1" : index === 1 ? "c2" : "c3";
                          const value = row[key];

                          return (
                            <td key={key} className="px-3 py-3 align-top">
                              <div className="font-medium text-ink">
                                {formatCurrency(value)}
                              </div>
                              {row.rowKey !== "A" ? (
                                <div className={`mt-1 text-xs ${progressClass(actual, value, tier)}`}>
                                  {formatPercent(progressPercent(actual, value))}%
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 align-top">
                          <input
                            className="field min-h-9 py-1 text-sm"
                            value={row.kpiText ?? ""}
                            placeholder="сотрудники, продажи, конверсия"
                            onChange={(event) =>
                              updateRowLocal(row.id, { kpiText: event.target.value })
                            }
                            onBlur={() => saveRow(row.id, { kpiText: row.kpiText })}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="font-medium text-ink">
                            {row.rowKey === "A" ? "—" : formatCurrency(actual)}
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {row.rowKey === "A" ? "Старт" : monthStatus(row, actual)}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex min-w-48 flex-col gap-2">
                            <label className="inline-flex items-center gap-2 text-xs text-muted">
                              <input
                                type="checkbox"
                                checked={row.isClosed}
                                onChange={(event) => {
                                  updateRowLocal(row.id, { isClosed: event.target.checked });
                                  saveRow(row.id, { isClosed: event.target.checked });
                                }}
                              />
                              Месяц закрыт
                            </label>
                            <input
                              className="field min-h-9 py-1 text-sm"
                              value={row.signatureText ?? ""}
                              placeholder="подпись"
                              onChange={(event) =>
                                updateRowLocal(row.id, { signatureText: event.target.value })
                              }
                              onBlur={() =>
                                saveRow(row.id, { signatureText: row.signatureText })
                              }
                            />
                            {savingRowId === row.id ? (
                              <span className="text-xs text-muted">Сохраняем…</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink">План 3–2–1</h2>
              <p className="mt-1 text-sm text-muted">
                Долгосрочные сценарии дохода на 1, 2 и 3 года. Это цели, не факт дохода.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-normal text-muted">
                  <tr>
                    <th className="px-3 py-3 font-medium">
                      <div>Точка C</div>
                      <div className="mt-1 normal-case text-muted/80">в месяц через год</div>
                    </th>
                    <th className="px-3 py-3 font-medium">
                      <div>Точка D</div>
                      <div className="mt-1 normal-case text-muted/80">в месяц через 2 года</div>
                    </th>
                    <th className="px-3 py-3 font-medium">
                      <div>Точка E</div>
                      <div className="mt-1 normal-case text-muted/80">в месяц через 3 года</div>
                    </th>
                    <th className="px-3 py-3 font-medium">Скорость роста</th>
                    <th className="px-3 py-3 font-medium">Оценка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.threeYearScenarios.map((scenario) => (
                    <tr
                      key={scenario.id}
                      className="border-b border-line/70 transition hover:bg-soft/40"
                    >
                      <td className="px-3 py-3 align-top">
                        <input
                          className="field min-h-9 py-1 text-sm"
                          type="number"
                          min={0}
                          step="0.01"
                          value={numberInputValue(scenario.pointC)}
                          onChange={(event) =>
                            updateScenarioLocal(scenario.speed, {
                              pointC: parseMoneyInput(event.target.value)
                            })
                          }
                          onBlur={() => saveThreeYearScenario(scenario)}
                        />
                      </td>
                      <td className="px-3 py-3 align-top font-medium text-ink">
                        {formatCurrency(scenario.pointD)}
                      </td>
                      <td className="px-3 py-3 align-top font-medium text-ink">
                        {formatCurrency(scenario.pointE)}
                      </td>
                      <td className="px-3 py-3 align-top text-ink">
                        ×{formatPercent(scenario.speed)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex max-w-36 flex-col gap-1">
                          <input
                            className="field min-h-9 py-1 text-sm"
                            type="number"
                            min={0}
                            max={10}
                            step={1}
                            value={scenario.score}
                            onChange={(event) =>
                              updateScenarioLocal(scenario.speed, {
                                score: Math.max(
                                  0,
                                  Math.min(10, Number(event.target.value) || 0)
                                )
                              })
                            }
                            onBlur={() => saveThreeYearScenario(scenario)}
                          />
                          {savingScenarioSpeed === scenario.speed ? (
                            <span className="text-xs text-muted">Сохраняем…</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink">Месячный такт</h2>
              <p className="mt-1 text-sm text-muted">
                Информационная шкала усилий от 0 до 10 для калибровки целей.
              </p>
            </div>

            <div className="grid gap-3">
              {data.taktLevels.map((level) => (
                <div
                  key={level.level}
                  className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-[80px_1fr_220px]"
                >
                  <div className="flex items-center gap-2 text-ink">
                    <Gauge className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="font-semibold">{level.level}</span>
                  </div>
                  <input
                    className="field"
                    value={level.description}
                    onChange={(event) =>
                      updateTaktLocal(level.level, { description: event.target.value })
                    }
                    onBlur={() => saveTakt(level)}
                  />
                  <div>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      step="0.01"
                      value={numberInputValue(level.amount)}
                      onChange={(event) =>
                        updateTaktLocal(level.level, {
                          amount: parseMoneyInput(event.target.value)
                        })
                      }
                      onBlur={() => saveTakt(level)}
                    />
                    {savingTaktLevel === level.level ? (
                      <div className="mt-1 text-xs text-muted">Сохраняем…</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
