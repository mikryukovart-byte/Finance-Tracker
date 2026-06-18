import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { parseDateInput, startOfWeek } from "@/lib/date-ranges";
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

function emptyToNull(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

const patchSchema = z.object({
  date: z.string().optional(),
  type: z.enum(actionTypes).optional(),
  restore: z.boolean().optional(),
  deletedAt: z.null().optional(),
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

  const existing = await prisma.dailyActionLog.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Действие не найдено" }, { status: 404 });
  }

  const date = parsed.data.date ? parseDateInput(parsed.data.date) : null;

  if (parsed.data.date && !date) {
    return NextResponse.json({ message: "Укажите корректную дату" }, { status: 400 });
  }

  const action = await prisma.dailyActionLog.update({
    where: { id: params.id },
    data: {
      date: date ?? undefined,
      weekStartDate: date ? startOfWeek(date) : undefined,
      type: parsed.data.type,
      deletedAt:
        parsed.data.restore || parsed.data.deletedAt === null ? null : undefined,
      target:
        parsed.data.target === undefined ? undefined : emptyToNull(parsed.data.target),
      value: parsed.data.value === undefined ? undefined : emptyToNull(parsed.data.value),
      nextStep:
        parsed.data.nextStep === undefined ? undefined : emptyToNull(parsed.data.nextStep),
      note: parsed.data.note === undefined ? undefined : emptyToNull(parsed.data.note)
    },
    select: dailyActionSelect
  });

  return NextResponse.json(action);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const existing = await prisma.dailyActionLog.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Действие не найдено" }, { status: 404 });
  }

  await prisma.dailyActionLog.update({
    where: { id: params.id },
    data: { deletedAt: new Date() }
  });

  return NextResponse.json({ ok: true });
}
