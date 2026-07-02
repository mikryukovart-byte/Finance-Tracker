import {
  telegramDailyActionLabels,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import {
  workRecordTypeLabels,
  type TelegramWorkRecord,
  type TelegramWorkRecordSource
} from "@/lib/telegram-work-records";

export type TelegramUpdate = {
  message?: {
    chat?: { id?: string | number };
    text?: string;
    voice?: {
      file_id?: string;
      duration?: number;
      file_size?: number;
    };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: string | number } };
  };
};

export type TelegramSavedAction = Pick<TelegramDailyAction, "type" | "target">;

export type TelegramWebhookDependencies = {
  classifyInput(text: string): Promise<"ACTION" | "WORK_RECORD">;
  parseAction(text: string): Promise<TelegramDailyAction | null>;
  parseWorkRecord(
    text: string,
    source: Extract<TelegramWorkRecordSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
  ): Promise<TelegramWorkRecord | null>;
  transcribeVoice(fileId: string): Promise<string>;
  createPending(chatId: string, action: TelegramDailyAction): Promise<string>;
  createPendingWorkRecord(chatId: string, record: TelegramWorkRecord): Promise<string>;
  cancelPending(chatId: string, pendingId: string): Promise<boolean>;
  cancelPendingWorkRecord(chatId: string, pendingId: string): Promise<boolean>;
  savePending(chatId: string, pendingId: string): Promise<TelegramSavedAction | null>;
  savePendingWorkRecord(chatId: string, pendingId: string): Promise<boolean>;
  convertPendingWorkRecord(
    chatId: string,
    pendingId: string
  ): Promise<{ pendingId: string; action: TelegramDailyAction } | null>;
  sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    }
  ): Promise<unknown>;
  answerCallback(callbackQueryId: string, text?: string): Promise<unknown>;
};

const unclearMessage =
  "Не понял, какое действие записать. Скажи коротко: что сделал, кому, почему это важно и следующий шаг.";
const voiceFailureMessage =
  "Не смог разобрать голосовое. Попробуй короче или отправь текстом.";

function chatIdFromUpdate(update: TelegramUpdate) {
  const value =
    update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  return value === undefined ? null : String(value);
}

function displayValue(value: string | null) {
  return value || "—";
}

export function confirmationText(action: TelegramDailyAction) {
  return [
    "Я понял так:",
    "",
    `Тип: ${telegramDailyActionLabels[action.type]}`,
    `Кому / куда: ${displayValue(action.target)}`,
    `Ценность: ${displayValue(action.value)}`,
    `Следующий шаг: ${displayValue(action.nextStep)}`,
    "",
    "Сохранить?"
  ].join("\n");
}

export function workRecordConfirmationText(record: TelegramWorkRecord) {
  const lines = [
    "Рабочая запись",
    "",
    `Тип: ${workRecordTypeLabels[record.recordType]}`,
    `Тема: ${record.title}`,
    "",
    "Суть:",
    record.summary
  ];

  if (record.insight) lines.push("", "Вывод:", record.insight);
  if (record.risk) lines.push("", "Риск:", record.risk);
  if (record.nextStep) lines.push("", "Следующий шаг:", record.nextStep);

  return lines.join("\n");
}

function parseCallbackData(value: string | undefined) {
  const match = /^(save|cancel|work_save|work_convert|work_cancel):([a-zA-Z0-9_-]{1,48})$/.exec(
    value || ""
  );

  if (!match) {
    return null;
  }

  return {
    command: match[1] as
      | "save"
      | "cancel"
      | "work_save"
      | "work_convert"
      | "work_cancel",
    pendingId: match[2]
  };
}

