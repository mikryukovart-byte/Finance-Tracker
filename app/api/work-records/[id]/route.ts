import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ restore: z.literal(true) });

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

  const existing = await prisma.workRecord.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Рабочая запись не найдена" }, { status: 404 });
  }

  const record = await prisma.workRecord.update({
    where: { id: existing.id },
    data: { deletedAt: null }
  });

  return NextResponse.json(record);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const existing = await prisma.workRecord.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Рабочая запись не найдена" }, { status: 404 });
  }

  await prisma.workRecord.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() }
  });

  return NextResponse.json({ ok: true });
}
