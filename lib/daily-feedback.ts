import { Prisma } from "@prisma/client";

import { getAdvisorSummary } from "@/lib/advisor";
import { endOfDay, startOfDay } from "@/lib/date-ranges";
import { activeLifeDecisions, normalizeLifeContext } from "@/lib/life-context";
import { prisma } from "@/lib/prisma";
import { dateOnlyValue } from "@/lib/week";

export function dailyFeedbackModel() {
  return process.env.OPENAI_DAILY_FEEDBACK_MODEL?.trim()
    || process.env.OPENAI_WORK_RECORD_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || "gpt-4o-mini";
}

function wordLimited(text: string, maximum = 250) {
  const words = text.trim().split(/\s+/);
  return words.length <= maximum ? text.trim() : `${words.slice(0, maximum).join(" ")}…`;
}

function relevantToMoney(domains: Prisma.JsonValue, cleanedText: string) {
  const domainList = Array.isArray(domains) ? domains : [];
  return domainList.includes("MONEY") || /\b(деньг|доход|расход|долг|кредит|зарплат|плат[её]ж)/i.test(cleanedText);
}

export async function buildDailyFeedbackContext(userId: string, entryId: string) {
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, userId, deletedAt: null },
    select: {
      id: true, entryDate: true, cleanedText: true, summary: true, domains: true,
      keyEvents: true, tensions: true, decisions: true, questions: true, nextStep: true
    }
  });
  if (!entry) throw new Error("Journal entry not found for feedback");

  const sevenDaysAgo = new Date(entry.entryDate.getFullYear(), entry.entryDate.getMonth(), entry.entryDate.getDate() - 6);
  const today = dateOnlyValue(entry.entryDate);
  const [journalEntries, actions, workRecords, lifeContextRow, goalPlan] = await Promise.all([
    prisma.journalEntry.findMany({
      where: {
        userId,
        deletedAt: null,
        entryDate: { gte: startOfDay(sevenDaysAgo), lt: endOfDay(entry.entryDate) }
      },
      select: {
        id: true, entryDate: true, cleanedText: true, summary: true, domains: true,
        keyEvents: true, tensions: true, decisions: true, questions: true, nextStep: true
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 24
    }),
    prisma.dailyActionLog.findMany({
      where: { userId, deletedAt: null, date: { gte: startOfDay(sevenDaysAgo), lt: endOfDay(entry.entryDate) } },
      select: { date: true, type: true, target: true, value: true, nextStep: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 30
    }),
    prisma.workRecord.findMany({
      where: { userId, deletedAt: null, createdAt: { gte: startOfDay(sevenDaysAgo), lt: endOfDay(entry.entryDate) } },
      select: { createdAt: true, recordType: true, title: true, summary: true, nextStep: true },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.lifeContext.findUnique({ where: { userId } }),
    prisma.annualGoalPlan.findFirst({
      where: { userId },
      select: { year: true, pointA: true, c1Target: true, c2Target: true, c3Target: true, planStartDate: true },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const lifeContext = normalizeLifeContext(lifeContextRow);
  const finances = relevantToMoney(entry.domains, entry.cleanedText)
    ? await getAdvisorSummary(userId).then((summary) => ({
        ownMoney: summary.totals.realMoney,
        totalDebt: summary.totals.totalDebt,
        monthlyIncome: summary.totals.monthlyIncome,
        monthlyExpense: summary.totals.monthlyExpense
      }))
    : null;

  return {
    today,
    currentEntry: entry,
    sameDayEntries: journalEntries.filter((item) => item.id !== entry.id && dateOnlyValue(item.entryDate) === today),
    recentJournal: journalEntries.filter(
      (item) => item.id !== entry.id && dateOnlyValue(item.entryDate) !== today
    ).map((item) => ({
      ...item,
      entryDate: dateOnlyValue(item.entryDate),
      cleanedText: item.cleanedText.slice(0, 1800)
    })),
    recentActions: actions.map((item) => ({ ...item, date: dateOnlyValue(item.date) })),
    recentWorkRecords: workRecords.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    lifeContext,
    activeDecisions: activeLifeDecisions(lifeContext, today),
    goalPlan: goalPlan ? { ...goalPlan, planStartDate: dateOnlyValue(goalPlan.planStartDate) } : null,
    finances
  };
}

function fallbackFeedback(context: Awaited<ReturnType<typeof buildDailyFeedbackContext>>) {
  const previousCount = context.recentJournal.length;
  const decision = context.activeDecisions[0];
  return [
    "Что я здесь вижу",
    context.currentEntry.summary,
    "",
    "Что важно",
    previousCount > 0
      ? `За последние семь дней есть ещё ${previousCount} дневниковых записей. Текущую мысль стоит читать рядом с ними, не как отдельный окончательный вывод.`
      : "Это пока отдельное наблюдение: данных недостаточно, чтобы уверенно называть его повторяющимся паттерном.",
    decision ? `Действующее решение: «${decision.text}». Оно остаётся рамкой для выводов.` : "Действующих решений, которые меняют трактовку записи, не указано.",
    "",
    "На что обратить внимание",
    context.currentEntry.nextStep
      ? `В записи уже есть следующий шаг: ${context.currentEntry.nextStep}`
      : "Я бы пока ничего не менял. Если вернёшься к этой теме, проверь, что именно стало фактом, а что осталось предположением."
  ].join("\n");
}

async function requestFeedback(context: Awaited<ReturnType<typeof buildDailyFeedbackContext>>, model: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: [
            "Ты даёшь короткое интеллектуальное зеркало к личной дневниковой записи на русском.",
            "Это не финансовый отчёт, не пересказ, не психотерапия и не медицинская консультация.",
            "Используй только подтверждённый контекст. Не выдумывай мотивы и не называй единичное наблюдение паттерном.",
            "Учитывай действующие решения и сознательные паузы. Не рекомендуй противоречить им без новых существенных фактов.",
            "Финансы используй только если поле finances не null и они относятся к записи.",
            "Структура: «Что я здесь вижу», «Что важно», «На что обратить внимание».",
            "Последний блок содержит максимум одну рекомендацию ИЛИ один вопрос. Допустимо сказать: «Я бы пока ничего не менял».",
            "Длина 150–250 слов, если данных достаточно; иначе короче. Никакой мотивационной воды."
          ].join("\n")
        },
        { role: "user", content: JSON.stringify(context) }
      ]
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Daily feedback OpenAI failed: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Daily feedback was empty");
  return wordLimited(content);
}

export async function generateAndSaveDailyFeedback(userId: string, entryId: string) {
  const context = await buildDailyFeedbackContext(userId, entryId);
  const configuredModel = dailyFeedbackModel();
  let feedback: string;
  let usedModel = configuredModel;

  if (!process.env.OPENAI_API_KEY?.trim()) {
    feedback = fallbackFeedback(context);
    usedModel = "rules-daily-v1";
  } else {
    try {
      feedback = await requestFeedback(context, configuredModel);
    } catch (error) {
      console.error("Daily feedback generation failed", {
        message: error instanceof Error ? error.message : "unknown",
        model: configuredModel
      });
      feedback = fallbackFeedback(context);
      usedModel = "rules-daily-v1";
    }
  }

  await prisma.journalEntry.updateMany({
    where: { id: entryId, userId, deletedAt: null },
    data: { dailyFeedback: feedback, feedbackModel: usedModel }
  });
  return { feedback, model: usedModel };
}
