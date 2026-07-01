type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

async function callTelegram<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const data = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;

  if (!response.ok || !data?.ok || data.result === undefined) {
    throw new Error(`Telegram API request failed: ${method}`);
  }

  return data.result;
}

export function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
) {
  return callTelegram(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

export function answerTelegramCallback(
  botToken: string,
  callbackQueryId: string,
  text?: string
) {
  return callTelegram(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {})
  });
}

export async function downloadTelegramVoice(botToken: string, fileId: string) {
  const file = await callTelegram<{ file_path?: string; file_size?: number }>(
    botToken,
    "getFile",
    { file_id: fileId }
  );

  if (!file.file_path) {
    throw new Error("Telegram did not return a voice file path");
  }

  if (file.file_size && file.file_size > 10 * 1024 * 1024) {
    throw new Error("VOICE_TOO_LARGE");
  }

  const response = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Telegram voice download failed");
  }

  const blob = await response.blob();

  if (blob.size > 10 * 1024 * 1024) {
    throw new Error("VOICE_TOO_LARGE");
  }

  return blob;
}

export function setTelegramWebhook(
  botToken: string,
  url: string,
  webhookSecret: string
) {
  return callTelegram<boolean>(botToken, "setWebhook", {
    url,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false
  });
}
