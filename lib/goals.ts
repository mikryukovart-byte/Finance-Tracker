import { Prisma } from "@prisma/client";

import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek
} from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import type { WeeklyTakt } from "@/types/finance";

export const goalRowKeys = [
  "A",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
  "B8",
  "B9",
  "B10",
  "B11",
  "B12"
] as const;

export type GoalRowKey = (typeof goalRowKeys)[number];

export const defaultTaktLevels = [
  { level: 10, description: "Умру и не сделаю" },
  { level: 9, description: "Умру, но сделаю" },
  { level: 8, description: "Сделаю и выиграю" },
  { level: 7, description: "Сложно, но можно" },
  { level: 6, description: "Если поработаю, то 100%" },
  { level: 5, description: "Сделаю комфортно" },
  { level: 4, description: "Работа 2 дня в неделю" },
  { level: 3, description: "Работа 1 день в неделю" },
  { level: 2, description: "Минимум усилий" },
  { level: 1, description: "Почти ничего не делаю" },
  { level: 0, description: "Ничего не делаю" }
];

export const defaultThreeYearScenarios = [
  { speed: 1.5, score: 5 },
  { speed: 2, score: 6 },
  { speed: 3, score: 8 },
  { speed: 4, score: 9 }
];

const goalPlanSelect = {
  id: true,
  userId: true,
  year: true,
  pointA: true,
  pointAMode: true,
  planStartDate: true,
  c1Target: true,
  c2Target: true,
  c3Target: true,
  growthMode: true,
  createdAt: true,
  updatedAt: true,
  rows: {
    select: {
      id: true,
      planId: true,
      rowKey: true,
      month: true,
      c1Value: true,
      c2Value: true,
      c3Value: true,
      kpiText: true,
      signatureText: true,
      isClosed: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: [{ month: "asc" }, { rowKey: "asc" }]
  }
} satisfies Prisma.AnnualGoalPlanSelect;

type SelectedGoalPlan = Prisma.AnnualGoalPlanGetPayload<{
  select: typeof goalPlanSelect;
}>;

export type GoalsTimingLabel = "parallelData";

export type GoalsPayloadOptions = {
  onTiming?: (label: GoalsTimingLabel, ms: number) => void;
  weekStartDate?: Date;
};

type SelectedGoalRow = SelectedGoalPlan["rows"][number];
type SelectedTaktLevel = Prisma.MonthlyTaktLevelGetPayload<{}>;
type SelectedThreeYearScenario = Prisma.ThreeYearGoalScenarioGetPayload<{}>;
type HydratedGoalRow = SelectedGoalRow & {
  calendarMonth?: number;
  calendarYear?: number;
  periodStart?: Date;
  periodEnd?: Date;
  isReserve?: boolean;
};

type JsonGoalRow = Omit<SelectedGoalRow, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

type JsonGoalPlan = Omit<SelectedGoalPlan, "createdAt" | "updatedAt" | "rows"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
  rows: JsonGoalRow[] | null;
};

type JsonTaktLevel = Omit<SelectedTaktLevel, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

type JsonThreeYearScenario = Omit<SelectedThreeYearScenario, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

type GoalsSnapshot = {
  plan: SelectedGoalPlan | null;
  facts: AnnualCycleIncomeFact[];
  autoPointA: number;
  taktLevels: SelectedTaktLevel[];
  threeYearScenarios: SelectedThreeYearScenario[];
};

type GoalsSnapshotRow = {
  plan: JsonGoalPlan | null;
  facts: JsonAnnualCycleIncomeFact[] | null;
  autoPointA: number | string | null;
  taktLevels: JsonTaktLevel[] | null;
  threeYearScenarios: JsonThreeYearScenario[] | null;
};

type AnnualCycleIncomeFact = {
  rowKey: string;
  month: number;
  year: number;
  periodStart: Date;
  periodEnd: Date;
  actualIncome: number;
};

type JsonAnnualCycleIncomeFact = {
  rowKey: string;
  month: number | string;
  year: number | string;
  periodStart: Date | string;
  periodEnd: Date | string;
  actualIncome: number | string | null;
};

type RowAssignment = {
  calendarMonth: number;
  calendarYear: number;
  periodStart: Date;
  periodEnd: Date;
  isReserve: boolean;
};

