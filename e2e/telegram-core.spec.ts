import { expect, test } from "@playwright/test";

import { safeSecretEquals } from "@/lib/telegram-auth";
import {
  parseTelegramDailyAction,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import {
  journalConfirmationText,
  processTelegramUpdate,
  type TelegramWebhookDependencies
} from "@/lib/telegram-webhook-core";
import type { TelegramWorkRecord } from "@/lib/telegram-work-records";
import {
  classifyTelegramInput,
  hasExplicitLifeContextIntent,
  journalMaxCompletionTokens,
  journalModel,
  parseTelegramJournal,
  TelegramJournalParseError,
  type TelegramJournal
} from "@/lib/journal";
import {
  applyLifeContextPatch,
  buildLifeContextPreview,
  lifeContextModel,
  normalizeTelegramLifeContextPatch,
  parseTelegramLifeContextProposal,
  type TelegramLifeContextProposal
} from "@/lib/telegram-life-context";
import { emptyLifeContext, type LifeContextValue } from "@/lib/life-context";
import { dailyFeedbackModel } from "@/lib/daily-feedback";
import {
  journalToLifeContextInput,
  lifeContextModeExpiresAt,
  lifeContextModeLifetimeMs
} from "@/lib/telegram-service";
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
  summary: "Ты сопоставляешь работу и собственные проекты, но пока не принял решение менять курс.",
  domains: ["EMPLOYMENT", "OWN_PROJECTS", "INNER_STATE"],
  keyEvents: [{ text: "Сегодня размышлял о работе и своих проектах", kind: "FACT" }],
  tensions: [{ text: "Хочется двигать свои проекты, но резкая смена курса пока вызывает сомнение", kind: "USER_INTERPRETATION" }],
  decisions: null,
  questions: null,
  nextStep: null,
  importance: "NORMAL"
};

const longTranscriptParts = Array.from(
  { length: 90 },
  (_, index) => `Фрагмент ${index + 1}: я подробно проговариваю события дня, свои сомнения, работу и то, что пока не хочу делать поспешных выводов.`
);
const longTranscript = longTranscriptParts.join(" ");
const longCleanedText = longTranscriptParts.slice(0, 68).join(" ");

const richJournalEntry: TelegramJournal = {
  entryDate: "2026-09-03",
  source: "TELEGRAM_VOICE",
  cleanedText: [
    "Я уже полгода живу в Москве и работаю исполнительным директором фотошколы. Мне нравится эта работа, потому что здесь я могу получить управленческий опыт перед запуском собственных проектов.",
    "Я сознательно остаюсь в найме: сейчас это не отказ от собственного пути, а школа управления и способ быстрее закрыть долги. После появления стабильной работы и квартиры мне стало спокойнее, поэтому я снова начал уделять внимание отношениям.",
    "Я хочу вернуть спорт и планирую начать ходить в зал в сентябре, но это пока намерение, а не жёсткое решение. По своему проекту я уже определил бизнес-модель, а 9 сентября встречаюсь с партнёром в Перми, чтобы обсудить следующий этап.",
    "До конца сентября я решил не увольняться. Пока остаюсь в Москве, держу финансовый приоритет на быстром погашении долгов и проверяю, как совместить работу, отношения, спорт и развитие проекта без поспешных решений."
  ].join("\n\n"),
  summary: [
    "Ты уже полгода живёшь в Москве и сознательно используешь работу исполнительным директором фотошколы как место, где можно получить управленческий опыт перед собственными проектами. Найм сейчас для тебя не отказ от своего пути, а практическая школа управления и источник стабильности, пока финансовый приоритет — как можно быстрее закрыть долги.",
    "После появления стабильной работы и квартиры тебе стало спокойнее, и ты сам связываешь это с возвращением внимания к отношениям. Ты хочешь вернуть спорт и планируешь начать зал в сентябре, но пока называешь это намерением. По собственному проекту уже есть бизнес-модель и конкретный следующий шаг — встреча 9 сентября в Перми."
  ].join("\n\n"),
  domains: ["MONEY", "EMPLOYMENT", "OWN_PROJECTS", "BODY_HEALTH", "RELATIONSHIPS"],
  keyEvents: [
    { text: "Ты уже полгода живёшь в Москве и работаешь исполнительным директором фотошколы", kind: "FACT" },
    { text: "Ты сам заметил: после появления стабильной работы и квартиры стало спокойнее, поэтому вернулось внимание к отношениям", kind: "USER_INTERPRETATION" },
    { text: "9 сентября ты встречаешься с партнёром в Перми по собственному проекту", kind: "FACT" }
  ],
  tensions: [{
    text: "Ты совмещаешь стабильность найма с намерением развивать собственный проект",
    kind: "USER_INTERPRETATION"
  }],
  decisions: [{
    text: "Ты решил не увольняться до конца сентября",
    kind: "FACT"
  }],
  questions: null,
  nextStep: "9 сентября встретиться с партнёром в Перми и обсудить следующий этап проекта",
  importance: "IMPORTANT"
};

function journalOutput(overrides: Partial<Omit<TelegramJournal, "source">> = {}) {
  const { source: _source, ...base } = journalEntry;
  return { ...base, ...overrides };
}

function chatCompletionResponse(
  content: unknown,
  finishReason = "stop",
  status = 200
) {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      message: { content: typeof content === "string" ? content : JSON.stringify(content) }
    }]
  }), { status, headers: { "Content-Type": "application/json" } });
}

const existingLifeContext: LifeContextValue = {
  currentSituation: "Сейчас я работаю в найме пять дней в неделю.",
  priorities: ["ISKRA — главный приоритет"],
  constraints: ["На свои проекты остается мало времени"],
  activeProjects: ["ISKRA"],
  deliberatePauses: ["Новый большой продукт"],
  activeDecisions: [{
    text: "Не увольняюсь из найма",
    validUntil: "2026-09-30",
    status: "ACTIVE"
  }],
  notes: "Сохраняю финансовую устойчивость.",
  updatedAt: "2026-07-01T10:00:00.000Z"
};

