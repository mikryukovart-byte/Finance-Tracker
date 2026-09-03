import { z } from "zod";

import {
  activeDecisionSchema,
  emptyLifeContext,
  type ActiveDecision,
  type LifeContextValue
} from "@/lib/life-context";
import { todayInAmsterdam } from "@/lib/telegram-daily-actions";
import type { TelegramJournalSource } from "@/lib/journal";

export const lifeContextPatchOperations = [
  "UNCHANGED",
  "REPLACE",
  "APPEND",
  "REMOVE"
] as const;

const patchOperationSchema = z.enum(lifeContextPatchOperations);
const nullablePatchTextSchema = z.string().trim().max(4000).nullable();
const listItemSchema = z.string().trim().min(1).max(500);

const textFieldPatchSchema = z.object({
  operation: patchOperationSchema,
  value: nullablePatchTextSchema,
  match: nullablePatchTextSchema
}).strict();

const listFieldPatchSchema = z.object({
  operation: patchOperationSchema,
  items: z.array(listItemSchema).max(30)
}).strict();

const decisionFieldPatchSchema = z.object({
  operation: patchOperationSchema,
  items: z.array(activeDecisionSchema).max(30)
}).strict();

const partialLifeContextPatchSchema = z.object({
  currentSituation: textFieldPatchSchema.optional(),
  priorities: listFieldPatchSchema.optional(),
  constraints: listFieldPatchSchema.optional(),
  activeProjects: listFieldPatchSchema.optional(),
  deliberatePauses: listFieldPatchSchema.optional(),
  activeDecisions: decisionFieldPatchSchema.optional(),
  notes: textFieldPatchSchema.optional(),
  ambiguities: z.array(z.string().trim().min(1).max(500)).max(8).optional()
}).strict();

export const telegramLifeContextPatchSchema = z.object({
  currentSituation: textFieldPatchSchema,
  priorities: listFieldPatchSchema,
  constraints: listFieldPatchSchema,
  activeProjects: listFieldPatchSchema,
  deliberatePauses: listFieldPatchSchema,
  activeDecisions: decisionFieldPatchSchema,
  notes: textFieldPatchSchema,
  ambiguities: z.array(z.string().trim().min(1).max(500)).max(8)
}).strict();

export const telegramLifeContextProposalSchema = z.object({
  patch: telegramLifeContextPatchSchema,
  baseUpdatedAt: z.string().datetime().nullable(),
  preview: z.string().trim().min(1).max(3900)
}).strict();

export type TelegramLifeContextPatch = z.infer<typeof telegramLifeContextPatchSchema>;
export type TelegramLifeContextProposal = z.infer<typeof telegramLifeContextProposalSchema>;
export type TelegramLifeContextSaveResult = "SAVED" | "STALE";

