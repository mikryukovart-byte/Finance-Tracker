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

function createDependencies(
  overrides: Partial<TelegramWebhookDependencies> = {}
): TelegramWebhookDependencies {
  return {
    classifyInput: async () => "ACTION",
    parseAction: async () => action,
    parseWorkRecord: async () => workRecord,
    transcribeVoice: async () => action.note,
    createPending: async () => "pending-id",
    createPendingWorkRecord: async () => "work-pending-id",
    cancelPending: async () => true,
    cancelPendingWorkRecord: async () => true,
    savePending: async () => ({ type: action.type, target: action.target }),
    savePendingWorkRecord: async () => true,
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
});
