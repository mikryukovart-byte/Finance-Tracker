import { Prisma } from "@prisma/client";

import { buildAdvisorContext, type AdvisorContext } from "@/lib/advisor-v2";
import { endOfWeek, startOfWeek } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram-api";
import { dateOnlyValue } from "@/lib/week";
import { splitTelegramMessage } from "@/lib/weekly-delivery";

export function weeklyReportModel() {
  return process.env.OPENAI_WEEKLY_REPORT_MODEL?.trim()
    || process.env.OPENAI_ADVISOR_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || "gpt-4o-mini";
}

function wordLimited(text: string, maximum = 800) {
  const words = text.trim().split(/\s+/);
  return words.length <= maximum ? text.trim() : `${words.slice(0, maximum).join(" ")}…`;
}

function fallbackWeekly(context: AdvisorContext) {
  const counts = context.actions.currentWeek.actionCounts;
  const latestJournal = context.journal.last7Days[0];
  const activeHypothesis = context.hypotheses.find((item) => item.status === "ACTIVE" || item.status === "PLANNED");
  const activeDecisions = context.lifeContext.activeDecisions.filter((item) => item.status === "ACTIVE");
  const priorities: string[] = [];
  const overLimit = context.finances.creditCards.reduce((sum, card) => sum + card.overLimit, 0);
  if (overLimit > 0) priorities.push(`Закрыть превышение кредитного лимита: ${Math.round(overLimit).toLocaleString("ru-RU")} ₽.`);
  if (context.actions.currentWeek.actionCount === 0 && context.lifeContext.deliberatePauses.length === 0) {
    priorities.push("Проверить одну коммерческую гипотезу: 3 первых касания и 3 follow-up с конкретным следующим шагом.");
  }
  if (activeHypothesis && !activeHypothesis.actualResult) priorities.push(`Записать фактический результат гипотезы «${activeHypothesis.title}».`);

  return [
    "Коротко",
    `За неделю зафиксировано ${context.journal.totalLast7Days} дневниковых записей и ${context.actions.currentWeek.actionCount} действий. Денежный поток месяца: ${Math.round(context.finances.currentMonth.cashFlow).toLocaleString("ru-RU")} ₽; собственные деньги: ${Math.round(context.finances.ownMoney).toLocaleString("ru-RU")} ₽.`,
    latestJournal
      ? `Последняя дневниковая тема: «${latestJournal.summary}». Это факт записи, а не психологический вывод.`
      : "Дневниковых записей за неделю нет, поэтому личный контекст периода виден неполно.",
    "",
    "Что реально изменилось",
    `Действия: ${counts.firstTouches} первых касаний, ${counts.followUps} follow-up, ${counts.calls} звонков, ${counts.proposals} КП, ${counts.priceNamed} названных цен.`,
    activeHypothesis
      ? `Гипотеза «${activeHypothesis.title}»: ${activeHypothesis.actualResult ?? "фактический результат пока не записан"}.`
      : "Активной проверяемой гипотезы нет.",
    "",
    "Где слова и действия могут расходиться",
    activeDecisions.length
      ? `Действует решение «${activeDecisions[0].text}». Его нужно учитывать до изменения курса.`
      : "Действующие решения в текущем контексте не указаны; уверенный вывод о расхождении сделать нельзя.",
    "",
    "Главный вопрос следующей недели",
    latestJournal?.questions
      ? `Как изменился вопрос из последней записи: ${JSON.stringify(latestJournal.questions)}?`
      : "Какой один наблюдаемый факт в конце следующей недели подтвердит, что текущий курс работает?",
    "",
    "Приоритеты",
    ...(priorities.length ? priorities.slice(0, 3).map((item, index) => `${index + 1}. ${item}`) : ["Я бы пока ничего принципиально не менял: продолжай собирать факты по текущему курсу."])
  ].join("\n\n");
}

