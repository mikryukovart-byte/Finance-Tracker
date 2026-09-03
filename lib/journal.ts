import { z } from "zod";

import { todayInAmsterdam } from "@/lib/telegram-daily-actions";

export const journalSources = ["TELEGRAM_TEXT", "TELEGRAM_VOICE", "WEB_MANUAL"] as const;
export const journalDomains = [
  "MONEY",
  "EMPLOYMENT",
  "OWN_PROJECTS",
  "BODY_HEALTH",
  "RELATIONSHIPS",
  "FRIENDSHIP_SOCIAL",
  "INNER_STATE",
  "MEANING_SPIRITUAL",
  "OTHER"
] as const;
export const journalEvidenceKinds = [
  "FACT",
  "USER_INTERPRETATION",
  "AI_INTERPRETATION"
] as const;
export const journalImportanceValues = ["NORMAL", "IMPORTANT"] as const;

export const journalDomainLabels: Record<(typeof journalDomains)[number], string> = {
  MONEY: "Деньги",
  EMPLOYMENT: "Работа в найме",
  OWN_PROJECTS: "Свои проекты",
  BODY_HEALTH: "Тело и здоровье",
  RELATIONSHIPS: "Отношения",
  FRIENDSHIP_SOCIAL: "Дружба и люди",
  INNER_STATE: "Внутреннее состояние",
  MEANING_SPIRITUAL: "Смысл и ценности",
  OTHER: "Другое"
};

export const journalEvidenceSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  kind: z.enum(journalEvidenceKinds)
});

const evidenceListSchema = z.array(journalEvidenceSchema).max(12).nullable();

export const telegramJournalSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(journalSources),
  cleanedText: z.string().trim().min(1).max(15000),
  summary: z.string().trim().min(1).max(600),
  domains: z.array(z.enum(journalDomains)).min(1).max(journalDomains.length),
  keyEvents: evidenceListSchema,
  tensions: evidenceListSchema,
  decisions: evidenceListSchema,
  questions: evidenceListSchema,
  nextStep: z.string().trim().max(800).nullable(),
  importance: z.enum(journalImportanceValues)
});

export type TelegramJournal = z.infer<typeof telegramJournalSchema>;
export type TelegramJournalSource = TelegramJournal["source"];
export type TelegramInputKind = "ACTION" | "WORK_RECORD" | "JOURNAL" | "LIFE_CONTEXT";

export function hasExplicitLifeContextIntent(originalText: string) {
  const text = originalText.trim().toLocaleLowerCase("ru-RU");
  if (!text) return false;

  return [
    /(?:обнови|обновить|заполни|заполнить|измени|изменить|дополни|дополнить|очисти|очистить)\s+(?:мой\s+)?(?:текущ(?:ий|его)\s+)?контекст/,
    /(?:добавь|добавить|запиши|записать|убери|убрать|удали|удалить|измени|изменить)\s+(?:в|из)\s+(?:мой\s+)?(?:текущ(?:ий|его)\s+)?(?:контекст|приоритеты|ограничения|активные проекты|действующие решения|решения|паузы|заметки)/,
    /(?:измени|изменить|обнови|обновить)\s+(?:мои\s+)?(?:приоритеты|ограничения|активные проекты|действующие решения|решения|паузы)/,
    /(?:добавь|добавить|запиши|записать),?\s+что\s+.+/,
    /(?:убери|убрать|удали|удалить)\s+.+\s+из\s+(?:приоритетов|ограничений|активных проектов|действующих решений|решений|паузы|поставленного на паузу)/,
    /(?:главн(?:ый|ая|ое)\s+)?приоритет.+\bтеперь\b/,
    /решени[ея]\s+(?:больше\s+)?не\s+действует/,
    /^(?:я\s+)?до(?:\s+конца)?\s+.+\s+не\s+увольня(?:юсь|ться)/
  ].some((pattern) => pattern.test(text));
}

function openAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return apiKey;
}