function markTiming(options: GoalsPayloadOptions | undefined, label: GoalsTimingLabel, startedAt: number) {
  options?.onTiming?.(label, Date.now() - startedAt);
}

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function dateOnlyParts(value: Date | string) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
      };
    }
  }

  const date = asDate(value);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function localDateOnlyParts(value: Date) {
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate()
  };
}

function partsToUtcNoon(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

export function dateOnlyString(value: Date | string) {
  const parts = dateOnlyParts(value);
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

export function dateOnlyToUtcNoon(value: Date | string) {
  return partsToUtcNoon(dateOnlyParts(value));
}

function todayToUtcNoon(value = new Date()) {
  return partsToUtcNoon(localDateOnlyParts(value));
}

function dateOnlyToLocalStart(value: Date | string) {
  const parts = dateOnlyParts(value);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function normalizeGoalYear(value: string | number | null | undefined) {
  const parsed = Number(value);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return currentYear;
  }

  return parsed;
}

export function yearBounds(year: number) {
  return {
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1)
  };
}

function last12MonthsBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

export async function getAutoPointA(userId: string) {
  const { start, end } = last12MonthsBounds();
  const result = await prisma.transaction.aggregate({
    where: {
      userId,
      type: "INCOME",
      date: {
        gte: start,
        lt: end
      }
    },
    _sum: {
      amount: true
    }
  });

  return (result._sum.amount ?? 0) / 12;
}

export async function getAnnualIncomeFacts(userId: string, year: number) {
  const { start, end } = yearBounds(year);
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    actualIncome: 0
  }));

  const rows = await prisma.$queryRaw<
    Array<{ month: number | string | bigint; total: number | string | null }>
  >`
    SELECT EXTRACT(MONTH FROM "date")::int AS month,
           COALESCE(SUM("amount"), 0)::float AS total
    FROM "Transaction"
    WHERE "userId" = ${userId}
      AND "type" = 'INCOME'
      AND "date" >= ${start}
      AND "date" < ${end}
    GROUP BY 1
  `;

  for (const row of rows) {
    const monthIndex = Number(row.month) - 1;

    if (monthIndex >= 0 && monthIndex < months.length) {
      months[monthIndex].actualIncome = Number(row.total ?? 0);
    }
  }

  return months;
}

function normalizeCycleFacts(facts: JsonAnnualCycleIncomeFact[] | null) {
  return (facts ?? []).map((fact) => ({
    rowKey: fact.rowKey,
    month: Number(fact.month),
    year: Number(fact.year),
    periodStart: asDate(fact.periodStart),
    periodEnd: asDate(fact.periodEnd),
    actualIncome: Number(fact.actualIncome ?? 0)
  }));
}

function normalizeGoalRow(row: JsonGoalRow): SelectedGoalRow {
  return {
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt)
  };
}

function normalizeGoalPlan(plan: JsonGoalPlan | null): SelectedGoalPlan | null {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    createdAt: asDate(plan.createdAt),
    updatedAt: asDate(plan.updatedAt),
    rows: (plan.rows ?? []).map(normalizeGoalRow)
  };
}

function normalizeTaktLevel(level: JsonTaktLevel): SelectedTaktLevel {
  return {
    ...level,
    createdAt: asDate(level.createdAt),
    updatedAt: asDate(level.updatedAt)
  };
}

function normalizeThreeYearScenario(scenario: JsonThreeYearScenario): SelectedThreeYearScenario {
  return {
    ...scenario,
    createdAt: asDate(scenario.createdAt),
    updatedAt: asDate(scenario.updatedAt)
  };
}

