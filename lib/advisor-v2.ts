import { Prisma } from "@prisma/client";

import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "@/lib/date-ranges";
import { getAdvisorSummary } from "@/lib/advisor";
import { prisma } from "@/lib/prisma";
import type {
  AdvisorReport,
  AdvisorResponse,
  AdvisorSummary,
  DailyActionType,
  WeeklyHypothesisStatus,
  WorkRecordType
} from "@/types/finance";

const reportHeadings = [
  "Картина периода",
  "Деньги и обязательства",
  "Цели: план против реальности",
  "Работа, продажи и действия",
  "Гипотезы",
  "Что ты сам фиксировал",
  "Противоречия",
  "Главный ограничитель",
  "Решения на следующие 7 дней",
  "Что сознательно не делать",
  "Что проверить в следующем разборе"
] as const;

const actionTypes: DailyActionType[] = [
  "FIRST_TOUCH",
  "FOLLOW_UP",
  "WARM_CONTACT",
  "CALL",
  "PROPOSAL",
  "PRICE_NAMED",
  "OTHER"
];

type ActionCounts = Record<DailyActionType, number>;

type AdvisorReportRow = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  content: string;
  model: string;
  source: string;
  contextSnapshot: Prisma.JsonValue | null;
  createdAt: Date;
};

type PreviousReview = {
  date: string;
  periodStart: string;
  periodEnd: string;
  mainSections: Record<string, string>;
  metrics: Prisma.JsonValue | null;
} | null;

export type AdvisorContext = {
  generatedAt: string;
  reportPeriod: {
    startDate: string;
    endDate: string;
  };
  finances: {
    ownMoney: number;
    ownAccounts: AdvisorSummary["accounts"];
    totalDebt: number;
    netPosition: number;
    creditCards: AdvisorSummary["creditCards"];
    loans: AdvisorSummary["loans"];
    mandatoryPaymentsBeforeMonthEnd: number;
    currentMonth: {
      income: number;
      expenses: number;
      cashFlow: number;
    };
    expenseTrend: AdvisorSummary["transactions"]["trend"];
    majorExpenseCategories: AdvisorSummary["transactions"]["topExpenseCategories"];
    leakage: AdvisorSummary["transactions"]["leakage"];
    cashRunway: {
      safeDailyLimit: number;
      daysLeftInMonth: number;
      daysUntilZero: number | null;
    };
    transfersLast30Days: {
      count: number;
      total: number;
      note: string;
      recent: Array<{
        date: string;
        amount: number;
        fromAccount: string;
        toAccount: string;
        description: string | null;
      }>;
    };
  };
  goals: {
    annualPlan: AdvisorSummary["annualGoals"];
    weeklyTakt: AdvisorSummary["weeklyTakt"];
    selectedScenario: string | null;
    currentMonthlyTarget: number | null;
    currentMonthlyFact: number;
    currentMonthlyGap: number | null;
    progressPercent: number | null;
  };
  actions: {
    currentWeek: AdvisorSummary["weeklyExecution"];
    recentEightWeeks: {
      total: number;
      counts: ActionCounts;
      byWeek: Array<{
        weekStartDate: string;
        total: number;
        counts: ActionCounts;
      }>;
      records: Array<{
        date: string;
        type: DailyActionType;
        target: string | null;
        value: string | null;
        nextStep: string | null;
      }>;
    };
  };
  hypotheses: Array<{
    weekStartDate: string;
    title: string;
    actionPlan: string;
    expectedResult: string | null;
    actualResult: string | null;
    conclusion: string | null;
    status: WeeklyHypothesisStatus;
  }>;
  workRecords: Array<{
    date: string;
    type: WorkRecordType;
    title: string;
    summary: string;
    insight: string | null;
    risk: string | null;
    nextStep: string | null;
  }>;
  previousReview: PreviousReview;
  dataQuality: AdvisorSummary["dataQuality"] & {
    interpretationRule: string;
  };
};

function dateOnly(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(Math.round(value || 0));
}

function emptyActionCounts(): ActionCounts {
  return Object.fromEntries(actionTypes.map((type) => [type, 0])) as ActionCounts;
}

function toAdvisorReport(row: AdvisorReportRow): AdvisorReport {
  return {
    id: row.id,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    content: row.content,
    model: row.model,
    source: row.source === "ai" ? "ai" : "rules",
    createdAt: row.createdAt.toISOString()
  };
}