export function journalModel() {
  return process.env.OPENAI_WORK_RECORD_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export const journalMaxCompletionTokens = 8192;

type JournalFailureReason =
  | "HTTP"
  | "NETWORK"
  | "TRUNCATED"
  | "MALFORMED_RESPONSE"
  | "MALFORMED_JSON"
  | "SCHEMA_VALIDATION"
  | "REFUSAL";

class JournalAttemptError extends Error {
  constructor(
    readonly reason: JournalFailureReason,
    readonly retryable: boolean,
    readonly repairContent: string | null = null
  ) {
    super(`Journal structured parse failed: ${reason}`);
    this.name = "JournalAttemptError";
  }
}

export class TelegramJournalParseError extends Error {
  constructor(readonly reason: JournalFailureReason, readonly attempts: number) {
    super(`OpenAI telegram_journal_entry parsing failed after ${attempts} attempt(s): ${reason}`);
    this.name = "TelegramJournalParseError";
  }
}

type JournalDiagnostic = {
  attempt: number;
  status?: number;
  finishReason?: string | null;
  responseLength?: number;
  contentLength?: number;
  validationPaths?: Array<{ path: string; code: string }>;
  apiErrorType?: string | null;
  apiErrorCode?: string | null;
  apiErrorParam?: string | null;
};

function safeApiErrorMetadata(rawResponse: string) {
  try {
    const parsed = JSON.parse(rawResponse) as {
      error?: { type?: unknown; code?: unknown; param?: unknown };
    };
    return {
      apiErrorType: typeof parsed.error?.type === "string" ? parsed.error.type : null,
      apiErrorCode: typeof parsed.error?.code === "string" ? parsed.error.code : null,
      apiErrorParam: typeof parsed.error?.param === "string" ? parsed.error.param : null
    };
  } catch {
    return { apiErrorType: null, apiErrorCode: null, apiErrorParam: null };
  }
}

function logJournalFailure(reason: JournalFailureReason, details: JournalDiagnostic) {
  console.error("OpenAI structured parser failure", {
    parser: "telegram_journal_entry",
    model: journalModel(),
    reason,
    ...details
  });
}

async function structuredCompletion(
  name: string,
  schema: Record<string, unknown>,
  messages: Array<{ role: "system" | "user"; content: string }>
) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: journalModel(),
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema }
      },
      messages
    }),
    cache: "no-store"
  });

  if (!response.ok) throw new Error(`OpenAI ${name} parsing failed`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`OpenAI returned an empty ${name}`);
  return JSON.parse(content) as unknown;
}

async function journalStructuredAttempt(
  schema: Record<string, unknown>,
  messages: Array<{ role: "system" | "user"; content: string }>,
  attempt: number
) {
  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: journalModel(),
        temperature: 0,
        max_completion_tokens: journalMaxCompletionTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "telegram_journal_entry",
            strict: true,
            schema
          }
        },
        messages
      }),
      cache: "no-store"
    });
  } catch {
    logJournalFailure("NETWORK", { attempt });
    throw new JournalAttemptError("NETWORK", false);
  }

  const rawResponse = await response.text();
  if (!response.ok) {
    logJournalFailure("HTTP", {
      attempt,
      status: response.status,
      responseLength: rawResponse.length,
      ...safeApiErrorMetadata(rawResponse)
    });
    throw new JournalAttemptError("HTTP", false);
  }

  let data: {
    choices?: Array<{
      finish_reason?: string | null;
      message?: { content?: unknown; refusal?: unknown };
    }>;
  };
  try {
    data = JSON.parse(rawResponse);
  } catch {
    logJournalFailure("MALFORMED_RESPONSE", {
      attempt,
      status: response.status,
      responseLength: rawResponse.length
    });
    throw new JournalAttemptError("MALFORMED_RESPONSE", true);
  }

  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? null;
  const content = choice?.message?.content;
  const contentLength = typeof content === "string" ? content.length : 0;

  if (finishReason === "length") {
    logJournalFailure("TRUNCATED", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength
    });
    throw new JournalAttemptError("TRUNCATED", true);
  }

  if (choice?.message?.refusal) {
    logJournalFailure("REFUSAL", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength
    });
    throw new JournalAttemptError("REFUSAL", false);
  }

  if (typeof content !== "string" || !content.trim()) {
    logJournalFailure("MALFORMED_RESPONSE", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength
    });
    throw new JournalAttemptError("MALFORMED_RESPONSE", true);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    logJournalFailure("MALFORMED_JSON", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength
    });
    throw new JournalAttemptError("MALFORMED_JSON", true, content);
  }

  const parsed = telegramJournalSchema.omit({ source: true }).safeParse(parsedJson);
  if (!parsed.success) {
    logJournalFailure("SCHEMA_VALIDATION", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength,
      validationPaths: parsed.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join(".") || "<root>",
        code: issue.code
      }))
    });
    throw new JournalAttemptError("SCHEMA_VALIDATION", true, content);
  }

  return parsed.data;
}

