import { NextResponse } from "next/server";

import { setTelegramWebhook } from "@/lib/telegram-api";
import {
  getTelegramSetupConfig,
  safeSecretEquals,
  TelegramConfigurationError
} from "@/lib/telegram-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let config;

  try {
    config = getTelegramSetupConfig();
  } catch (error) {
    if (error instanceof TelegramConfigurationError) {
      console.error(error.message);
      return NextResponse.json(
        { ok: false, message: "Telegram setup не настроен на сервере" },
        { status: 503 }
      );
    }
    throw error;
  }

  if (
    !safeSecretEquals(
      request.headers.get("x-telegram-setup-secret"),
      config.setupSecret
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const webhookUrl = new URL("/api/telegram/webhook", request.url);

  if (webhookUrl.protocol !== "https:" && webhookUrl.hostname !== "localhost") {
    return NextResponse.json(
      { ok: false, message: "Webhook требует HTTPS" },
      { status: 400 }
    );
  }

  try {
    await setTelegramWebhook(
      config.botToken,
      webhookUrl.toString(),
      config.webhookSecret
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram setWebhook error", error);
    return NextResponse.json(
      { ok: false, message: "Не удалось настроить webhook" },
      { status: 502 }
    );
  }
}
