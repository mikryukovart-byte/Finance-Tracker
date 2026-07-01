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

const action: TelegramDailyAction = {
  type: "WARM_CONTACT",
  date: "2026-07-01",
  target: "директор Oceaniq",
  value: "вышел напрямую на человека, который принимает решения",
  nextStep: "follow-up через 3 дня",
  note: "Написал директору Oceaniq"
};

function createDependencies(
  overrides: Partial<TelegramWebhookDependencies> = {}
): TelegramWebhookDependencies {
  return {
    parseAction: async () => action,
    transcribeVoice: async () => action.note,
    createPending: async () => "pending-id",
    cancelPending: async () => true,
    savePending: async () => ({ type: action.type, target: action.target }),
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
});