function journalRepairMessages(content: string) {
  return [
    {
      role: "system" as const,
      content: [
        "Исправь только структуру ранее подготовленной дневниковой записи.",
        "Верни полный результат строго по JSON Schema без markdown и пояснений.",
        "Не сокращай cleanedText, не добавляй факты и не меняй смысл автора."
      ].join("\n")
    },
    { role: "user" as const, content }
  ];
}

function journalRetryMessages(
  messages: Array<{ role: "system" | "user"; content: string }>
) {
  return messages.map((message, index) => index === 0
    ? {
        ...message,
        content: `${message.content}\nЭто повторная попытка: обязательно заверши весь JSON в пределах доступного output budget.`
      }
    : message
  );
}

async function parseStructuredJournalWithRetry(
  schema: Record<string, unknown>,
  messages: Array<{ role: "system" | "user"; content: string }>
) {
  let attemptMessages = messages;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await journalStructuredAttempt(schema, attemptMessages, attempt);
    } catch (error) {
      if (!(error instanceof JournalAttemptError)) throw error;
      if (attempt === 2 || !error.retryable) {
        throw new TelegramJournalParseError(error.reason, attempt);
      }
      attemptMessages = error.repairContent && error.reason !== "TRUNCATED"
        ? journalRepairMessages(error.repairContent)
        : journalRetryMessages(messages);
    }
  }

  throw new TelegramJournalParseError("MALFORMED_RESPONSE", 2);
}

export async function classifyTelegramInput(
  originalText: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
): Promise<TelegramInputKind> {
  const text = originalText.trim();
  if (!text) return "JOURNAL";

  const result = z.object({
    kind: z.enum(["ACTION", "WORK_RECORD", "JOURNAL", "LIFE_CONTEXT"]),
    confidence: z.number().min(0).max(1)
  }).parse(await structuredCompletion(
    "telegram_input_kind_v3",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["ACTION", "WORK_RECORD", "JOURNAL", "LIFE_CONTEXT"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["kind", "confidence"]
    },
    [
      {
        role: "system",
        content: [
          "Маршрутизируй сообщение в один поток личного трекера.",
          "ACTION — только явно уже совершенное конкретное коммерческое действие: касание, follow-up, созвон, отправленное предложение или названная цена.",
          "WORK_RECORD — намеренная структурированная рабочая заметка: решение, риск, гипотеза, рабочий план или идея.",
          "JOURNAL — свободное размышление, итоги дня, жизнь, работа в широком смысле, отношения, состояние, сомнения, планы, ценности или смешанная тема.",
          "LIFE_CONTEXT — только явная команда заполнить или изменить постоянный текущий контекст, приоритеты, ограничения, активные проекты, сознательные паузы или действующие решения.",
          "Для LIFE_CONTEXT требуется явный глагол изменения или недвусмысленная формулировка принятого долгосрочного решения. Размышления о работе, жизни и приоритетах сами по себе остаются JOURNAL.",
          "Длинное свободное голосовое по умолчанию является JOURNAL. При сомнении выбирай JOURNAL.",
          "Никогда не превращай дневниковое сообщение в ACTION из-за одного упомянутого возможного действия."
        ].join("\n")
      },
      { role: "user", content: `Источник: ${source}\n\n${text}` }
    ]
  ));

  if (result.kind === "LIFE_CONTEXT") {
    return result.confidence >= 0.86 && hasExplicitLifeContextIntent(text)
      ? "LIFE_CONTEXT"
      : "JOURNAL";
  }

  return result.confidence < 0.72 ? "JOURNAL" : result.kind;
}

