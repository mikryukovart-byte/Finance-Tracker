import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, conflict, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { categorySchema, firstZodError } from "@/lib/validation";

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

  const parsed = categorySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const current = await prisma.category.findFirst({
    where: { id: params.id, userId: auth.userId },
    include: { _count: { select: { transactions: true } } }
  });

  if (!current) {
    return NextResponse.json({ message: "Категория не найдена" }, { status: 404 });
  }

  if (current.type !== parsed.data.type && current._count.transactions > 0) {
    return NextResponse.json(
      { message: "Нельзя менять тип категории, пока в ней есть операции" },
      { status: 409 }
    );
  }

  const duplicate = await prisma.category.findFirst({
    where: {
      userId: auth.userId,
      type: parsed.data.type,
      id: { not: params.id },
      name: {
        equals: parsed.data.name,
        mode: "insensitive"
      }
    },
    select: { id: true }
  });

  if (duplicate) {
    return conflict("Такая категория уже существует");
  }

  try {
    const category = await prisma.category.update({
      where: { id: params.id },
      data: parsed.data,
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    });

    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { message: "Такая категория уже существует" },
        { status: 409 }
      );
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const transactionsCount = await prisma.transaction.count({
    where: { userId: auth.userId, categoryId: params.id }
  });

  if (transactionsCount > 0) {
    return NextResponse.json(
      { message: "Сначала удалите или перенесите операции из этой категории" },
      { status: 409 }
    );
  }

  try {
    const current = await prisma.category.findFirst({
      where: { id: params.id, userId: auth.userId }
    });

    if (!current) {
      return NextResponse.json({ message: "Категория не найдена" }, { status: 404 });
    }

    await prisma.category.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ message: "Категория не найдена" }, { status: 404 });
    }

    throw error;
  }
}
