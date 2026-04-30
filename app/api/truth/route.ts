import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { dateRangeFromSearch } from "@/lib/date-ranges";
import {
  getFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const url = new URL(request.url);
  const threshold = parseLeakageThreshold(url.searchParams.get("leakageThreshold"));
  const range = dateRangeFromSearch(url.searchParams);
  const data = await getFinancialControlData(auth.userId, threshold, range);

  return NextResponse.json(data);
}
