import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { getAnnualIncomeFacts, getAutoPointA, normalizeGoalYear } from "@/lib/goals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const year = normalizeGoalYear(url.searchParams.get("year"));
  const [facts, autoPointA] = await Promise.all([
    getAnnualIncomeFacts(auth.userId, year),
    getAutoPointA(auth.userId)
  ]);

  return NextResponse.json({
    year,
    facts,
    autoPointA
  });
}
