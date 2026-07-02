import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workRecordTypes } from "@/lib/telegram-work-records";
import { mondayOfWeek, parseDateOnly } from "@/lib/week";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

function optionalText(max: number) {
  return z.string().trim().max(max).optional().nullable();
}

function hasTwoToFiveSentences(value: string) {
  const sentenceCount = value
    .split(/[.!?]+(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  return sentenceCount >= 2 && sentenceCount <= 5;
}

const createSchema = z.object({
  title: z.string().trim().min(1, "Укажите тему").max(90, "Тема должна быть короче 90 символов"),
  recordType: z.enum(workRecordTypes),
  summary: z
    .string()
    .trim()
    .min(1, "Укажите суть")
    .max(1200, "Суть должна быть короче 1200 символов")
    .refine(hasTwoToFiveSentences, "Суть должна содержать от 2 до 5 предложений"),
  insight: optionalText(500),
  risk: optionalText(500),
  nextStep: optionalText(500),
  relatedWeekStart: z.string().trim().optional().nullable()
});

const workRecordSelect = {
  id: true,
  title: true,
  recordType: true,
  summary: true,
  insight: true,
  risk: true,
  nextStep: true,
  relatedWeekStart: true,
  source: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true
};

function emptyToNull(value: string | null | undefined) {
  return value?.trim() || null;
}

function parseBoolean(value: string | null) {
  return value === "true" || value === "1";
}

function parseLimit(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const requestedType = url.searchParams.get("type");
  const recordType = workRecordTypes.find((value) => value === requestedType);
  const where: Prisma.WorkRecordWhereInput = {
    userId: auth.userId,
    ...(parseBoolean(url.searchParams.get("includeDeleted")) ? {} : { deletedAt: null }),
    ...(recordType ? { recordType } : {})
  };
  const records = await prisma.workRecord.findMany({
    where,
    select: workRecordSelect,
    orderBy: [{ createdAt: "desc" }],
    take: parseLimit(url.searchParams.get("limit"))
  });

  return NextResponse.json({ records });
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

  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const relatedDate = parsed.data.relatedWeekStart
    ? parseDateOnly(parsed.data.relatedWeekStart)
    : null;

  if (parsed.data.relatedWeekStart && !relatedDate) {
    return NextResponse.json({ message: "Укажите корректную дату недели" }, { status: 400 });
  }

  const record = await prisma.workRecord.create({
    data: {
      userId: auth.userId,
      title: parsed.data.title,
      recordType: parsed.data.recordType,
      summary: parsed.data.summary,
      insight: emptyToNull(parsed.data.insight),
      risk: emptyToNull(parsed.data.risk),
      nextStep: emptyToNull(parsed.data.nextStep),
      relatedWeekStart: relatedDate ? mondayOfWeek(relatedDate) : null,
      source: "WEB_MANUAL"
    },
    select: workRecordSelect
  });

  return NextResponse.json(record, { status: 201 });
}