async function loadGoalsSnapshot(userId: string, year: number): Promise<GoalsSnapshot> {
  const { start: pointAStart, end: pointAEnd } = last12MonthsBounds();
  const [snapshot] = await prisma.$queryRaw<GoalsSnapshotRow[]>`
    WITH selected_plan AS (
      SELECT *
      FROM "AnnualGoalPlan"
      WHERE "userId" = ${userId}
        AND "year" = ${year}
      LIMIT 1
    )
    SELECT
      (
        SELECT jsonb_build_object(
          'id', p."id",
          'userId', p."userId",
          'year', p."year",
          'pointA', p."pointA",
          'pointAMode', p."pointAMode",
          'planStartDate', p."planStartDate",
          'c1Target', p."c1Target",
          'c2Target', p."c2Target",
          'c3Target', p."c3Target",
          'growthMode', p."growthMode",
          'createdAt', p."createdAt",
          'updatedAt', p."updatedAt",
          'rows', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', r."id",
                  'planId', r."planId",
                  'rowKey', r."rowKey",
                  'month', r."month",
                  'c1Value', r."c1Value",
                  'c2Value', r."c2Value",
                  'c3Value', r."c3Value",
                  'kpiText', r."kpiText",
                  'signatureText', r."signatureText",
                  'isClosed', r."isClosed",
                  'createdAt', r."createdAt",
                  'updatedAt', r."updatedAt"
                )
                ORDER BY CASE r."rowKey"
                  WHEN 'A' THEN 0
                  WHEN 'B1' THEN 1
                  WHEN 'B2' THEN 2
                  WHEN 'B3' THEN 3
                  WHEN 'B4' THEN 4
                  WHEN 'B5' THEN 5
                  WHEN 'B6' THEN 6
                  WHEN 'B7' THEN 7
                  WHEN 'B8' THEN 8
                  WHEN 'B9' THEN 9
                  WHEN 'B10' THEN 10
                  WHEN 'B11' THEN 11
                  WHEN 'B12' THEN 12
                  ELSE 99
                END
              )
              FROM "AnnualGoalRow" r
              WHERE r."planId" = p."id"
            ),
            '[]'::jsonb
          )
        )
        FROM selected_plan p
      ) AS "plan",
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'rowKey', facts."rowKey",
              'month', facts."month",
              'year', facts."year",
              'periodStart', facts."periodStart",
              'periodEnd', facts."periodEnd",
              'actualIncome', facts."actualIncome"
            )
            ORDER BY facts."periodStart"
          ),
          '[]'::jsonb
        )
        FROM (
          WITH cycle_months AS (
            SELECT
              CASE steps."step"
                WHEN 0 THEN 'A'
                ELSE 'B' || steps."step"::text
              END AS "rowKey",
              (
                date_trunc('month', p."planStartDate")
                + steps."step" * INTERVAL '1 month'
              )::timestamp AS "periodStart",
              (
                date_trunc('month', p."planStartDate")
                + (steps."step" + 1) * INTERVAL '1 month'
              )::timestamp AS "periodEnd"
            FROM selected_plan p
            CROSS JOIN generate_series(0, 12) AS steps("step")
          ),
          cycle_income AS (
            SELECT
              date_trunc('month', "date")::timestamp AS "periodStart",
              COALESCE(SUM("amount"), 0)::float AS "total"
            FROM "Transaction"
            WHERE "userId" = ${userId}
              AND "type" = 'INCOME'
              AND "date" >= (
                SELECT MIN("periodStart") FROM cycle_months
              )
              AND "date" < (
                SELECT MAX("periodEnd") FROM cycle_months
              )
            GROUP BY 1
          )
          SELECT
            cycle_months."rowKey",
            EXTRACT(MONTH FROM cycle_months."periodStart")::int AS "month",
            EXTRACT(YEAR FROM cycle_months."periodStart")::int AS "year",
            cycle_months."periodStart",
            cycle_months."periodEnd",
            COALESCE(cycle_income."total", 0)::float AS "actualIncome"
          FROM cycle_months
          LEFT JOIN cycle_income
            ON cycle_income."periodStart" = cycle_months."periodStart"
        ) facts
      ) AS "facts",
      (
        SELECT COALESCE(SUM("amount"), 0)::float / 12
        FROM "Transaction"
        WHERE "userId" = ${userId}
          AND "type" = 'INCOME'
          AND "date" >= ${pointAStart}
          AND "date" < ${pointAEnd}
      ) AS "autoPointA",
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', t."id",
              'userId', t."userId",
              'year', t."year",
              'level', t."level",
              'description', t."description",
              'amount', t."amount",
              'createdAt', t."createdAt",
              'updatedAt', t."updatedAt"
            )
            ORDER BY t."level" DESC
          ),
          '[]'::jsonb
        )
        FROM "MonthlyTaktLevel" t
        WHERE t."userId" = ${userId}
          AND t."year" = ${year}
      ) AS "taktLevels",
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', s."id",
              'userId', s."userId",
              'year', s."year",
              'speed', s."speed",
              'pointC', s."pointC",
              'score', s."score",
              'createdAt', s."createdAt",
              'updatedAt', s."updatedAt"
            )
            ORDER BY s."speed" ASC
          ),
          '[]'::jsonb
        )
        FROM "ThreeYearGoalScenario" s
        WHERE s."userId" = ${userId}
          AND s."year" = ${year}
      ) AS "threeYearScenarios"
  `;

  return {
    plan: normalizeGoalPlan(snapshot?.plan ?? null),
    facts: normalizeCycleFacts(snapshot?.facts ?? null),
    autoPointA: Number(snapshot?.autoPointA ?? 0),
    taktLevels: (snapshot?.taktLevels ?? []).map(normalizeTaktLevel),
    threeYearScenarios: (snapshot?.threeYearScenarios ?? []).map(
      normalizeThreeYearScenario
    )
  };
}

