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
export type TelegramInputKind = "ACTION" | "WORK_RECORD" | "JOURNAL";

function openAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return apiKey;
}

function journalModel() {
  return process.env.OPENAI_WORK_RECORD_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
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

export async function classifyTelegramInput(
  originalText: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">
): Promise<TelegramInputKind> {
  const text = originalText.trim();
  if (!text) return "JOURNAL";

  const result = z.object({
    kind: z.enum(["ACTION", "WORK_RECORD", "JOURNAL"]),
    confidence: z.number().min(0).max(1)
  }).parse(await structuredCompletion(
    "telegram_input_kind_v2",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["ACTION", "WORK_RECORD", "JOURNAL"] },
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
          "Длинное свободное голосовое по умолчанию является JOURNAL. При сомнении выбирай JOURNAL.",
          "Никогда не превращай дневниковое сообщение в ACTION из-за одного упомянутого возможного действия."
        ].join("\n")
      },
      { role: "user", content: `Источник: ${source}\n\n${text}` }
    ]
  ));

  return result.confidence < 0.72 ? "JOURNAL" : result.kind;
}

const evidenceJsonSchema = {
  type: ["array", "null"],
  maxItems: 12,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string", maxLength: 1000 },
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

  const parsed = telegramJournalSchema.omit({ source: true }).parse(await structuredCompletion(
    "telegram_journal_entry",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        entryDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        cleanedText: { type: "string", maxLength: 15000 },
        summary: { type: "string", maxLength: 600 },
        domains: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: journalDomains } },
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
  ));

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
