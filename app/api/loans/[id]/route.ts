import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstZodError, loanSchema } from "@/lib/validation";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PUT(request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest();
  }

  const parsed = loanSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  try {
    const existing = await prisma.loan.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    const loan = await prisma.loan.update({
      where: { id: params.id },
      data: {
        ...parsed.data,
        userId: auth.userId
      }
    });

    return NextResponse.json(loan);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  try {
    const existing = await prisma.loan.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!existing) {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    await prisma.loan.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Кредит не найден" }, { status: 404 });
    }

    throw error;
  }
}
