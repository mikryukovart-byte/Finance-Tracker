import { expect, test } from "@playwright/test";

import { safeSecretEquals } from "@/lib/telegram-auth";
import {
  parseTelegramDailyAction,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import {
  processTelegramUpdate,
  type TelegramWebhookDependencies
} from "@/lib/telegram-webhook-core";
import type { TelegramWorkRecord } from "@/lib/telegram-work-records";
import {
  classifyTelegramInput,
  parseTelegramJournal,
  type TelegramJournal
} from "@/lib/journal";
import { dailyFeedbackModel } from "@/lib/daily-feedback";
import { splitTelegramMessage, weeklyDeliveryWindow } from "@/lib/weekly-delivery";
import { weeklyReportIdempotencyKey, weeklyReportModel } from "@/lib/weekly-report";

const action: TelegramDailyAction = {
  type: "WARM_CONTACT",
  date: "2026-07-01",
  target: "директор Oceaniq",
  value: "вышел напрямую на человека, который принимает решения",
  nextStep: "follow-up через 3 дня",
  note: "Написал директору Oceaniq"
};

const workRecord: TelegramWorkRecord = {
  title: "Сфокусироваться на исходящих",
  recordType: "DECISION",
  summary: "Входящих обращений пока нет. Ближайшие три дня приоритетом будут исходящие сообщения.",
  insight: "Сайт сейчас не является главным ограничением.",
  risk: null,
  nextStep: "Написать потенциальным клиентам",
  relatedWeekStart: "2026-06-29",
  source: "TELEGRAM_TEXT"
};

const journalEntry: TelegramJournal = {
  entryDate: "2026-07-01",
  source: "TELEGRAM_VOICE",
  cleanedText: "Сегодня я много думал о работе и своих проектах. Пока не уверен, что нужно резко менять курс.",
  summary: "Пользователь сопоставляет работу и собственные проекты, но пока не принял решение менять курс.",
  domains: ["EMPLOYMENT", "OWN_PROJECTS", "INNER_STATE"],
  keyEvents: [{ text: "Сегодня размышлял о работе и своих проектах", kind: "FACT" }],
  tensions: [{ text: "Хочется двигать свои проекты, но резкая смена курса пока вызывает сомнение", kind: "USER_INTERPRETATION" }],
  decisions: null,
  questions: null,
  nextStep: null,
  importance: "NORMAL"
};

function createDependencies(
  overrides: Partial<TelegramWebhookDependencies> = {}
): TelegramWebhookDependencies {
  return {
    classifyInput: async () => "ACTION",
    parseAction: async () => action,
    parseWorkRecord: async () => workRecord,
    parseJournal: async () => journalEntry,
    transcribeVoice: async () => action.note,
    createPending: async () => "pending-id",
    createPendingWorkRecord: async () => "work-pending-id",
    createPendingJournal: async () => "journal-pending-id",
    cancelPending: async () => true,
    cancelPendingWorkRecord: async () => true,
    cancelPendingJournal: async () => true,
    savePending: async () => ({ type: action.type, target: action.target }),
    savePendingWorkRecord: async () => true,
    savePendingJournal: async () => ({
      id: "journal-id",
      summary: journalEntry.summary,
      feedback: "Что я здесь вижу\n\nКороткая обратная связь."
    }),
    convertPendingWorkRecord: async () => ({ pendingId: "action-pending-id", action }),
    sendMessage: async () => ({}),
    answerCallback: async () => ({}),
    ...overrides
  };
}

test.describe("Telegram webhook core", () => {
  test("parses a deterministic structured OpenAI response without network calls", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let responseFormatType = "";
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body));
      responseFormatType = requestBody.response_format?.type || "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...action, note: "model may not rewrite this" })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      const parsed = await parseTelegramDailyAction(
        "Написал директору Oceaniq",
        new Date("2026-07-01T12:00:00Z")
      );
      expect(parsed).toEqual({
        ...action,
        note: "Написал директору Oceaniq"
      });
      expect(responseFormatType).toBe("json_schema");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("defaults an uncertain Telegram classification to Journal", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ kind: "WORK_RECORD", confidence: 0.55 }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    try {
      await expect(classifyTelegramInput("Я пока не понимаю, чего хочу от этой недели", "TELEGRAM_VOICE")).resolves.toBe("JOURNAL");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("parses cleaned first-person Journal data without adding raw transcript fields", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        ...journalEntry,
        source: undefined
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    try {
      const parsed = await parseTelegramJournal("Я думаю о работе, но пока не уверен, что нужно резко менять курс.", "TELEGRAM_TEXT");
      expect(parsed?.cleanedText.startsWith("Сегодня я")).toBeTruthy();
      expect(parsed?.domains).toContain("EMPLOYMENT");
      expect(parsed).not.toHaveProperty("rawTranscript");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("rejects a wrong webhook secret", () => {
    expect(safeSecretEquals("wrong-secret", "expected-secret")).toBeFalsy();
    expect(safeSecretEquals("expected-secret", "expected-secret")).toBeTruthy();
  });

  test("does not process updates from another chat", async () => {
    let parsed = false;
    const result = await processTelegramUpdate(
      { message: { chat: { id: "other-chat" }, text: "Позвонил клиенту" } },
      "allowed-chat",
      createDependencies({
        parseAction: async () => {
          parsed = true;
          return action;
        }
      })
    );

    expect(result).toBe("forbidden");
    expect(parsed).toBeFalsy();
  });

  test("Save claims only the pending item scoped to the callback chat", async () => {
    const saveCalls: Array<{ chatId: string; pendingId: string }> = [];
    const result = await processTelegramUpdate(
      {
        callback_query: {
          id: "callback-1",
          data: "save:pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePending: async (chatId, pendingId) => {
          saveCalls.push({ chatId, pendingId });
          return { type: action.type, target: action.target };
        }
      })
    );

    expect(result).toBe("handled");
    expect(saveCalls).toEqual([
      { chatId: "allowed-chat", pendingId: "pending-id" }
    ]);
  });

  test("Cancel never calls the save operation", async () => {
    let saveCount = 0;
    let cancelCount = 0;
    await processTelegramUpdate(
      {
        callback_query: {
          id: "callback-2",
          data: "cancel:pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePending: async () => {
          saveCount += 1;
          return { type: action.type, target: action.target };
        },
        cancelPending: async () => {
          cancelCount += 1;
          return true;
        }
      })
    );

    expect(cancelCount).toBe(1);
    expect(saveCount).toBe(0);
  });

  test("creates a WorkRecord confirmation from text without entering the action flow", async () => {
    const messages: Array<{ text: string; replyMarkup?: unknown }> = [];
    let parsedAction = false;
    let parsedSource = "";

    await processTelegramUpdate(
      {
        message: {
          chat: { id: "allowed-chat" },
          text: "Думаю делать сайт, но ближайшие три дня лучше писать людям"
        }
      },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "WORK_RECORD",
        parseAction: async () => {
          parsedAction = true;
          return action;
        },
        parseWorkRecord: async (_text, source) => {
          parsedSource = source;
          return workRecord;
        },
        sendMessage: async (_chatId, text, replyMarkup) => {
          messages.push({ text, replyMarkup });
          return {};
        }
      })
    );

    expect(parsedAction).toBeFalsy();
    expect(parsedSource).toBe("TELEGRAM_TEXT");
    expect(messages[0].text).toContain("Рабочая запись");
    expect(messages[0].text).toContain(workRecord.title);
    expect(JSON.stringify(messages[0].replyMarkup)).toContain("work_save:work-pending-id");
    expect(JSON.stringify(messages[0].replyMarkup)).toContain("work_convert:work-pending-id");
  });

  test("saving a WorkRecord does not save a Daily Action", async () => {
    let workSaveCount = 0;
    let actionSaveCount = 0;
    const messages: string[] = [];

    await processTelegramUpdate(
      {
        callback_query: {
          id: "work-save-callback",
          data: "work_save:work-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePendingWorkRecord: async () => {
          workSaveCount += 1;
          return true;
        },
        savePending: async () => {
          actionSaveCount += 1;
          return { type: action.type, target: action.target };
        },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );

    expect(workSaveCount).toBe(1);
    expect(actionSaveCount).toBe(0);
    expect(messages).toContain("Рабочая запись сохранена.");
  });

  test("conversion requires the existing second action confirmation", async () => {
    let actionSaveCount = 0;
    const messages: string[] = [];
    const dependencies = createDependencies({
      savePending: async () => {
        actionSaveCount += 1;
        return { type: action.type, target: action.target };
      },
      sendMessage: async (_chatId, text) => {
        messages.push(text);
        return {};
      }
    });

    await processTelegramUpdate(
      {
        callback_query: {
          id: "work-convert-callback",
          data: "work_convert:work-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      dependencies
    );

    expect(actionSaveCount).toBe(0);
    expect(messages.some((message) => message.startsWith("Я понял так:"))).toBeTruthy();

    await processTelegramUpdate(
      {
        callback_query: {
          id: "action-save-callback",
          data: "save:action-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      dependencies
    );

    expect(actionSaveCount).toBe(1);
  });

  test("canceling a WorkRecord saves neither records nor actions", async () => {
    let cancelCount = 0;
    let workSaveCount = 0;
    let actionSaveCount = 0;
    const messages: string[] = [];

    await processTelegramUpdate(
      {
        callback_query: {
          id: "work-cancel-callback",
          data: "work_cancel:work-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        cancelPendingWorkRecord: async () => {
          cancelCount += 1;
          return true;
        },
        savePendingWorkRecord: async () => {
          workSaveCount += 1;
          return true;
        },
        savePending: async () => {
          actionSaveCount += 1;
          return { type: action.type, target: action.target };
        },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );

    expect(cancelCount).toBe(1);
    expect(workSaveCount).toBe(0);
    expect(actionSaveCount).toBe(0);
    expect(messages).toContain("Не сохраняю.");
  });

  test("accepts a voice message up to 300 seconds", async () => {
    let transcribed = 0;
    const pendingEntries: TelegramJournal[] = [];
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, voice: { file_id: "voice-300", duration: 300 } } },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "JOURNAL",
        transcribeVoice: async () => {
          transcribed += 1;
          return "Свободная дневниковая запись";
        },
        createPendingJournal: async (_chatId, entry) => {
          pendingEntries.push(entry);
          return "journal-pending-id";
        }
      })
    );
    expect(transcribed).toBe(1);
    expect(pendingEntries[0]?.summary).toBe(journalEntry.summary);
  });

  test("does not persist a raw transcript when voice is classified as Daily Action", async () => {
    const rawTranscript = "Дословная длинная расшифровка голосового сообщения";
    const pendingActions: TelegramDailyAction[] = [];
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, voice: { file_id: "voice-action", duration: 40 } } },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "ACTION",
        transcribeVoice: async () => rawTranscript,
        parseAction: async () => ({ ...action, note: rawTranscript }),
        createPending: async (_chatId, parsedAction) => {
          pendingActions.push(parsedAction);
          return "pending-id";
        }
      })
    );
    expect(pendingActions[0]?.note).toBe("Добавлено из голосового сообщения");
    expect(JSON.stringify(pendingActions[0])).not.toContain(rawTranscript);
  });

  test("rejects a voice message over 300 seconds without transcription", async () => {
    let transcribed = 0;
    const messages: string[] = [];
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, voice: { file_id: "voice-301", duration: 301 } } },
      "allowed-chat",
      createDependencies({
        transcribeVoice: async () => {
          transcribed += 1;
          return "Не должно вызываться";
        },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );
    expect(transcribed).toBe(0);
    expect(messages[0]).toContain("длиннее 5 минут");
  });

  test("requires confirmation before a JournalEntry is saved and persists no raw fields", async () => {
    let saved = 0;
    let pendingEntry: TelegramJournal | null = null;
    const messages: Array<{ text: string; markup?: unknown }> = [];
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "Длинная свободная мысль о сегодняшнем дне" } },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "JOURNAL",
        parseJournal: async (_text, source) => ({ ...journalEntry, source }),
        createPendingJournal: async (_chatId, entry) => {
          pendingEntry = entry;
          return "journal-pending-id";
        },
        savePendingJournal: async () => {
          saved += 1;
          return { id: "journal-id", summary: journalEntry.summary };
        },
        sendMessage: async (_chatId, text, markup) => {
          messages.push({ text, markup });
          return {};
        }
      })
    );
    expect(saved).toBe(0);
    expect(messages[0].text).toContain("Дневниковая запись");
    expect(JSON.stringify(messages[0].markup)).toContain("journal_save:journal-pending-id");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("rawTranscript");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("fileId");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("audio");
  });

  test("Journal cancel creates no entry and Save sends feedback only after confirmation", async () => {
    let saved = 0;
    let canceled = 0;
    const messages: string[] = [];
    const dependencies = createDependencies({
      cancelPendingJournal: async () => {
        canceled += 1;
        return true;
      },
      savePendingJournal: async () => {
        saved += 1;
        return { id: "journal-id", summary: journalEntry.summary, feedback: "Что я здесь вижу\n\nФакт подтвержден." };
      },
      sendMessage: async (_chatId, text) => {
        messages.push(text);
        return {};
      }
    });
    await processTelegramUpdate(
      { callback_query: { id: "journal-cancel", data: "journal_cancel:journal-pending-id", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );
    expect(canceled).toBe(1);
    expect(saved).toBe(0);
    expect(messages).not.toContain("Что я здесь вижу\n\nФакт подтвержден.");

    await processTelegramUpdate(
      { callback_query: { id: "journal-save", data: "journal_save:journal-pending-id", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );
    expect(saved).toBe(1);
    expect(messages).toContain("Что я здесь вижу\n\nФакт подтвержден.");
  });

  test("uses the dedicated daily feedback model fallback chain", () => {
    const previous = {
      feedback: process.env.OPENAI_DAILY_FEEDBACK_MODEL,
      work: process.env.OPENAI_WORK_RECORD_MODEL,
      common: process.env.OPENAI_MODEL
    };
    try {
      process.env.OPENAI_DAILY_FEEDBACK_MODEL = "daily-model";
      process.env.OPENAI_WORK_RECORD_MODEL = "work-model";
      process.env.OPENAI_MODEL = "common-model";
      expect(dailyFeedbackModel()).toBe("daily-model");
      delete process.env.OPENAI_DAILY_FEEDBACK_MODEL;
      expect(dailyFeedbackModel()).toBe("work-model");
      delete process.env.OPENAI_WORK_RECORD_MODEL;
      expect(dailyFeedbackModel()).toBe("common-model");
    } finally {
      process.env.OPENAI_DAILY_FEEDBACK_MODEL = previous.feedback;
      process.env.OPENAI_WORK_RECORD_MODEL = previous.work;
      process.env.OPENAI_MODEL = previous.common;
    }
  });

  test("splits long weekly reports safely and detects a configured delivery window", () => {
    const report = Array.from({ length: 12 }, (_, index) => `Раздел ${index + 1}\n${"текст ".repeat(90)}`).join("\n\n");
    const parts = splitTelegramMessage(report, 900);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 900)).toBeTruthy();
    expect(weeklyDeliveryWindow(
      { enabled: true, timezone: "UTC", weekday: 3, localTime: "10:00" },
      new Date("2026-07-01T10:20:00Z")
    )).toBe("2026-07-01");
    expect(weeklyReportIdempotencyKey("user-1", new Date("2026-07-01T12:00:00Z")))
      .toBe(weeklyReportIdempotencyKey("user-1", new Date("2026-07-05T12:00:00Z")));
    expect(weeklyReportIdempotencyKey("user-1", new Date("2026-07-06T12:00:00Z")))
      .not.toBe(weeklyReportIdempotencyKey("user-1", new Date("2026-07-05T12:00:00Z")));
  });

  test("uses a weekly model chain independent from daily feedback", () => {
    const previous = {
      weekly: process.env.OPENAI_WEEKLY_REPORT_MODEL,
      advisor: process.env.OPENAI_ADVISOR_MODEL,
      common: process.env.OPENAI_MODEL
    };
    try {
      process.env.OPENAI_WEEKLY_REPORT_MODEL = "weekly-model";
      process.env.OPENAI_ADVISOR_MODEL = "advisor-model";
      process.env.OPENAI_MODEL = "common-model";
      expect(weeklyReportModel()).toBe("weekly-model");
      delete process.env.OPENAI_WEEKLY_REPORT_MODEL;
      expect(weeklyReportModel()).toBe("advisor-model");
      delete process.env.OPENAI_ADVISOR_MODEL;
      expect(weeklyReportModel()).toBe("common-model");
    } finally {
      process.env.OPENAI_WEEKLY_REPORT_MODEL = previous.weekly;
      process.env.OPENAI_ADVISOR_MODEL = previous.advisor;
      process.env.OPENAI_MODEL = previous.common;
    }
  });
});
