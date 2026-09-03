import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";
import { defaultWeeklyDelivery } from "@/lib/weekly-delivery";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1, "Укажите часовой пояс").max(100),
  weekday: z.number().int().min(1).max(7),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ")
}).superRefine((value, context) => {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value.timezone }).format();
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: "Неизвестный часовой пояс" });
  }
});

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const row = await prisma.weeklyDeliverySettings.findUnique({ where: { userId: auth.userId } });
  return NextResponse.json(row ? {
    enabled: row.enabled,
    timezone: row.timezone,
    weekday: row.weekday,
    localTime: row.localTime,
    updatedAt: row.updatedAt.toISOString()
  } : defaultWeeklyDelivery);
}

export async function PUT(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const body = await readJsonBody(request);
  if (!body) return badRequest();
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }
  const row = await prisma.weeklyDeliverySettings.upsert({
    where: { userId: auth.userId },
    create: { userId: auth.userId, ...parsed.data },
    update: parsed.data
  });
  return NextResponse.json({
    enabled: row.enabled,
    timezone: row.timezone,
    weekday: row.weekday,
    localTime: row.localTime,
    updatedAt: row.updatedAt.toISOString()
  });
}