export function calculateGoalRowValues({
  rowKey,
  pointA,
  c1Target,
  c2Target,
  c3Target
}: {
  rowKey: GoalRowKey;
  pointA: number;
  c1Target: number;
  c2Target: number;
  c3Target: number;
}) {
  if (rowKey === "A") {
    return {
      c1Value: pointA,
      c2Value: pointA,
      c3Value: pointA
    };
  }

  const month = Number(rowKey.replace("B", ""));
  const activeStep = Math.min(month, 10);

  return {
    c1Value: pointA + ((c1Target - pointA) / 10) * activeStep,
    c2Value: pointA + ((c2Target - pointA) / 10) * activeStep,
    c3Value: pointA + ((c3Target - pointA) / 10) * activeStep
  };
}

function rowMonth(rowKey: GoalRowKey) {
  return rowKey === "A" ? null : Number(rowKey.replace("B", ""));
}

function rowCycleStep(rowKey: GoalRowKey) {
  return rowKey === "A" ? 0 : Number(rowKey.replace("B", ""));
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12, 0, 0));
}

function rowAssignment(planStartDate: Date, rowKey: GoalRowKey): RowAssignment {
  const step = rowCycleStep(rowKey);
  const periodStart = addMonths(monthStart(planStartDate), step);
  const periodEnd = addMonths(periodStart, 1);

  return {
    calendarMonth: periodStart.getUTCMonth() + 1,
    calendarYear: periodStart.getUTCFullYear(),
    periodStart,
    periodEnd,
    isReserve: step > 10
  };
}

function rowLabel(row: HydratedGoalRow) {
  if (!row.calendarMonth || !row.calendarYear) {
    return row.rowKey;
  }

  return `${row.rowKey} · ${String(row.calendarMonth).padStart(2, "0")}.${row.calendarYear}`;
}

function localMonthRange(row: HydratedGoalRow) {
  const calendarMonth = row.calendarMonth ?? 1;
  const calendarYear = row.calendarYear ?? new Date().getFullYear();
  const start = new Date(calendarYear, calendarMonth - 1, 1);

  return {
    start,
    end: new Date(calendarYear, calendarMonth, 1)
  };
}

function minDate(first: Date, second: Date) {
  return first.getTime() <= second.getTime() ? first : second;
}

function maxDate(first: Date, second: Date) {
  return first.getTime() >= second.getTime() ? first : second;
}

