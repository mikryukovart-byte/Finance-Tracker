import { NextResponse } from "next/server";

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function badRequest(message = "Некорректный запрос") {
  return NextResponse.json({ message }, { status: 400 });
}

export function notFound(message = "Запись не найдена") {
  return NextResponse.json({ message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ message }, { status: 409 });
}
