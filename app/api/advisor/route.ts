import { NextResponse } from "next/server";

import { getAdvisorResponse } from "@/lib/advisor";
import { isAuthError, requireAuth } from "@/lib/auth";
import { createApiTimer } from "@/lib/perf";

export const dynamic = "force-dynamic";

export async function GET() {
  const timer = createApiTimer("/api/advisor");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const dbStarted = Date.now();
  const response = await getAdvisorResponse(auth.userId, false);
  timer.mark("db", dbStarted);
  timer.done({ refresh: false });
  return NextResponse.json(response);
}

export async function POST() {
  const timer = createApiTimer("/api/advisor");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const dbStarted = Date.now();
  const response = await getAdvisorResponse(auth.userId, true);
  timer.mark("db", dbStarted);
  timer.done({ refresh: true });
  return NextResponse.json(response);
}
