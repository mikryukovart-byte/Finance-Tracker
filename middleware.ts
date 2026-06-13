import { NextRequest, NextResponse } from "next/server";

const accessTokenCookie = "finance-access-token";
const refreshTokenCookie = "finance-refresh-token";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const isLogin = pathname === "/login";
  const hasAccessToken = request.cookies.has(accessTokenCookie);
  const hasRefreshToken = request.cookies.has(refreshTokenCookie);
  const hasSessionCookie = hasAccessToken || hasRefreshToken;

  if (!hasSessionCookie && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  if (hasAccessToken && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