function currentCycleState(
  rows: HydratedGoalRow[],
  planStartDateValue: Date | string,
  now = new Date()
) {
  const rowsWithDates = rows.filter((row) => row.calendarMonth && row.calendarYear);

  if (!rowsWithDates.length) {
    return {
      status: "ACTIVE" as const,
      row: rows[0] ?? null,
      nextRow: rows[1] ?? null
    };
  }

  const today = todayToUtcNoon(now);
  const planStartDate = dateOnlyToUtcNoon(planStartDateValue);
  const first = rowsWithDates[0];

  if (today.getTime() < planStartDate.getTime()) {
    return {
      status: "NOT_STARTED" as const,
      row: null,
      nextRow: first
    };
  }

  const startMonthKey = planStartDate.getUTCFullYear() * 12 + planStartDate.getUTCMonth();
  const currentMonthKey = today.getUTCFullYear() * 12 + today.getUTCMonth();
  const offset = Math.max(0, currentMonthKey - startMonthKey);
  const activeRowKey = offset === 0 ? "A" : `B${Math.min(offset, 12)}`;
  const row =
    rowsWithDates.find((item) => item.rowKey === activeRowKey) ??
    rowsWithDates[rowsWithDates.length - 1] ??
    null;
  const rowIndex = row ? rowsWithDates.findIndex((item) => item.id === row.id) : -1;

  return {
    status: offset > 12 ? ("FINISHED" as const) : ("ACTIVE" as const),
    row,
    nextRow: rowIndex >= 0 ? rowsWithDates[rowIndex + 1] ?? null : null
  };
}

async function getWeeklyIncomeFacts(
  userId: string,
  ranges: {
    weekStart: Date;
    weekEnd: Date;
    monthStart: Date;
    monthEnd: Date;
  }
) {
  const { weekStart, weekEnd, monthStart, monthEnd } = ranges;
  const [result] = await prisma.$queryRaw<
    Array<{ "weeklyIncome": number | string | null; "monthlyIncome": number | string | null }>
  >`
    SELECT
      COALESCE(SUM("amount") FILTER (
        WHERE "date" >= ${weekStart} AND "date" < ${weekEnd}
      ), 0)::float AS "weeklyIncome",
      COALESCE(SUM("amount") FILTER (
        WHERE "date" >= ${monthStart} AND "date" < ${monthEnd}
      ), 0)::float AS "monthlyIncome"
    FROM "Transaction"
    WHERE "userId" = ${userId}
      AND "type" = 'INCOME'
      AND "date" >= ${minDate(weekStart, monthStart)}
      AND "date" < ${maxDate(weekEnd, monthEnd)}
  `;

  return {
    weeklyIncome: Number(result?.weeklyIncome ?? 0),
    monthlyIncome: Number(result?.monthlyIncome ?? 0),
    weekStart,
    weekEnd,
    monthStart,
    monthEnd
  };
}

async function buildWeeklyTakt(
  userId: string,
  plan: SelectedGoalPlan,
  selectedWeekStart?: Date
): Promise<WeeklyTakt> {
  const now = selectedWeekStart ?? new Date();
  const cycle = currentCycleState(plan.rows as HydratedGoalRow[], plan.planStartDate, now);
  const row = cycle.row;
  const previewRow = row ?? cycle.nextRow;
  const monthlyTarget = previewRow?.c2Value ?? 0;
  const weeklyTarget = monthlyTarget / 4;
  const dailyTarget = weeklyTarget / 5;
  const planStartDate = dateOnlyToUtcNoon(plan.planStartDate);

  if (cycle.status === "NOT_STARTED") {
    return {
      status: cycle.status,
      selectedScenario: "C2",
      rowKey: null,
      rowLabel: "—",
      nextRowKey: cycle.nextRow?.rowKey ?? null,
      nextRowLabel: cycle.nextRow ? rowLabel(cycle.nextRow) : null,
      planStartDate: planStartDate.toISOString(),
      monthlyTarget,
      weeklyTarget,
      dailyTarget,
      weeklyIncome: 0,
      monthlyIncome: 0,
      weeklyGap: 0,
      monthlyGap: 0,
      weekStartDate: "",
      weekEndDate: "",
      monthStartDate: cycle.nextRow?.periodStart?.toISOString() ?? "",
      monthEndDate: cycle.nextRow?.periodEnd
        ? new Date(cycle.nextRow.periodEnd.getTime() - 1).toISOString()
        : ""
    };
  }

  const monthRange = row ? localMonthRange(row) : { start: startOfMonth(now), end: endOfMonth(now) };
  const activePeriodStart =
    row?.rowKey === "A"
      ? maxDate(dateOnlyToLocalStart(plan.planStartDate), monthRange.start)
      : monthRange.start;
  const weekStart = maxDate(startOfWeek(now), activePeriodStart);
  const weekEnd = minDate(endOfWeek(now), monthRange.end);
  const facts =
    weekStart.getTime() < weekEnd.getTime()
      ? await getWeeklyIncomeFacts(userId, {
          weekStart,
          weekEnd,
          monthStart: monthRange.start,
          monthEnd: monthRange.end
        })
      : {
          weeklyIncome: 0,
          monthlyIncome: 0,
          weekStart,
          weekEnd,
          monthStart: monthRange.start,
          monthEnd: monthRange.end
        };

  return {
    status: cycle.status,
    selectedScenario: "C2",
    rowKey: row?.rowKey ?? null,
    rowLabel: row ? rowLabel(row) : "—",
    nextRowKey: cycle.nextRow?.rowKey ?? null,
    nextRowLabel: cycle.nextRow ? rowLabel(cycle.nextRow) : null,
    planStartDate: planStartDate.toISOString(),
    monthlyTarget,
    weeklyTarget,
    dailyTarget,
    weeklyIncome: facts.weeklyIncome,
    monthlyIncome: facts.monthlyIncome,
    weeklyGap: Math.max(0, weeklyTarget - facts.weeklyIncome),
    monthlyGap: Math.max(0, monthlyTarget - facts.monthlyIncome),
    weekStartDate: facts.weekStart.toISOString(),
    weekEndDate: new Date(facts.weekEnd.getTime() - 1).toISOString(),
    monthStartDate: facts.monthStart.toISOString(),
    monthEndDate: new Date(facts.monthEnd.getTime() - 1).toISOString()
  };
}

