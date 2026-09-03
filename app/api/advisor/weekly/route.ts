import { NextResponse } from "next/server";

import { isAuthError, requireAuth } from "@/lib/auth";
import { generateWeeklyTelegramReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  try {
    const result = await generateWeeklyTelegramReport(auth.userId);
    return NextResponse.json({ report: result.report, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error("Weekly advisor report failed", {
      userId: auth.userId,
      message: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ message: "Не удалось собрать недельный отчет" }, { status: 500 });
  }
}
