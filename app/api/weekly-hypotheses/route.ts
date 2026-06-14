import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { parseDateInput, startOfWeek } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const statusValues = ["PLANNED", "ACTIVE", "WON", "FAILED", "REPEAT", "CHANGE", "DROP"] as const;

function weekStartFromValue(value: string | null | undefined) {
  const date = parseDateInput(value ?? "") ?? new Date();
  return startOfWeek(date);
}

function textField(max: number, message: string) {
  return z.string().trim().max(max, message);
}

const hypothesisSchema = z.object({
  weekStartDate: z.string().optional(),
  title: textField(160, "Гипотеза должна быть короче 160 символов").min(1, "Укажите гипотезу"),
  actionPlan: textField(500, "План действий должен быть короче 500 символов").min(1, "Укажите, что делаете"),
  expectedResult: textField(300, "Ожидаемый результат должен быть короче 300 символов").optional().nullable(),
  actualResult: textField(300, "Факт должен быть короче 300 символов").optional().nullable(),
  conclusion: textField(300, "Вывод должен быть короче 300 символов").optional().nullable(),
  status: z.enum(statusValues).default("PLANNED")
});

const hypothesisSelect = {
  id: true,
  userId: true,
  weekStartDate: true,
  title: true,
  actionPlan: true,
  expectedResult: true,
  actualResult: true,
  conclusion: true,
  status: true,
  createdAt: true,
  updatedAt: true
};

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const weekStartDate = weekStartFromValue(url.searchParams.get("weekStartDate"));
  const weekEndDate = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate() + 7
  );
  const hypotheses = await prisma.weeklyHypothesis.findMany({
    where: {
      userId: auth.userId,
      weekStartDate
    },
    select: hypothesisSelect,
    orderBy: [{ createdAt: "asc" }]
  });

  return NextResponse.json({
    weekStartDate: weekStartDate.toISOString(),
    weekEndDate: new Date(weekEndDate.getTime() - 1).toISOString(),
    hypotheses
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

  const parsed = hypothesisSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const hypothesis = await prisma.weeklyHypothesis.create({
    data: {
      userId: auth.userId,
      weekStartDate: weekStartFromValue(parsed.data.weekStartDate),
      title: parsed.data.title,
      actionPlan: parsed.data.actionPlan,
      expectedResult: parsed.data.expectedResult || null,
      actualResult: parsed.data.actualResult || null,
      conclusion: parsed.data.conclusion || null,
      status: parsed.data.status
    },
    select: hypothesisSelect
  });

  return NextResponse.json(hypothesis, { status: 201 });
}

