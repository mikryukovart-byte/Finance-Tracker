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

const authCacheTtlMs = 30_000;
const authUserCache = new Map<
  string,
  {
    user: AuthUser;
    expiresAt: number;
  }
>();
const refreshSessionRequests = new Map<string, Promise<SupabaseSession | null>>();

function getAuthCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  };
}

function logAuthFailure(reason: string, details: Record<string, unknown> = {}) {
  console.warn("[auth]", reason, details);
}

function getJwtExpiresAt(token: string) {
  try {
    const [, payload] = token.split(".");

    if (!payload) {
      return null;
    }

    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalizedPayload, "base64").toString("utf8"));
    const expiresAt = Number(decoded?.exp) * 1000;

    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

function readCachedAuthUser(token: string) {
  const cached = authUserCache.get(token);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    authUserCache.delete(token);
    return null;
  }

  return cached.user;
}

function cacheAuthUser(token: string, user: AuthUser) {
  const tokenExpiresAt = getJwtExpiresAt(token);
  const maxExpiresAt = tokenExpiresAt ?? Date.now() + authCacheTtlMs;
  const expiresAt = Math.min(Date.now() + authCacheTtlMs, maxExpiresAt);

  if (expiresAt > Date.now()) {
    authUserCache.set(token, { user, expiresAt });
  }
}

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

async function getAuthUserFromAccessToken(token: string) {
  const cachedUser = readCachedAuthUser(token);

  if (cachedUser) {
    return cachedUser;
  }

  const response = await supabaseAuthFetch("/user", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    logAuthFailure("supabase_user_check_failed", { status: response.status });
    return null;
  }

  const user = await response.json().catch(() => null);

  if (!user?.id) {
    logAuthFailure("supabase_user_missing_id");
    return null;
  }

  const authUser = {
    userId: user.id,
    email: user.email ?? null
  };

  cacheAuthUser(token, authUser);

  return authUser;
}

async function refreshSupabaseSession(refreshToken: string) {
  const existing = refreshSessionRequests.get(refreshToken);

  if (existing) {
    return existing;
  }

  const request = supabaseAuthFetch("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken })
  })
    .then(async (response) => {
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.access_token) {
        logAuthFailure("supabase_refresh_failed", { status: response.status });
        return null;
      }

      return data as SupabaseSession;
    })
    .catch((error) => {
      logAuthFailure("supabase_refresh_request_error", {
        message: error instanceof Error ? error.message : "unknown"
      });
      return null;
    })
    .finally(() => {
      refreshSessionRequests.delete(refreshToken);
    });

  refreshSessionRequests.set(refreshToken, request);
  return request;
}

function setAuthCookiesInStore(session: SupabaseSession) {
  if (!session.access_token) {
    return;
  }

  const store = cookies();
  const accessMaxAge = Math.max(60, session.expires_in ?? 3600);

  store.set(accessTokenCookie, session.access_token, getAuthCookieOptions(accessMaxAge));

  if (session.refresh_token) {
    store.set(
      refreshTokenCookie,
      session.refresh_token,
      getAuthCookieOptions(60 * 60 * 24 * 30)
    );
  }
}

function clearAuthCookiesInStore() {
  const store = cookies();
  store.set(accessTokenCookie, "", getAuthCookieOptions(0));
  store.set(refreshTokenCookie, "", getAuthCookieOptions(0));
}

export async function requireAuth(): Promise<AuthUser | NextResponse> {
  const store = cookies();
  const token = store.get(accessTokenCookie)?.value;
  const refreshToken = store.get(refreshTokenCookie)?.value;

  try {
    if (token) {
      const authUser = await getAuthUserFromAccessToken(token);

      if (authUser) {
        return authUser;
      }
    }

    if (!refreshToken) {
      logAuthFailure("auth_missing_refresh_token", { hasAccessToken: Boolean(token) });
      return authJsonError();
    }

    const refreshedSession = await refreshSupabaseSession(refreshToken);

    if (!refreshedSession?.access_token) {
      clearAuthCookiesInStore();
      return authJsonError("Сессия истекла. Войдите снова");
    }

    setAuthCookiesInStore(refreshedSession);

    if (refreshedSession.user?.id) {
      const authUser = {
        userId: refreshedSession.user.id,
        email: refreshedSession.user.email ?? null
      };

      cacheAuthUser(refreshedSession.access_token, authUser);
      return authUser;
    }

    const authUser = await getAuthUserFromAccessToken(refreshedSession.access_token);

    if (authUser) {
      return authUser;
    }

    clearAuthCookiesInStore();
    return authJsonError("Сессия истекла. Войдите снова");
  } catch (error) {
    logAuthFailure("auth_check_error", {
      message: error instanceof Error ? error.message : "unknown"
    });
    return authJsonError();
  }
}

export function setAuthCookies(response: NextResponse, session: SupabaseSession) {
  if (!session.access_token) {
    return;
  }

  const accessMaxAge = Math.max(60, session.expires_in ?? 3600);

  response.cookies.set(accessTokenCookie, session.access_token, {
    ...getAuthCookieOptions(accessMaxAge)
  });

  if (session.refresh_token) {
    response.cookies.set(refreshTokenCookie, session.refresh_token, {
      ...getAuthCookieOptions(60 * 60 * 24 * 30)
    });
  }
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(accessTokenCookie, "", {
    ...getAuthCookieOptions(0)
  });
  response.cookies.set(refreshTokenCookie, "", {
    ...getAuthCookieOptions(0)
  });
}