function isGoalRowKey(value: string): value is GoalRowKey {
  return (goalRowKeys as readonly string[]).includes(value);
}

function goalRowSortIndex(rowKey: string) {
  const index = (goalRowKeys as readonly string[]).indexOf(rowKey);
  return index === -1 ? goalRowKeys.length : index;
}

function buildGoalRowData(
  planId: string,
  values: {
    pointA: number;
    c1Target: number;
    c2Target: number;
    c3Target: number;
    growthMode: string;
  },
  keys: readonly GoalRowKey[] = goalRowKeys
) {
  const now = new Date();

  return keys.map((rowKey) => {
    const rowValues =
      values.growthMode === "LINEAR"
        ? calculateGoalRowValues({
            rowKey,
            pointA: values.pointA,
            c1Target: values.c1Target,
            c2Target: values.c2Target,
            c3Target: values.c3Target
          })
        : {
            c1Value: 0,
            c2Value: 0,
            c3Value: 0
          };

    return {
      planId,
      rowKey,
      month: rowMonth(rowKey),
      ...rowValues,
      createdAt: now,
      updatedAt: now
    };
  });
}

async function ensureGoalRowsForLoadedPlan(
  plan: SelectedGoalPlan,
  values: {
    pointA: number;
    c1Target: number;
    c2Target: number;
    c3Target: number;
    growthMode: string;
  }
) {
  const existingKeys = new Set(plan.rows.map((row) => row.rowKey));
  const missingKeys = goalRowKeys.filter((rowKey) => !existingKeys.has(rowKey));

  if (!missingKeys.length) {
    return false;
  }

  await prisma.annualGoalRow.createMany({
    data: buildGoalRowData(plan.id, values, missingKeys),
    skipDuplicates: true
  });

  return true;
}

function hydrateGoalPlan(plan: SelectedGoalPlan, autoPointA: number): SelectedGoalPlan {
  const effectivePointA = plan.pointAMode === "AUTO" ? autoPointA : plan.pointA;
  const planStartDate = dateOnlyToUtcNoon(plan.planStartDate);
  const sortedRows = [...plan.rows].sort(
    (first, second) => goalRowSortIndex(first.rowKey) - goalRowSortIndex(second.rowKey)
  );

  return {
    ...plan,
    pointA: effectivePointA,
    growthMode: "LINEAR",
    rows: sortedRows.map((row) => {
      if (!isGoalRowKey(row.rowKey)) {
        return row;
      }
      const assignment = rowAssignment(planStartDate, row.rowKey);

      return {
        ...row,
        ...assignment,
        ...calculateGoalRowValues({
          rowKey: row.rowKey,
          pointA: effectivePointA,
          c1Target: plan.c1Target,
          c2Target: plan.c2Target,
          c3Target: plan.c3Target
        })
      };
    })
  };
}

