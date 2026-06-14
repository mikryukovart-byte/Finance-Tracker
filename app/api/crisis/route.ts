import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { getCrisisControl } from "@/lib/crisis";
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

const crisisSettingsSchema = z.object({
  acuteReliefTarget: z.preprocess(
    moneyValue,
    z.number().finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной").optional()
  ),
  normalWorkTarget: z.preprocess(
    moneyValue,
    z.number().finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной").optional()
  ),
  requiredDailyExpense: z.preprocess(
    moneyValue,
    z.number().finite("Введите корректную сумму").min(0, "Сумма не может быть отрицательной").nullable().optional()
  )
});

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  return NextResponse.json(await getCrisisControl(auth.userId));
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

  const parsed = crisisSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  await prisma.crisisSettings.upsert({
    where: { userId: auth.userId },
    update: parsed.data,
    create: {
      userId: auth.userId,
      acuteReliefTarget: parsed.data.acuteReliefTarget ?? 0,
      normalWorkTarget: parsed.data.normalWorkTarget ?? 0,
      requiredDailyExpense: parsed.data.requiredDailyExpense ?? null
    }
  });

  return NextResponse.json(await getCrisisControl(auth.userId));
}

