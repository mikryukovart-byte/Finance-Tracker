import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { setAuthCookies, supabaseAuthFetch } from "@/lib/auth";
import { ensureDefaultCategories } from "@/lib/default-categories";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || password.length < 6) {
    return badRequest("Введите email и пароль не короче 6 символов");
  }

  const response = await supabaseAuthFetch("/signup", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return NextResponse.json(
      { message: data?.error_description ?? data?.msg ?? "Не удалось создать аккаунт" },
      { status: 400 }
    );
  }

  const authenticated = Boolean(data?.access_token);
  if (authenticated && data?.user?.id) {
    await ensureDefaultCategories(data.user.id);
  }

  const result = NextResponse.json({
    ok: true,
    authenticated,
    message: authenticated
      ? "Аккаунт создан"
      : "Аккаунт создан. Проверьте почту для подтверждения."
  });

  setAuthCookies(result, data);
  return result;
}
