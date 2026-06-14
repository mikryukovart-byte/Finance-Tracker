"use client";

import {
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  Scale,
  WalletCards
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import {
  buildQuery,
  fetchJsonCached,
  readClientCache,
  readErrorMessage,
  setClientCache
} from "@/lib/client-api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { buildPeriodQuery, createPeriodState, describePeriod } from "@/lib/period";
import { parseSettings, storageKey } from "@/lib/settings";
import type { TruthResponse } from "@/types/finance";

const initialTruthPeriod = createPeriodState("month");

function truthQuery(period: typeof initialTruthPeriod, threshold = 1000) {
  return buildQuery({
    leakageThreshold: String(threshold),
    ...buildPeriodQuery(period)
  });
}

function truthCacheKey(period: typeof initialTruthPeriod, threshold = 1000) {
  return `truth:${truthQuery(period, threshold)}`;
}

function readLeakageThreshold() {
  if (typeof window === "undefined") {
    return 1000;
  }

  const settings = parseSettings(window.localStorage.getItem(storageKey));
  return Number(settings.leakageThreshold) || 1000;
}

function numberInputValue(value: number | null | undefined) {
  return Number.isFinite(value) ? String(value) : "";
}

function formatOptionalCurrency(value: number | null) {
  return value === null ? "Недостаточно данных" : formatCurrency(value).replace(/\s/g, "\u00A0");
}

export function TruthClient() {
  const [data, setData] = useState<TruthResponse | null>(() =>
    readClientCache<TruthResponse>(truthCacheKey(initialTruthPeriod))
  );
  const [period, setPeriod] = useState(() => initialTruthPeriod);
  const [loading, setLoading] = useState(() => !data);
  const [error, setError] = useState("");
  const [crisisMessage, setCrisisMessage] = useState("");
  const [savingCrisis, setSavingCrisis] = useState(false);
  const [crisisForm, setCrisisForm] = useState({
    acuteReliefTarget: "",
    normalWorkTarget: "",
    requiredDailyExpense: ""
  });

  useEffect(() => {
    async function loadTruth() {
      setError("");
      const threshold = readLeakageThreshold();
      const key = truthCacheKey(period, threshold);
      const cached = readClientCache<TruthResponse>(key);

      if (cached) {
        setData(cached);
      }

      setLoading(!cached);

      try {
        setData(
          await fetchJsonCached<TruthResponse>(
            key,
            `/api/truth${truthQuery(period, threshold)}`,
            { ttlMs: 12_000 }
          )
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      } finally {
        setLoading(false);
      }
    }

    loadTruth();
  }, [period]);

  useEffect(() => {
    if (!data?.crisis) {
      return;
    }

    setCrisisForm({
      acuteReliefTarget: numberInputValue(data.crisis.settings.acuteReliefTarget),
      normalWorkTarget: numberInputValue(data.crisis.settings.normalWorkTarget),
      requiredDailyExpense: numberInputValue(data.crisis.settings.requiredDailyExpense)
    });
  }, [data?.crisis]);

  async function saveCrisisSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCrisisMessage("");
    setSavingCrisis(true);

    try {
      const response = await fetch("/api/crisis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acuteReliefTarget: crisisForm.acuteReliefTarget,
          normalWorkTarget: crisisForm.normalWorkTarget,
          requiredDailyExpense: crisisForm.requiredDailyExpense || null
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const crisis = await response.json();
      setData((current) => {
        if (!current) {
          return current;
        }

        const next = { ...current, crisis };
        const threshold = readLeakageThreshold();
        setClientCache(truthCacheKey(period, threshold), next, 12_000);
        return next;
      });
      setCrisisMessage("Антикризисные настройки сохранены");
    } catch (err) {
      setCrisisMessage(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    } finally {
      setSavingCrisis(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Правда"
        description={`Контроль денег, долгов и утечек за период: ${describePeriod(period)}.`}
      />

      <PeriodFilter value={period} onChange={setPeriod} />

      <Notice message={error} tone="error" />

      {loading && data ? <p className="mb-3 text-sm text-muted">Обновляем данные…</p> : null}

      {loading && !data ? (
        <>
          <p className="mb-3 text-sm text-muted">Загрузка...</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Деньги на счетах" value="" icon={WalletCards} loading />
            <StatCard label="Доход за период" value="" icon={CircleDollarSign} loading />
            <StatCard label="Расходы за период" value="" icon={CalendarDays} loading />
            <StatCard label="Общий долг" value="" icon={Landmark} loading />
            <StatCard label="Чистая позиция" value="" icon={Scale} loading />
            <StatCard label="До выхода в ноль" value="" icon={Scale} loading />
          </div>
        </>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Деньги на счетах"
              value={formatCurrency(data.assetBalance)}
              icon={WalletCards}
              tone={data.assetBalance >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="Доход за период"
              value={formatCurrency(data.monthlyIncome)}
              icon={CircleDollarSign}
              tone="income"
            />
            <StatCard
              label="Расходы за период"
              value={formatCurrency(data.monthlyExpense)}
              icon={CalendarDays}
              tone="expense"
            />
            <StatCard
              label="Общий долг"
              value={formatCurrency(data.totalDebt)}
              icon={Landmark}
              tone="expense"
            />
            <StatCard
              label="Чистая позиция"
              value={formatCurrency(data.netPosition)}
              icon={Scale}
              tone={data.netPosition >= 0 ? "income" : "expense"}
            />
            <StatCard
              label="До выхода в ноль"
              value={formatCurrency(data.toZero)}
              icon={Scale}
              tone="neutral"
            />
            <StatCard
              label="До выхода в плюс"
              value={formatCurrency(data.toPositive)}
              icon={Scale}
              tone="neutral"
            />
          </div>

          <section className="card p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Антикризисный контроль</h2>
                <p className="mt-1 text-sm text-muted">
                  Реальные деньги, долги и минимальный запас без учета кредитных лимитов.
                </p>
              </div>
              {data.crisis.isCritical || data.crisis.creditCardOverLimit ? (
                <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
                  Антикризисный режим
                </div>
              ) : null}
            </div>

            {data.crisis.warnings.length > 0 ? (
              <div className="mb-4 grid gap-2">
                {data.crisis.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="rounded-md border border-line bg-soft/40 px-3 py-2 text-sm text-ink"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label="Деньги сейчас" value={formatCurrency(data.crisis.realMoney)} icon={WalletCards} tone={data.crisis.realMoney >= 0 ? "income" : "expense"} showIcon={false} valueNoWrap valueSize="compact" />
              <StatCard label="Долги всего" value={formatCurrency(data.crisis.totalDebt)} icon={Landmark} tone="expense" showIcon={false} valueNoWrap valueSize="compact" />
              <StatCard label="Платежи в месяц" value={formatCurrency(data.crisis.monthlyRequiredPayments)} icon={CalendarDays} showIcon={false} valueNoWrap valueSize="compact" />
              <StatCard
                label="Проценты / утечки"
                value={
                  data.crisis.interestLeakage === null
                    ? "Данные неполные"
                    : formatCurrency(data.crisis.interestLeakage)
                }
                icon={AlertTriangle}
                tone={data.crisis.interestLeakage ? "expense" : "neutral"}
                showIcon={false}
                valueNoWrap={data.crisis.interestLeakage !== null}
                valueSize="compact"
              />
              <StatCard label="Обязательные расходы на 7 дней" value={formatOptionalCurrency(data.crisis.requiredExpenses7Days)} icon={Scale} showIcon={false} valueNoWrap={data.crisis.requiredExpenses7Days !== null} valueSize="compact" />
              <StatCard label="Обязательные расходы на 30 дней" value={formatOptionalCurrency(data.crisis.requiredExpenses30Days)} icon={Scale} showIcon={false} valueNoWrap={data.crisis.requiredExpenses30Days !== null} valueSize="compact" />
              <StatCard
                label="Дней до нуля"
                value={
                  data.crisis.daysUntilZero === null
                    ? "Недостаточно данных"
                    : `${formatPercent(Math.max(0, data.crisis.daysUntilZero))} дн.`
                }
                icon={Scale}
                tone={data.crisis.isCritical ? "expense" : "neutral"}
                showIcon={false}
                valueNoWrap
                valueSize="compact"
              />
              <StatCard label="Сумма для снятия острой тревоги" value={formatCurrency(data.crisis.acuteReliefTarget)} icon={CircleDollarSign} showIcon={false} valueNoWrap valueSize="compact" />
              <StatCard label="Сумма для нормальной работы" value={formatCurrency(data.crisis.normalWorkTarget)} icon={CircleDollarSign} showIcon={false} valueNoWrap valueSize="compact" />
            </div>

            <form className="mt-5 grid gap-4 md:grid-cols-4" onSubmit={saveCrisisSettings}>
              <div>
                <label className="field-label" htmlFor="requiredDailyExpense">
                  Обязательные расходы в день
                </label>
                <input
                  id="requiredDailyExpense"
                  className="field mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={crisisForm.requiredDailyExpense}
                  placeholder="авто по расходам"
                  onChange={(event) =>
                    setCrisisForm((current) => ({
                      ...current,
                      requiredDailyExpense: event.target.value
                    }))
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="acuteReliefTarget">
                  Снять острую тревогу
                </label>
                <input
                  id="acuteReliefTarget"
                  className="field mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={crisisForm.acuteReliefTarget}
                  placeholder="14 дней + платежи"
                  onChange={(event) =>
                    setCrisisForm((current) => ({
                      ...current,
                      acuteReliefTarget: event.target.value
                    }))
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="normalWorkTarget">
                  Нормальная работа
                </label>
                <input
                  id="normalWorkTarget"
                  className="field mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={crisisForm.normalWorkTarget}
                  placeholder="30 дней + платежи"
                  onChange={(event) =>
                    setCrisisForm((current) => ({
                      ...current,
                      normalWorkTarget: event.target.value
                    }))
                  }
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="btn-secondary min-h-11 w-full justify-center" disabled={savingCrisis}>
                  {savingCrisis ? "Сохраняем" : "Сохранить"}
                </button>
              </div>
              {crisisMessage ? (
                <div className="text-sm text-muted md:col-span-4">{crisisMessage}</div>
              ) : null}
            </form>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Контроль дня</h2>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-muted">Операции сегодня</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.hasTransactionsToday ? "Да" : "Нет"}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Расходы сегодня</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.dailyControl.todaySpending)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Расходы периода</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.dailyControl.monthSpending)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Дней подряд</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.transactionStreakDays}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-muted">Последняя операция</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.dailyControl.lastTransactionDate
                      ? formatDate(data.dailyControl.lastTransactionDate)
                      : "Нет операций"}
                  </div>
                </div>
              </div>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Расчет до конца месяца</h2>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-muted">Доступно сейчас</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.survival.availableBalance)}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Дней осталось</div>
                  <div className="mt-1 font-medium text-ink">
                    {data.survival.daysLeftInMonth}
                  </div>
                </div>
                <div>
                  <div className="text-muted">Лимит в день</div>
                  <div className="mt-1 font-medium text-ink">
                    {formatCurrency(data.survival.safeDailyLimit)}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="card p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Утечки денег</h2>
                <p className="mt-1 text-sm text-muted">
                  Расходы меньше {formatCurrency(data.leakage.threshold)} за текущий месяц
                </p>
              </div>
              <div className="rounded-md border border-line px-3 py-2 text-sm text-ink">
                {formatCurrency(data.leakage.totalSmallExpenses)} ·{" "}
                {formatPercent(data.leakage.percentOfMonthlyIncome)}% дохода
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <h3 className="text-sm font-medium text-ink">Категории</h3>
                <div className="mt-3 space-y-2">
                  {data.leakage.topCategories.length === 0 ? (
                    <EmptyState text="Мелких расходов нет" />
                  ) : (
                    data.leakage.topCategories.map((category) => (
                      <div
                        key={category.categoryId}
                        className="rounded-md border border-line p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-ink">{category.name}</span>
                          <span className="text-muted">{category.count}</span>
                        </div>
                        <div className="mt-1 text-muted">{formatCurrency(category.amount)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                <h3 className="text-sm font-medium text-ink">Повторяющиеся мелкие расходы</h3>
                <div className="mt-3 space-y-2">
                  {data.leakage.repeatedExpenses.length === 0 ? (
                    <EmptyState text="Повторов нет" />
                  ) : (
                    data.leakage.repeatedExpenses.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-md border border-line p-3 text-sm"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">
                              {item.description}
                            </div>
                            <div className="text-muted">{item.categoryName}</div>
                          </div>
                          <div className="text-ink">
                            {formatCurrency(item.total)} · {item.count} раз
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-ink">Долги</h2>
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-muted">Остаток долга</div>
                <div className="mt-1 font-medium text-ink">
                  {formatCurrency(data.debtSummary.totalDebt)}
                </div>
              </div>
              <div>
                <div className="text-muted">Платежи в месяц</div>
                <div className="mt-1 font-medium text-ink">
                  {formatCurrency(data.debtSummary.paymentsThisMonth)}
                </div>
              </div>
              <div>
                <div className="text-muted">Погашено</div>
                <div className="mt-1 font-medium text-ink">
                  {formatPercent(data.debtSummary.paidPercent ?? 0)}%
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
