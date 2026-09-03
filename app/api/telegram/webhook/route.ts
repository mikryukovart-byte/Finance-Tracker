import { NextResponse } from "next/server";

import {
  getTelegramRuntimeConfig,
  safeSecretEquals,
  TelegramConfigurationError
} from "@/lib/telegram-auth";
import { createTelegramDependencies } from "@/lib/telegram-service";
import {
  processTelegramUpdate,
  type TelegramUpdate
} from "@/lib/telegram-webhook-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let config;

  try {
    config = getTelegramRuntimeConfig();
  } catch (error) {
    if (error instanceof TelegramConfigurationError) {
      console.error(error.message);
      return NextResponse.json(
        { ok: false, message: "Telegram-интеграция не настроена на сервере" },
        { status: 503 }
      );
    }
    throw error;
  }

  if (
    !safeSecretEquals(
      request.headers.get("x-telegram-bot-api-secret-token"),
      config.webhookSecret
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  if (!update || typeof update !== "object") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await processTelegramUpdate(
      update,
      config.allowedChatId,
      createTelegramDependencies(config)
    );

    if (result === "forbidden") {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error", error);
    return NextResponse.json(
      { ok: false, message: "Не удалось обработать Telegram update" },
      { status: 500 }
    );
  }
}
