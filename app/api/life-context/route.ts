import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  lifeContextInputSchema,
  lifeContextToPrisma,
  normalizeLifeContext
} from "@/lib/life-context";
import { prisma } from "@/lib/prisma";
import { firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const row = await prisma.lifeContext.findUnique({ where: { userId: auth.userId } });
  return NextResponse.json(normalizeLifeContext(row));
}

export async function PUT(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const body = await readJsonBody(request);
  if (!body) return badRequest();
  const parsed = lifeContextInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const data = lifeContextToPrisma(parsed.data);
  const row = await prisma.lifeContext.upsert({
    where: { userId: auth.userId },
    create: { userId: auth.userId, ...data },
    update: data
  });
  return NextResponse.json(normalizeLifeContext(row));
}
