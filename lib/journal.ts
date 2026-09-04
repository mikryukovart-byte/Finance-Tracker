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
type JournalEvidenceKind = (typeof journalEvidenceKinds)[number];

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
  summary: z.string().trim().min(1).max(1800),
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
export type JournalPreviewModel = {
  summary: string;
  domains: TelegramJournal["domains"];
  importantPoints: string[];
  decisions: string[];
  nextStep: string | null;
};

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
  | "CONTENT_QUALITY"
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
  qualityIssues?: string[];
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

function logJournalRepair(repairedCount: number) {
  console.warn("OpenAI structured parser repair", {
    parser: "telegram_journal_entry",
    repair: "intention_misclassified_as_decision",
    repairedCount
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
  attempt: number,
  validateQuality: (entry: Omit<TelegramJournal, "source">) => string[]
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

  const normalized = normalizeRepairableJournalIssues(parsed.data);
  const qualityIssues = validateQuality(normalized);
  if (qualityIssues.length > 0) {
    logJournalFailure("CONTENT_QUALITY", {
      attempt,
      status: response.status,
      finishReason,
      responseLength: rawResponse.length,
      contentLength,
      qualityIssues
    });
    throw new JournalAttemptError("CONTENT_QUALITY", true);
  }

  return normalized;
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
  messages: Array<{ role: "system" | "user"; content: string }>,
  reason: JournalFailureReason
) {
  return messages.map((message, index) => index === 0
    ? {
        ...message,
        content: [
          message.content,
          reason === "CONTENT_QUALITY"
            ? "Это повторная попытка: cleanedText должен остаться подробным текстом от первого лица, а summary и тезисы preview — естественным текстом от первого лица без обращений и технических обозначений говорящего. Не усиливай причинность и не записывай желания или планы в decisions."
            : "Это повторная попытка: обязательно заверши весь JSON в пределах доступного output budget."
        ].join("\n")
      }
    : message
  );
}

async function parseStructuredJournalWithRetry(
  schema: Record<string, unknown>,
  messages: Array<{ role: "system" | "user"; content: string }>,
  validateQuality: (entry: Omit<TelegramJournal, "source">) => string[]
) {
  let attemptMessages = messages;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await journalStructuredAttempt(
        schema,
        attemptMessages,
        attempt,
        validateQuality
      );
    } catch (error) {
      if (!(error instanceof JournalAttemptError)) throw error;
      if (attempt === 2 || !error.retryable) {
        throw new TelegramJournalParseError(error.reason, attempt);
      }
      attemptMessages = error.repairContent && error.reason !== "TRUNCATED"
        ? journalRepairMessages(error.repairContent)
        : journalRetryMessages(messages, error.reason);
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

function hasRussianWord(text: string, word: string) {
  return new RegExp(
    `(^|[^А-ЯЁа-яё])${word}(?=$|[^А-ЯЁа-яё])`,
    "i"
  ).test(text);
}

function hasFirstPersonVoice(text: string) {
  return ["я", "мне", "меня", "мной", "мой", "моя", "моё", "мои"].some((word) => (
    hasRussianWord(text, word)
  ));
}

function journalPreviewFields(entry: Omit<TelegramJournal, "source">) {
  return [
    entry.summary,
    ...(entry.keyEvents ?? []).map((item) => item.text),
    ...(entry.tensions ?? []).map((item) => item.text),
    ...(entry.decisions ?? []).map((item) => item.text),
    ...(entry.questions ?? []).map((item) => item.text),
    ...(entry.nextStep ? [entry.nextStep] : [])
  ];
}

function startsAsIntention(text: string) {
  const normalized = text.trim();
  const hasExplicitCommitment = /(?:^|[^А-ЯЁа-яё])(?:решил(?:а)?|принял(?:а)?\s+решение|выбираю|точно\s+буду|обязуюсь)(?=$|[^А-ЯЁа-яё])/i
    .test(normalized);
  if (hasExplicitCommitment) return false;

  return /^(?:я\s+)?(?:хочу|хотел(?:а)?\s+бы|хотелось\s+бы|планирую|собираюсь|думаю|рассматриваю|намерен(?:а)?|постараюсь|возможно|может\s+быть)(?=$|[^А-ЯЁа-яё])/i
    .test(normalized);
}

function normalizeRepairableJournalIssues(entry: Omit<TelegramJournal, "source">) {
  const decisions = entry.decisions ?? [];
  const normalizedDecisions = decisions.filter((item) => !startsAsIntention(item.text));
  const repairedCount = decisions.length - normalizedDecisions.length;

  if (repairedCount === 0) return entry;
  logJournalRepair(repairedCount);

  return {
    ...entry,
    decisions: normalizedDecisions.length > 0 ? normalizedDecisions : null
  };
}

function journalQualityIssues(
  entry: Omit<TelegramJournal, "source">,
  originalText: string,
  isLongEntry: boolean
) {
  const issues: string[] = [];
  const previewFields = journalPreviewFields(entry);
  if (previewFields.some((field) => (
    ["автор", "пользователь", "субъект"].some((word) => hasRussianWord(field, word))
    || /(?:^|\n)\s*ты\s*:/i.test(field)
  ))) {
    issues.push("preview_forbidden_actor_label");
  }
  if (!hasFirstPersonVoice(entry.summary)) {
    issues.push("preview_missing_first_person");
  }
  if (hasRussianWord(originalText, "я") && !hasRussianWord(entry.cleanedText, "я")) {
    issues.push("cleaned_text_missing_first_person");
  }
  const originalWordCount = originalText.split(/\s+/).filter(Boolean).length;
  const cleanedWordCount = entry.cleanedText.split(/\s+/).filter(Boolean).length;
  if (isLongEntry && cleanedWordCount < Math.max(180, Math.floor(originalWordCount * 0.45))) {
    issues.push("cleaned_text_too_short_for_long_entry");
  }
  if ((entry.decisions ?? []).some((item) => startsAsIntention(item.text))) {
    issues.push("intention_misclassified_as_decision");
  }
  return issues;
}

export async function parseTelegramJournal(
  originalText: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  now = new Date()
): Promise<TelegramJournal | null> {
  const text = originalText.trim();
  if (!text) return null;
  const isLongEntry = text.split(/\s+/).length >= 220;

  const parsed = await parseStructuredJournalWithRetry(
    {
      type: "object",
      additionalProperties: false,
      properties: {
        entryDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        cleanedText: { type: "string", minLength: 1, maxLength: 15000 },
        summary: { type: "string", minLength: 1, maxLength: 1800 },
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
          "cleanedText — бережно отредактированная речь от ПЕРВОГО ЛИЦА, а не summary.",
          "В cleanedText используй «я» и сохрани ход мысли, аргументацию, сомнения, отношение к происходящему, мотивацию, объяснение решений, причинные связи, эмоциональный оттенок и значимые детали.",
          "Для длинной содержательной расшифровки cleanedText должен сохранять примерно 60–85% смыслового содержания: планы, существенные суммы, даты, людей и проекты. Это подробный дневниковый текст, а не сухая выжимка из двух-трёх предложений.",
          "Удали только слова-паразиты, оговорки, случайные повторы и очевидный речевой шум.",
          "Запрещено переписывать от третьего лица, делать корпоративную выжимку, превращать сомнение в уверенность, диагностировать или выдумывать мотивы.",
          "summary — компактный Telegram preview ОТ ПЕРВОГО ЛИЦА, как личная дневниковая запись. Используй естественные формулировки с «я», «мне», «мой»; не обращайся к человеку через «ты».",
          "Во всех текстах preview категорически запрещены слова-ярлыки и префиксы «Автор:», «Пользователь:», «Субъект:», «Ты:». Не начинай ими ни summary, ни отдельный тезис.",
          isLongEntry
            ? "Для этой длинной записи summary должен содержать 120–250 слов: 2–4 плотных абзаца без искусственного заполнения объёма."
            : "Для этой короткой записи summary должен быть заметно короче и не повторять cleanedText целиком.",
          "В summary приоритетны: что происходит; почему это важно для меня; причинные связи, которые я сам назвал; реальные решения; корректно обозначенные планы и намерения; конкретный ближайший шаг или событие.",
          "Сохраняй названную человеком мотивацию и причинные связи буквально по смыслу. Не усиливай и не инвертируй причинность, не достраивай психологическое объяснение и не превращай временную последовательность в связь «из-за». Если связь не заявлена явно, оставь события раздельными.",
          "Если человек сам объяснил причинную связь, сохрани её направление и силу и пометь соответствующий тезис USER_INTERPRETATION. При сомнении ослабь формулировку, а не усиливай её.",
          "domains — все действительно затронутые сферы.",
          "keyEvents — произошедшие значимые факты, важные изменения траектории и явно назначенные будущие события; tensions — только названные мной противоречия; decisions — только явно принятые решения; questions — только реальные открытые вопросы.",
          "Для «Что важно» выделяй в keyEvents/tensions 2–3 самых стратегичных смысла: мотивацию, изменение жизненной стратегии или состояния, мою причинную связь, траекторию собственного проекта, принятое решение или конкретный следующий шаг. Не повышай приоритет тезиса только из-за негативности, суммы или порядка появления.",
          "Строго различай решение, намерение и событие. Желание или намерение называй «хочу», «планирую» или «намерен», но не записывай в decisions без отдельного явного commitment. Размышление не является решением. Назначенная встреча, поездка или дедлайн — событие/nextStep, а не решение.",
          "Каждый структурный элемент пометь FACT, USER_INTERPRETATION или AI_INTERPRETATION. Самостоятельно названная причинная связь — USER_INTERPRETATION. AI_INTERPRETATION используй только при явной необходимости и формулируй как гипотезу.",
          "Тексты keyEvents, tensions, decisions и questions, которые могут попасть в preview, также формулируй естественно от первого лица. Не используй третье лицо и технические обозначения говорящего.",
          "nextStep добавляй только для реально названного ближайшего шага или конкретного будущего события. По умолчанию importance=NORMAL.",
          "Не добавляй советы, мотивацию, терапевтические или медицинские выводы."
        ].join("\n")
      },
      { role: "user", content: text }
    ],
    (entry) => journalQualityIssues(entry, text, isLongEntry)
  );

  return {
    ...parsed,
    domains: Array.from(new Set(parsed.domains)),
    nextStep: nullableText(parsed.nextStep),
    source
  };
}

export function journalPreviewThoughts(entry: TelegramJournal) {
  return buildJournalPreviewModel(entry).importantPoints;
}

function journalThoughtPriority(text: string, kind: JournalEvidenceKind) {
  const normalized = text.toLocaleLowerCase("ru-RU");
  const has = (pattern: RegExp) => pattern.test(normalized);
  let score = kind === "USER_INTERPRETATION" ? 80 : 20;

  if (has(/(?:потому\s+что|чтобы|для\s+того\s+чтобы|для\s+того|зачем|мне\s+важно|мне\s+нравится[^.!?]*потому|воспринима|опыт|научиться|перед\s+тем\s+как|пригодится|возможност|как\s+способ|хочу\s+получить|цель|смысл|да[её]т\s+мне)/)) score += 60;
  if (has(/(?:после|когда|поэтому|из-за|благодаря|связыва|стало)/)) score += 50;
  if (has(/(?:стратег|траектор|приоритет|курс|сознательно|изменил|изменила|начал|начала)/)) score += 35;
  if (has(/(?:сво(?:й|его|ему|им|их)|собственн(?:ый|ого|ому|ым|ых))\s+проект|проект(?:а|у|ом|ы|ов|ам|ами|ах)?/)) score += 40;
  if (has(/(?:решил|решила|выбираю|остаюсь|буду)/)) score += 25;
  if (has(/(?:встреч|поезд|лечу|еду|дедлайн|следующ(?:ий|ая|ее)\s+шаг)/) || /(?:^|[^0-9])\d{1,2}\s+[а-яё]+(?=$|[^а-яё])/i.test(normalized)) score += 35;

  return score;
}

type GroundedJournalFragment = {
  index: number;
  text: string;
  tokens: Set<string>;
  dates: Set<string>;
};

const journalStopWords = new Set([
  "без", "был", "была", "были", "быть", "для", "его", "если", "еще", "или",
  "как", "мне", "мой", "моя", "мои", "над", "она", "они", "оно", "после",
  "при", "про", "так", "там", "тем", "что", "это", "этот", "эта", "эти", "меня"
]);

const journalMonthPattern = "январ(?:я|ь)|феврал(?:я|ь)|март(?:а)?|апрел(?:я|ь)|ма[йя]|июн(?:я|ь)|июл(?:я|ь)|август(?:а)?|сентябр(?:я|ь)|октябр(?:я|ь)|ноябр(?:я|ь)|декабр(?:я|ь)";

function journalSemanticTokens(text: string) {
  return new Set(
    (text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").match(/[а-яa-z0-9]+/g) ?? [])
      .filter((token) => (token.length >= 3 || /^\d+$/.test(token)) && !journalStopWords.has(token))
  );
}

function journalDateKeys(text: string) {
  const keys = new Set<string>();
  const pattern = new RegExp(`(?:^|[^0-9])(\\d{1,2})\\s+(${journalMonthPattern})`, "gi");
  const normalized = text.toLocaleLowerCase("ru-RU");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    keys.add(`${Number(match[1])}:${match[2].slice(0, 3)}`);
  }
  return keys;
}

function journalGroundedFragments(cleanedText: string) {
  const sentences = cleanedText.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [cleanedText];
  return sentences
    .map((sentence) => sentence.trim().replace(/\s+/g, " "))
    .filter((sentence) => sentence.length >= 16)
    .map((text, index): GroundedJournalFragment => ({
      index,
      text,
      tokens: journalSemanticTokens(text),
      dates: journalDateKeys(text)
    }));
}

function sharedValues(left: Set<string>, right: Set<string>) {
  let count = 0;
  left.forEach((value) => {
    if (right.has(value)) count += 1;
  });
  return count;
}

function findGroundedJournalFragment(
  hint: string | null,
  fragments: GroundedJournalFragment[]
) {
  if (!hint?.trim()) return null;
  const hintTokens = journalSemanticTokens(hint);
  const hintDates = journalDateKeys(hint);

  const ranked = fragments.map((fragment) => {
    const shared = sharedValues(hintTokens, fragment.tokens);
    const shortest = Math.max(1, Math.min(hintTokens.size, fragment.tokens.size));
    const overlap = shared / shortest;
    const sharedDate = sharedValues(hintDates, fragment.dates) > 0;
    return {
      fragment,
      shared,
      overlap,
      sharedDate,
      score: overlap + shared * 0.04 + (sharedDate ? 0.5 : 0)
    };
  }).sort((left, right) => right.score - left.score || left.fragment.index - right.fragment.index);

  const best = ranked[0];
  if (!best) return null;
  const grounded = best.shared >= 2 && best.overlap >= 0.28;
  const groundedByDate = best.sharedDate && best.shared >= 2;
  return grounded || groundedByDate ? best.fragment : null;
}

function isExplicitJournalDecision(text: string) {
  if (startsAsIntention(text)) return false;
  return /^(?:(?:сейчас|поэтому|пока)\s*,?\s*)?(?:я\s+)?(?:решил(?:а)?|принял(?:а)?\s+решение|выбираю|выбрал(?:а)?|буду|остаюсь|отказал(?:ся|ась)|прекращаю|начинаю)(?=$|[^А-ЯЁа-яё])/i
    .test(text.trim());
}

function journalFragmentsDuplicate(
  left: GroundedJournalFragment,
  right: GroundedJournalFragment
) {
  if (left.index === right.index) return true;
  const shared = sharedValues(left.tokens, right.tokens);
  const shortest = Math.max(1, Math.min(left.tokens.size, right.tokens.size));
  const overlap = shared / shortest;
  const sharedDate = sharedValues(left.dates, right.dates) > 0;
  return (shared >= 3 && overlap >= 0.6) || (sharedDate && shared >= 2);
}

export function buildJournalPreviewModel(entry: TelegramJournal): JournalPreviewModel {
  const fragments = journalGroundedFragments(entry.cleanedText);
  const nextStepFragment = findGroundedJournalFragment(entry.nextStep, fragments);
  const decisionFragments: GroundedJournalFragment[] = [];

  for (const decision of entry.decisions ?? []) {
    const fragment = findGroundedJournalFragment(decision.text, fragments);
    if (
      !fragment
      || !isExplicitJournalDecision(fragment.text)
      || (nextStepFragment && journalFragmentsDuplicate(fragment, nextStepFragment))
      || decisionFragments.some((item) => journalFragmentsDuplicate(item, fragment))
    ) continue;
    decisionFragments.push(fragment);
  }

  const hintKinds = new Map<number, JournalEvidenceKind>();
  const hints = [
    ...(entry.keyEvents ?? []),
    ...(entry.tensions ?? []),
    ...(entry.questions ?? [])
  ].filter((item) => item.kind !== "AI_INTERPRETATION");

  for (const hint of hints) {
    const fragment = findGroundedJournalFragment(hint.text, fragments);
    if (!fragment) continue;
    const currentKind = hintKinds.get(fragment.index);
    if (!currentKind || hint.kind === "USER_INTERPRETATION") {
      hintKinds.set(fragment.index, hint.kind);
    }
  }

  const importantFragments = fragments
    .filter((fragment) => !nextStepFragment || !journalFragmentsDuplicate(fragment, nextStepFragment))
    .filter((fragment) => !decisionFragments.some((decision) => journalFragmentsDuplicate(fragment, decision)))
    .map((fragment) => ({
      fragment,
      score: journalThoughtPriority(fragment.text, hintKinds.get(fragment.index) ?? "FACT")
    }))
    .filter((item) => item.score >= 40)
    .sort((left, right) => right.score - left.score || left.fragment.index - right.fragment.index)
    .slice(0, 3)
    .map((item) => item.fragment.text);

  return {
    summary: entry.summary,
    domains: entry.domains,
    importantPoints: importantFragments,
    decisions: decisionFragments.map((fragment) => fragment.text),
    nextStep: nextStepFragment?.text ?? null
  };
}
