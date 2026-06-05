import { NextResponse } from "next/server";

import { getAdvisorResponse } from "@/lib/advisor";
import { isAuthError, requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const response = await getAdvisorResponse(auth.userId, false);
  return NextResponse.json(response);
}

export async function POST() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const response = await getAdvisorResponse(auth.userId, true);
  return NextResponse.json(response);
}
