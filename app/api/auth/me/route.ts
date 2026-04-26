import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  return NextResponse.json({ user: auth });
}