async function requestWeekly(context: AdvisorContext, previousWeekly: string | null, model: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 2400,
      messages: [
        {
          role: "system",
          content: [
            "Собери сжатый недельный разбор на русском как аналитический operating partner.",
            "Длина 500–800 слов максимум. Начни с «Коротко» — 2–3 абзаца с главным выводом.",
            "Дальше используй только релевантные блоки: что изменилось, где было движение, где слова и действия разошлись, важные сферы, главный вопрос, максимум три приоритета.",
            "Не создавай одинаковые пустые разделы. Не мотивируй, не ставь диагнозы и не выдумывай мотивы.",
            "Паттерн называй только при нескольких evidence points с датами. Отсутствие данных не является плохим поведением.",
            "Учитывай LifeContext, сознательные паузы и действующие решения. Не советуй против действующего решения без новых существенных фактов.",
            "Доступный кредит и лимит не являются собственными деньгами. Финансы показывай только когда они меняют решение.",
            "Отделяй факт пользователя от собственной осторожной интерпретации."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({ context, previousWeeklyReport: previousWeekly })
        }
      ]
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Weekly report OpenAI failed: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Weekly report was empty");
  return wordLimited(content);
}

function weeklySnapshot(context: AdvisorContext): Prisma.InputJsonObject {
  return {
    ownMoney: context.finances.ownMoney,
    totalDebt: context.finances.totalDebt,
    monthlyIncome: context.finances.currentMonth.income,
    monthlyExpenses: context.finances.currentMonth.expenses,
    actions: context.actions.currentWeek.actionCount,
    hypotheses: context.hypotheses.length,
    workRecords: context.workRecords.length,
    journalEntries: context.journal.totalLast7Days,
    lifeContextUpdatedAt: context.lifeContext.updatedAt
  };
}

export function weeklyReportIdempotencyKey(userId: string, referenceDate: Date) {
  return `weekly:${userId}:${dateOnlyValue(startOfWeek(referenceDate))}`;
}

export async function generateWeeklyTelegramReport(userId: string, referenceDate = new Date()) {
  const start = startOfWeek(referenceDate);
  const endExclusive = endOfWeek(referenceDate);
  const periodStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
  const periodEnd = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate() - 1, 12);
  const idempotencyKey = weeklyReportIdempotencyKey(userId, referenceDate);
  const existing = await prisma.advisorReport.findUnique({ where: { idempotencyKey } });
  if (existing) return { report: existing, created: false };

  const [{ context }, previousWeekly] = await Promise.all([
    buildAdvisorContext(userId, referenceDate),
    prisma.advisorReport.findFirst({
      where: { userId, reportKind: "WEEKLY", periodStart: { lt: periodStart } },
      select: { content: true },
      orderBy: { periodStart: "desc" }
    })
  ]);
  const configuredModel = weeklyReportModel();
  let content: string;
  let model = configuredModel;
  let source = "ai";

  if (!process.env.OPENAI_API_KEY?.trim()) {
    content = fallbackWeekly(context);
    model = "rules-weekly-v1";
    source = "rules";
  } else {
    try {
      content = await requestWeekly(context, previousWeekly?.content ?? null, configuredModel);
    } catch (error) {
      console.error("Weekly report generation failed", {
        message: error instanceof Error ? error.message : "unknown",
        model: configuredModel
      });
      content = fallbackWeekly(context);
      model = "rules-weekly-v1";
      source = "rules";
    }
  }

  try {
    const report = await prisma.advisorReport.create({
      data: {
        userId,
        periodStart,
        periodEnd,
        content,
        model,
        source,
        reportKind: "WEEKLY",
        idempotencyKey,
        contextSnapshot: weeklySnapshot(context)
      }
    });
    return { report, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const report = await prisma.advisorReport.findUnique({ where: { idempotencyKey } });
      if (report) return { report, created: false };
    }
    throw error;
  }
}

export async function deliverWeeklyTelegramReport(
  botToken: string,
  chatId: string,
  report: { id: string; content: string; deliveredAt: Date | null }
) {
  if (report.deliveredAt) return { delivered: false, parts: 0 };
  const parts = splitTelegramMessage(report.content);
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = parts.length > 1 ? `Часть ${index + 1}/${parts.length}\n\n` : "";
    await sendTelegramMessage(botToken, chatId, `${prefix}${parts[index]}`);
  }
  const deliveredAt = new Date();
  await prisma.advisorReport.updateMany({
    where: { id: report.id, deliveredAt: null },
    data: { deliveredAt }
  });
  return { delivered: true, parts: parts.length, deliveredAt };
}