function lifeContextProposal(
  patchValue: unknown = {
    priorities: {
      operation: "APPEND",
      items: ["Три тренировки в неделю"]
    }
  },
  current = existingLifeContext
): TelegramLifeContextProposal {
  const patch = normalizeTelegramLifeContextPatch(patchValue);
  return {
    patch,
    baseUpdatedAt: current.updatedAt,
    preview: buildLifeContextPreview(current, patch)
  };
}

function createDependencies(
  overrides: Partial<TelegramWebhookDependencies> = {}
): TelegramWebhookDependencies {
  return {
    classifyInput: async () => "ACTION",
    parseAction: async () => action,
    parseWorkRecord: async () => workRecord,
    parseJournal: async () => journalEntry,
    parseLifeContext: async () => lifeContextProposal(),
    transcribeVoice: async () => action.note,
    createPending: async () => "pending-id",
    createPendingWorkRecord: async () => "work-pending-id",
    createPendingJournal: async () => "journal-pending-id",
    createPendingLifeContext: async () => "context-pending-id",
    convertPendingJournalToLifeContext: async () => ({
      pendingId: "context-pending-id",
      proposal: lifeContextProposal()
    }),
    startLifeContextMode: async () => {},
    consumeLifeContextMode: async () => false,
    cancelPending: async () => true,
    cancelPendingWorkRecord: async () => true,
    cancelPendingJournal: async () => true,
    cancelPendingLifeContext: async () => true,
    savePending: async () => ({ type: action.type, target: action.target }),
    savePendingWorkRecord: async () => true,
    savePendingJournal: async () => ({
      id: "journal-id",
      summary: journalEntry.summary,
      feedback: "Что я здесь вижу\n\nКороткая обратная связь."
    }),
    savePendingLifeContext: async () => "SAVED",
    convertPendingWorkRecord: async () => ({ pendingId: "action-pending-id", action }),
    sendMessage: async () => ({}),
    answerCallback: async () => ({}),
    ...overrides
  };
}