const unchangedTextPatch = {
  operation: "UNCHANGED" as const,
  value: null,
  match: null
};
const unchangedListPatch = {
  operation: "UNCHANGED" as const,
  items: [] as string[]
};
const unchangedDecisionPatch = {
  operation: "UNCHANGED" as const,
  items: [] as ActiveDecision[]
};

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function uniqueTextItems(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizedText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTextPatch(
  patch: z.infer<typeof textFieldPatchSchema> | undefined,
  ambiguities: string[]
) {
  if (!patch || patch.operation === "UNCHANGED") return unchangedTextPatch;
  if (patch.operation === "APPEND" && !patch.value) {
    ambiguities.push("Не определён текст, который нужно добавить.");
    return unchangedTextPatch;
  }
  if (patch.operation === "REMOVE" && !patch.match) {
    ambiguities.push("Не определён точный текст, который нужно убрать.");
    return unchangedTextPatch;
  }
  return {
    operation: patch.operation,
    value: patch.operation === "REMOVE" ? null : patch.value,
    match: patch.operation === "REMOVE" ? patch.match : null
  };
}

function normalizeListPatch(
  patch: z.infer<typeof listFieldPatchSchema> | undefined,
  ambiguities: string[]
) {
  if (!patch || patch.operation === "UNCHANGED") return unchangedListPatch;
  const items = uniqueTextItems(patch.items);
  if (patch.operation !== "REPLACE" && items.length === 0) {
    ambiguities.push("Не определены точные пункты для изменения.");
    return unchangedListPatch;
  }
  return { operation: patch.operation, items };
}

function normalizeDecisionPatch(
  patch: z.infer<typeof decisionFieldPatchSchema> | undefined,
  ambiguities: string[]
) {
  if (!patch || patch.operation === "UNCHANGED") return unchangedDecisionPatch;
  const seen = new Set<string>();
  const items = patch.items.filter((item) => {
    const key = normalizedText(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (patch.operation !== "REPLACE" && items.length === 0) {
    ambiguities.push("Не определено точное действующее решение для изменения.");
    return unchangedDecisionPatch;
  }
  return { operation: patch.operation, items };
}

export function normalizeTelegramLifeContextPatch(value: unknown): TelegramLifeContextPatch {
  const parsed = partialLifeContextPatchSchema.parse(value);
  const ambiguities = [...(parsed.ambiguities ?? [])];
  return telegramLifeContextPatchSchema.parse({
    currentSituation: normalizeTextPatch(parsed.currentSituation, ambiguities),
    priorities: normalizeListPatch(parsed.priorities, ambiguities),
    constraints: normalizeListPatch(parsed.constraints, ambiguities),
    activeProjects: normalizeListPatch(parsed.activeProjects, ambiguities),
    deliberatePauses: normalizeListPatch(parsed.deliberatePauses, ambiguities),
    activeDecisions: normalizeDecisionPatch(parsed.activeDecisions, ambiguities),
    notes: normalizeTextPatch(parsed.notes, ambiguities),
    ambiguities: Array.from(new Set(ambiguities)).slice(0, 8)
  });
}

function applyTextPatch(current: string, patch: TelegramLifeContextPatch["currentSituation"]) {
  if (patch.operation === "UNCHANGED") return current;
  if (patch.operation === "REPLACE") return patch.value ?? current;
  if (patch.operation === "APPEND") {
    const addition = patch.value?.trim();
    if (!addition) return current;
    if (!current.trim()) return addition;
    if (normalizedText(current).includes(normalizedText(addition))) return current;
    return `${current.trim()}\n${addition}`;
  }

  const match = patch.match?.trim();
  if (!match) return current;
  if (normalizedText(current) === normalizedText(match)) return "";
  const lines = current.split("\n");
  const remaining = lines.filter((line) => normalizedText(line) !== normalizedText(match));
  return remaining.length === lines.length ? current : remaining.join("\n").trim();
}

function applyListPatch(current: string[], patch: TelegramLifeContextPatch["priorities"]) {
  if (patch.operation === "UNCHANGED") return [...current];
  if (patch.operation === "REPLACE") return uniqueTextItems(patch.items);
  if (patch.operation === "APPEND") return uniqueTextItems([...current, ...patch.items]);
  const removed = new Set(patch.items.map(normalizedText));
  return current.filter((item) => !removed.has(normalizedText(item)));
}

function applyDecisionPatch(
  current: ActiveDecision[],
  patch: TelegramLifeContextPatch["activeDecisions"]
) {
  if (patch.operation === "UNCHANGED") return current.map((item) => ({ ...item }));
  if (patch.operation === "REPLACE") return patch.items.map((item) => ({ ...item }));
  if (patch.operation === "APPEND") {
    const existing = new Set(current.map((item) => normalizedText(item.text)));
    return [
      ...current.map((item) => ({ ...item })),
      ...patch.items
        .filter((item) => !existing.has(normalizedText(item.text)))
        .map((item) => ({ ...item }))
    ];
  }
  const removed = new Set(patch.items.map((item) => normalizedText(item.text)));
  return current
    .filter((item) => !removed.has(normalizedText(item.text)))
    .map((item) => ({ ...item }));
}

export function applyLifeContextPatch(
  current: LifeContextValue,
  patch: TelegramLifeContextPatch
): LifeContextValue {
  return {
    currentSituation: applyTextPatch(current.currentSituation, patch.currentSituation),
    priorities: applyListPatch(current.priorities, patch.priorities),
    constraints: applyListPatch(current.constraints, patch.constraints),
    activeProjects: applyListPatch(current.activeProjects, patch.activeProjects),
    deliberatePauses: applyListPatch(current.deliberatePauses, patch.deliberatePauses),
    activeDecisions: applyDecisionPatch(current.activeDecisions, patch.activeDecisions),
    notes: applyTextPatch(current.notes, patch.notes),
    updatedAt: current.updatedAt
  };
}

const fieldLabels = {
  currentSituation: "Что происходит сейчас",
  priorities: "Приоритеты",
  constraints: "Ограничения",
  activeProjects: "Активные проекты",
  deliberatePauses: "Сознательно на паузе",
  activeDecisions: "Действующие решения",
  notes: "Дополнительные заметки"
} as const;

function compact(value: string, maxLength = 240) {
  const oneLine = value.trim().replace(/\s+/g, " ");
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}…` : oneLine;
}

function textDiff(before: string, after: string) {
  if (before === after) return [];
  return [
    ...(before.trim() ? [`− ${compact(before)}`] : []),
    ...(after.trim() ? [`+ ${compact(after)}`] : ["+ поле будет очищено"])
  ];
}

function listDiff(before: string[], after: string[]) {
  const beforeKeys = new Set(before.map(normalizedText));
  const afterKeys = new Set(after.map(normalizedText));
  return [
    ...before.filter((item) => !afterKeys.has(normalizedText(item))).slice(0, 4).map((item) => `− ${compact(item)}`),
    ...after.filter((item) => !beforeKeys.has(normalizedText(item))).slice(0, 4).map((item) => `+ ${compact(item)}`)
  ];
}

function decisionLabel(decision: ActiveDecision) {
  const date = decision.validUntil ? ` · до ${decision.validUntil}` : "";
  return `${decision.text}${date}`;
}

function decisionDiff(before: ActiveDecision[], after: ActiveDecision[]) {
  const beforeKeys = new Set(before.map((item) => normalizedText(item.text)));
  const afterKeys = new Set(after.map((item) => normalizedText(item.text)));
  return [
    ...before.filter((item) => !afterKeys.has(normalizedText(item.text))).slice(0, 4).map((item) => `− ${compact(decisionLabel(item))}`),
    ...after.filter((item) => !beforeKeys.has(normalizedText(item.text))).slice(0, 4).map((item) => `+ ${compact(decisionLabel(item))}`)
  ];
}

export function buildLifeContextPreview(
  current: LifeContextValue,
  patch: TelegramLifeContextPatch
) {
  const next = applyLifeContextPatch(current, patch);
  const sections: Array<{ label: string; lines: string[] }> = [
    { label: fieldLabels.currentSituation, lines: textDiff(current.currentSituation, next.currentSituation) },
    { label: fieldLabels.priorities, lines: listDiff(current.priorities, next.priorities) },
    { label: fieldLabels.constraints, lines: listDiff(current.constraints, next.constraints) },
    { label: fieldLabels.activeProjects, lines: listDiff(current.activeProjects, next.activeProjects) },
    { label: fieldLabels.deliberatePauses, lines: listDiff(current.deliberatePauses, next.deliberatePauses) },
    { label: fieldLabels.activeDecisions, lines: decisionDiff(current.activeDecisions, next.activeDecisions) },
    { label: fieldLabels.notes, lines: textDiff(current.notes, next.notes) }
  ].filter((section) => section.lines.length > 0);

  const lines = ["Текущий контекст — предлагаемые изменения", ""];
  for (const section of sections) {
    lines.push(`${section.label}:`, ...section.lines, "");
  }
  if (sections.length < Object.keys(fieldLabels).length) {
    lines.push("Остальные поля: без изменений.");
  }
  if (sections.length === 0) {
    lines.push("Безопасных изменений не определено.");
  }
  if (patch.ambiguities.length > 0) {
    lines.push("", "Не применено:", ...patch.ambiguities.map((item) => `• ${compact(item)}`));
  }
  lines.push("", "Применить изменения?");
  return lines.join("\n").slice(0, 3900);
}

export function hasLifeContextChanges(
  current: LifeContextValue,
  patch: TelegramLifeContextPatch
) {
  const next = applyLifeContextPatch(current, patch);
  return JSON.stringify({ ...current, updatedAt: null }) !== JSON.stringify({ ...next, updatedAt: null });
}

export function lifeContextModel() {
  return process.env.OPENAI_LIFE_CONTEXT_MODEL?.trim()
    || process.env.OPENAI_WORK_RECORD_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || "gpt-4o-mini";
}

function openAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return apiKey;
}

const textPatchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: lifeContextPatchOperations },
    value: { type: ["string", "null"], maxLength: 4000 },
    match: { type: ["string", "null"], maxLength: 4000 }
  },
  required: ["operation", "value", "match"]
};

const listPatchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: lifeContextPatchOperations },
    items: { type: "array", maxItems: 30, items: { type: "string", maxLength: 500 } }
  },
  required: ["operation", "items"]
};

const decisionPatchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: lifeContextPatchOperations },
    items: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", maxLength: 500 },
          validUntil: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          status: { type: "string", enum: ["ACTIVE", "COMPLETED", "CANCELED"] }
        },
        required: ["text", "validUntil", "status"]
      }
    }
  },
  required: ["operation", "items"]
};

async function extractLifeContextPatch(
  text: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  current: LifeContextValue,
  now: Date
) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: lifeContextModel(),
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "telegram_life_context_patch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              currentSituation: textPatchJsonSchema,
              priorities: listPatchJsonSchema,
              constraints: listPatchJsonSchema,
              activeProjects: listPatchJsonSchema,
              deliberatePauses: listPatchJsonSchema,
              activeDecisions: decisionPatchJsonSchema,
              notes: textPatchJsonSchema,
              ambiguities: {
                type: "array",
                maxItems: 8,
                items: { type: "string", maxLength: 500 }
              }
            },
            required: [
              "currentSituation", "priorities", "constraints", "activeProjects",
              "deliberatePauses", "activeDecisions", "notes", "ambiguities"
            ]
          }
        }
      },
      messages: [
        {
          role: "system",
          content: [
            "Подготовь безопасный PATCH текущего жизненного контекста пользователя на русском языке.",
            `Сегодня: ${todayInAmsterdam(now)}. Источник: ${source}.`,
            "LifeContext — подтвержденная рамка жизни, а не настроение или дневниковая интерпретация.",
            "Для каждого поля обязательно выбери UNCHANGED, REPLACE, APPEND или REMOVE.",
            "Отсутствие информации означает UNCHANGED. Никогда не очищай поле из-за того, что пользователь его не упомянул.",
            "REPLACE — только явная замена поля; APPEND — добавление; REMOVE — только точное явно названное удаление.",
            "Для currentSituation и notes используй value для REPLACE/APPEND и match для REMOVE.",
            "Для списков items содержат только добавляемые, заменяющие или удаляемые пункты.",
            "Для activeDecisions APPEND добавляет решение, REMOVE удаляет только решение с точно совпадающим смыслом, REPLACE допустим для явного полного заполнения.",
            "Если соответствие решения неоднозначно, оставь activeDecisions UNCHANGED и объясни это в ambiguities.",
            "Извлекай validUntil только из явно названного срока и сохраняй как YYYY-MM-DD. Не придумывай срок. Значение без срока — null.",
            "Сохраняй первое лицо, фактический смысл и характерные формулировки пользователя. Можно убрать речевой шум.",
            "Не пиши от третьего лица, не делай HR-документ, не ставь диагнозы и не превращай сомнение в решение.",
            "Если контекст пустой и пользователь явно просит заполнить его целиком, разложи сказанное по всем действительно затронутым полям.",
            "Если контекст уже есть, меняй только то, что пользователь явно попросил изменить."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Текущий контекст:",
            JSON.stringify({ ...current, updatedAt: undefined }),
            "",
            "Команда пользователя:",
            text
          ].join("\n")
        }
      ]
    }),
    cache: "no-store"
  });

  if (!response.ok) throw new Error("OpenAI LifeContext parsing failed");
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned an empty LifeContext patch");
  return normalizeTelegramLifeContextPatch(JSON.parse(content));
}

export async function parseTelegramLifeContextProposal(
  originalText: string,
  source: Extract<TelegramJournalSource, "TELEGRAM_TEXT" | "TELEGRAM_VOICE">,
  current: LifeContextValue = emptyLifeContext,
  now = new Date()
): Promise<TelegramLifeContextProposal | null> {
  const text = originalText.trim();
  if (!text) return null;
  const patch = await extractLifeContextPatch(text, source, current, now);
  return telegramLifeContextProposalSchema.parse({
    patch,
    baseUpdatedAt: current.updatedAt,
    preview: buildLifeContextPreview(current, patch)
  });
}