export async function syncLinearGoalRows(
  planId: string,
  values: {
    pointA: number;
    c1Target: number;
    c2Target: number;
    c3Target: number;
  }
) {
  for (const rowKey of goalRowKeys) {
    await prisma.annualGoalRow.updateMany({
      where: { planId, rowKey },
      data: calculateGoalRowValues({ rowKey, ...values })
    });
  }
}

async function createMissingTaktLevels(
  userId: string,
  year: number,
  existingLevels: Array<{ level: number }>
) {
  const existing = new Set(existingLevels.map((item) => item.level));
  const missing = defaultTaktLevels.filter((item) => !existing.has(item.level));

  if (!missing.length) {
    return false;
  }

  const now = new Date();

  await prisma.monthlyTaktLevel.createMany({
    data: missing.map((item) => ({
      userId,
      year,
      level: item.level,
      description: item.description,
      amount: 0,
      createdAt: now,
      updatedAt: now
    })),
    skipDuplicates: true
  });

  return true;
}

export async function getTaktLevels(userId: string, year: number) {
  const levels = await prisma.monthlyTaktLevel.findMany({
    where: { userId, year },
    orderBy: { level: "desc" }
  });

  const createdMissing = await createMissingTaktLevels(userId, year, levels);

  if (!createdMissing) {
    return levels;
  }

  return prisma.monthlyTaktLevel.findMany({
    where: { userId, year },
    orderBy: { level: "desc" }
  });
}

function scenarioPointCDefault(
  speed: number,
  plan: { c1Target: number; c2Target: number; c3Target: number }
) {
  if (speed === 1.5) {
    return plan.c1Target;
  }

  if (speed === 2) {
    return plan.c2Target;
  }

  if (speed === 3) {
    return plan.c3Target;
  }

  return 0;
}

function withCalculatedScenarioValues<T extends { speed: number; pointC: number }>(scenario: T) {
  const pointD = scenario.pointC * scenario.speed;
  return {
    ...scenario,
    pointD,
    pointE: pointD * scenario.speed
  };
}

async function ensureThreeYearScenarios(
  userId: string,
  year: number,
  plan: { c1Target: number; c2Target: number; c3Target: number },
  existingScenarios: Array<{ speed: number }>
) {
  const existing = new Set(existingScenarios.map((item) => item.speed));
  const missing = defaultThreeYearScenarios.filter((item) => !existing.has(item.speed));

  if (!missing.length) {
    return false;
  }

  const now = new Date();

  await prisma.threeYearGoalScenario.createMany({
    data: missing.map((item) => ({
      userId,
      year,
      speed: item.speed,
      pointC: scenarioPointCDefault(item.speed, plan),
      score: item.score,
      createdAt: now,
      updatedAt: now
    })),
    skipDuplicates: true
  });

  return true;
}

export async function getThreeYearScenarios(
  userId: string,
  year: number,
  plan: { c1Target: number; c2Target: number; c3Target: number }
) {
  const scenarios = await prisma.threeYearGoalScenario.findMany({
    where: { userId, year },
    orderBy: { speed: "asc" }
  });

  const createdMissing = await ensureThreeYearScenarios(userId, year, plan, scenarios);

  if (!createdMissing) {
    return scenarios.map(withCalculatedScenarioValues);
  }

  const updatedScenarios = await prisma.threeYearGoalScenario.findMany({
    where: { userId, year },
    orderBy: { speed: "asc" }
  });

  return updatedScenarios.map(withCalculatedScenarioValues);
}

async function loadGoalPlan(userId: string, year: number) {
  return prisma.annualGoalPlan.findUnique({
    where: {
      userId_year: {
        userId,
        year
      }
    },
    select: goalPlanSelect
  });
}

