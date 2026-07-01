import { z } from "zod";

export const telegramDailyActionTypes = [
  "FIRST_TOUCH",
  "FOLLOW_UP",
  "WARM_CONTACT",
  "CALL",
  "PROPOSAL",
  "PRICE_NAMED",
  "OTHER"
] as const;

export const telegramDailyActionSchema = z.object({
  type: z.enum(telegramDailyActionTypes),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target: z.string().trim().max(160).nullable(),
  value: z.string().trim().max(300).nullable(),
  nextStep: z.string().trim().max(300).nullable(),
  note: z.string().max(4096)
});

export type TelegramDailyAction = z.infer<typeof telegramDailyActionSchema>;

export const telegramDailyActionLabels: Record<
  TelegramDailyAction["type"],
  string
> = {
  FIRST_TOUCH: "Первое касание",
  FOLLOW_UP: "Follow-up",
  WARM_CONTACT: "Тёплый контакт",
  CALL: "Созвон",
  PROPOSAL: "Коммерческое предложение",
  PRICE_NAMED: "Названа цена",
  OTHER: "Другое действие"
};

function openAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  return apiKey;
}

export function todayInAmsterdam(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function nullableText(value: string | null) {
  return value?.trim() || null;
}

export function hasUsefulDailyAction(action: TelegramDailyAction) {
  return (
    action.type !== "OTHER" ||
    Boolean(action.target || action.value || action.nextStep)
  );
}

export async function parseTelegramDailyAction(
  originalText: string,
  now = new Date()
): Promise<TelegramDailyAction | null> {
  const text = originalText.trim();

  if (!text) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "daily_action",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: telegramDailyActionTypes },
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              target: { type: ["string", "null"] },
              value: { type: ["string", "null"] },
              nextStep: { type: ["string", "null"] },
              note: { type: "string" }
            },
            required: ["type", "date", "target", "value", "nextStep", "note"]
          }
        }
      },
      messages: [
        {
          role: "system",
          content: [
            "Ты извлекаешь только одно деловое Daily Action из сообщения на русском языке.",
            `Сегодня в Europe/Amsterdam: ${todayInAmsterdam(now)}. Используй эту дату, если явная дата не указана.`,
            "Типы: FIRST_TOUCH — первое холодное касание; FOLLOW_UP — повторное напоминание; WARM_CONTACT — прямой или тёплый контакт с принимающим решение; CALL — состоявшийся созвон; PROPOSAL — отправлено КП/предложение; PRICE_NAMED — клиенту названа цена; OTHER — любое иное или неясное действие.",
            "Не придумывай факты. Если действие или тип неясны, ставь OTHER.",
            "target — кому или куда; value — почему сделанное ценно; nextStep — конкретный следующий шаг. Неизвестные поля должны быть null.",
            "Не обрабатывай расходы, доходы, переводы, долги и кредитные карты как финансовые операции. Этот парсер только про Daily Actions.",
            "Все текстовые поля пиши по-русски. Не добавляй советы, мотивацию или markdown.",
            "Поле note верни как исходное сообщение без пересказа."
          ].join("\n")
        },
        { role: "user", content: text }
      ]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("OpenAI Daily Action parsing failed");
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenAI returned an empty Daily Action");
  }

  const parsed = telegramDailyActionSchema.safeParse(JSON.parse(content));

  if (!parsed.success || !isValidCalendarDate(parsed.data.date)) {
    throw new Error("OpenAI returned an invalid Daily Action");
  }

  const action: TelegramDailyAction = {
    ...parsed.data,
    target: nullableText(parsed.data.target),
    value: nullableText(parsed.data.value),
    nextStep: nullableText(parsed.data.nextStep),
    note: text
  };

  return hasUsefulDailyAction(action) ? action : null;
}

export async function transcribeTelegramVoice(audio: Blob) {
  const formData = new FormData();
  formData.append("file", audio, "telegram-voice.ogg");
  formData.append(
    "model",
    process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
  );
  formData.append("language", "ru");
  formData.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiApiKey()}` },
    body: formData,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("OpenAI transcription failed");
  }

  const data = await response.json();
  const transcript = typeof data?.text === "string" ? data.text.trim() : "";

  if (!transcript) {
    throw new Error("OpenAI transcription was empty");
  }

  return transcript;
}
