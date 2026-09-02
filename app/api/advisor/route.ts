import { NextResponse } from "next/server";

import { generateAdvisorReview, getAdvisorOverview } from "@/lib/advisor-v2";
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
  try {
    const response = await getAdvisorOverview(auth.userId);
    timer.mark("db", dbStarted);
    timer.done({ generated: false });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Advisor overview failed", {
      message: error instanceof Error ? error.message : "unknown"
    });
    timer.done({ status: 500, generated: false });
    return NextResponse.json(
      { message: "Не удалось загрузить данные советника" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const timer = createApiTimer("/api/advisor");
  const authStarted = Date.now();
  const auth = await requireAuth();
  timer.mark("auth", authStarted);

  if (isAuthError(auth)) {
    timer.done({ status: 401 });
    return auth;
  }

  const dbStarted = Date.now();
  const forceRuleBased =
    process.env.NODE_ENV !== "production" &&
    request.headers.get("x-e2e-advisor-fallback") === "1";

  try {
    const response = await generateAdvisorReview(auth.userId, { forceRuleBased });
    timer.mark("db", dbStarted);
    timer.done({ generated: true, source: response.report?.source });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Advisor report generation failed", {
      message: error instanceof Error ? error.message : "unknown"
    });
    timer.done({ status: 500, generated: true });
    return NextResponse.json(
      { message: "Не удалось собрать стратегический разбор" },
      { status: 500 }
    );
  }
}
