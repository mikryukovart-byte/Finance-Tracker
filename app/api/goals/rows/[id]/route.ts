import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

function moneyValue(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
    return normalized ? Number(normalized) : undefined;
  }

  return value;
}

const optionalMoneySchema = z.preprocess(
  moneyValue,
  z.number({ invalid_type_error: "Введите корректную сумму" }).finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной").optional()
);

const rowPatchSchema = z.object({
  c1Value: optionalMoneySchema,
  c2Value: optionalMoneySchema,
  c3Value: optionalMoneySchema,
  kpiText: z
    .string()
    .trim()
    .max(160, "КП должен быть короче 160 символов")
    .optional()
    .transform((value) => value || null),
  signatureText: z
    .string()
    .trim()
    .max(160, "Подпись должна быть короче 160 символов")
    .optional()
    .transform((value) => value || null),
  isClosed: z.boolean().optional()
});

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

  const parsed = rowPatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const row = await prisma.annualGoalRow.findFirst({
    where: {
      id: params.id,
      plan: {
        userId: auth.userId
      }
    },
    select: {
      id: true
    }
  });

  if (!row) {
    return NextResponse.json({ message: "Строка цели не найдена" }, { status: 404 });
  }

  const valueUpdates = {
    ...(parsed.data.c1Value !== undefined ? { c1Value: parsed.data.c1Value } : {}),
    ...(parsed.data.c2Value !== undefined ? { c2Value: parsed.data.c2Value } : {}),
    ...(parsed.data.c3Value !== undefined ? { c3Value: parsed.data.c3Value } : {})
  };

  if (Object.keys(valueUpdates).length > 0) {
    return NextResponse.json(
      { message: "Месячные значения рассчитываются автоматически из точки А и целей к B10" },
      { status: 400 }
    );
  }

  const updated = await prisma.annualGoalRow.update({
    where: { id: row.id },
    data: {
      ...valueUpdates,
      ...(parsed.data.kpiText !== undefined ? { kpiText: parsed.data.kpiText } : {}),
      ...(parsed.data.signatureText !== undefined
        ? { signatureText: parsed.data.signatureText }
        : {}),
      ...(parsed.data.isClosed !== undefined ? { isClosed: parsed.data.isClosed } : {})
    }
  });

  return NextResponse.json(updated);
}
