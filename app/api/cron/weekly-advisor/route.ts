import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getTelegramRuntimeConfig, safeSecretEquals, TelegramConfigurationError } from "@/lib/telegram-auth";
import { parseDateOnly } from "@/lib/week";
import { weeklyDeliveryWindow } from "@/lib/weekly-delivery";
import { deliverWeeklyTelegramReport, generateWeeklyTelegramReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !safeSecretEquals(received, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let telegram;
  try {
    telegram = getTelegramRuntimeConfig();
  } catch (error) {
    if (error instanceof TelegramConfigurationError) {
      return NextResponse.json({ ok: false, message: "Telegram-интеграция не настроена" }, { status: 503 });
    }
    throw error;
  }

  const settings = await prisma.weeklyDeliverySettings.findUnique({
    where: { userId: telegram.trackerUserId }
  });
  if (!settings) return NextResponse.json({ ok: true, due: false, reason: "settings_missing" });
  const dueDate = weeklyDeliveryWindow(settings);
  if (!dueDate) return NextResponse.json({ ok: true, due: false });
  const referenceDate = parseDateOnly(dueDate);
  if (!referenceDate) return NextResponse.json({ ok: false, message: "Некорректная локальная дата" }, { status: 500 });

  try {
    const { report, created } = await generateWeeklyTelegramReport(telegram.trackerUserId, referenceDate);
    const delivery = await deliverWeeklyTelegramReport(
      telegram.botToken,
      telegram.allowedChatId,
      report
    );
    return NextResponse.json({ ok: true, due: true, created, delivered: delivery.delivered, parts: delivery.parts });
  } catch (error) {
    console.error("Weekly advisor cron failed", {
      userId: telegram.trackerUserId,
      message: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ ok: false, message: "Не удалось отправить недельный отчет" }, { status: 500 });
  }
}