const evidenceJsonSchema = {
  type: ["array", "null"],
  maxItems: 12,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string", minLength: 1, maxLength: 1000 },
      kind: { type: "string", enum: journalEvidenceKinds }
    },
    required: ["text", "kind"]
  }
};

function nullableText(value: string | null) {
  return value?.trim() || null;
}

export async function parseTelegramJournal(
  originalText: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  now = new Date()
): Promise<TelegramJournal | null> {
  const text = originalText.trim();
  if (!text) return null;

  const parsed = await parseStructuredJournalWithRetry(
    {
      type: "object",
      additionalProperties: false,
      properties: {
        entryDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        cleanedText: { type: "string", minLength: 1, maxLength: 15000 },
        summary: { type: "string", minLength: 1, maxLength: 600 },
        domains: {
          type: "array",
          minItems: 1,
          maxItems: journalDomains.length,
          items: { type: "string", enum: journalDomains }
        },
        keyEvents: evidenceJsonSchema,
        tensions: evidenceJsonSchema,
        decisions: evidenceJsonSchema,
        questions: evidenceJsonSchema,
        nextStep: { type: ["string", "null"], maxLength: 800 },
        importance: { type: "string", enum: journalImportanceValues }
      },
      required: [
        "entryDate", "cleanedText", "summary", "domains", "keyEvents",
        "tensions", "decisions", "questions", "nextStep", "importance"
      ]
    },
    [
      {
        role: "system",
        content: [
          "Создай структурированную дневниковую запись на русском без выдуманных фактов.",
          `Сегодня: ${todayInAmsterdam(now)}.`,
          "cleanedText — бережно отредактированная речь автора ОТ ПЕРВОГО ЛИЦА, а не summary.",
          "Сохрани эмоциональность, сомнения, разговорные и характерные формулировки. Обычно сохраняй 60–85% смыслового содержания.",
          "Удали только слова-паразиты, оговорки, случайные повторы и очевидный речевой шум.",
          "Запрещено переписывать от третьего лица, делать корпоративную выжимку, превращать сомнение в уверенность, диагностировать или выдумывать мотивы.",
          "summary — короткая фактическая суть. domains — все действительно затронутые сферы.",
          "keyEvents — только произошедшее; tensions — только названные автором противоречия; decisions — только явно принятые решения; questions — только реальные открытые вопросы.",
          "Каждый структурный элемент пометь FACT, USER_INTERPRETATION или AI_INTERPRETATION. AI_INTERPRETATION используй редко и формулируй как гипотезу.",
          "nextStep добавляй только если он действительно следует из речи. По умолчанию importance=NORMAL.",
          "Не добавляй советы, мотивацию, терапевтические или медицинские выводы."
        ].join("\n")
      },
      { role: "user", content: text }
    ]
  );

  return {
    ...parsed,
    domains: Array.from(new Set(parsed.domains)),
    nextStep: nullableText(parsed.nextStep),
    source
  };
}

export function journalPreviewThoughts(entry: TelegramJournal) {
  return [
    ...(entry.keyEvents ?? []),
    ...(entry.tensions ?? []),
    ...(entry.questions ?? [])
  ].map((item) => item.text).slice(0, 3);
}
