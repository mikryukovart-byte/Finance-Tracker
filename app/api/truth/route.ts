import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
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
  const data = await getFinancialControlData(auth.userId, threshold);

  return NextResponse.json(data);
}
