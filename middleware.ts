import { NextRequest, NextResponse } from "next/server";

const accessTokenCookie = "finance-access-token";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const isLogin = pathname === "/login";
  const hasToken = request.cookies.has(accessTokenCookie);

  if (!hasToken && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  if (hasToken && isLogin) {
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
