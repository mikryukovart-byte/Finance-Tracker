import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const accessTokenCookie = "finance-access-token";
export const refreshTokenCookie = "finance-refresh-token";

export type AuthUser = {
  userId: string;
  email: string | null;
};

type SupabaseSession = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
    email?: string;
  };
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Не настроены переменные Supabase");
  }

  return {
    url: url.replace(/\/$/, ""),
    anonKey
  };
}

export function authJsonError(message = "Войдите в аккаунт") {
  return NextResponse.json({ message }, { status: 401 });
}

export function isAuthError(value: AuthUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function supabaseAuthFetch(path: string, init: RequestInit = {}) {
  const { url, anonKey } = getSupabaseConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", anonKey);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });
}

export async function requireAuth(): Promise<AuthUser | NextResponse> {
  const token = cookies().get(accessTokenCookie)?.value;

  if (!token) {
    return authJsonError();
  }

  try {
    const response = await supabaseAuthFetch("/user", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return authJsonError();
    }

    const user = await response.json();

    if (!user?.id) {
      return authJsonError();
    }

    return {
      userId: user.id,
      email: user.email ?? null
    };
  } catch {
    return authJsonError();
  }
}

export function setAuthCookies(response: NextResponse, session: SupabaseSession) {
  if (!session.access_token) {
    return;
  }

  const secure = process.env.NODE_ENV === "production";
  const accessMaxAge = Math.max(60, session.expires_in ?? 3600);

  response.cookies.set(accessTokenCookie, session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: accessMaxAge
  });

  if (session.refresh_token) {
    response.cookies.set(refreshTokenCookie, session.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
  }
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(accessTokenCookie, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  response.cookies.set(refreshTokenCookie, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
