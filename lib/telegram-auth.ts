import { timingSafeEqual } from "node:crypto";

export type TelegramRuntimeConfig = {
  botToken: string;
  webhookSecret: string;
  allowedChatId: string;
  trackerUserId: string;
};

export class TelegramConfigurationError extends Error {
  constructor(missingNames: string[]) {
    super(`Не настроены серверные переменные: ${missingNames.join(", ")}`);
    this.name = "TelegramConfigurationError";
  }
}

function readRequiredEnv(names: string[]) {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    const value = process.env[name]?.trim();

    if (!value) {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new TelegramConfigurationError(missing);
  }

  return values;
}

export function getTelegramRuntimeConfig(): TelegramRuntimeConfig {
  const values = readRequiredEnv([
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_ALLOWED_CHAT_ID",
    "TELEGRAM_TRACKER_USER_ID"
  ]);

  return {
    botToken: values.TELEGRAM_BOT_TOKEN,
    webhookSecret: values.TELEGRAM_WEBHOOK_SECRET,
    allowedChatId: values.TELEGRAM_ALLOWED_CHAT_ID,
    trackerUserId: values.TELEGRAM_TRACKER_USER_ID
  };
}

export function getTelegramSetupConfig() {
  const values = readRequiredEnv([
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_SETUP_SECRET"
  ]);

  return {
    botToken: values.TELEGRAM_BOT_TOKEN,
    webhookSecret: values.TELEGRAM_WEBHOOK_SECRET,
    setupSecret: values.TELEGRAM_SETUP_SECRET
  };
}

export function safeSecretEquals(received: string | null, expected: string) {
  if (!received) {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function isAllowedTelegramChat(chatId: string, allowedChatId: string) {
  return chatId === allowedChatId;
}
