import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { endOfDay, parseDateInput, startOfDay, startOfWeek } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const actionTypes = [
  "FIRST_TOUCH",
  "FOLLOW_UP",
  "WARM_CONTACT",
  "CALL",
  "PROPOSAL",
  "PRICE_NAMED",
  "OTHER"
] as const;

function textField(max: number, message: string) {
  return z.string().trim().max(max, message);
}

function weekStartFromValue(value: string | null | undefined) {
  const date = parseDateInput(value ?? "") ?? new Date();
  return startOfWeek(date);
}

function actionDateFromValue(value: string) {
  return parseDateInput(value);
}

function emptyToNull(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function isActionType(value: string | null): value is (typeof actionTypes)[number] {
  return Boolean(value && (actionTypes as readonly string[]).includes(value));
}

function parseBoolean(value: string | null) {
  return value === "true" || value === "1";
}

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(parsed, 300);
}

const actionSchema = z.object({
  date: z.string().min(1, "Укажите дату"),
  type: z.enum(actionTypes),
  target: textField(160, "Кому / куда должно быть короче 160 символов").optional().nullable(),
  value: textField(300, "Ценность должна быть короче 300 символов").optional().nullable(),
  nextStep: textField(300, "Следующий шаг должен быть короче 300 символов").optional().nullable(),
  note: textField(500, "Заметка должна быть короче 500 символов").optional().nullable()
});

const dailyActionSelect = {
  id: true,
  userId: true,
  date: true,
  weekStartDate: true,
  type: true,
  target: true,
  value: true,
  nextStep: true,
  note: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true
};

function emptyCounts() {
  return Object.fromEntries(actionTypes.map((type) => [type, 0])) as Record<
    (typeof actionTypes)[number],
    number
  >;
}

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const includeDeleted = parseBoolean(url.searchParams.get("includeDeleted"));
  const requestedType = url.searchParams.get("type");

  if (url.searchParams.get("mode") === "history") {
    const from = parseDateInput(url.searchParams.get("from"));
    const to = parseDateInput(url.searchParams.get("to"));
    const q = url.searchParams.get("q")?.trim();
    const where: Prisma.DailyActionLogWhereInput = {
      userId: auth.userId,
      ...(includeDeleted ? {} : { deletedAt: null })
    };

    if (from || to) {
      where.date = {
        ...(from ? { gte: startOfDay(from) } : {}),
        ...(to ? { lt: endOfDay(to) } : {})
      };
    }

    if (isActionType(requestedType)) {
      where.type = requestedType;
    }

    if (q) {
      where.OR = [
        { target: { contains: q, mode: "insensitive" } },
        { value: { contains: q, mode: "insensitive" } },
        { nextStep: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } }
      ];
    }

    const actions = await prisma.dailyActionLog.findMany({
      where,
      select: dailyActionSelect,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: parseLimit(url.searchParams.get("limit"))
    });
    const counts = emptyCounts();

    for (const action of actions) {
      if (!action.deletedAt && action.type in counts) {
        counts[action.type as keyof typeof counts] += 1;
      }
    }

    return NextResponse.json({
      mode: "history",
      actions,
      counts,
      hypothesisCount: 0
    });
  }

  const dateFilter = parseDateInput(url.searchParams.get("date"));
  const weekStartDate = dateFilter
    ? startOfWeek(dateFilter)
    : weekStartFromValue(url.searchParams.get("weekStartDate"));
  const weekEndDate = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate() + 7
  );
  const where = dateFilter
    ? {
        userId: auth.userId,
        ...(includeDeleted ? {} : { deletedAt: null }),
        date: {
          gte: startOfDay(dateFilter),
          lt: endOfDay(dateFilter)
        }
      }
    : {
        userId: auth.userId,
        weekStartDate,
        ...(includeDeleted ? {} : { deletedAt: null })
      };

  const [actions, hypothesisCount] = await Promise.all([
    prisma.dailyActionLog.findMany({
      where,
      select: dailyActionSelect,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.weeklyHypothesis.count({
      where: {
        userId: auth.userId,
        weekStartDate
      }
    })
  ]);
  const counts = emptyCounts();

  for (const action of actions) {
    if (!action.deletedAt && action.type in counts) {
      counts[action.type as keyof typeof counts] += 1;
    }
  }

  return NextResponse.json({
    weekStartDate: weekStartDate.toISOString(),
    weekEndDate: new Date(weekEndDate.getTime() - 1).toISOString(),
    actions,
    counts,
    hypothesisCount
  });
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

  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const date = actionDateFromValue(parsed.data.date);

  if (!date) {
    return NextResponse.json({ message: "Укажите корректную дату" }, { status: 400 });
  }

  const action = await prisma.dailyActionLog.create({
    data: {
      userId: auth.userId,
      date,
      weekStartDate: startOfWeek(date),
      type: parsed.data.type,
      target: emptyToNull(parsed.data.target),
      value: emptyToNull(parsed.data.value),
      nextStep: emptyToNull(parsed.data.nextStep),
      note: emptyToNull(parsed.data.note)
    },
    select: dailyActionSelect
  });

  return NextResponse.json(action, { status: 201 });
}
