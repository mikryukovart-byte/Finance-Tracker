import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { getCrisisControl } from "@/lib/crisis";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import {
  getFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";
import { createApiTimer } from "@/lib/perf";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const timer = createApiTimer("/api/truth");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const url = new URL(request.url);
  const threshold = parseLeakageThreshold(url.searchParams.get("leakageThreshold"));
  const range = dateRangeFromSearch(url.searchParams);
  const dbStarted = Date.now();
  const [data, crisis] = await Promise.all([
    getFinancialControlData(auth.userId, threshold, range),
    getCrisisControl(auth.userId)
  ]);
  timer.mark("db", dbStarted);
  timer.done();

  return NextResponse.json({ ...data, crisis });
}
