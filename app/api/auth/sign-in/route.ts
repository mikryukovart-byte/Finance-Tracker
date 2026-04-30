import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { ensureDefaultAccount } from "@/lib/accounts";
import { setAuthCookies, supabaseAuthFetch } from "@/lib/auth";
import { ensureDefaultCategories } from "@/lib/default-categories";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return badRequest("Введите email и пароль");
  }

  const response = await supabaseAuthFetch("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return NextResponse.json(
      { message: data?.error_description ?? data?.msg ?? "Не удалось войти" },
      { status: 401 }
    );
  }

  if (data?.user?.id) {
    await ensureDefaultCategories(data.user.id);
    await ensureDefaultAccount(data.user.id);
  }

  const result = NextResponse.json({ ok: true });
  setAuthCookies(result, data);
  return result;
}
