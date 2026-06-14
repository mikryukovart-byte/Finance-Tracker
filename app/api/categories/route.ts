import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { badRequest, conflict, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { createApiTimer } from "@/lib/perf";
import { prisma } from "@/lib/prisma";
import { categorySchema, firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const timer = createApiTimer("/api/categories");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const dbStarted = Date.now();
  const categories = await prisma.category.findMany({
    where: { userId: auth.userId },
    select: {
      id: true,
      userId: true,
      name: true,
      type: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { transactions: true }
      }
    },
    orderBy: [
      {
        transactions: {
          _count: "desc"
        }
      },
      { type: "asc" },
      { name: "asc" }
    ]
  });
  timer.mark("db", dbStarted);
  timer.done({ count: categories.length });

  return NextResponse.json(categories);
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

  const parsed = categorySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: firstZodError(parsed.error) }, { status: 400 });
  }

  const existing = await prisma.category.findFirst({
    where: {
      userId: auth.userId,
      type: parsed.data.type,
      name: {
        equals: parsed.data.name,
        mode: "insensitive"
      }
    },
    select: { id: true }
  });

  if (existing) {
    return conflict("Такая категория уже существует");
  }

  try {
    const category = await prisma.category.create({
      data: {
        ...parsed.data,
        userId: auth.userId
      },
      select: {
        id: true,
        userId: true,
        name: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { transactions: true }
        }
      }
    });

    return NextResponse.json(category, { status: 201 });
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
