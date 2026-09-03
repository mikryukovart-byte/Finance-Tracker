import { z } from "zod";

import { todayInAmsterdam } from "@/lib/telegram-daily-actions";
import { dateOnlyValue, mondayOfWeek, parseDateOnly } from "@/lib/week";

export const workRecordTypes = [
  "NOTE",
  "DECISION",
  "RISK",
  "IDEA",
  "DAILY_REFLECTION",
  "WEEKLY_PLAN_DRAFT",
  "HYPOTHESIS_DRAFT",
  "ACTION_CANDIDATE"
] as const;

export const workRecordSources = [
  "TELEGRAM_TEXT",
  "TELEGRAM_VOICE",
  "WEB_MANUAL"
] as const;

function hasTwoToFiveSentences(value: string) {
  const sentences = value
    .split(/[.!?]+(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length >= 2 && sentences.length <= 5;
}

export const telegramWorkRecordSchema = z.object({
  title: z.string().trim().min(1).max(90),
  recordType: z.enum(workRecordTypes),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .refine(hasTwoToFiveSentences, "Суть должна содержать от 2 до 5 предложений"),
  insight: z.string().trim().max(500).nullable(),
  risk: z.string().trim().max(500).nullable(),
  nextStep: z.string().trim().max(500).nullable(),
  relatedWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source: z.enum(workRecordSources)
});

export type TelegramWorkRecord = z.infer<typeof telegramWorkRecordSchema>;
export type TelegramWorkRecordSource = TelegramWorkRecord["source"];

export const workRecordTypeLabels: Record<TelegramWorkRecord["recordType"], string> = {
  NOTE: "Заметка",
  DECISION: "Решение",
  RISK: "Риск",
  IDEA: "Идея",
  DAILY_REFLECTION: "Итоги дня",
  WEEKLY_PLAN_DRAFT: "Черновик плана недели",
  HYPOTHESIS_DRAFT: "Черновик гипотезы",
  ACTION_CANDIDATE: "Кандидат в действие"
};

function openAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  return apiKey;
}

function workRecordModel() {
  return process.env.OPENAI_WORK_RECORD_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
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
      model: workRecordModel(),
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema }
      },
      messages
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${name} parsing failed`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error(`OpenAI returned an empty ${name}`);
  }

  return JSON.parse(content) as unknown;
}

function nullableText(value: string | null) {
  return value?.trim() || null;
}

function normalizeRelatedWeek(value: string | null) {
  if (!value) {
    return null;
  }

  const date = parseDateOnly(value);
  return date ? dateOnlyValue(mondayOfWeek(date)) : null;
}

export async function parseTelegramWorkRecord(
  originalText: string,
  source: Extract<TelegramWorkRecordSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  now = new Date()
): Promise<TelegramWorkRecord | null> {
  const text = originalText.trim();

  if (!text) {
    return null;
  }

  const today = todayInAmsterdam(now);
  const parsed = telegramWorkRecordSchema.omit({ source: true }).parse(
    await structuredCompletion(
      "telegram_work_record",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", maxLength: 90 },
          recordType: { type: "string", enum: workRecordTypes },
          summary: { type: "string", maxLength: 1200 },
          insight: { type: ["string", "null"], maxLength: 500 },
          risk: { type: ["string", "null"], maxLength: 500 },
          nextStep: { type: ["string", "null"], maxLength: 500 },
          relatedWeekStart: {
            type: ["string", "null"],
            pattern: "^\\d{4}-\\d{2}-\\d{2}$"
          }
        },
        required: [
          "title",
          "recordType",
          "summary",
          "insight",
          "risk",
          "nextStep",
          "relatedWeekStart"
        ]
      },
      [
        {
          role: "system",
          content: [
            "Преобразуй русское сообщение в одну рабочую запись без выдуманных фактов.",
            `Сегодня: ${today}.`,
            "title — ясная тема до 90 символов.",
            "summary — самодостаточная суть в 2–5 коротких предложениях, без markdown и без дословной стенограммы.",
            "recordType: NOTE, DECISION, RISK, IDEA, DAILY_REFLECTION, WEEKLY_PLAN_DRAFT, HYPOTHESIS_DRAFT или ACTION_CANDIDATE.",
            "Если точная категория неясна, используй NOTE и нейтрально сохраняй неопределённость автора.",
            "insight, risk и nextStep заполняй только когда они прямо следуют из сообщения, иначе null.",
            "relatedWeekStart — дата понедельника YYYY-MM-DD только при явной связи с неделей, иначе null.",
            "Отделяй факты от предположений. Не выдумывай имена клиентов, даты, обязательства или результаты.",
            "Не превращай каждую рефлексию в задачу, не ставь психологических диагнозов и не сохраняй финансовые транзакции.",
            "Все текстовые поля пиши по-русски. Не добавляй советы, терапевтический язык или мотивацию."
          ].join("\n")
        },
        { role: "user", content: text }
      ]
    )
  );

  return {
    ...parsed,
    insight: nullableText(parsed.insight),
    risk: nullableText(parsed.risk),
    nextStep: nullableText(parsed.nextStep),
    relatedWeekStart: normalizeRelatedWeek(parsed.relatedWeekStart),
    source
  };
}