function extractReportSections(content: string) {
  const sections: Record<string, string> = {};
  let currentHeading = "";

  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/)?.[1]?.trim();

    if (heading) {
      currentHeading = heading;
      continue;
    }

    if (!currentHeading || !line.trim()) {
      continue;
    }

    sections[currentHeading] = `${sections[currentHeading] ?? ""} ${line.trim()}`
      .trim()
      .slice(0, 1200);
  }

  const important = [
    "Картина периода",
    "Противоречия",
    "Главный ограничитель",
    "Решения на следующие 7 дней",
    "Что проверить в следующем разборе"
  ];

  return Object.fromEntries(
    important
      .filter((heading) => sections[heading])
      .map((heading) => [heading, sections[heading]])
  );
}

async function getLatestAdvisorReportRow(userId: string) {
  return prisma.advisorReport.findFirst({
    where: { userId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      content: true,
      model: true,
      source: true,
      contextSnapshot: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function getLatestAdvisorReport(userId: string) {
  const report = await getLatestAdvisorReportRow(userId);
  return report ? toAdvisorReport(report) : null;
}

function buildPreviousReview(report: AdvisorReportRow | null): PreviousReview {
  if (!report) {
    return null;
  }

  return {
    date: report.createdAt.toISOString(),
    periodStart: report.periodStart.toISOString(),
    periodEnd: report.periodEnd.toISOString(),
    mainSections: extractReportSections(report.content),
    metrics: report.contextSnapshot
  };
}

export async function buildAdvisorContext(
  userId: string,
  now = new Date()
): Promise<{ summary: AdvisorSummary; context: AdvisorContext }> {
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const historyStart = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() - 7 * 7
  );
  const transferStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 29
  );

  const [summary, previousReport, priorActions, recentHypotheses, workRecords, transfers] =
    await Promise.all([
      getAdvisorSummary(userId),
      getLatestAdvisorReportRow(userId),
      prisma.dailyActionLog.findMany({
        where: {
          userId,
          deletedAt: null,
          date: { gte: historyStart, lt: weekStart }
        },
        select: {
          date: true,
          weekStartDate: true,
          type: true,
          target: true,
          value: true,
          nextStep: true,
          createdAt: true
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 80
      }),
      prisma.weeklyHypothesis.findMany({
        where: {
          userId,
          weekStartDate: { gte: historyStart, lt: weekEnd }
        },
        select: {
          weekStartDate: true,
          title: true,
          actionPlan: true,
          expectedResult: true,
          actualResult: true,
          conclusion: true,
          status: true,
          createdAt: true
        },
        orderBy: [{ weekStartDate: "desc" }, { createdAt: "asc" }],
        take: 30
      }),
      prisma.workRecord.findMany({
        where: {
          userId,
          deletedAt: null,
          OR: [
            { createdAt: { gte: historyStart } },
            { relatedWeekStart: { gte: historyStart } }
          ]
        },
        select: {
          title: true,
          recordType: true,
          summary: true,
          insight: true,
          risk: true,
          nextStep: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 30
      }),
      prisma.transfer.findMany({
        where: {
          userId,
          date: { gte: startOfDay(transferStart), lt: endOfDay(now) }
        },
        select: {
          amount: true,
          date: true,
          description: true,
          fromAccount: { select: { name: true } },
          toAccount: { select: { name: true } }
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 30
      })
    ]);

  const byWeek = new Map<string, { total: number; counts: ActionCounts }>();

  for (const action of priorActions) {
    const key = dateOnly(action.weekStartDate);
    const current = byWeek.get(key) ?? { total: 0, counts: emptyActionCounts() };
    const type = action.type as DailyActionType;

    current.total += 1;
    if (actionTypes.includes(type)) {
      current.counts[type] += 1;
    }
    byWeek.set(key, current);
  }

  const currentCounts = summary.weeklyExecution.actionCounts;
  const normalizedCurrentCounts: ActionCounts = {
    FIRST_TOUCH: currentCounts.firstTouches,
    FOLLOW_UP: currentCounts.followUps,
    WARM_CONTACT: currentCounts.warmContacts,
    CALL: currentCounts.calls,
    PROPOSAL: currentCounts.proposals,
    PRICE_NAMED: currentCounts.priceNamed,
    OTHER: currentCounts.other
  };
  byWeek.set(dateOnly(weekStart), {
    total: summary.weeklyExecution.actionCount,
    counts: normalizedCurrentCounts
  });

  const recentActionCounts = emptyActionCounts();
  let recentActionTotal = 0;

  for (const item of Array.from(byWeek.values())) {
    recentActionTotal += item.total;
    for (const type of actionTypes) {
      recentActionCounts[type] += item.counts[type];
    }
  }

  const actionRecords = [
    ...summary.weeklyExecution.recentActions,
    ...priorActions.map((action) => ({
      date: action.date.toISOString(),
      type: action.type as DailyActionType,
      target: action.target,
      value: action.value,
      nextStep: action.nextStep
    }))
  ]
    .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
    .slice(0, 30);

  const currentTarget = summary.weeklyTakt?.monthlyTarget ??
    summary.annualGoals?.currentMonth.c2Plan ?? null;
  const currentFact = summary.totals.monthlyIncome;
  const currentGap = currentTarget === null ? null : Math.max(0, currentTarget - currentFact);
  const progressPercent =
    currentTarget && currentTarget > 0
      ? Math.max(0, Math.min(100, (currentFact / currentTarget) * 100))
      : null;

  return {
    summary,
    context: {
      generatedAt: now.toISOString(),
      reportPeriod: {
        startDate: dateOnly(weekStart),
        endDate: dateOnly(new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 1))
      },
      finances: {
        ownMoney: summary.totals.realMoney,
        ownAccounts: summary.accounts,
        totalDebt: summary.totals.totalDebt,
        netPosition: summary.totals.netPosition,
        creditCards: summary.creditCards,
        loans: summary.loans,
        mandatoryPaymentsBeforeMonthEnd: summary.totals.requiredPaymentsBeforeMonthEnd,
        currentMonth: {
          income: summary.totals.monthlyIncome,
          expenses: summary.totals.monthlyExpense,
          cashFlow: summary.totals.monthlyIncome - summary.totals.monthlyExpense
        },
        expenseTrend: summary.transactions.trend,
        majorExpenseCategories: summary.transactions.topExpenseCategories,
        leakage: summary.transactions.leakage,
        cashRunway: {
          safeDailyLimit: summary.totals.safeDailyLimit,
          daysLeftInMonth: summary.totals.daysLeftInMonth,
          daysUntilZero: summary.totals.daysUntilZero
        },
        transfersLast30Days: {
          count: transfers.length,
          total: transfers.reduce((sum, transfer) => sum + transfer.amount, 0),
          note: "Переводы между своими счетами не являются расходом или доходом.",
          recent: transfers.slice(0, 10).map((transfer) => ({
            date: transfer.date.toISOString(),
            amount: transfer.amount,
            fromAccount: transfer.fromAccount.name,
            toAccount: transfer.toAccount.name,
            description: transfer.description
          }))
        }
      },
      goals: {
        annualPlan: summary.annualGoals,
        weeklyTakt: summary.weeklyTakt,
        selectedScenario: summary.weeklyTakt?.selectedScenario ?? null,
        currentMonthlyTarget: currentTarget,
        currentMonthlyFact: currentFact,
        currentMonthlyGap: currentGap,
        progressPercent
      },
      actions: {
        currentWeek: summary.weeklyExecution,
        recentEightWeeks: {
          total: recentActionTotal,
          counts: recentActionCounts,
          byWeek: Array.from(byWeek.entries())
            .map(([weekStartDate, value]) => ({ weekStartDate, ...value }))
            .sort((first, second) => second.weekStartDate.localeCompare(first.weekStartDate)),
          records: actionRecords
        }
      },
      hypotheses: recentHypotheses.map((hypothesis) => ({
        weekStartDate: hypothesis.weekStartDate.toISOString(),
        title: hypothesis.title,
        actionPlan: hypothesis.actionPlan,
        expectedResult: hypothesis.expectedResult,
        actualResult: hypothesis.actualResult,
        conclusion: hypothesis.conclusion,
        status: hypothesis.status as WeeklyHypothesisStatus
      })),
      workRecords: workRecords.map((record) => ({
        date: record.createdAt.toISOString(),
        type: record.recordType as WorkRecordType,
        title: record.title,
        summary: record.summary,
        insight: record.insight,
        risk: record.risk,
        nextStep: record.nextStep
      })),
      previousReview: buildPreviousReview(previousReport),
      dataQuality: {
        ...summary.dataQuality,
        interpretationRule:
          "Отделяй факты трекера от интерпретаций и прямо называй недостающие данные."
      }
    }
  };
}

function buildContextSnapshot(context: AdvisorContext): Prisma.InputJsonObject {
  return {
    ownMoney: context.finances.ownMoney,
    totalDebt: context.finances.totalDebt,
    netPosition: context.finances.netPosition,
    monthlyIncome: context.finances.currentMonth.income,
    monthlyExpenses: context.finances.currentMonth.expenses,
    monthlyTarget: context.goals.currentMonthlyTarget,
    monthlyGap: context.goals.currentMonthlyGap,
    weeklyActions: context.actions.currentWeek.actionCount,
    firstTouches: context.actions.currentWeek.actionCounts.firstTouches,
    followUps: context.actions.currentWeek.actionCounts.followUps,
    calls: context.actions.currentWeek.actionCounts.calls,
    proposals: context.actions.currentWeek.actionCounts.proposals,
    priceNamed: context.actions.currentWeek.actionCounts.priceNamed,
    hypotheses: context.actions.currentWeek.hypothesisCount,
    workRecords: context.workRecords.length
  };
}

function buildFallbackReport(context: AdvisorContext) {
  const { finances, goals, actions, hypotheses, workRecords, previousReview } = context;
  const counts = actions.currentWeek.actionCounts;
  const overLimit = finances.creditCards.filter((card) => card.overLimit > 0);
  const activeHypotheses = hypotheses.filter((item) =>
    item.status === "ACTIVE" || item.status === "PLANNED"
  );
  const monthGap = goals.currentMonthlyGap;
  const lowActionVolume = actions.currentWeek.actionCount < 6;
  const noIncome = finances.currentMonth.income <= 0;
  const primaryConstraint = overLimit.length > 0
    ? `превышение лимита по кредитным картам на ${formatRub(overLimit.reduce((sum, card) => sum + card.overLimit, 0))}`
    : finances.ownMoney < 1000 && lowActionVolume
      ? `кассовый дефицит при ${actions.currentWeek.actionCount} действиях за неделю`
      : counts.proposals > 0 && noIncome
        ? "переход от предложений к оплате"
        : lowActionVolume
          ? "недостаточный объем проверяемых действий"
          : finances.currentMonth.cashFlow < 0
            ? "отрицательный денежный поток"
            : "отсутствие подтвержденной связи между действиями и доходом";
  const topExpense = finances.majorExpenseCategories[0];
  const firstWorkRecord = workRecords[0];
  const firstHypothesis = activeHypotheses[0];
  const previousConstraint = previousReview?.mainSections["Главный ограничитель"];

  return [
    "# Картина периода",
    `Факт: на собственных счетах ${formatRub(finances.ownMoney)}, общий долг ${formatRub(finances.totalDebt)}, чистая позиция ${formatRub(finances.netPosition)}. За текущий месяц внесено доходов ${formatRub(finances.currentMonth.income)} и расходов ${formatRub(finances.currentMonth.expenses)}.`,
    `Факт: за текущую неделю зафиксировано ${actions.currentWeek.actionCount} действий: ${counts.firstTouches} первых касаний, ${counts.followUps} follow-up, ${counts.warmContacts} теплых контактов, ${counts.calls} звонков, ${counts.proposals} предложений и ${counts.priceNamed} названных цен.`,
    `Интерпретация: сейчас главным ограничителем выглядит ${primaryConstraint}. Это вывод из зафиксированных денег и действий, а не оценка личных качеств.`,
    "Неизвестно: трекер не подтверждает причинную связь между конкретным действием и оплатой, если она не отражена в записи действия, гипотезе или рабочей записи.",
    "",
    "# Деньги и обязательства",
    `Факт: обязательные платежи до конца месяца составляют ${formatRub(finances.mandatoryPaymentsBeforeMonthEnd)}. Безопасный дневной лимит по текущему остатку — ${formatRub(Math.max(0, finances.cashRunway.safeDailyLimit))}.`,
    finances.creditCards.length
      ? `Факт: задолженность по кредитным картам — ${formatRub(finances.creditCards.reduce((sum, card) => sum + card.currentDebt, 0))}. Доступный кредит банка не включен в собственные деньги.`
      : "Факт: активные кредитные карты в данных не обнаружены.",
    overLimit.length
      ? `Факт: превышение лимита есть по ${overLimit.map((card) => `«${card.name}» — ${formatRub(card.overLimit)}`).join(", ")}. Это обязательство с немедленным приоритетом.`
      : "Факт: превышение кредитных лимитов не зафиксировано.",
    topExpense
      ? `Факт: крупнейшая категория расходов месяца — «${topExpense.name}», ${formatRub(topExpense.amount)} за ${topExpense.count} операций.`
      : "Неизвестно: значимые категории расходов за месяц отсутствуют или не заполнены.",
    `Интерпретация: денежное давление определяется разницей между собственными деньгами и обязательствами, а не доступными лимитами кредитных карт. Переводы между своими счетами (${finances.transfersLast30Days.count} за 30 дней) не включены в расходы.`,
    "",
    "# Цели: план против реальности",
    goals.currentMonthlyTarget === null
      ? "Неизвестно: активная месячная цель не определена или план еще не начался. Сравнение плана с фактом сейчас недостоверно."
      : `Факт: цель ${goals.selectedScenario ?? "C2"} на активный месяц — ${formatRub(goals.currentMonthlyTarget)}, факт дохода — ${formatRub(goals.currentMonthlyFact)}, разрыв — ${formatRub(monthGap ?? 0)}. Выполнение — ${Math.round(goals.progressPercent ?? 0)}%.`,
    goals.weeklyTakt?.status === "ACTIVE"
      ? `Факт: недельная цель ${formatRub(goals.weeklyTakt.weeklyTarget)}, недельный факт ${formatRub(goals.weeklyTakt.weeklyIncome)}, разрыв ${formatRub(goals.weeklyTakt.weeklyGap)}.`
      : "Факт: недельный такт сейчас не активен; будущая цель не сравнивается с текущим доходом.",
    `Интерпретация: ${lowActionVolume && (monthGap ?? 0) > 0 ? "при текущем объеме действий разрыв нельзя объяснять только качеством стратегии: сначала не выполнен достаточный объем проверки." : "для вывода о реалистичности плана нужно сопоставлять динамику воронки и реальные оплаты по неделям."}`,
    "",
    "# Работа, продажи и действия",
    `Факт: за восемь недель сохранено ${actions.recentEightWeeks.total} действий. За текущую неделю воронка выглядит так: ${counts.firstTouches} первых касаний → ${counts.warmContacts} теплых контактов → ${counts.calls} звонков → ${counts.proposals} КП → ${counts.priceNamed} названных цен.`,
    counts.followUps > 0 && counts.proposals === 0
      ? `Интерпретация: ${counts.followUps} follow-up не дошли до зафиксированного КП; текущий узкий участок — перевод диалога в конкретное предложение.`
      : counts.proposals > 0 && noIncome
        ? `Интерпретация: ${counts.proposals} предложений пока не дали внесенного дохода; нужно проверить сроки оплаты и следующий шаг по каждому КП.`
        : lowActionVolume
          ? `Интерпретация: ${actions.currentWeek.actionCount} действий недостаточно, чтобы уверенно оценить конверсию, оффер или цену.`
          : "Интерпретация: объем действий позволяет искать узкое место дальше по воронке, но трекер не содержит надежной атрибуции выручки к отдельным действиям.",
    actions.currentWeek.recentActions[0]
      ? `Факт: последнее действие — «${actions.currentWeek.recentActions[0].target ?? "без адресата"}»; следующий шаг: ${actions.currentWeek.recentActions[0].nextStep ?? "не указан"}.`
      : "Факт: действий за текущую неделю не зафиксировано.",
    "",
    "# Гипотезы",
    firstHypothesis
      ? `Факт: активная гипотеза «${firstHypothesis.title}»: ${firstHypothesis.actionPlan}. Ожидание: ${firstHypothesis.expectedResult ?? "не указано"}. Факт: ${firstHypothesis.actualResult ?? "не указан"}.`
      : "Факт: активных или запланированных гипотез в недавнем периоде нет.",
    firstHypothesis && lowActionVolume
      ? `Интерпретация: при ${actions.currentWeek.actionCount} действиях гипотеза еще не получила достаточной проверки. Нельзя считать ее подтвержденной или опровергнутой только по отсутствию дохода.`
      : "Неизвестно: без явного фактического результата и достаточного числа действий нельзя надежно оценить гипотезу.",
    "",
    "# Что ты сам фиксировал",
    firstWorkRecord
      ? `Факт: последняя подтвержденная запись «${firstWorkRecord.title}» содержит: ${firstWorkRecord.summary}${firstWorkRecord.nextStep ? ` Следующий шаг: ${firstWorkRecord.nextStep}.` : ""}`
      : "Неизвестно: подтвержденных WorkRecord за недавний период нет, поэтому сопоставить намерения с действиями нельзя.",
    workRecords.length > 1
      ? `Факт: за период доступно ${workRecords.length} подтвержденных рабочих записей. Повторяющиеся темы нужно проверять по их формулировкам, а не приписывать пользователю мотивы.`
      : "Интерпретация: одной записи недостаточно, чтобы говорить о повторяющемся рабочем паттерне.",
    "",
    "# Противоречия",
    firstWorkRecord && lowActionVolume
      ? `Факт: в WorkRecord «${firstWorkRecord.title}» обозначен следующий шаг «${firstWorkRecord.nextStep ?? "не указан"}», при этом за неделю сохранено ${actions.currentWeek.actionCount} действий. Интерпретация: заявленный приоритет и фактический объем исполнения могут расходиться; связь нужно подтвердить содержанием записи и действий.`
      : goals.currentMonthlyTarget !== null && (monthGap ?? 0) > 0 && lowActionVolume
        ? `Факт: разрыв к месячной цели составляет ${formatRub(monthGap ?? 0)}, а за неделю зафиксировано ${actions.currentWeek.actionCount} действий. Это несоответствие между масштабом цели и наблюдаемым объемом исполнения.`
        : "Неизвестно: данных недостаточно для доказанного противоречия между заявленными приоритетами и действиями.",
    previousConstraint
      ? `Предыдущий разбор называл ограничителем: ${previousConstraint} Текущие данные показывают, изменился ли этот показатель, но не объясняют причину изменения.`
      : "Неизвестно: предыдущего сохраненного разбора нет, поэтому повтор проблемы пока не подтвержден.",
    "",
    "# Главный ограничитель",
    `Интерпретация: ${primaryConstraint}. Этот фактор выбран первым, потому что он напрямую ограничивает либо платежеспособность, либо возможность проверить путь к доходу в ближайшие семь дней. Альтернативные объяснения нельзя ставить выше без дополнительных данных.`,
    "",
    "# Решения на следующие 7 дней",
    `1. Результат: закрыть ближайшее денежное ограничение ${overLimit.length ? `на ${formatRub(overLimit.reduce((sum, card) => sum + card.overLimit, 0))}` : `в пределах обязательных платежей ${formatRub(finances.mandatoryPaymentsBeforeMonthEnd)}`}. Индикатор: подтвержденная сумма входящих денег или платежа. Срок: до конца текущей недели. Основание: собственные деньги ${formatRub(finances.ownMoney)} при обязательствах ${formatRub(finances.totalDebt)}.`,
    `2. Результат: провести измеримую проверку воронки. Индикатор: минимум ${Math.max(6, counts.firstTouches + counts.followUps)} новых первых касаний и follow-up с указанным следующим шагом. Срок: семь дней. Основание: сейчас сохранено ${actions.currentWeek.actionCount} действий.`,
    firstHypothesis
      ? `3. Результат: завершить проверку гипотезы «${firstHypothesis.title}». Индикатор: выполнить план «${firstHypothesis.actionPlan}» и записать фактический результат. Срок: до следующего разбора. Основание: текущий результат — ${firstHypothesis.actualResult ?? "не указан"}.`
      : `3. Результат: зафиксировать одну проверяемую гипотезу получения дохода. Индикатор: конкретная аудитория, действие, объем и ожидаемый результат. Срок: в первый день периода. Основание: активной гипотезы сейчас нет.`,
    "",
    "# Что сознательно не делать",
    "- Не считать кредитный лимит или доступный кредит собственными деньгами.",
    lowActionVolume
      ? "- Не менять одновременно оффер, аудиторию, цену и канал до выполнения минимального объема одной проверки."
      : "- Не расширять список гипотез, пока по текущим не записан фактический результат.",
    topExpense
      ? `- Не делать категорию «${topExpense.name}» главным объяснением финансового разрыва без сравнения ${formatRub(topExpense.amount)} с разрывом дохода и обязательствами.`
      : "- Не делать выводы о расходных утечках без заполненных категорий.",
    "",
    "# Что проверить в следующем разборе",
    `- Изменились ли собственные деньги ${formatRub(finances.ownMoney)}, общий долг ${formatRub(finances.totalDebt)} и обязательные платежи ${formatRub(finances.mandatoryPaymentsBeforeMonthEnd)}.`,
    `- Появились ли после ${counts.firstTouches} первых касаний и ${counts.followUps} follow-up новые звонки, КП, названные цены и реальные оплаты.`,
    firstHypothesis
      ? `- Есть ли фактический результат по гипотезе «${firstHypothesis.title}», подтверждающий или опровергающий ожидание «${firstHypothesis.expectedResult ?? "не задано"}».`
      : "- Появилась ли одна гипотеза с измеримым объемом действий и фактическим результатом.",
    "- Какие рекомендации прошлого разбора выполнены, какие проигнорированы и что изменилось в числах после этого."
  ].join("\n\n");
}

export function validateAdvisorReport(content: string, context: AdvisorContext) {
  const issues: string[] = [];

  for (const heading of reportHeadings) {
    if (!new RegExp(`^#{1,3}\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "mi").test(content)) {
      issues.push(`Нет раздела «${heading}»`);
    }
  }

  const evidenceCount =
    context.actions.recentEightWeeks.total +
    context.hypotheses.length +
    context.workRecords.length +
    context.finances.majorExpenseCategories.length;
  const minimumLength = evidenceCount >= 8 ? 6000 : 2200;

  if (content.trim().length < minimumLength) {
    issues.push(`Разбор слишком короткий для объема данных: ${content.trim().length} символов`);
  }

  if (!/Факт:/i.test(content) || !/Интерпретация:/i.test(content) || !/Неизвестно:/i.test(content)) {
    issues.push("Не разделены факты, интерпретации и неизвестные данные");
  }

  const genericWithoutEvidence = content
    .split(/\n+/)
    .filter((line) => /(?:трать меньше|экономь больше|работай усерднее|увеличь доход|сократи расходы)/i.test(line))
    .filter((line) => !/[\d₽«»]/.test(line));

  if (genericWithoutEvidence.length > 0) {
    issues.push("Есть общие рекомендации без числовой или предметной опоры");
  }

  return issues;
}

function advisorModel() {
  return (
    process.env.OPENAI_ADVISOR_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function supportsReasoningEffort(model: string) {
  return /^(gpt-5|o[134])/i.test(model);
}

function advisorMessages(context: AdvisorContext, qualityFeedback: string[] = []) {
  const qualityCorrection = qualityFeedback.length
    ? [
        "Предыдущий черновик не прошел внутреннюю проверку качества:",
        ...qualityFeedback.map((issue) => `- ${issue}`),
        "Перепиши отчет целиком и исправь эти проблемы."
      ].join("\n")
    : "";

  return [
    {
      role: "system",
      content: [
        "Ты аналитический операционный партнер в персональном survival finance tracker.",
        "Подготовь серьезный еженедельный стратегический разбор на русском языке.",
        "Не мотивируй, не хвали, не морализируй и не ставь психологических диагнозов.",
        "Каждый важный вывод должен опираться на конкретные данные из контекста.",
        "Явно различай: «Факт:» — данные трекера; «Интерпретация:» — правдоподобное объяснение нескольких фактов; «Неизвестно:» — вывод, который нельзя сделать по данным.",
        "Не выдумывай доход, клиентов, обязательства, мотивы, даты, конверсии и причинные связи.",
        "Доступный кредит и кредитный лимит не являются собственными деньгами. Переводы между своими счетами и погашение тела кредита не являются расходом.",
        "Цели — план, а не фактический доход. WorkRecord — зафиксированное наблюдение пользователя, а не психологический профиль.",
        "Ищи одну главную причинную цепочку: финансовое давление → цель и разрыв → объем и качество действий → гипотезы → наблюдения WorkRecord.",
        "Определи один главный ограничитель и не более трех приоритетов на семь дней.",
        "Не используй советы вроде «трать меньше», «увеличь доход» или «работай усерднее» без суммы, факта, конкретного действия и срока.",
        "Перед ответом проведи внутреннюю проверку: для каждой рекомендации назови себе факт, который делает ее специфичной этому пользователю сейчас. Удали рекомендацию, если такого факта нет.",
        "Верни только отчет в Markdown. Не добавляй вступление вне отчета."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "Собери один связный аналитический отчет приблизительно на 1500–4000 слов, если данных достаточно. Если данных мало, пиши короче и прямо перечисли, чего не хватает.",
        "Используй строго эти заголовки и этот порядок:",
        ...reportHeadings.map((heading) => `# ${heading}`),
        "В разделе «Решения на следующие 7 дней» дай максимум три приоритета. Для каждого укажи конкретный результат, измеримый опережающий индикатор, срок и основание в данных.",
        "В разделе «Что проверить в следующем разборе» укажи наблюдения, которые подтвердят или опровергнут текущие выводы.",
        "Сопоставь предыдущий разбор с текущим периодом: что изменилось, что повторяется и какая рекомендация могла остаться невыполненной. Если предыдущего разбора нет, прямо скажи это.",
        qualityCorrection,
        "Нормализованный AdvisorContext:",
        JSON.stringify(context)
      ].filter(Boolean).join("\n\n")
    }
  ];
}

async function requestOpenAiReport(
  context: AdvisorContext,
  model: string,
  qualityFeedback: string[] = []
) {
  const reasoningModel = supportsReasoningEffort(model);
  const body = {
    model,
    messages: advisorMessages(context, qualityFeedback),
    ...(reasoningModel
      ? { reasoning_effort: "high", max_completion_tokens: 12000 }
      : { temperature: 0.1, max_tokens: 9000 })
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    console.error("Advisor OpenAI request failed", {
      status: response.status,
      model,
      body: responseBody.slice(0, 500)
    });
    throw new Error(`OpenAI API вернул статус ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI API вернул пустой стратегический разбор");
  }

  return content.trim();
}

async function generateReportContent(context: AdvisorContext, forceRuleBased = false) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || forceRuleBased) {
    return {
      content: buildFallbackReport(context),
      model: "rules-v2",
      source: "rules" as const,
      warning: apiKey
        ? undefined
        : "OPENAI_API_KEY не настроен. Сохранен расчетный стратегический разбор без AI."
    };
  }

  const model = advisorModel();

  try {
    let content = await requestOpenAiReport(context, model);
    const issues = validateAdvisorReport(content, context);

    if (issues.length > 0) {
      content = await requestOpenAiReport(context, model, issues);
      const remainingIssues = validateAdvisorReport(content, context);

      if (remainingIssues.length > 0) {
        throw new Error(`Разбор не прошел проверку качества: ${remainingIssues.join("; ")}`);
      }
    }

    return { content, model, source: "ai" as const };
  } catch (error) {
    console.error("Advisor V2 generation failed", {
      message: error instanceof Error ? error.message : "unknown",
      model
    });
    return {
      content: buildFallbackReport(context),
      model: "rules-v2",
      source: "rules" as const,
      warning: "OpenAI сейчас недоступен. Сохранен расчетный стратегический разбор без AI."
    };
  }
}

export async function getAdvisorOverview(userId: string): Promise<AdvisorResponse> {
  const [summary, report] = await Promise.all([
    getAdvisorSummary(userId),
    getLatestAdvisorReport(userId)
  ]);

  return { summary, report };
}

export async function generateAdvisorReview(
  userId: string,
  options: { forceRuleBased?: boolean } = {}
): Promise<AdvisorResponse> {
  const { summary, context } = await buildAdvisorContext(userId);
  const generated = await generateReportContent(context, options.forceRuleBased);
  const generatedAt = new Date();
  const start = startOfWeek(generatedAt);
  const periodStart = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    12
  );
  const periodEnd = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
    12
  );
  const report = await prisma.advisorReport.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      content: generated.content,
      model: generated.model,
      source: generated.source,
      contextSnapshot: buildContextSnapshot(context)
    },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      content: true,
      model: true,
      source: true,
      contextSnapshot: true,
      createdAt: true
    }
  });

  return {
    summary,
    report: toAdvisorReport(report),
    warning: generated.warning
  };
}
