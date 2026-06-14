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
  if (!value) {
    return undefined;
  }

  const date = parseDateInput(value);
  return date ? startOfWeek(date) : undefined;
}

function textField(max: number, message: string) {
  return z.string().trim().max(max, message);
}

const patchSchema = z.object({
  weekStartDate: z.string().optional(),
  title: textField(160, "Гипотеза должна быть короче 160 символов").min(1, "Укажите гипотезу").optional(),
  actionPlan: textField(500, "План действий должен быть короче 500 символов").min(1, "Укажите, что делаете").optional(),
  expectedResult: textField(300, "Ожидаемый результат должен быть короче 300 символов").optional().nullable(),
  actualResult: textField(300, "Факт должен быть короче 300 символов").optional().nullable(),
  conclusion: textField(300, "Вывод должен быть короче 300 символов").optional().nullable(),
  status: z.enum(statusValues).optional()
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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const existing = await prisma.weeklyHypothesis.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Гипотеза не найдена" }, { status: 404 });
  }

  const hypothesis = await prisma.weeklyHypothesis.update({
    where: { id: params.id },
    data: {
      ...parsed.data,
      weekStartDate: weekStartFromValue(parsed.data.weekStartDate)
    },
    select: hypothesisSelect
  });

  return NextResponse.json(hypothesis);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const existing = await prisma.weeklyHypothesis.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Гипотеза не найдена" }, { status: 404 });
  }

  await prisma.weeklyHypothesis.delete({
    where: { id: params.id }
  });

  return NextResponse.json({ ok: true });
}