async function withMockedOpenAiResponse<T>(
  content: unknown,
  run: () => Promise<T>
) {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
  }
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

  test("classifies an explicit voice context update as LifeContext", async () => {
    await withMockedOpenAiResponse(
      { kind: "LIFE_CONTEXT", confidence: 0.96 },
      async () => {
        await expect(classifyTelegramInput(
          "Обнови мой текущий контекст. Сейчас я работаю в найме пять дней в неделю.",
          "TELEGRAM_VOICE"
        )).resolves.toBe("LIFE_CONTEXT");
      }
    );
  });

  test("routes explicit initial-fill and update phrases to LifeContext", async () => {
    for (const text of [
      "Заполни мой текущий контекст. Сейчас я работаю в найме и развиваю свой проект.",
      "Хочу обновить текущий контекст. Главным приоритетом стала финансовая устойчивость."
    ]) {
      await withMockedOpenAiResponse(
        { kind: "LIFE_CONTEXT", confidence: 0.97 },
        async () => {
          await expect(classifyTelegramInput(text, "TELEGRAM_VOICE"))
            .resolves.toBe("LIFE_CONTEXT");
        }
      );
    }
  });

  test("classifies an explicit text priority update as LifeContext", async () => {
    await withMockedOpenAiResponse(
      { kind: "LIFE_CONTEXT", confidence: 0.94 },
      async () => {
        await expect(classifyTelegramInput(
          "Добавь в приоритеты: три тренировки в неделю.",
          "TELEGRAM_TEXT"
        )).resolves.toBe("LIFE_CONTEXT");
      }
    );
  });

  test("keeps an ordinary work reflection in Journal even if the model over-classifies it", async () => {
    expect(hasExplicitLifeContextIntent(
      "Сегодня опять думаю, что работа забирает всё время и хочется всё поменять."
    )).toBeFalsy();
    await withMockedOpenAiResponse(
      { kind: "LIFE_CONTEXT", confidence: 0.97 },
      async () => {
        await expect(classifyTelegramInput(
          "Сегодня опять думаю, что работа забирает всё время и хочется всё поменять.",
          "TELEGRAM_VOICE"
        )).resolves.toBe("JOURNAL");
      }
    );
  });

  test("defaults uncertain LifeContext classification to Journal", async () => {
    await withMockedOpenAiResponse(
      { kind: "LIFE_CONTEXT", confidence: 0.8 },
      async () => {
        await expect(classifyTelegramInput(
          "Измени мои приоритеты: сначала стабилизация денег.",
          "TELEGRAM_TEXT"
        )).resolves.toBe("JOURNAL");
      }
    );
  });

  test("builds a full initial LifeContext baseline from an empty context", async () => {
    const fullPatch = normalizeTelegramLifeContextPatch({
      currentSituation: {
        operation: "REPLACE",
        value: "Сейчас я работаю в найме пять дней в неделю.",
        match: null
      },
      priorities: { operation: "REPLACE", items: ["Стабилизировать деньги", "Двигать ISKRA"] },
      constraints: { operation: "REPLACE", items: ["Мало времени в будни"] },
      activeProjects: { operation: "REPLACE", items: ["ISKRA"] },
      deliberatePauses: { operation: "REPLACE", items: ["Запуск нового продукта"] },
      activeDecisions: {
        operation: "REPLACE",
        items: [{ text: "Не увольняюсь из найма", validUntil: "2026-09-30", status: "ACTIVE" }]
      },
      notes: { operation: "REPLACE", value: "Сохраняю текущий темп.", match: null },
      ambiguities: []
    });
    const proposal = await withMockedOpenAiResponse(fullPatch, () =>
      parseTelegramLifeContextProposal(
        "Заполни мой текущий контекст. Сейчас я работаю в найме...",
        "TELEGRAM_VOICE",
        emptyLifeContext,
        new Date("2026-09-03T12:00:00Z")
      )
    );
    const next = applyLifeContextPatch(emptyLifeContext, proposal!.patch);
    expect(next.currentSituation).toContain("работаю в найме");
    expect(next.priorities).toHaveLength(2);
    expect(next.constraints).toEqual(["Мало времени в будни"]);
    expect(next.activeProjects).toEqual(["ISKRA"]);
    expect(next.deliberatePauses).toEqual(["Запуск нового продукта"]);
    expect(next.activeDecisions[0].validUntil).toBe("2026-09-30");
    expect(proposal?.preview).not.toContain("{");
  });

  test("uses Journal-conversion instructions without turning intentions into decisions", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let requestBody: Record<string, any> | null = null;
    const patch = normalizeTelegramLifeContextPatch({
      currentSituation: {
        operation: "APPEND",
        value: "Я работаю в найме и использую его как школу управления.",
        match: null
      },
      activeDecisions: { operation: "UNCHANGED", items: [] }
    });
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return chatCompletionResponse(patch);
    };
    try {
      const proposal = await parseTelegramLifeContextProposal(
        richJournalEntry.cleanedText,
        "TELEGRAM_VOICE",
        existingLifeContext,
        new Date("2026-09-03T12:00:00Z"),
        "JOURNAL_CONVERSION"
      );
      const body = requestBody as Record<string, any> | null;
      expect(body?.messages[0].content).toContain("отдельно подтвердил намерение перенести");
      expect(body?.messages[0].content).toContain("не превращай желание или план в activeDecision");
      expect(body?.messages[1].content).toContain("дневниковая запись для переноса");
      expect(proposal?.patch.activeDecisions.operation).toBe("UNCHANGED");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("partial LifeContext update leaves every untouched field structurally unchanged", () => {
    const patch = normalizeTelegramLifeContextPatch({
      priorities: { operation: "REPLACE", items: ["Стабилизация финансов — главный приоритет"] }
    });
    const next = applyLifeContextPatch(existingLifeContext, patch);
    expect(next.priorities).toEqual(["Стабилизация финансов — главный приоритет"]);
    expect(next.currentSituation).toBe(existingLifeContext.currentSituation);
    expect(next.constraints).toEqual(existingLifeContext.constraints);
    expect(next.activeProjects).toEqual(existingLifeContext.activeProjects);
    expect(next.deliberatePauses).toEqual(existingLifeContext.deliberatePauses);
    expect(next.activeDecisions).toEqual(existingLifeContext.activeDecisions);
    expect(next.notes).toBe(existingLifeContext.notes);
  });

  test("missing fields in an AI patch normalize to UNCHANGED and never clear data", () => {
    const patch = normalizeTelegramLifeContextPatch({
      notes: { operation: "APPEND", value: "Проверю контекст в конце месяца.", match: null }
    });
    const next = applyLifeContextPatch(existingLifeContext, patch);
    expect(patch.priorities.operation).toBe("UNCHANGED");
    expect(next.priorities).toEqual(existingLifeContext.priorities);
    expect(next.activeDecisions).toEqual(existingLifeContext.activeDecisions);
  });

  test("APPEND adds one list item without destroying or duplicating existing values", () => {
    const patch = normalizeTelegramLifeContextPatch({
      priorities: {
        operation: "APPEND",
        items: ["Три тренировки в неделю", "iskra — главный приоритет"]
      }
    });
    const next = applyLifeContextPatch(existingLifeContext, patch);
    expect(next.priorities).toEqual([
      "ISKRA — главный приоритет",
      "Три тренировки в неделю"
    ]);
  });

  test("REMOVE deletes only an explicitly and exactly selected item", () => {
    const context = {
      ...existingLifeContext,
      deliberatePauses: ["ISKRA", "Новый большой продукт"]
    };
    const patch = normalizeTelegramLifeContextPatch({
      deliberatePauses: { operation: "REMOVE", items: ["ISKRA"] }
    });
    expect(applyLifeContextPatch(context, patch).deliberatePauses)
      .toEqual(["Новый большой продукт"]);
  });

  test("keeps an explicit active-decision date as date-only without timezone conversion", async () => {
    const patch = normalizeTelegramLifeContextPatch({
      activeDecisions: {
        operation: "APPEND",
        items: [{ text: "Не увольняюсь из найма", validUntil: "2026-09-30", status: "ACTIVE" }]
      }
    });
    const proposal = await withMockedOpenAiResponse(patch, () =>
      parseTelegramLifeContextProposal(
        "Запиши в действующие решения: до конца сентября не увольняюсь из найма.",
        "TELEGRAM_TEXT",
        emptyLifeContext,
        new Date("2026-09-03T20:30:00Z")
      )
    );
    expect(proposal?.patch.activeDecisions.items[0].validUntil).toBe("2026-09-30");
    expect(proposal?.preview).toContain("2026-09-30");
  });

  test("does not invent validUntil when an active decision has no explicit date", () => {
    const patch = normalizeTelegramLifeContextPatch({
      activeDecisions: {
        operation: "APPEND",
        items: [{ text: "Продолжаю ISKRA", validUntil: null, status: "ACTIVE" }]
      }
    });
    expect(patch.activeDecisions.items[0].validUntil).toBeNull();
  });

  test("removes only the explicitly named active decision and keeps similar decisions", () => {
    const context: LifeContextValue = {
      ...existingLifeContext,
      activeDecisions: [
        { text: "Не увольняюсь из найма", validUntil: "2026-09-30", status: "ACTIVE" },
        { text: "Не меняю основную работу без оффера", validUntil: null, status: "ACTIVE" }
      ]
    };
    const patch = normalizeTelegramLifeContextPatch({
      activeDecisions: {
        operation: "REMOVE",
        items: [{ text: "Не увольняюсь из найма", validUntil: null, status: "CANCELED" }]
      }
    });
    expect(applyLifeContextPatch(context, patch).activeDecisions).toEqual([
      { text: "Не меняю основную работу без оффера", validUntil: null, status: "ACTIVE" }
    ]);
  });

  test("keeps a field unchanged when a REMOVE target does not exactly match", () => {
    const patch = normalizeTelegramLifeContextPatch({
      activeDecisions: {
        operation: "REMOVE",
        items: [{ text: "Похожее, но не точное решение", validUntil: null, status: "CANCELED" }]
      },
      ambiguities: ["Точное действующее решение не найдено, поэтому оно оставлено без изменений."]
    });
    const next = applyLifeContextPatch(existingLifeContext, patch);
    expect(next.activeDecisions).toEqual(existingLifeContext.activeDecisions);
    expect(buildLifeContextPreview(existingLifeContext, patch)).toContain("Не применено");
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

  test("parses a content-rich 4-5 minute Journal result with strict schema and an explicit output budget", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const requestBodies: Array<Record<string, any>> = [];
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      const parsed = await parseTelegramJournal(
        longTranscript,
        "TELEGRAM_VOICE",
        new Date("2026-09-03T12:00:00Z")
      );
      expect(parsed?.cleanedText.length).toBeGreaterThan(5000);
      expect(parsed!.cleanedText.split(/\s+/).length).toBeGreaterThan(500);
      const requestBody = requestBodies[0];
      expect(requestBody.max_completion_tokens).toBe(journalMaxCompletionTokens);
      expect(requestBody.response_format?.type).toBe("json_schema");
      expect(requestBody.response_format?.json_schema?.strict).toBeTruthy();
      expect(JSON.stringify(requestBody.response_format?.json_schema?.schema))
        .not.toContain("uniqueItems");
      const systemPrompt = requestBody.messages[0].content;
      expect(systemPrompt).toContain("120–250 слов");
      expect(systemPrompt).toContain("причинные связи");
      expect(systemPrompt).toContain("Желание или намерение");
      expect(systemPrompt).toContain("Самостоятельно названная причинная связь — USER_INTERPRETATION");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("keeps a long Journal preview dense, personal and free of third-person labels", () => {
    const preview = journalConfirmationText(richJournalEntry);
    const wordCount = preview.split(/\s+/).filter(Boolean).length;

    expect(preview).toContain("Ты уже полгода живёшь в Москве");
    expect(preview).toContain("управленческий опыт перед собственными проектами");
    expect(preview).toContain("после появления стабильной работы и квартиры");
    expect(preview).toContain("9 сентября");
    expect(preview).not.toMatch(/\b(?:Автор|Пользователь|Субъект)\b/i);
    expect(wordCount).toBeGreaterThanOrEqual(120);
    expect(wordCount).toBeLessThanOrEqual(250);
  });

  test("removes forbidden third-person labels from Journal preview defensively", () => {
    const preview = journalConfirmationText({
      ...journalEntry,
      summary: "Автор работает в найме и развивает собственный проект.",
      keyEvents: [{ text: "Пользователь назначил встречу на 9 сентября", kind: "FACT" }],
      tensions: [{ text: "Субъект связывает стабильность с возвращением внимания к отношениям", kind: "USER_INTERPRETATION" }]
    });

    expect(preview).not.toMatch(/(?:Автор|Пользователь|Субъект)/i);
    expect(preview).toContain("Ты:");
  });

  test("keeps first-person cleaned text and does not merge decisions, intentions and events", () => {
    expect(richJournalEntry.cleanedText).toMatch(/(^|[^А-ЯЁа-яё])Я(?=$|[^А-ЯЁа-яё])/);
    expect(richJournalEntry.cleanedText.length).toBeGreaterThan(800);
    expect(richJournalEntry.cleanedText.split(/[.!?]+/).filter(Boolean).length).toBeGreaterThan(3);
    expect(richJournalEntry.decisions?.map((item) => item.text).join(" "))
      .toContain("не увольняться до конца сентября");
    expect(richJournalEntry.decisions?.map((item) => item.text).join(" "))
      .not.toContain("зал");
    expect(richJournalEntry.summary).toContain("пока называешь это намерением");
    expect(richJournalEntry.nextStep).toContain("9 сентября");
  });

  test("repairs a malformed structured Journal response once without resending the transcript", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const requestBodies: Array<Record<string, any>> = [];
    let attempt = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      attempt += 1;
      return attempt === 1
        ? chatCompletionResponse("{\"entryDate\":")
        : chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      const parsed = await parseTelegramJournal(longTranscript, "TELEGRAM_VOICE");
      expect(parsed?.cleanedText).toBe(longCleanedText);
      expect(attempt).toBe(2);
      expect(requestBodies[1].messages[1].content).toBe("{\"entryDate\":");
      expect(requestBodies[1].messages[1].content).not.toContain(longTranscriptParts[20]);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("reprocesses the transcript once when the first Journal output is truncated", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const requestBodies: Array<Record<string, any>> = [];
    let attempt = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      attempt += 1;
      return attempt === 1
        ? chatCompletionResponse("{\"entryDate\":\"2026-09-03\"", "length")
        : chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      const parsed = await parseTelegramJournal(longTranscript, "TELEGRAM_VOICE");
      expect(parsed?.cleanedText).toBe(longCleanedText);
      expect(attempt).toBe(2);
      expect(requestBodies[1].messages[1].content).toBe(longTranscript);
      expect(requestBodies[1].messages[0].content).toContain("повторная попытка");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("retries a schema-invalid Journal response and validates the repaired result", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let attempt = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => {
      attempt += 1;
      return attempt === 1
        ? chatCompletionResponse(journalOutput({ domains: [] }))
        : chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      const parsed = await parseTelegramJournal(longTranscript, "TELEGRAM_VOICE");
      expect(parsed?.domains.length).toBeGreaterThan(0);
      expect(attempt).toBe(2);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("retries a lossy long Journal result instead of accepting a short cleaned summary", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalConsoleError = console.error;
    let attempt = 0;
    const logs: unknown[][] = [];
    process.env.OPENAI_API_KEY = "test-key";
    console.error = (...args) => { logs.push(args); };
    global.fetch = async () => {
      attempt += 1;
      return attempt === 1
        ? chatCompletionResponse(journalOutput({
            cleanedText: "Я работаю в найме и развиваю свой проект.",
            summary: "Ты работаешь в найме и развиваешь свой проект."
          }))
        : chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      const parsed = await parseTelegramJournal(longTranscript, "TELEGRAM_VOICE");
      expect(parsed?.cleanedText).toBe(longCleanedText);
      expect(attempt).toBe(2);
      expect(JSON.stringify(logs)).toContain("cleaned_text_too_short_for_long_entry");
      expect(JSON.stringify(logs)).not.toContain(longTranscriptParts[0]);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
      console.error = originalConsoleError;
    }
  });

  test("fails after two malformed Journal attempts with a structured error", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let attempt = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => {
      attempt += 1;
      return chatCompletionResponse("not-json");
    };
    try {
      await expect(parseTelegramJournal(longTranscript, "TELEGRAM_VOICE"))
        .rejects.toMatchObject({
          name: "TelegramJournalParseError",
          reason: "MALFORMED_JSON",
          attempts: 2
        });
      expect(attempt).toBe(2);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("logs only safe Journal diagnostics for an OpenAI HTTP failure", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalConsoleError = console.error;
    const logs: unknown[][] = [];
    let requestCount = 0;
    process.env.OPENAI_API_KEY = "test-key";
    console.error = (...args) => { logs.push(args); };
    global.fetch = async () => {
      requestCount += 1;
      return new Response(JSON.stringify({
        error: {
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "response_format",
          message: "PRIVATE-CONTENT-MUST-NOT-BE-LOGGED"
        }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    };
    try {
      await expect(parseTelegramJournal(longTranscript, "TELEGRAM_VOICE"))
        .rejects.toBeInstanceOf(TelegramJournalParseError);
      const serialized = JSON.stringify(logs);
      expect(serialized).toContain("telegram_journal_entry");
      expect(serialized).toContain("invalid_json_schema");
      expect(serialized).toContain("response_format");
      expect(serialized).not.toContain("PRIVATE-CONTENT-MUST-NOT-BE-LOGGED");
      expect(serialized).not.toContain(longTranscriptParts[0]);
      expect(requestCount).toBe(1);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
      console.error = originalConsoleError;
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

  test("exposes the current-context entry point from /start", async () => {
    const messages: Array<{ text: string; markup?: unknown }> = [];
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "/start" } },
      "allowed-chat",
      createDependencies({
        sendMessage: async (_chatId, text, markup) => {
          messages.push({ text, markup });
          return {};
        }
      })
    );

    expect(messages[0].text).toContain("/context");
    expect(JSON.stringify(messages[0].markup)).toContain("🧭 Текущий контекст");
    expect(JSON.stringify(messages[0].markup)).toContain("context_mode");
  });

  test("activates current-context mode from the inline button", async () => {
    let activatedFor = "";
    const messages: string[] = [];
    await processTelegramUpdate(
      { callback_query: { id: "mode", data: "context_mode", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      createDependencies({
        startLifeContextMode: async (chatId) => { activatedFor = chatId; },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );

    expect(activatedFor).toBe("allowed-chat");
    expect(messages[0]).toContain("Наговори, что сейчас происходит");
  });

  test("current-context mode is one-shot and bypasses the classifier once", async () => {
    let modeActive = false;
    let classifierCount = 0;
    let contextCount = 0;
    let journalCount = 0;
    const dependencies = createDependencies({
      startLifeContextMode: async () => { modeActive = true; },
      consumeLifeContextMode: async () => {
        if (!modeActive) return false;
        modeActive = false;
        return true;
      },
      classifyInput: async () => {
        classifierCount += 1;
        return "JOURNAL";
      },
      createPendingLifeContext: async () => {
        contextCount += 1;
        return "context-pending-id";
      },
      createPendingJournal: async () => {
        journalCount += 1;
        return "journal-pending-id";
      }
    });

    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "/context" } },
      "allowed-chat",
      dependencies
    );
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "Сейчас я остаюсь в найме и закрываю долги." } },
      "allowed-chat",
      dependencies
    );
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "Сегодня думаю о работе и отношениях." } },
      "allowed-chat",
      dependencies
    );

    expect(contextCount).toBe(1);
    expect(journalCount).toBe(1);
    expect(classifierCount).toBe(1);
  });

  test("current-context mode forces the next voice into LifeContext without retranscription", async () => {
    let transcriptionCount = 0;
    let classifierCount = 0;
    let contextCount = 0;
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, voice: { file_id: "voice-context", duration: 90 } } },
      "allowed-chat",
      createDependencies({
        consumeLifeContextMode: async () => true,
        transcribeVoice: async () => {
          transcriptionCount += 1;
          return "Сейчас я работаю в найме и развиваю собственный проект.";
        },
        classifyInput: async () => {
          classifierCount += 1;
          return "JOURNAL";
        },
        createPendingLifeContext: async () => {
          contextCount += 1;
          return "context-pending-id";
        }
      })
    );

    expect(transcriptionCount).toBe(1);
    expect(classifierCount).toBe(0);
    expect(contextCount).toBe(1);
  });

  test("current-context mode is scoped to the allowed chat", async () => {
    let consumeCount = 0;
    const result = await processTelegramUpdate(
      { message: { chat: { id: "other-chat" }, text: "Контекст другого чата" } },
      "allowed-chat",
      createDependencies({
        consumeLifeContextMode: async () => {
          consumeCount += 1;
          return true;
        }
      })
    );

    expect(result).toBe("forbidden");
    expect(consumeCount).toBe(0);
  });

  test("expired current-context mode falls back to normal Journal classification", async () => {
    let journalCount = 0;
    let contextCount = 0;
    await processTelegramUpdate(
      { message: { chat: { id: "allowed-chat" }, text: "Сегодня опять думаю, что работа забирает всё время." } },
      "allowed-chat",
      createDependencies({
        consumeLifeContextMode: async () => false,
        classifyInput: async () => "JOURNAL",
        createPendingJournal: async () => {
          journalCount += 1;
          return "journal-pending-id";
        },
        createPendingLifeContext: async () => {
          contextCount += 1;
          return "context-pending-id";
        }
      })
    );

    expect(journalCount).toBe(1);
    expect(contextCount).toBe(0);
  });

  test("current-context mode has a 30-minute TTL", () => {
    const now = new Date("2026-09-03T12:00:00.000Z");
    expect(lifeContextModeLifetimeMs).toBe(30 * 60 * 1000);
    expect(lifeContextModeExpiresAt(now).toISOString()).toBe("2026-09-03T12:30:00.000Z");
  });

  test("requires a LifeContext preview before Apply and keeps storage unchanged", async () => {
    let saveCount = 0;
    const messages: Array<{ text: string; markup?: unknown }> = [];
    await processTelegramUpdate(
      {
        message: {
          chat: { id: "allowed-chat" },
          text: "Добавь в приоритеты: три тренировки в неделю."
        }
      },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "LIFE_CONTEXT",
        savePendingLifeContext: async () => {
          saveCount += 1;
          return "SAVED";
        },
        sendMessage: async (_chatId, text, markup) => {
          messages.push({ text, markup });
          return {};
        }
      })
    );
    expect(saveCount).toBe(0);
    expect(messages[0].text).toContain("предлагаемые изменения");
    expect(JSON.stringify(messages[0].markup)).toContain("context_apply:context-pending-id");
    expect(JSON.stringify(messages[0].markup)).toContain("context_cancel:context-pending-id");
  });

  test("canceling a LifeContext preview leaves the context unchanged", async () => {
    let cancelCount = 0;
    let saveCount = 0;
    const messages: string[] = [];
    await processTelegramUpdate(
      {
        callback_query: {
          id: "context-cancel",
          data: "context_cancel:context-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        cancelPendingLifeContext: async () => {
          cancelCount += 1;
          return true;
        },
        savePendingLifeContext: async () => {
          saveCount += 1;
          return "SAVED";
        },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );
    expect(cancelCount).toBe(1);
    expect(saveCount).toBe(0);
    expect(messages).toContain("Изменения текущего контекста отменены.");
  });

  test("Apply saves only the confirmed LifeContext patch", async () => {
    const saveCalls: Array<{ chatId: string; pendingId: string }> = [];
    const messages: string[] = [];
    await processTelegramUpdate(
      {
        callback_query: {
          id: "context-apply",
          data: "context_apply:context-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePendingLifeContext: async (chatId, pendingId) => {
          saveCalls.push({ chatId, pendingId });
          return "SAVED";
        },
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );
    expect(saveCalls).toEqual([{ chatId: "allowed-chat", pendingId: "context-pending-id" }]);
    expect(messages[0]).toContain("Текущий контекст обновлен");
  });

  test("does not apply a LifeContext callback from another Telegram chat", async () => {
    let saveCount = 0;
    const result = await processTelegramUpdate(
      {
        callback_query: {
          id: "foreign-context-apply",
          data: "context_apply:context-pending-id",
          message: { chat: { id: "other-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePendingLifeContext: async () => {
          saveCount += 1;
          return "SAVED";
        }
      })
    );
    expect(result).toBe("forbidden");
    expect(saveCount).toBe(0);
  });

  test("LifeContext flow is mutually exclusive with Journal, WorkRecord and DailyAction", async () => {
    let journalCount = 0;
    let workCount = 0;
    let actionCount = 0;
    let contextCount = 0;
    await processTelegramUpdate(
      {
        message: {
          chat: { id: "allowed-chat" },
          text: "Обнови мой текущий контекст: главным приоритетом стала стабилизация денег."
        }
      },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "LIFE_CONTEXT",
        createPending: async () => {
          actionCount += 1;
          return "pending-id";
        },
        createPendingWorkRecord: async () => {
          workCount += 1;
          return "work-pending-id";
        },
        createPendingJournal: async () => {
          journalCount += 1;
          return "journal-pending-id";
        },
        createPendingLifeContext: async () => {
          contextCount += 1;
          return "context-pending-id";
        }
      })
    );
    expect(contextCount).toBe(1);
    expect(actionCount).toBe(0);
    expect(workCount).toBe(0);
    expect(journalCount).toBe(0);
  });

  test("voice LifeContext pending payload contains no transcript, audio or Telegram file id", async () => {
    const rawTranscript = "Обнови мой текущий контекст. Это полный исходный текст голосового.";
    let pendingProposal: TelegramLifeContextProposal | null = null;
    await processTelegramUpdate(
      {
        message: {
          chat: { id: "allowed-chat" },
          voice: { file_id: "private-voice-file-id", duration: 120 }
        }
      },
      "allowed-chat",
      createDependencies({
        classifyInput: async () => "LIFE_CONTEXT",
        transcribeVoice: async () => rawTranscript,
        createPendingLifeContext: async (_chatId, proposal) => {
          pendingProposal = proposal;
          return "context-pending-id";
        }
      })
    );
    const serialized = JSON.stringify(pendingProposal);
    expect(serialized).not.toContain(rawTranscript);
    expect(serialized).not.toContain("private-voice-file-id");
    expect(serialized).not.toContain("audio");
    expect(Object.keys(pendingProposal ?? {})).toEqual(["patch", "baseUpdatedAt", "preview"]);
  });

  test("reports a stale LifeContext preview instead of claiming success", async () => {
    const messages: string[] = [];
    await processTelegramUpdate(
      {
        callback_query: {
          id: "stale-context-apply",
          data: "context_apply:context-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        savePendingLifeContext: async () => "STALE",
        sendMessage: async (_chatId, text) => {
          messages.push(text);
          return {};
        }
      })
    );
    expect(messages[0]).toContain("изменился после создания preview");
  });

  test("accepts a 291-second voice and preserves a substantial cleaned Journal", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let transcribed = 0;
    const pendingEntries: TelegramJournal[] = [];
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => chatCompletionResponse(
      journalOutput({ cleanedText: longCleanedText })
    );
    try {
      await processTelegramUpdate(
        {
          message: {
            chat: { id: "allowed-chat" },
            voice: { file_id: "voice-291", duration: 291 }
          }
        },
        "allowed-chat",
        createDependencies({
          classifyInput: async () => "JOURNAL",
          transcribeVoice: async () => {
            transcribed += 1;
            return longTranscript;
          },
          parseJournal: (text, source) => parseTelegramJournal(text, source),
          createPendingJournal: async (_chatId, entry) => {
            pendingEntries.push(entry);
            return "journal-pending-id";
          }
        })
      );
      expect(transcribed).toBe(1);
      expect(pendingEntries[0]?.cleanedText.length).toBeGreaterThan(5000);
      expect(Object.keys(pendingEntries[0] ?? {})).not.toContain("rawTranscript");
      expect(Object.keys(pendingEntries[0] ?? {})).not.toContain("fileId");
      expect(JSON.stringify(pendingEntries[0])).not.toContain("voice-291");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("Journal retry creates only one confirmation draft and no duplicate record", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let attempt = 0;
    let pendingCount = 0;
    let savedCount = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => {
      attempt += 1;
      return attempt === 1
        ? chatCompletionResponse("broken-json")
        : chatCompletionResponse(journalOutput({ cleanedText: longCleanedText }));
    };
    try {
      await processTelegramUpdate(
        {
          message: {
            chat: { id: "allowed-chat" },
            voice: { file_id: "voice-retry", duration: 291 }
          }
        },
        "allowed-chat",
        createDependencies({
          classifyInput: async () => "JOURNAL",
          transcribeVoice: async () => longTranscript,
          parseJournal: (text, source) => parseTelegramJournal(text, source),
          createPendingJournal: async () => {
            pendingCount += 1;
            return "journal-pending-id";
          },
          savePendingJournal: async () => {
            savedCount += 1;
            return { id: "journal-id", summary: journalEntry.summary };
          }
        })
      );
      expect(attempt).toBe(2);
      expect(pendingCount).toBe(1);
      expect(savedCount).toBe(0);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test("two failed Journal attempts create no draft or record and return a clear message", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalConsoleError = console.error;
    let pendingCount = 0;
    let savedCount = 0;
    let attempt = 0;
    const messages: string[] = [];
    process.env.OPENAI_API_KEY = "test-key";
    console.error = () => {};
    global.fetch = async () => {
      attempt += 1;
      return chatCompletionResponse("still-broken");
    };
    try {
      await processTelegramUpdate(
        {
          message: {
            chat: { id: "allowed-chat" },
            voice: { file_id: "voice-fails", duration: 291 }
          }
        },
        "allowed-chat",
        createDependencies({
          classifyInput: async () => "JOURNAL",
          transcribeVoice: async () => longTranscript,
          parseJournal: (text, source) => parseTelegramJournal(text, source),
          createPendingJournal: async () => {
            pendingCount += 1;
            return "journal-pending-id";
          },
          savePendingJournal: async () => {
            savedCount += 1;
            return { id: "journal-id", summary: journalEntry.summary };
          },
          sendMessage: async (_chatId, text) => {
            messages.push(text);
            return {};
          }
        })
      );
      expect(attempt).toBe(2);
      expect(pendingCount).toBe(0);
      expect(savedCount).toBe(0);
      expect(messages[0]).toContain("после двух попыток");
      expect(messages[0]).toContain("Ничего не сохранено");
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
      console.error = originalConsoleError;
    }
  });

  test("routes a long explicit LifeContext voice away from Journal", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const explicitTranscript = `Заполни мой текущий контекст. ${longTranscript}`;
    let contextCount = 0;
    let journalCount = 0;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = async () => chatCompletionResponse({
      kind: "LIFE_CONTEXT",
      confidence: 0.98
    });
    try {
      await processTelegramUpdate(
        {
          message: {
            chat: { id: "allowed-chat" },
            voice: { file_id: "voice-life-context", duration: 291 }
          }
        },
        "allowed-chat",
        createDependencies({
          classifyInput: (text, source) => classifyTelegramInput(text, source),
          transcribeVoice: async () => explicitTranscript,
          parseJournal: async () => {
            journalCount += 1;
            return journalEntry;
          },
          createPendingLifeContext: async () => {
            contextCount += 1;
            return "context-pending-id";
          }
        })
      );
      expect(contextCount).toBe(1);
      expect(journalCount).toBe(0);
    } finally {
      global.fetch = originalFetch;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
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
    const confirmationMarkup = JSON.stringify(messages[0].markup);
    expect(confirmationMarkup).toContain("Сохранить в дневник");
    expect(confirmationMarkup).toContain("journal_save:journal-pending-id");
    expect(confirmationMarkup).toContain("В текущий контекст");
    expect(confirmationMarkup).toContain("journal_context:journal-pending-id");
    expect(confirmationMarkup).toContain("Отмена");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("rawTranscript");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("fileId");
    expect(Object.keys(pendingEntry ?? {})).not.toContain("audio");
  });

  test("converts a Journal draft to a LifeContext preview without saving either destination", async () => {
    let journalSaveCount = 0;
    let contextSaveCount = 0;
    let convertCount = 0;
    const messages: Array<{ text: string; markup?: unknown }> = [];

    await processTelegramUpdate(
      {
        callback_query: {
          id: "journal-context",
          data: "journal_context:journal-pending-id",
          message: { chat: { id: "allowed-chat" } }
        }
      },
      "allowed-chat",
      createDependencies({
        convertPendingJournalToLifeContext: async (chatId, pendingId) => {
          convertCount += 1;
          expect(chatId).toBe("allowed-chat");
          expect(pendingId).toBe("journal-pending-id");
          return { pendingId: "context-from-journal", proposal: lifeContextProposal() };
        },
        savePendingJournal: async () => {
          journalSaveCount += 1;
          return { id: "journal-id", summary: richJournalEntry.summary };
        },
        savePendingLifeContext: async () => {
          contextSaveCount += 1;
          return "SAVED";
        },
        sendMessage: async (_chatId, text, markup) => {
          messages.push({ text, markup });
          return {};
        }
      })
    );

    expect(convertCount).toBe(1);
    expect(journalSaveCount).toBe(0);
    expect(contextSaveCount).toBe(0);
    expect(messages[0].text).toContain("предлагаемые изменения");
    expect(JSON.stringify(messages[0].markup)).toContain("context_apply:context-from-journal");
    expect(JSON.stringify(messages[0].markup)).toContain("context_cancel:context-from-journal");
  });

  test("Journal conversion reuses only the processed pending representation", () => {
    const input = journalToLifeContextInput(richJournalEntry);

    expect(input).toEqual({
      text: richJournalEntry.cleanedText,
      source: "TELEGRAM_VOICE"
    });
    expect(input).not.toHaveProperty("rawTranscript");
    expect(input).not.toHaveProperty("fileId");
    expect(input).not.toHaveProperty("audio");
  });

  test("applies a converted Journal context only after the second confirmation", async () => {
    let contextSaveCount = 0;
    const dependencies = createDependencies({
      convertPendingJournalToLifeContext: async () => ({
        pendingId: "context-from-journal",
        proposal: lifeContextProposal()
      }),
      savePendingLifeContext: async (_chatId, pendingId) => {
        expect(pendingId).toBe("context-from-journal");
        contextSaveCount += 1;
        return "SAVED";
      }
    });

    await processTelegramUpdate(
      { callback_query: { id: "convert", data: "journal_context:journal-pending-id", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );
    expect(contextSaveCount).toBe(0);

    await processTelegramUpdate(
      { callback_query: { id: "apply", data: "context_apply:context-from-journal", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );
    expect(contextSaveCount).toBe(1);
  });

  test("canceling a converted Journal context changes nothing", async () => {
    let contextSaveCount = 0;
    let contextCancelCount = 0;
    const dependencies = createDependencies({
      convertPendingJournalToLifeContext: async () => ({
        pendingId: "context-from-journal",
        proposal: lifeContextProposal()
      }),
      cancelPendingLifeContext: async (_chatId, pendingId) => {
        expect(pendingId).toBe("context-from-journal");
        contextCancelCount += 1;
        return true;
      },
      savePendingLifeContext: async () => {
        contextSaveCount += 1;
        return "SAVED";
      }
    });

    await processTelegramUpdate(
      { callback_query: { id: "convert", data: "journal_context:journal-pending-id", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );
    await processTelegramUpdate(
      { callback_query: { id: "cancel-context", data: "context_cancel:context-from-journal", message: { chat: { id: "allowed-chat" } } } },
      "allowed-chat",
      dependencies
    );

    expect(contextCancelCount).toBe(1);
    expect(contextSaveCount).toBe(0);
  });

  test("a repeated Journal conversion cannot create a duplicate pending context", async () => {
    let available = true;
    let draftCount = 0;
    const dependencies = createDependencies({
      convertPendingJournalToLifeContext: async () => {
        if (!available) return null;
        available = false;
        draftCount += 1;
        return { pendingId: "context-from-journal", proposal: lifeContextProposal() };
      }
    });

    for (const id of ["convert-once", "convert-twice"]) {
      await processTelegramUpdate(
        { callback_query: { id, data: "journal_context:journal-pending-id", message: { chat: { id: "allowed-chat" } } } },
        "allowed-chat",
        dependencies
      );
    }
    expect(draftCount).toBe(1);
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

  test("uses the WorkRecord model chain for Journal parsing", () => {
    const previous = {
      work: process.env.OPENAI_WORK_RECORD_MODEL,
      common: process.env.OPENAI_MODEL
    };
    try {
      process.env.OPENAI_WORK_RECORD_MODEL = "journal-work-model";
      process.env.OPENAI_MODEL = "common-model";
      expect(journalModel()).toBe("journal-work-model");
      delete process.env.OPENAI_WORK_RECORD_MODEL;
      expect(journalModel()).toBe("common-model");
      delete process.env.OPENAI_MODEL;
      expect(journalModel()).toBe("gpt-4o-mini");
    } finally {
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

  test("uses the dedicated LifeContext model fallback chain", () => {
    const previous = {
      lifeContext: process.env.OPENAI_LIFE_CONTEXT_MODEL,
      work: process.env.OPENAI_WORK_RECORD_MODEL,
      common: process.env.OPENAI_MODEL
    };
    try {
      process.env.OPENAI_LIFE_CONTEXT_MODEL = "life-context-model";
      process.env.OPENAI_WORK_RECORD_MODEL = "work-model";
      process.env.OPENAI_MODEL = "common-model";
      expect(lifeContextModel()).toBe("life-context-model");
      delete process.env.OPENAI_LIFE_CONTEXT_MODEL;
      expect(lifeContextModel()).toBe("work-model");
      delete process.env.OPENAI_WORK_RECORD_MODEL;
      expect(lifeContextModel()).toBe("common-model");
      delete process.env.OPENAI_MODEL;
      expect(lifeContextModel()).toBe("gpt-4o-mini");
    } finally {
      process.env.OPENAI_LIFE_CONTEXT_MODEL = previous.lifeContext;
      process.env.OPENAI_WORK_RECORD_MODEL = previous.work;
      process.env.OPENAI_MODEL = previous.common;
    }
  });
});