async function handleCallback(
  update: TelegramUpdate,
  chatId: string,
  dependencies: TelegramWebhookDependencies
) {
  const callback = update.callback_query;

  if (!callback?.id) {
    return;
  }

  const parsed = parseCallbackData(callback.data);

  if (!parsed) {
    await dependencies.answerCallback(callback.id, "Команда устарела");
    return;
  }

  if (parsed.command === "work_cancel") {
    const canceled = await dependencies.cancelPendingWorkRecord(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, canceled ? "Отменено" : "Черновик недоступен");
    await dependencies.sendMessage(
      chatId,
      canceled ? "Не сохраняю." : "Черновик уже недоступен или истёк."
    );
    return;
  }

  if (parsed.command === "work_save") {
    const saved = await dependencies.savePendingWorkRecord(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, saved ? "Сохранено" : "Черновик недоступен");
    await dependencies.sendMessage(
      chatId,
      saved ? "Рабочая запись сохранена." : "Черновик уже недоступен или истёк."
    );
    return;
  }

  if (parsed.command === "work_convert") {
    const converted = await dependencies.convertPendingWorkRecord(chatId, parsed.pendingId);

    if (!converted) {
      await dependencies.answerCallback(callback.id, "Черновик недоступен");
      await dependencies.sendMessage(chatId, "Черновик уже недоступен или истёк.");
      return;
    }

    await dependencies.answerCallback(callback.id, "Черновик действия создан");
    await dependencies.sendMessage(chatId, confirmationText(converted.action), {
      inline_keyboard: [
        [
          { text: "Сохранить", callback_data: `save:${converted.pendingId}` },
          { text: "Отмена", callback_data: `cancel:${converted.pendingId}` }
        ]
      ]
    });
    return;
  }

  if (parsed.command === "cancel") {
    const canceled = await dependencies.cancelPending(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, canceled ? "Отменено" : "Черновик недоступен");
    await dependencies.sendMessage(
      chatId,
      canceled ? "Отменено." : "Черновик уже недоступен или истёк."
    );
    return;
  }

  const saved = await dependencies.savePending(chatId, parsed.pendingId);

  if (!saved) {
    await dependencies.answerCallback(callback.id, "Черновик недоступен");
    await dependencies.sendMessage(chatId, "Черновик уже недоступен или истёк.");
    return;
  }

  await dependencies.answerCallback(callback.id, "Сохранено");
  await dependencies.sendMessage(
    chatId,
    `Сохранено: ${telegramDailyActionLabels[saved.type]} · ${saved.target || "без адресата"}`
  );
}

async function parseAndConfirm(
  chatId: string,
  text: string,
  source: Extract<TelegramWorkRecordSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  dependencies: TelegramWebhookDependencies
) {
  try {
    const kind = await dependencies.classifyInput(text);

    if (kind === "ACTION") {
      const action = await dependencies.parseAction(text);

      if (!action) {
        await dependencies.sendMessage(chatId, unclearMessage);
        return;
      }

      const pendingId = await dependencies.createPending(chatId, action);
      await dependencies.sendMessage(chatId, confirmationText(action), {
        inline_keyboard: [
          [
            { text: "Сохранить", callback_data: `save:${pendingId}` },
            { text: "Отмена", callback_data: `cancel:${pendingId}` }
          ]
        ]
      });
      return;
    }

    const record = await dependencies.parseWorkRecord(text, source);

    if (!record) {
      await dependencies.sendMessage(chatId, unclearMessage);
      return;
    }

    const pendingId = await dependencies.createPendingWorkRecord(chatId, record);
    await dependencies.sendMessage(chatId, workRecordConfirmationText(record), {
      inline_keyboard: [
        [{ text: "Сохранить запись", callback_data: `work_save:${pendingId}` }],
        [{ text: "Превратить в действие", callback_data: `work_convert:${pendingId}` }],
        [{ text: "Отмена", callback_data: `work_cancel:${pendingId}` }]
      ]
    });
  } catch (error) {
    console.error("Telegram message parse error", error);
    await dependencies.sendMessage(
      chatId,
      "Не смог обработать сообщение. Попробуй ещё раз или отправь текст короче."
    );
  }
}

export async function processTelegramUpdate(
  update: TelegramUpdate,
  allowedChatId: string,
  dependencies: TelegramWebhookDependencies
): Promise<"handled" | "ignored" | "forbidden"> {
  const chatId = chatIdFromUpdate(update);

  if (!chatId) {
    return "ignored";
  }

  if (chatId !== allowedChatId) {
    return "forbidden";
  }

  if (update.callback_query) {
    await handleCallback(update, chatId, dependencies);
    return "handled";
  }

  const message = update.message;
  const text = message?.text?.trim();

  if (text && /^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    await dependencies.sendMessage(
      chatId,
      "Я записываю действия и рабочие заметки в твой трекер. Пришли текст или голосовое — перед сохранением я покажу, как понял сообщение."
    );
    return "handled";
  }

  if (text) {
    await parseAndConfirm(chatId, text, "TELEGRAM_TEXT", dependencies);
    return "handled";
  }

  const voice = message?.voice;

  if (!voice?.file_id) {
    return "ignored";
  }

  if (
    (voice.duration !== undefined && voice.duration > 90) ||
    (voice.file_size !== undefined && voice.file_size > 10 * 1024 * 1024)
  ) {
    await dependencies.sendMessage(
      chatId,
      "Голосовое должно быть не длиннее 90 секунд. Попробуй короче или отправь текстом."
    );
    return "handled";
  }

  let transcript: string;

  try {
    transcript = await dependencies.transcribeVoice(voice.file_id);
  } catch (error) {
    console.error("Telegram voice transcription error", error);
    await dependencies.sendMessage(chatId, voiceFailureMessage);
    return "handled";
  }

  await parseAndConfirm(chatId, transcript, "TELEGRAM_VOICE", dependencies);
  return "handled";
}
