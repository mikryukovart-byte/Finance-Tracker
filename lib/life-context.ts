import { Prisma } from "@prisma/client";
import { z } from "zod";

export const activeDecisionStatuses = ["ACTIVE", "COMPLETED", "CANCELED"] as const;

export const activeDecisionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  status: z.enum(activeDecisionStatuses)
});

const textItemsSchema = z.array(z.string().trim().min(1).max(500)).max(30);

export const lifeContextInputSchema = z.object({
  currentSituation: z.string().trim().max(4000),
  priorities: textItemsSchema,
  constraints: textItemsSchema,
  activeProjects: textItemsSchema,
  deliberatePauses: textItemsSchema,
  activeDecisions: z.array(activeDecisionSchema).max(30),
  notes: z.string().trim().max(4000)
});

export type ActiveDecision = z.infer<typeof activeDecisionSchema>;
export type LifeContextValue = z.infer<typeof lifeContextInputSchema> & {
  updatedAt: string | null;
};

export const emptyLifeContext: LifeContextValue = {
  currentSituation: "",
  priorities: [],
  constraints: [],
  activeProjects: [],
  deliberatePauses: [],
  activeDecisions: [],
  notes: "",
  updatedAt: null
};

function parseJson<T>(schema: z.ZodType<T>, value: Prisma.JsonValue): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : schema.parse([]);
}

export function normalizeLifeContext(
  row: {
    currentSituation: string;
    priorities: Prisma.JsonValue;
    constraints: Prisma.JsonValue;
    activeProjects: Prisma.JsonValue;
    deliberatePauses: Prisma.JsonValue;
    activeDecisions: Prisma.JsonValue;
    notes: string;
    updatedAt: Date;
  } | null
): LifeContextValue {
  if (!row) return emptyLifeContext;

  return {
    currentSituation: row.currentSituation,
    priorities: parseJson(textItemsSchema, row.priorities),
    constraints: parseJson(textItemsSchema, row.constraints),
    activeProjects: parseJson(textItemsSchema, row.activeProjects),
    deliberatePauses: parseJson(textItemsSchema, row.deliberatePauses),
    activeDecisions: parseJson(z.array(activeDecisionSchema), row.activeDecisions),
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString()
  };
}

export function lifeContextToPrisma(value: z.infer<typeof lifeContextInputSchema>) {
  return {
    currentSituation: value.currentSituation,
    priorities: value.priorities as Prisma.InputJsonArray,
    constraints: value.constraints as Prisma.InputJsonArray,
    activeProjects: value.activeProjects as Prisma.InputJsonArray,
    deliberatePauses: value.deliberatePauses as Prisma.InputJsonArray,
    activeDecisions: value.activeDecisions as Prisma.InputJsonArray,
    notes: value.notes
  };
}

export function activeLifeDecisions(context: LifeContextValue, today: string) {
  return context.activeDecisions.filter(
    (decision) =>
      decision.status === "ACTIVE" &&
      (!decision.validUntil || decision.validUntil >= today)
  );
}