async function createDefaultGoalBundle(userId: string, year: number, autoPointA: number) {
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const plan = await tx.annualGoalPlan.create({
        data: {
          userId,
          year,
          pointA: autoPointA,
          pointAMode: "AUTO",
          planStartDate: todayToUtcNoon(now),
          c1Target: autoPointA * 2,
          c2Target: autoPointA * 3,
          c3Target: autoPointA * 4,
          growthMode: "LINEAR"
        },
        select: { id: true, c1Target: true, c2Target: true, c3Target: true }
      });

      await tx.annualGoalRow.createMany({
        data: buildGoalRowData(plan.id, {
          pointA: autoPointA,
          c1Target: plan.c1Target,
          c2Target: plan.c2Target,
          c3Target: plan.c3Target,
          growthMode: "LINEAR"
        }),
        skipDuplicates: true
      });
      await tx.monthlyTaktLevel.createMany({
        data: defaultTaktLevels.map((item) => ({
          userId,
          year,
          level: item.level,
          description: item.description,
          amount: 0,
          createdAt: now,
          updatedAt: now
        })),
        skipDuplicates: true
      });
      await tx.threeYearGoalScenario.createMany({
        data: defaultThreeYearScenarios.map((item) => ({
          userId,
          year,
          speed: item.speed,
          pointC: scenarioPointCDefault(item.speed, plan),
          score: item.score,
          createdAt: now,
          updatedAt: now
        })),
        skipDuplicates: true
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }

    throw error;
  }
}

export async function getOrCreateAnnualGoalPlan(userId: string, year: number, autoPointA?: number) {
  const effectiveAutoPointA = autoPointA ?? (await getAutoPointA(userId));
  let plan = await prisma.annualGoalPlan.findUnique({
    where: {
      userId_year: {
        userId,
        year
      }
    },
    select: goalPlanSelect
  });

  if (!plan) {
    await createDefaultGoalBundle(userId, year, effectiveAutoPointA);
    plan = await loadGoalPlan(userId, year);
  }

  if (!plan) {
    throw new Error("Не удалось создать план годовых целей");
  }

  const effectivePointA = plan.pointAMode === "AUTO" ? effectiveAutoPointA : plan.pointA;
  const createdMissingRows = await ensureGoalRowsForLoadedPlan(plan, {
    pointA: effectivePointA,
    c1Target: plan.c1Target,
    c2Target: plan.c2Target,
    c3Target: plan.c3Target,
    growthMode: "LINEAR"
  });

  if (createdMissingRows) {
    plan = await prisma.annualGoalPlan.findUniqueOrThrow({
      where: { id: plan.id },
      select: goalPlanSelect
    });
  }

  return hydrateGoalPlan(plan, effectiveAutoPointA);
}

export async function getGoalsPayload(userId: string, year: number, options?: GoalsPayloadOptions) {
  const parallelStartedAt = Date.now();
  let snapshot = await loadGoalsSnapshot(userId, year);
  markTiming(options, "parallelData", parallelStartedAt);

  if (!snapshot.plan) {
    await createDefaultGoalBundle(userId, year, snapshot.autoPointA);
    snapshot = await loadGoalsSnapshot(userId, year);
  }

  let plan = snapshot.plan;

  if (!plan) {
    throw new Error("Не удалось создать план годовых целей");
  }

  const effectivePointA = plan.pointAMode === "AUTO" ? snapshot.autoPointA : plan.pointA;
  const [createdMissingRows, createdMissingTaktLevels, createdMissingScenarios] =
    await Promise.all([
      ensureGoalRowsForLoadedPlan(plan, {
        pointA: effectivePointA,
        c1Target: plan.c1Target,
        c2Target: plan.c2Target,
        c3Target: plan.c3Target,
        growthMode: "LINEAR"
      }),
      createMissingTaktLevels(userId, year, snapshot.taktLevels),
      ensureThreeYearScenarios(userId, year, plan, snapshot.threeYearScenarios)
    ]);

  if (createdMissingRows || createdMissingTaktLevels || createdMissingScenarios) {
    snapshot = await loadGoalsSnapshot(userId, year);
    plan = snapshot.plan;
  }

  if (!plan) {
    throw new Error("Не удалось загрузить план годовых целей");
  }

  const hydratedPlan = hydrateGoalPlan(plan, snapshot.autoPointA);
  const weeklyTakt = await buildWeeklyTakt(
    userId,
    hydratedPlan,
    options?.weekStartDate
  );

  return {
    plan: hydratedPlan,
    facts: snapshot.facts,
    taktLevels: snapshot.taktLevels,
    threeYearScenarios: snapshot.threeYearScenarios.map(withCalculatedScenarioValues),
    weeklyTakt,
    autoPointA: snapshot.autoPointA
  };
}
