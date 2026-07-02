import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  dateOnlyToUtcNoon,
  getAutoPointA,
  getGoalsPayload,
  normalizeGoalYear,
  syncLinearGoalRows
} from "@/lib/goals";
import { parseDateInput, startOfWeek } from "@/lib/date-ranges";
import { createApiTimer } from "@/lib/perf";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

function moneyValue(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
    return normalized ? Number(normalized) : 0;
  }

  return value;
}

function dateValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

    if (!match) {
      return value;
    }

    const date = dateOnlyToUtcNoon(trimmed);
    return Number.isNaN(date.getTime()) ? value : date;
  }

  return value;
}

const optionalMoneySchema = z.preprocess(
  moneyValue,
  z.number({ invalid_type_error: "Введите корректную сумму" }).finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной").optional()
);

const optionalDateSchema = z.preprocess(
  dateValue,
  z.date({ invalid_type_error: "Укажите корректную дату" }).optional()
);

const taktLevelSchema = z.object({
  level: z.number().int().min(0).max(10),
  description: z
    .string()
    .trim()
    .min(1, "Укажите описание уровня")
    .max(120, "Описание должно быть короче 120 символов"),
  amount: z.preprocess(
    moneyValue,
    z.number({ invalid_type_error: "Введите корректную сумму" }).finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной")
  )
});

const threeYearScenarioSchema = z.object({
  speed: z.number().refine(
    (value) => [1.5, 2, 3, 4].includes(value),
    "Некорректная скорость роста"
  ),
  pointC: z.preprocess(
    moneyValue,
    z.number({ invalid_type_error: "Введите корректную сумму" }).finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной")
  ),
  score: z.coerce
    .number({ invalid_type_error: "Укажите оценку" })
    .int("Оценка должна быть целым числом")
    .min(0, "Оценка не может быть меньше 0")
    .max(10, "Оценка не может быть больше 10")
});

const goalSettingsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  pointA: optionalMoneySchema,
  pointAMode: z.enum(["AUTO", "MANUAL"]).optional(),
  planStartDate: optionalDateSchema,
  c1Target: optionalMoneySchema,
  c2Target: optionalMoneySchema,
  c3Target: optionalMoneySchema,
  growthMode: z.enum(["LINEAR", "MANUAL"]).optional(),
  confirmLowerTargets: z.boolean().optional(),
  taktLevels: z.array(taktLevelSchema).optional(),
  threeYearScenarios: z.array(threeYearScenarioSchema).optional()
});

async function updatePlan(userId: string, body: unknown) {
  const parsed = goalSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const year = normalizeGoalYear(parsed.data.year);
  const current = await getGoalsPayload(userId, year);
  const autoPointA = await getAutoPointA(userId);
  const pointAMode = parsed.data.pointAMode ?? current.plan.pointAMode;
  const nextPointA =
    pointAMode === "AUTO"
      ? autoPointA
      : parsed.data.pointA ?? current.plan.pointA;
  const nextC1Target = parsed.data.c1Target ?? current.plan.c1Target;
  const nextC2Target = parsed.data.c2Target ?? current.plan.c2Target;
  const nextC3Target = parsed.data.c3Target ?? current.plan.c3Target;
  const targetSetupChanged =
    parsed.data.pointA !== undefined ||
    parsed.data.pointAMode !== undefined ||
    parsed.data.planStartDate !== undefined ||
    parsed.data.c1Target !== undefined ||
    parsed.data.c2Target !== undefined ||
    parsed.data.c3Target !== undefined;
  const hasLowerTarget = [nextC1Target, nextC2Target, nextC3Target].some(
    (target) => target <= nextPointA
  );

  if (targetSetupChanged && hasLowerTarget) {
    return NextResponse.json(
      { message: "Цель должна быть выше точки А, иначе это план снижения дохода." },
      { status: 400 }
    );
  }

  const updated = await prisma.annualGoalPlan.update({
    where: { id: current.plan.id },
    data: {
      pointA: nextPointA,
      pointAMode,
      ...(parsed.data.planStartDate ? { planStartDate: parsed.data.planStartDate } : {}),
      c1Target: nextC1Target,
      c2Target: nextC2Target,
      c3Target: nextC3Target,
      growthMode: "LINEAR"
    }
  });

  await syncLinearGoalRows(updated.id, {
    pointA: nextPointA,
    c1Target: updated.c1Target,
    c2Target: updated.c2Target,
    c3Target: updated.c3Target
  });

  if (!parsed.data.threeYearScenarios?.length) {
    const scenarioDefaults = [
      { speed: 1.5, previous: current.plan.c1Target, next: updated.c1Target },
      { speed: 2, previous: current.plan.c2Target, next: updated.c2Target },
      { speed: 3, previous: current.plan.c3Target, next: updated.c3Target }
    ];

    for (const scenario of scenarioDefaults) {
      await prisma.threeYearGoalScenario.updateMany({
        where: {
          userId,
          year,
          speed: scenario.speed,
          OR: [{ pointC: 0 }, { pointC: scenario.previous }]
        },
        data: {
          pointC: scenario.next
        }
      });
    }
  }

  if (parsed.data.taktLevels?.length) {
    for (const level of parsed.data.taktLevels) {
      await prisma.monthlyTaktLevel.upsert({
        where: {
          userId_year_level: {
            userId,
            year,
            level: level.level
          }
        },
        update: {
          description: level.description,
          amount: level.amount
        },
        create: {
          userId,
          year,
          level: level.level,
          description: level.description,
          amount: level.amount
        }
      });
    }
  }

  if (parsed.data.threeYearScenarios?.length) {
    for (const scenario of parsed.data.threeYearScenarios) {
      await prisma.threeYearGoalScenario.upsert({
        where: {
          userId_year_speed: {
            userId,
            year,
            speed: scenario.speed
          }
        },
        update: {
          pointC: scenario.pointC,
          score: scenario.score
        },
        create: {
          userId,
          year,
          speed: scenario.speed,
          pointC: scenario.pointC,
          score: scenario.score
        }
      });
    }
  }

  return NextResponse.json(await getGoalsPayload(userId, year));
}

export async function GET(request: Request) {
  const timer = createApiTimer("/api/goals");
  const authStartedAt = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStartedAt);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const url = new URL(request.url);
  const year = normalizeGoalYear(url.searchParams.get("year"));
  const requestedWeek = parseDateInput(url.searchParams.get("week"));

  try {
    const payload = await getGoalsPayload(auth.userId, year, {
      weekStartDate: requestedWeek ? startOfWeek(requestedWeek) : undefined,
      onTiming(label, ms) {
        timer.set(label, ms);
      }
    });

    timer.done({ year });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/goals] failed", {
      year,
      message: error instanceof Error ? error.message : "Unknown error"
    });
    throw error;
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  return updatePlan(auth.userId, body);
}

export async function PATCH(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  return updatePlan(auth.userId, body);
}
