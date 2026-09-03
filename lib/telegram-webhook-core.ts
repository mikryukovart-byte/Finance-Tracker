import {
  telegramDailyActionLabels,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import {
  workRecordTypeLabels,
  type TelegramWorkRecord,
  type TelegramWorkRecordSource
} from "@/lib/telegram-work-records";
import {
  journalDomainLabels,
  journalPreviewThoughts,
  TelegramJournalParseError,
  type TelegramInputKind,
  type TelegramJournal,
  type TelegramJournalSource
} from "@/lib/journal";
import type {
  TelegramLifeContextProposal,
  TelegramLifeContextSaveResult
} from "@/lib/telegram-life-context";

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
  classifyInput(
    text: string,
    source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
  ): Promise<TelegramInputKind>;
  parseAction(text: string): Promise<TelegramDailyAction | null>;
  parseWorkRecord(
    text: string,
    source: Extract<TelegramWorkRecordSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
  ): Promise<TelegramWorkRecord | null>;
  parseJournal(
    text: string,
    source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
  ): Promise<TelegramJournal | null>;
  parseLifeContext(
    text: string,
    source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
  ): Promise<TelegramLifeContextProposal | null>;
  transcribeVoice(fileId: string): Promise<string>;
  createPending(chatId: string, action: TelegramDailyAction): Promise<string>;
  createPendingWorkRecord(chatId: string, record: TelegramWorkRecord): Promise<string>;
  createPendingJournal(chatId: string, entry: TelegramJournal): Promise<string>;
  createPendingLifeContext(
    chatId: string,
    proposal: TelegramLifeContextProposal
  ): Promise<string>;
  convertPendingJournalToLifeContext(
    chatId: string,
    pendingId: string
  ): Promise<{ pendingId: string; proposal: TelegramLifeContextProposal } | null>;
  startLifeContextMode(chatId: string): Promise<void>;
  consumeLifeContextMode(chatId: string): Promise<boolean>;
  cancelPending(chatId: string, pendingId: string): Promise<boolean>;
  cancelPendingWorkRecord(chatId: string, pendingId: string): Promise<boolean>;
  cancelPendingJournal(chatId: string, pendingId: string): Promise<boolean>;
  cancelPendingLifeContext(chatId: string, pendingId: string): Promise<boolean>;
  savePending(chatId: string, pendingId: string): Promise<TelegramSavedAction | null>;
  savePendingWorkRecord(chatId: string, pendingId: string): Promise<boolean>;
  savePendingJournal(
    chatId: string,
    pendingId: string
  ): Promise<{ id: string; summary: string; feedback?: string } | null>;
  savePendingLifeContext(
    chatId: string,
    pendingId: string
  ): Promise<TelegramLifeContextSaveResult | null>;
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
  "Не смог уверенно разобрать сообщение. Попробуй сформулировать мысль ещё раз или отправь её текстом.";
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

export function journalConfirmationText(entry: TelegramJournal) {
  const thoughts = journalPreviewThoughts(entry);
  const decisions = entry.decisions?.map((item) => item.text).slice(0, 2) ?? [];
  const lines = [
    "Дневниковая запись",
    "",
    "Суть:",
    personalPreviewText(entry.summary),
    "",
    `Сферы: ${entry.domains.map((domain) => journalDomainLabels[domain]).join(", ")}`
  ];

  if (thoughts.length) {
    lines.push(
      "",
      "Что важно:",
      ...thoughts.map((thought) => `• ${compactPreviewText(personalPreviewText(thought), 260)}`)
    );
  }
  if (decisions.length) {
    lines.push(
      "",
      "Решения:",
      ...decisions.map((decision) => `• ${compactPreviewText(personalPreviewText(decision), 260)}`)
    );
  }
  if (entry.nextStep) {
    lines.push(
      "",
      "Ближайший шаг / событие:",
      compactPreviewText(personalPreviewText(entry.nextStep), 420)
    );
  }
  lines.push("", "Выбери действие:");
  return lines.join("\n").slice(0, 3900);
}

function compactPreviewText(value: string, maxLength: number) {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function personalPreviewText(value: string) {
  const withoutThirdPerson = value
    .replace(
      /(^|[^А-ЯЁа-яё])(?:автор|пользователь|субъект)(?=$|[^А-ЯЁа-яё])[\s,:—-]*/gi,
      "$1"
    )
    .trim();
  if (/(^|[^А-ЯЁа-яё])ты(?=$|[^А-ЯЁа-яё])/i.test(withoutThirdPerson)) {
    return withoutThirdPerson;
  }
  return `Ты: ${withoutThirdPerson}`;
}

const lifeContextModePrompt =
  "Наговори, что сейчас происходит в твоей жизни. Можно свободно рассказать про работу, деньги, свои проекты, отношения, состояние, планы, ограничения и важные решения.";

function parseCallbackData(value: string | undefined) {
  if (value === "context_mode") {
    return { command: "context_mode" as const, pendingId: "" };
  }

  const match = /^(save|cancel|work_save|work_convert|work_cancel|journal_save|journal_context|journal_cancel|context_apply|context_cancel):([a-zA-Z0-9_-]{1,48})$/.exec(
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
      | "work_cancel"
      | "journal_save"
      | "journal_context"
      | "journal_cancel"
      | "context_apply"
      | "context_cancel",
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

  if (parsed.command === "context_mode") {
    await dependencies.startLifeContextMode(chatId);
    await dependencies.answerCallback(callback.id, "Режим включён на 30 минут");
    await dependencies.sendMessage(chatId, lifeContextModePrompt);
    return;
  }

  if (parsed.command === "context_cancel") {
    const canceled = await dependencies.cancelPendingLifeContext(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, canceled ? "Отменено" : "Черновик недоступен");
    await dependencies.sendMessage(
      chatId,
      canceled ? "Изменения текущего контекста отменены." : "Черновик уже недоступен или истёк."
    );
    return;
  }

  if (parsed.command === "context_apply") {
    const saved = await dependencies.savePendingLifeContext(chatId, parsed.pendingId);
    await dependencies.answerCallback(
      callback.id,
      saved === "SAVED" ? "Применено" : "Черновик недоступен"
    );
    if (saved === "SAVED") {
      await dependencies.sendMessage(
        chatId,
        "Текущий контекст обновлен. Его можно посмотреть и отредактировать вручную в Советнике."
      );
      return;
    }
    if (saved === "STALE") {
      await dependencies.sendMessage(
        chatId,
        "Текущий контекст изменился после создания preview. Отправь обновление ещё раз, чтобы не затереть новые данные."
      );
      return;
    }
    await dependencies.sendMessage(chatId, "Черновик уже недоступен или истёк.");
    return;
  }

  if (parsed.command === "journal_cancel") {
    const canceled = await dependencies.cancelPendingJournal(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, canceled ? "Отменено" : "Черновик недоступен");
    await dependencies.sendMessage(
      chatId,
      canceled ? "Не сохраняю." : "Черновик уже недоступен или истёк."
    );
    return;
  }

  if (parsed.command === "journal_save") {
    const saved = await dependencies.savePendingJournal(chatId, parsed.pendingId);
    await dependencies.answerCallback(callback.id, saved ? "Сохранено" : "Черновик недоступен");
    if (!saved) {
      await dependencies.sendMessage(chatId, "Черновик уже недоступен или истёк.");
      return;
    }
    await dependencies.sendMessage(chatId, "Дневниковая запись сохранена.");
    if (saved.feedback) await dependencies.sendMessage(chatId, saved.feedback);
    return;
  }

  if (parsed.command === "journal_context") {
    try {
      const converted = await dependencies.convertPendingJournalToLifeContext(
        chatId,
        parsed.pendingId
      );
      if (!converted) {
        await dependencies.answerCallback(callback.id, "Черновик недоступен");
        await dependencies.sendMessage(chatId, "Черновик уже недоступен или истёк.");
        return;
      }
      await dependencies.answerCallback(callback.id, "Preview контекста готов");
      await dependencies.sendMessage(chatId, converted.proposal.preview, {
        inline_keyboard: [[
          { text: "✅ Применить", callback_data: `context_apply:${converted.pendingId}` },
          { text: "❌ Отмена", callback_data: `context_cancel:${converted.pendingId}` }
        ]]
      });
    } catch (error) {
      console.error("Telegram Journal to LifeContext conversion failed", {
        message: error instanceof Error ? error.message : "unknown"
      });
      await dependencies.answerCallback(callback.id, "Не удалось подготовить изменения");
      await dependencies.sendMessage(
        chatId,
        "Не смог подготовить изменения текущего контекста. Дневниковая запись не сохранена, контекст не изменён."
      );
    }
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
  dependencies: TelegramWebhookDependencies,
  forcedKind?: TelegramInputKind
) {
  try {
    const kind = forcedKind ?? await dependencies.classifyInput(text, source);

    if (kind === "ACTION") {
      const parsedAction = await dependencies.parseAction(text);

      if (!parsedAction) {
        await dependencies.sendMessage(chatId, unclearMessage);
        return;
      }

      const action = source === "TELEGRAM_VOICE"
        ? { ...parsedAction, note: "Добавлено из голосового сообщения" }
        : parsedAction;

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

    if (kind === "WORK_RECORD") {
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
      return;
    }

    if (kind === "LIFE_CONTEXT") {
      const proposal = await dependencies.parseLifeContext(text, source);

      if (!proposal) {
        await dependencies.sendMessage(chatId, unclearMessage);
        return;
      }

      const pendingId = await dependencies.createPendingLifeContext(chatId, proposal);
      await dependencies.sendMessage(chatId, proposal.preview, {
        inline_keyboard: [[
          { text: "✅ Применить", callback_data: `context_apply:${pendingId}` },
          { text: "❌ Отмена", callback_data: `context_cancel:${pendingId}` }
        ]]
      });
      return;
    }

    const entry = await dependencies.parseJournal(text, source);
    if (!entry) {
      await dependencies.sendMessage(chatId, unclearMessage);
      return;
    }
    const pendingId = await dependencies.createPendingJournal(chatId, entry);
    await dependencies.sendMessage(chatId, journalConfirmationText(entry), {
      inline_keyboard: [
        [{ text: "Сохранить в дневник", callback_data: `journal_save:${pendingId}` }],
        [{ text: "В текущий контекст", callback_data: `journal_context:${pendingId}` }],
        [{ text: "Отмена", callback_data: `journal_cancel:${pendingId}` }]
      ]
    });
  } catch (error) {
    console.error("Telegram message parse error", error);
    if (error instanceof TelegramJournalParseError) {
      await dependencies.sendMessage(
        chatId,
        error.attempts === 2
          ? "Не смог структурировать дневниковую запись после двух попыток. Ничего не сохранено. Попробуй отправить текстом или разделить голосовое на две части."
          : "Не смог структурировать дневниковую запись. Ничего не сохранено. Попробуй отправить текстом или повторить позже."
      );
      return;
    }
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
      "Я записываю действия, рабочие заметки, дневниковые записи и явные изменения текущего контекста. Пришли текст или голосовое — перед сохранением я покажу, как понял сообщение. Для разового обновления контекста используй /context.",
      {
        inline_keyboard: [[
          { text: "🧭 Текущий контекст", callback_data: "context_mode" }
        ]]
      }
    );
    return "handled";
  }

  if (text && (/^\/context(?:@\w+)?(?:\s|$)/i.test(text) || /^🧭\s*текущий контекст$/i.test(text))) {
    await dependencies.startLifeContextMode(chatId);
    await dependencies.sendMessage(chatId, lifeContextModePrompt);
    return "handled";
  }

  if (text) {
    const forceLifeContext = await dependencies.consumeLifeContextMode(chatId);
    await parseAndConfirm(
      chatId,
      text,
      "TELEGRAM_TEXT",
      dependencies,
      forceLifeContext ? "LIFE_CONTEXT" : undefined
    );
    return "handled";
  }

  const voice = message?.voice;

  if (!voice?.file_id) {
    return "ignored";
  }

  if (voice.duration !== undefined && voice.duration > 300) {
    await dependencies.sendMessage(
      chatId,
      "Голосовое длиннее 5 минут. Разбей мысль на несколько сообщений — я обработаю их по отдельности, а в общем анализе они будут рассматриваться вместе."
    );
    return "handled";
  }

  if (voice.file_size !== undefined && voice.file_size > 20 * 1024 * 1024) {
    await dependencies.sendMessage(chatId, "Файл голосового слишком большой. Разбей его на несколько сообщений.");
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

  const forceLifeContext = await dependencies.consumeLifeContextMode(chatId);
  await parseAndConfirm(
    chatId,
    transcript,
    "TELEGRAM_VOICE",
    dependencies,
    forceLifeContext ? "LIFE_CONTEXT" : undefined
  );
  return "handled";
}
