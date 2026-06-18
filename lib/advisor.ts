import {
  endOfWeek,
  endOfMonth,
  monthLabel,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "@/lib/date-ranges";
import { getCrisisControl } from "@/lib/crisis";
import {
  buildFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";
import {
  getDebtProgress,
  getPlannedDebtPayment
} from "@/lib/debts";
import { calculateGoalRowValues, type GoalRowKey } from "@/lib/goals";
import { prisma } from "@/lib/prisma";
import type {
  AdvisorAnalysis,
  AdvisorResponse,
  AdvisorSummary,
  DailyActionType,
  WeeklyHypothesisStatus
} from "@/types/finance";

const advisorSections: Array<keyof Omit<AdvisorAnalysis, "source">> = [
  "shortConclusion",
  "mainRisk",
  "todayActions",
  "weeklyExecution",
  "dontDo",
  "debtPriority",
  "spendingLimit",
  "hardTruth"
];

const dailyActionTypes: DailyActionType[] = [
  "FIRST_TOUCH",
  "FOLLOW_UP",
  "WARM_CONTACT",
  "CALL",
  "PROPOSAL",
  "PRICE_NAMED",
  "OTHER"
];

const dailyActionLabels: Record<DailyActionType, string> = {
  FIRST_TOUCH: "первых касаний",
  FOLLOW_UP: "follow-up",
  WARM_CONTACT: "тёплых контактов",
  CALL: "созвонов",
  PROPOSAL: "КП",
  PRICE_NAMED: "названных цен",
  OTHER: "других действий"
};

function daysBefore(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

function buildTopExpenseCategories(
  transactions: Array<{
    amount: number;
    type: string;
    categoryId: string | null;
    category: { name: string } | null;
  }>,
  limit = 10
) {
  const categories = new Map<string, { name: string; amount: number; count: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE" || !transaction.categoryId || !transaction.category) {
      continue;
    }

    const current = categories.get(transaction.categoryId) ?? {
      name: transaction.category.name,
      amount: 0,
      count: 0
    };
    current.amount += transaction.amount;
    current.count += 1;
    categories.set(transaction.categoryId, current);
  }

  return Array.from(categories.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function sumAmounts(items: Array<{ amount: number }>) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function compactDescription(value: string | null, fallback = "Без описания") {
  const normalized = (value || fallback).trim().replace(/\s+/g, " ");

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}

function annualGoalCycleStep(planStartDate: Date, date: Date) {
  const startMonth = new Date(
    planStartDate.getFullYear(),
    planStartDate.getMonth(),
    1
  );
  return Math.max(
    0,
    Math.min(
      12,
      (date.getFullYear() - startMonth.getFullYear()) * 12 +
        date.getMonth() -
        startMonth.getMonth()
    )
  );
}

function annualGoalRowKeyForDate(planStartDate: Date, date: Date): GoalRowKey {
  const step = annualGoalCycleStep(planStartDate, date);
  return step === 0 ? "A" : (`B${step}` as GoalRowKey);
}

function isBeforeAnnualGoalStart(planStartDate: Date, date: Date) {
  const start = new Date(
    planStartDate.getFullYear(),
    planStartDate.getMonth(),
    planStartDate.getDate()
  );
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  return current.getTime() < start.getTime();
}

function normalizeDescription(value: string | null) {
  return compactDescription(value).toLocaleLowerCase("ru-RU");
}

function transactionSnapshot(transaction: {
  amount: number;
  type: string;
  date: Date;
  description: string | null;
  category: { name: string } | null;
  account: { name: string; type: string } | null;
}) {
  return {
    date: transaction.date.toISOString(),
    amount: transaction.amount,
    type: transaction.type,
    description: compactDescription(transaction.description),
    categoryName: transaction.category?.name ?? "Без категории",
    accountName: transaction.account?.name ?? "Без счета",
    accountType: transaction.account?.type ?? "UNKNOWN"
  };
}

function buildLargestTransactions(
  transactions: Array<{
    amount: number;
    type: string;
    date: Date;
    description: string | null;
    category: { name: string } | null;
    account: { name: string; type: string } | null;
  }>
) {
  return transactions
    .filter((transaction) => transaction.type === "EXPENSE" || transaction.type === "INCOME")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map(transactionSnapshot);
}

function buildExpensesByAccount(
  transactions: Array<{
    amount: number;
    type: string;
    accountId: string | null;
    account: { name: string; type: string } | null;
  }>
) {
  const accounts = new Map<
    string,
    { accountName: string; accountType: string; amount: number; count: number }
  >();

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") {
      continue;
    }

    const key = transaction.accountId ?? "no-account";
    const current = accounts.get(key) ?? {
      accountName: transaction.account?.name ?? "Без счета",
      accountType: transaction.account?.type ?? "UNKNOWN",
      amount: 0,
      count: 0
    };
    current.amount += transaction.amount;
    current.count += 1;
    accounts.set(key, current);
  }

  return Array.from(accounts.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
}

function buildIncomeSources(
  transactions: Array<{
    amount: number;
    type: string;
    description: string | null;
    categoryId: string | null;
    category: { name: string } | null;
  }>
) {
  const sources = new Map<string, { name: string; amount: number; count: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== "INCOME") {
      continue;
    }

    const key = transaction.categoryId
      ? `category:${transaction.categoryId}`
      : `description:${normalizeDescription(transaction.description)}`;
    const current = sources.get(key) ?? {
      name: transaction.category?.name ?? compactDescription(transaction.description, "Доход без источника"),
      amount: 0,
      count: 0
    };
    current.amount += transaction.amount;
    current.count += 1;
    sources.set(key, current);
  }

  return Array.from(sources.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
}

function buildCategoryGrowth(
  transactions: Array<{
    amount: number;
    type: string;
    date: Date;
    categoryId: string | null;
    category: { name: string } | null;
  }>,
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date
) {
  const categories = new Map<
    string,
    { categoryName: string; last7Days: number; previous7Days: number; growth: number; growthPercent: number | null }
  >();

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") {
      continue;
    }

    const key = transaction.categoryId ?? "no-category";
    const current = categories.get(key) ?? {
      categoryName: transaction.category?.name ?? "Без категории",
      last7Days: 0,
      previous7Days: 0,
      growth: 0,
      growthPercent: null
    };

    if (transaction.date >= currentStart && transaction.date < currentEnd) {
      current.last7Days += transaction.amount;
    } else if (transaction.date >= previousStart && transaction.date < currentStart) {
      current.previous7Days += transaction.amount;
    }

    categories.set(key, current);
  }

  return Array.from(categories.values())
    .map((category) => ({
      ...category,
      growth: category.last7Days - category.previous7Days,
      growthPercent:
        category.previous7Days > 0
          ? ((category.last7Days - category.previous7Days) / category.previous7Days) * 100
          : null
    }))
    .filter((category) => category.growth > 0 && category.last7Days > 0)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 10);
}

function sumExpenses(
  transactions: Array<{ amount: number; type: string; date: Date }>,
  from: Date,
  to: Date
) {
  return transactions
    .filter(
      (transaction) =>
        transaction.type === "EXPENSE" &&
        transaction.date >= from &&
        transaction.date < to
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function normalizeAnalysis(value: unknown, source: AdvisorAnalysis["source"]) {
  const sourceObject = typeof value === "object" && value !== null ? value : {};

  const result = advisorSections.reduce((acc, key) => {
    const section = (sourceObject as Record<string, unknown>)[key];

    if (Array.isArray(section)) {
      acc[key] = section
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 6);
    } else if (typeof section === "string" && section.trim()) {
      acc[key] = [section.trim()];
    } else {
      acc[key] = [];
    }

    return acc;
  }, {} as Omit<AdvisorAnalysis, "source">);

  return {
    ...result,
    source
  };
}

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(Math.round(value || 0));
}

function compactDate(value: string | null) {
  if (!value) {
    return "дата не указана";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function isLifestyleLeakCategory(name: string) {
  const normalized = name.toLocaleLowerCase("ru-RU");

  return [
    "кафе",
    "кофе",
    "алкоголь",
    "фастфуд",
    "fast food",
    "развлеч"
  ].some((marker) => normalized.includes(marker));
}

function clampItems(items: string[], limit = 4) {
  return items.filter(Boolean).slice(0, limit);
}

function emptyActionCounts() {
  return Object.fromEntries(dailyActionTypes.map((type) => [type, 0])) as Record<
    DailyActionType,
    number
  >;
}

function actionCountsText(counts: AdvisorSummary["weeklyExecution"]["actionCounts"]) {
  return [
    `${counts.firstTouches} первых касаний`,
    `${counts.followUps} follow-up`,
    `${counts.warmContacts} тёплых контактов`,
    `${counts.calls} созвонов`,
    `${counts.proposals} КП`,
    `${counts.priceNamed} цен названо`
  ].join(", ");
}

export async function getAdvisorSummary(userId: string): Promise<AdvisorSummary> {
  const now = new Date();
  const periodStart = startOfMonth(now);
  const periodEnd = endOfMonth(now);
  const todayStart = startOfDay(now);
  const last7Start = startOfDay(daysBefore(now, 6));
  const previous7Start = startOfDay(daysBefore(now, 13));
  const last30Start = startOfDay(daysBefore(now, 29));
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const tomorrowStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate() + 1
  );
  const threshold = parseLeakageThreshold(null);

  const [
    monthTransactions,
    trendTransactions,
    loans,
    accounts,
    recentTransfers,
    monthLoanPayments,
    annualGoalPlan,
    threeYearGoalScenarios,
    crisisControl,
    weeklyActions,
    weeklyHypotheses
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: periodStart,
          lt: periodEnd
        }
      },
      select: {
        id: true,
        amount: true,
        type: true,
        date: true,
        description: true,
        categoryId: true,
        createdAt: true,
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        accountId: true,
        account: {
          select: {
            name: true,
            type: true
          }
        }
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: last30Start,
          lt: tomorrowStart
        }
      },
      select: {
        amount: true,
        type: true,
        date: true,
        description: true,
        categoryId: true,
        accountId: true,
        createdAt: true,
        category: {
          select: {
            name: true
          }
        },
        account: {
          select: {
            name: true,
            type: true
          }
        }
      }
    }),
    prisma.loan.findMany({
      where: { userId, status: { not: "CLOSED" } },
      select: {
        id: true,
        debtType: true,
        title: true,
        lender: true,
        initialAmount: true,
        remainingAmount: true,
        monthlyPayment: true,
        plannedPayment: true,
        minimalPayment: true,
        paymentDate: true,
        accountId: true,
        priority: true,
        status: true,
        account: {
          select: {
            currentDebt: true,
            minimalPayment: true
          }
        },
        payments: {
          where: { userId },
          select: {
            amount: true,
            appliedAmount: true,
            date: true,
            description: true
          },
          orderBy: { date: "desc" },
          take: 5
        }
      },
      orderBy: [{ paymentDate: "asc" }, { createdAt: "desc" }]
    }),
    prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        type: true,
        balance: true,
        currency: true,
        creditLimit: true,
        currentDebt: true,
        availableCredit: true,
        minimalPayment: true,
        paymentDate: true
      },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }]
    }),
    prisma.transfer.findMany({
      where: {
        userId,
        date: {
          gte: last30Start,
          lt: tomorrowStart
        }
      },
      select: {
        amount: true,
        date: true,
        description: true,
        fromAccountId: true,
        toAccountId: true,
        fromAccount: {
          select: {
            name: true,
            type: true
          }
        },
        toAccount: {
          select: {
            name: true,
            type: true
          }
        }
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.loanPayment.findMany({
      where: {
        userId,
        date: {
          gte: periodStart,
          lt: periodEnd
        }
      },
      select: {
        loanId: true,
        amount: true,
        appliedAmount: true
      }
    }),
    prisma.annualGoalPlan.findFirst({
      where: {
        userId,
        planStartDate: {
          lte: now
        }
      },
      orderBy: { planStartDate: "desc" },
      select: {
        year: true,
        pointA: true,
        pointAMode: true,
        planStartDate: true,
        c1Target: true,
        c2Target: true,
        c3Target: true,
        growthMode: true,
        rows: {
          select: {
            rowKey: true,
            month: true,
            c1Value: true,
            c2Value: true,
            c3Value: true,
            kpiText: true,
            signatureText: true,
            isClosed: true
          }
        }
      }
    }),
    prisma.threeYearGoalScenario.findMany({
      where: {
        userId,
        year: now.getFullYear()
      },
      select: {
        speed: true,
        pointC: true,
        score: true
      },
      orderBy: { speed: "asc" }
    }),
    getCrisisControl(userId),
    prisma.dailyActionLog.findMany({
      where: {
        userId,
        weekStartDate: weekStart,
        deletedAt: null
      },
      select: {
        id: true,
        date: true,
        type: true,
        target: true,
        value: true,
        nextStep: true,
        createdAt: true
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.weeklyHypothesis.findMany({
      where: {
        userId,
        weekStartDate: weekStart
      },
      select: {
        id: true,
        userId: true,
        weekStartDate: true,
        title: true,
        actionPlan: true,
        expectedResult: true,
        actualResult: true,
        conclusion: true,
        status: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ createdAt: "asc" }]
    })
  ]);

  const control = buildFinancialControlData(
    monthTransactions,
    loans,
    threshold,
    now,
    accounts
  );
  const realAccounts = accounts.filter((account) => account.type !== "CREDIT_CARD");
  const creditCardAccounts = accounts.filter((account) => account.type === "CREDIT_CARD");
  const loanPaymentTotals = monthLoanPayments.reduce((acc, payment) => {
    const current = acc.get(payment.loanId) ?? {
      amount: 0,
      appliedAmount: 0,
      count: 0
    };
    current.amount += payment.amount;
    current.appliedAmount += payment.appliedAmount ?? payment.amount;
    current.count += 1;
    acc.set(payment.loanId, current);
    return acc;
  }, new Map<string, { amount: number; appliedAmount: number; count: number }>());
  const creditCards = creditCardAccounts.map((account) => {
    const cardMonthTransactions = monthTransactions.filter(
      (transaction) => transaction.accountId === account.id
    );
    const cardTrendTransactions = trendTransactions.filter(
      (transaction) => transaction.accountId === account.id
    );
    const incomingTransfers = recentTransfers.filter(
      (transfer) => transfer.toAccountId === account.id
    );
    const incomeRepayments = cardTrendTransactions.filter(
      (transaction) => transaction.type === "INCOME"
    );
    const recentRepayments = [
      ...incomingTransfers.map((transfer) => ({
        date: transfer.date.toISOString(),
        amount: transfer.amount,
        source: "TRANSFER",
        fromAccountName: transfer.fromAccount.name,
        description: compactDescription(transfer.description, "Погашение кредитки")
      })),
      ...incomeRepayments.map((transaction) => ({
        date: transaction.date.toISOString(),
        amount: transaction.amount,
        source: "INCOME_OR_REFUND",
        fromAccountName: transaction.category?.name ?? "Доход / возврат",
        description: compactDescription(transaction.description, "Поступление на кредитку")
      }))
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    return {
      name: account.name,
      creditLimit: account.creditLimit ?? 0,
      currentDebt: account.currentDebt,
      availableCredit: account.availableCredit,
      overLimit: Math.max(0, account.currentDebt - (account.creditLimit ?? 0)),
      minimalPayment: account.minimalPayment,
      paymentDate: account.paymentDate?.toISOString() ?? null,
      monthlySpending: sumAmounts(
        cardMonthTransactions.filter((transaction) => transaction.type === "EXPENSE")
      ),
      last30DaysSpending: sumAmounts(
        cardTrendTransactions.filter((transaction) => transaction.type === "EXPENSE")
      ),
      last30DaysRepayments:
        sumAmounts(incomingTransfers) + sumAmounts(incomeRepayments),
      recentSpending: cardTrendTransactions
        .filter((transaction) => transaction.type === "EXPENSE")
        .sort(
          (a, b) =>
            b.date.getTime() - a.date.getTime() ||
            b.createdAt.getTime() - a.createdAt.getTime()
        )
        .slice(0, 5)
        .map(transactionSnapshot),
      recentRepayments
    };
  });
  const activeLoans = loans
    .filter((loan) => loan.debtType !== "CREDIT_CARD")
    .map((loan) => ({
      title: loan.title,
      lender: loan.lender,
      debtType: loan.debtType as AdvisorSummary["loans"][number]["debtType"],
      remainingDebt: loan.remainingAmount,
      plannedPayment: getPlannedDebtPayment(loan),
      progressPercent: getDebtProgress(loan),
      paymentDate: loan.paymentDate?.toISOString() ?? null,
      priority: loan.priority as AdvisorSummary["loans"][number]["priority"],
      monthRepaymentTotal: loanPaymentTotals.get(loan.id)?.appliedAmount ?? 0,
      monthRepaymentCount: loanPaymentTotals.get(loan.id)?.count ?? 0,
      recentPayments: loan.payments.map((payment) => ({
        date: payment.date.toISOString(),
        amount: payment.amount,
        appliedAmount: payment.appliedAmount ?? payment.amount,
        description: compactDescription(payment.description, "Погашение")
      }))
    }));
  const last7DaysExpense = sumExpenses(
    trendTransactions,
    last7Start,
    tomorrowStart
  );
  const previous7DaysExpense = sumExpenses(trendTransactions, previous7Start, last7Start);
  const last30DaysExpense = sumExpenses(trendTransactions, last30Start, tomorrowStart);
  const averageDailyLast7Days = last7DaysExpense / 7;
  const averageDailyLast30Days = last30DaysExpense / 30;
  const daysUntilZero =
    averageDailyLast7Days > 0 ? control.assetBalance / averageDailyLast7Days : null;
  const isCurrentMonthPayment = (paymentDate: string | null) => {
    if (!paymentDate) {
      return false;
    }

    const date = new Date(paymentDate);
    return date >= periodStart && date < periodEnd;
  };
  const urgentOverLimitAmount = creditCards.reduce((sum, card) => sum + card.overLimit, 0);
  const requiredPaymentsBeforeMonthEnd =
    urgentOverLimitAmount +
    [...creditCards, ...activeLoans].reduce((sum, item) => {
      const payment = "plannedPayment" in item ? item.plannedPayment : item.minimalPayment ?? 0;
      return isCurrentMonthPayment(item.paymentDate) ? sum + payment : sum;
    }, 0);
  const topExpenseCategories = buildTopExpenseCategories(monthTransactions, 10);
  const incomeSources = buildIncomeSources(monthTransactions);
  const incomeTransactionCount = monthTransactions.filter(
    (transaction) => transaction.type === "INCOME"
  ).length;
  const incomeSuspiciouslyLow =
    control.monthlyIncome > 0 &&
    control.monthlyExpense > 0 &&
    control.monthlyIncome < control.monthlyExpense * 0.5;
  const incomeStatus =
    control.monthlyIncome <= 0
      ? "missing_or_zero"
      : incomeSuspiciouslyLow
        ? "suspiciously_low"
        : "present";
  const dataQualityWarnings = [
    control.monthlyIncome <= 0 ? "доход не внесен или неполный" : "",
    incomeSuspiciouslyLow
      ? "доход выглядит неполным относительно текущих расходов"
      : "",
    incomeTransactionCount === 0 ? "нет операций дохода за текущий месяц" : "",
    accounts.length === 0 ? "нет счетов" : "",
    topExpenseCategories.length === 0 && control.monthlyExpense > 0
      ? "часть расходов без категорий"
      : ""
  ].filter(Boolean);
  const isAnnualGoalNotStarted = annualGoalPlan
    ? isBeforeAnnualGoalStart(annualGoalPlan.planStartDate, now)
    : false;
  const currentGoalRowKey = annualGoalPlan && !isAnnualGoalNotStarted
    ? annualGoalRowKeyForDate(annualGoalPlan.planStartDate, now)
    : null;
  const storedCurrentGoalRow =
    annualGoalPlan && currentGoalRowKey
      ? annualGoalPlan.rows.find((row) => row.rowKey === currentGoalRowKey) ?? null
      : null;
  const currentGoalValues =
    annualGoalPlan && currentGoalRowKey
      ? calculateGoalRowValues({
          rowKey: currentGoalRowKey,
          pointA: annualGoalPlan.pointA,
          c1Target: annualGoalPlan.c1Target,
          c2Target: annualGoalPlan.c2Target,
          c3Target: annualGoalPlan.c3Target
        })
      : null;
  const annualGoals = annualGoalPlan
    ? {
        year: annualGoalPlan.year,
        pointA: annualGoalPlan.pointA,
        pointAMode: annualGoalPlan.pointAMode,
        planStartDate: annualGoalPlan.planStartDate.toISOString(),
        growthMode: annualGoalPlan.growthMode,
        finalTargets: {
          c1: annualGoalPlan.c1Target,
          c2: annualGoalPlan.c2Target,
          c3: annualGoalPlan.c3Target
        },
        currentMonth: {
          month: now.getMonth() + 1,
          rowKey: currentGoalRowKey,
          actualIncome: control.monthlyIncome,
          c1Plan: currentGoalValues?.c1Value ?? null,
          c2Plan: currentGoalValues?.c2Value ?? null,
          c3Plan: currentGoalValues?.c3Value ?? null,
          gapToC1:
            currentGoalValues?.c1Value !== undefined
              ? Math.max(0, currentGoalValues.c1Value - control.monthlyIncome)
              : null,
          gapToC2:
            currentGoalValues?.c2Value !== undefined
              ? Math.max(0, currentGoalValues.c2Value - control.monthlyIncome)
              : null,
          gapToC3:
            currentGoalValues?.c3Value !== undefined
              ? Math.max(0, currentGoalValues.c3Value - control.monthlyIncome)
              : null,
          kpiText: storedCurrentGoalRow?.kpiText ?? null,
          signatureText: storedCurrentGoalRow?.signatureText ?? null,
          isClosed: storedCurrentGoalRow?.isClosed ?? false
        },
        threeYearScenarios: threeYearGoalScenarios.map((scenario) => {
          const pointD = scenario.pointC * scenario.speed;
          return {
            speed: scenario.speed,
            pointC: scenario.pointC,
            pointD,
            pointE: pointD * scenario.speed,
            score: scenario.score
          };
        }),
        note: "Годовые цели являются планом и не считаются фактическим доходом."
      }
    : null;
  const weeklyTakt =
    annualGoalPlan && currentGoalRowKey && currentGoalValues
      ? {
          status: "ACTIVE" as const,
          selectedScenario: "C2" as const,
          rowKey: currentGoalRowKey,
          rowLabel: currentGoalRowKey,
          nextRowKey: null,
          nextRowLabel: null,
          planStartDate: annualGoalPlan.planStartDate.toISOString(),
          monthlyTarget: currentGoalValues.c2Value,
          weeklyTarget: currentGoalValues.c2Value / 4,
          dailyTarget: currentGoalValues.c2Value / 20,
          weeklyIncome: monthTransactions
            .filter(
              (transaction) =>
                transaction.type === "INCOME" &&
                transaction.date >= weekStart &&
                transaction.date < weekEnd
            )
            .reduce((sum, transaction) => sum + transaction.amount, 0),
          monthlyIncome: control.monthlyIncome,
          weeklyGap: Math.max(
            0,
            currentGoalValues.c2Value / 4 -
              monthTransactions
                .filter(
                  (transaction) =>
                    transaction.type === "INCOME" &&
                    transaction.date >= weekStart &&
                    transaction.date < weekEnd
                )
                .reduce((sum, transaction) => sum + transaction.amount, 0)
          ),
          monthlyGap: Math.max(0, currentGoalValues.c2Value - control.monthlyIncome),
          weekStartDate: weekStart.toISOString(),
          weekEndDate: new Date(weekEnd.getTime() - 1).toISOString(),
          monthStartDate: periodStart.toISOString(),
          monthEndDate: new Date(periodEnd.getTime() - 1).toISOString()
        }
      : null;
  const weeklyActionCounts = emptyActionCounts();

  for (const action of weeklyActions) {
    if (dailyActionTypes.includes(action.type as DailyActionType)) {
      weeklyActionCounts[action.type as DailyActionType] += 1;
    }
  }

  const weeklyExecution = {
    weekStartDate: weekStart.toISOString(),
    weekEndDate: new Date(weekEnd.getTime() - 1).toISOString(),
    hypothesisCount: weeklyHypotheses.length,
    actionCount: weeklyActions.length,
    actionCounts: {
      firstTouches: weeklyActionCounts.FIRST_TOUCH,
      followUps: weeklyActionCounts.FOLLOW_UP,
      warmContacts: weeklyActionCounts.WARM_CONTACT,
      calls: weeklyActionCounts.CALL,
      proposals: weeklyActionCounts.PROPOSAL,
      priceNamed: weeklyActionCounts.PRICE_NAMED,
      other: weeklyActionCounts.OTHER
    },
    recentActions: weeklyActions.slice(0, 5).map((action) => ({
      date: action.date.toISOString(),
      type: action.type as DailyActionType,
      target: compactDescription(action.target, "Без адресата"),
      value: action.value ? compactDescription(action.value) : null,
      nextStep: action.nextStep ? compactDescription(action.nextStep) : null
    })),
    hypotheses: weeklyHypotheses
      .filter((hypothesis) => hypothesis.status !== "DROP")
      .sort((first, second) => {
        const firstActive = first.status === "ACTIVE" || first.status === "PLANNED";
        const secondActive = second.status === "ACTIVE" || second.status === "PLANNED";

        if (firstActive !== secondActive) {
          return firstActive ? -1 : 1;
        }

        return first.createdAt.getTime() - second.createdAt.getTime();
      })
      .slice(0, 5)
      .map((hypothesis) => ({
        title: hypothesis.title,
        actionPlan: hypothesis.actionPlan,
        expectedResult: hypothesis.expectedResult,
        actualResult: hypothesis.actualResult,
        status: hypothesis.status as WeeklyHypothesisStatus
      }))
  };

  return {
    generatedAt: now.toISOString(),
    period: {
      label: monthLabel(now),
      startDate: periodStart.toISOString(),
      endDate: new Date(periodEnd.getTime() - 1).toISOString()
    },
    totals: {
      realMoney: control.assetBalance,
      totalDebt: control.totalDebt,
      netPosition: control.netPosition,
      monthlyIncome: control.monthlyIncome,
      monthlyExpense: control.monthlyExpense,
      safeDailyLimit: control.survival.safeDailyLimit,
      daysLeftInMonth: control.survival.daysLeftInMonth,
      daysUntilZero,
      requiredPaymentsBeforeMonthEnd
    },
    accounts: realAccounts.map((account) => ({
      name: account.name,
      type: account.type as AdvisorSummary["accounts"][number]["type"],
      balance: account.balance,
      currency: account.currency as AdvisorSummary["accounts"][number]["currency"]
    })),
    creditCards,
    loans: activeLoans,
    transactions: {
      topExpenseCategories,
      largestTransactions: buildLargestTransactions(monthTransactions),
      expensesByAccount: buildExpensesByAccount(monthTransactions),
      incomeSources,
      fastestGrowingCategories: buildCategoryGrowth(
        trendTransactions,
        last7Start,
        tomorrowStart,
        previous7Start
      ),
      trend: {
        last7DaysExpense,
        previous7DaysExpense,
        last30DaysExpense,
        averageDailyLast7Days,
        averageDailyLast30Days,
        change: last7DaysExpense - previous7DaysExpense
      },
      leakage: {
        threshold: control.leakage.threshold,
        totalSmallExpenses: control.leakage.totalSmallExpenses,
        percentOfMonthlyIncome: control.leakage.percentOfMonthlyIncome,
        topCategories: control.leakage.topCategories.map((category) => ({
          name: category.name,
          amount: category.amount,
          count: category.count
        })),
        repeatedExpenses: control.leakage.repeatedExpenses.map((item) => ({
          description: item.description,
          categoryName: item.categoryName,
          count: item.count,
          total: item.total
        }))
      }
    },
    dataQuality: {
      incomeStatus,
      incomeTransactionCount,
      warnings: dataQualityWarnings
    },
    crisis: {
      realMoney: crisisControl.realMoney,
      totalDebt: crisisControl.totalDebt,
      monthlyRequiredPayments: crisisControl.monthlyRequiredPayments,
      requiredDailyExpenses: crisisControl.requiredDailyExpenses,
      daysUntilZero: crisisControl.daysUntilZero,
      acuteReliefTarget: crisisControl.acuteReliefTarget,
      normalWorkTarget: crisisControl.normalWorkTarget,
      isCritical: crisisControl.isCritical,
      creditCardOverLimit: crisisControl.creditCardOverLimit,
      creditCardOverLimitAmount: crisisControl.creditCardOverLimitAmount,
      warnings: crisisControl.warnings
    },
    weeklyTakt,
    weeklyExecution,
    weeklyHypotheses: weeklyHypotheses.map((hypothesis) => ({
      ...hypothesis,
      status: hypothesis.status as WeeklyHypothesisStatus,
      weekStartDate: hypothesis.weekStartDate.toISOString(),
      createdAt: hypothesis.createdAt.toISOString(),
      updatedAt: hypothesis.updatedAt.toISOString()
    })),
    annualGoals
  };
}

export function buildRuleBasedAnalysis(summary: AdvisorSummary): AdvisorAnalysis {
  const overLimitCards = summary.creditCards.filter((card) => card.overLimit > 0);
  const creditCardDebt = summary.creditCards.reduce((sum, card) => sum + card.currentDebt, 0);
  const availableCredit = summary.creditCards.reduce((sum, card) => sum + card.availableCredit, 0);
  const largestDebt = [...summary.creditCards, ...summary.loans]
    .map((item) => ({
      name: "title" in item ? item.title : item.name,
      debt: "remainingDebt" in item ? item.remainingDebt : item.currentDebt,
      payment: "plannedPayment" in item ? item.plannedPayment : item.minimalPayment ?? 0,
      paymentDate: item.paymentDate
    }))
    .sort((a, b) => b.debt - a.debt)[0];
  const biggestExpense = summary.transactions.topExpenseCategories[0];
  const leakCategory = summary.transactions.leakage.topCategories[0];
  const repeatedLeak = summary.transactions.leakage.repeatedExpenses[0];
  const fastestGrowingCategory = summary.transactions.fastestGrowingCategories[0];
  const largestExpenseTransaction = summary.transactions.largestTransactions.find(
    (transaction) => transaction.type === "EXPENSE"
  );
  const biggestExpenseAccount = summary.transactions.expensesByAccount[0];
  const topIncomeSource = summary.transactions.incomeSources[0];
  const currentAnnualGoal = summary.annualGoals?.currentMonth ?? null;
  const weeklyTakt = summary.weeklyTakt;
  const weeklyExecution = summary.weeklyExecution;
  const weeklyActionCounts = weeklyExecution.actionCounts;
  const currentHypothesis = summary.weeklyHypotheses.find((hypothesis) =>
    hypothesis.status === "ACTIVE" || hypothesis.status === "PLANNED"
  );
  const failedHypotheses = summary.weeklyHypotheses.filter(
    (hypothesis) => hypothesis.status === "FAILED" || hypothesis.status === "DROP"
  );
  const crisisWarnings = summary.crisis?.warnings ?? [];
  const riskyTopCategory =
    biggestExpense && isLifestyleLeakCategory(biggestExpense.name) ? biggestExpense : null;
  const cashflowNegative = summary.totals.monthlyExpense > summary.totals.monthlyIncome;
  const incomeDataIncomplete = summary.dataQuality.incomeStatus !== "present";
  const noIncomeWithExpenses =
    summary.totals.monthlyIncome <= 0 && summary.totals.monthlyExpense > 0;
  const noWeeklyActions = weeklyExecution.actionCount === 0;
  const lowWeeklyActions = weeklyExecution.actionCount > 0 && weeklyExecution.actionCount < 6;
  const hasHypothesesWithoutActions =
    weeklyExecution.hypothesisCount > 0 && weeklyExecution.actionCount < 3;
  const hasActionsButNoIncome =
    weeklyExecution.actionCount >= 10 && summary.totals.monthlyIncome <= 0;
  const hasFollowUpsWithoutProposals =
    weeklyActionCounts.followUps > 0 && weeklyActionCounts.proposals === 0;
  const hasProposalsWithoutIncome =
    weeklyActionCounts.proposals > 0 && summary.totals.monthlyIncome <= 0;
  const lowRealMoney = summary.totals.realMoney < 1000;
  const debtAboveMoney = summary.totals.totalDebt > summary.totals.realMoney;
  const strictSpendingStop = summary.totals.safeDailyLimit < 100;
  const upcomingPayments = [...summary.creditCards, ...summary.loans]
    .map((item) => ({
      name: "title" in item ? item.title : item.name,
      payment: "plannedPayment" in item ? item.plannedPayment : item.minimalPayment ?? 0,
      paymentDate: item.paymentDate,
      debt: "remainingDebt" in item ? item.remainingDebt : item.currentDebt,
      overLimit: "overLimit" in item ? item.overLimit : 0
    }))
    .filter((item) => item.payment > 0 || item.overLimit > 0)
    .sort((a, b) => {
      if (a.overLimit !== b.overLimit) {
        return b.overLimit - a.overLimit;
      }

      if (a.paymentDate && b.paymentDate) {
        return new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime();
      }

      if (a.paymentDate) {
        return -1;
      }

      if (b.paymentDate) {
        return 1;
      }

      return b.debt - a.debt;
    })
    .slice(0, 3);
  const nextPaymentText = upcomingPayments
    .map((payment) => {
      if (payment.overLimit > 0) {
        return `${payment.name}: превышение ${formatRub(payment.overLimit)}`;
      }

      return `${payment.name}: ${formatRub(payment.payment)}, ${compactDate(payment.paymentDate)}`;
    })
    .join("; ");

  return {
    source: "rules",
    shortConclusion: clampItems([
      `Реальные деньги: ${formatRub(summary.totals.realMoney)}. Доступный лимит кредиток сюда не входит.`,
      summary.totals.netPosition < 0
        ? `Чистая позиция: ${formatRub(summary.totals.netPosition)}. Долги больше собственных денег.`
        : `Чистая позиция: ${formatRub(summary.totals.netPosition)}.`,
      incomeDataIncomplete
        ? `Доход не внесен или неполный. В системе доход: ${formatRub(summary.totals.monthlyIncome)}, расходы: ${formatRub(summary.totals.monthlyExpense)}.`
        : cashflowNegative
          ? `Расходы за месяц выше доходов на ${formatRub(summary.totals.monthlyExpense - summary.totals.monthlyIncome)}.`
          : `Доходы за месяц: ${formatRub(summary.totals.monthlyIncome)}, расходы: ${formatRub(summary.totals.monthlyExpense)}.`,
      creditCardDebt > 0
        ? `Долг по кредиткам: ${formatRub(creditCardDebt)}. Доступно по кредиткам: ${formatRub(availableCredit)}, это не ваши деньги.`
        : "",
      currentAnnualGoal?.c2Plan
        ? `Годовая цель C2 на текущий месяц: ${formatRub(currentAnnualGoal.c2Plan)}. Факт: ${formatRub(currentAnnualGoal.actualIncome)}.`
        : "",
      `Действия недели: ${actionCountsText(weeklyActionCounts)}. Гипотезы: ${weeklyExecution.hypothesisCount}.`,
      weeklyTakt
        ? `Недельный такт C2: цель ${formatRub(weeklyTakt.weeklyTarget)}, факт ${formatRub(weeklyTakt.weeklyIncome)}, разрыв ${formatRub(weeklyTakt.weeklyGap)}.`
        : ""
    ]),
    mainRisk: clampItems([
      summary.crisis?.isCritical
        ? `Кризисный режим: реальные деньги ${formatRub(summary.crisis.realMoney)}, расчетных дней до нуля ${summary.crisis.daysUntilZero === null ? "нет данных" : Math.floor(summary.crisis.daysUntilZero)}.`
        : "",
      lowRealMoney
        ? `На счетах меньше ${formatRub(1000)}. Это риск кассового разрыва, даже без новых покупок.`
        : "",
      overLimitCards[0]
        ? `Карта «${overLimitCards[0].name}» выше лимита на ${formatRub(overLimitCards[0].overLimit)}. Это первый платеж.`
        : "",
      debtAboveMoney
        ? `Общий долг ${formatRub(summary.totals.totalDebt)} больше реальных денег ${formatRub(summary.totals.realMoney)}.`
        : "",
      noIncomeWithExpenses
        ? "Данных о доходе нет, а расходы есть. Нельзя считать коэффициенты к доходу; сначала нужен подтвержденный денежный вход."
        : "",
      lowRealMoney && weeklyExecution.actionCount < 6
        ? "Главная проблема сейчас не в стратегии, а в недостатке действий для нового денежного входа."
        : "",
      hasHypothesesWithoutActions
        ? `Гипотезы недели есть (${weeklyExecution.hypothesisCount}), но действий всего ${weeklyExecution.actionCount}. Гипотеза не проверена объемом.`
        : "",
      summary.totals.requiredPaymentsBeforeMonthEnd > summary.totals.realMoney
        ? `Платежи до конца месяца ${formatRub(summary.totals.requiredPaymentsBeforeMonthEnd)} выше реальных денег ${formatRub(summary.totals.realMoney)}.`
        : "",
      fastestGrowingCategory
        ? `Быстро растет категория «${fastestGrowingCategory.categoryName}»: +${formatRub(fastestGrowingCategory.growth)} за последние 7 дней.`
        : "",
      currentAnnualGoal?.gapToC2
        ? `До плана C2 по доходу не хватает ${formatRub(currentAnnualGoal.gapToC2)}. Это цель, не текущие деньги.`
        : "",
      weeklyTakt?.weeklyGap
        ? `По недельному такту не хватает ${formatRub(weeklyTakt.weeklyGap)}. Без денежного входа месяц не догоняется сам.`
        : "",
      strictSpendingStop
        ? `Дневной лимит ниже ${formatRub(100)}. Все необязательные расходы нужно остановить.`
        : ""
    ]),
    todayActions: clampItems([
      noWeeklyActions
        ? "Сегодня минимум: 3 первых касания + 3 follow-up."
        : "",
      noIncomeWithExpenses
        ? "Зафиксировать ближайший реальный источник денег: оплата, аванс, возврат долга, продажа лишнего или подработка."
        : "",
      overLimitCards[0]
        ? `Внести платеж по «${overLimitCards[0].name}» минимум на ${formatRub(overLimitCards[0].overLimit)} или зафиксировать дату платежа.`
        : "Проверить все расходы за сегодня и внести пропущенные операции.",
      nextPaymentText ? `Проверить ближайшие платежи: ${nextPaymentText}.` : "",
      currentAnnualGoal?.kpiText
        ? `Отработать КП месяца: «${currentAnnualGoal.kpiText}».`
        : "",
      currentHypothesis
        ? `Сделать действие по гипотезе недели: «${currentHypothesis.actionPlan}». Ожидаемый результат: ${currentHypothesis.expectedResult || "зафиксировать вручную"}.`
        : "",
      biggestExpense
        ? `Поставить лимит на «${biggestExpense.name}» до конца дня: не выше ${formatRub(Math.max(0, summary.totals.safeDailyLimit))}.`
        : "",
      largestDebt
        ? `Следующий свободный платеж направить в «${largestDebt.name}», долг ${formatRub(largestDebt.debt)}.`
        : "Не добавлять новые долги.",
      strictSpendingStop
        ? "Сегодня не покупать ничего необязательного."
        : `Держать траты сегодня в пределах ${formatRub(Math.max(0, summary.totals.safeDailyLimit))}.`
    ]),
    weeklyExecution: clampItems([
      `На этой неделе: ${actionCountsText(weeklyActionCounts)}. Всего действий: ${weeklyExecution.actionCount}.`,
      noWeeklyActions
        ? "Действий нет. Сегодня минимум: 3 первых касания + 3 follow-up."
        : "",
      hasHypothesesWithoutActions
        ? `Гипотезы пока не проверены: ${weeklyExecution.hypothesisCount} гипотез, но ${weeklyExecution.actionCount} действий.`
        : "",
      hasActionsButNoIncome
        ? "Объем действий есть, а дохода нет: менять оффер, аудиторию, текст или цену."
        : "",
      hasFollowUpsWithoutProposals
        ? "Есть follow-up, но нет КП. Дожимай разговоры до предложения и цены."
        : "",
      hasProposalsWithoutIncome
        ? "КП есть, денег нет: фокус на follow-up, сроках оплаты и конкретном следующем шаге."
        : "",
      lowWeeklyActions
        ? `Объем низкий: ${weeklyExecution.actionCount} действий за неделю. Этого мало, чтобы проверить гипотезу.`
        : "",
      weeklyExecution.recentActions[0]
        ? `Последнее действие: ${compactDate(weeklyExecution.recentActions[0].date)} · ${dailyActionLabels[weeklyExecution.recentActions[0].type]} · ${weeklyExecution.recentActions[0].target ?? "без адресата"}.`
        : ""
    ], 4),
    dontDo: clampItems([
      "Не считать доступный лимит кредитки своими деньгами.",
      noIncomeWithExpenses
        ? "Не делать мелкую оптимизацию главной стратегией. При нулевом доходе главный рычаг — новый денежный вход."
        : cashflowNegative
          ? "Не увеличивать регулярные расходы, пока месячные расходы выше доходов."
          : "Не брать новые обязательства без отдельного источника погашения.",
      riskyTopCategory
        ? `Не продолжать траты в категории «${riskyTopCategory.name}» как будто это мелочь: уже ${formatRub(riskyTopCategory.amount)}.`
        : "",
      largestExpenseTransaction
        ? `Не повторять крупную трату «${largestExpenseTransaction.description}» на ${formatRub(largestExpenseTransaction.amount)} без отдельного дохода.`
        : "",
      strictSpendingStop
        ? "Не использовать кредитку для бытовых покупок: это увеличит долг, а не деньги."
        : "",
      failedHypotheses[0]
        ? `Не повторять без изменений гипотезу «${failedHypotheses[0].title}»: она уже помечена как нерабочая.`
        : "",
      "Не корректировать баланс счета без операции или сверки с банком."
    ]),
    debtPriority: clampItems([
      overLimitCards.length
        ? `Сначала закрыть превышение лимита: ${overLimitCards
            .map((card) => `${card.name} ${formatRub(card.overLimit)}`)
            .join(", ")}.`
        : largestDebt
          ? `Первый приоритет: «${largestDebt.name}», долг ${formatRub(largestDebt.debt)}.`
          : "Активных долгов нет.",
      nextPaymentText ? `Ближайшие обязательные платежи: ${nextPaymentText}.` : "",
      "Минимальные платежи закрывать до любых дополнительных покупок.",
      summary.totals.requiredPaymentsBeforeMonthEnd > 0
        ? `До конца месяца нужно закрыть платежей минимум на ${formatRub(summary.totals.requiredPaymentsBeforeMonthEnd)}.`
        : "",
      largestDebt?.payment > 0
        ? `По «${largestDebt.name}» плановый платеж: ${formatRub(largestDebt.payment)}.`
        : ""
    ]),
    spendingLimit: clampItems([
      `Безопасный дневной лимит до конца месяца: ${formatRub(Math.max(0, summary.totals.safeDailyLimit))}.`,
      strictSpendingStop
        ? "Лимит ниже 100 ₽: еда дома, транспорт по необходимости, остальные траты — стоп."
        : "",
      biggestExpense
        ? `Самая большая категория расходов: «${biggestExpense.name}» — ${formatRub(biggestExpense.amount)}.`
        : "Расходов по категориям за месяц пока нет.",
      biggestExpenseAccount
        ? `Больше всего расходов идет со счета «${biggestExpenseAccount.accountName}»: ${formatRub(biggestExpenseAccount.amount)}.`
        : "",
      riskyTopCategory
        ? `Категория «${riskyTopCategory.name}» бьет по бюджету напрямую. Закрыть ее до конца месяца.`
        : "",
      leakCategory
        ? `Мелкие утечки: «${leakCategory.name}» — ${formatRub(leakCategory.amount)} за ${leakCategory.count} операций.`
        : "",
      repeatedLeak
        ? `Повторяется: «${repeatedLeak.description}», ${repeatedLeak.count} раз, всего ${formatRub(repeatedLeak.total)}.`
        : "",
      summary.crisis?.requiredDailyExpenses
        ? `Обязательные расходы в день: ${formatRub(summary.crisis.requiredDailyExpenses)}. Это нижняя граница, не комфортный лимит.`
        : ""
    ], 6),
    hardTruth: clampItems([
      crisisWarnings[0] ?? "",
      summary.totals.totalDebt > 0
        ? "Пока долг не снижается, доступный лимит кредитки не улучшает финансовую позицию."
        : "Без долгов главная задача — не потерять контроль над регулярными расходами.",
      incomeDataIncomplete
        ? topIncomeSource
          ? `Доход выглядит неполным. Основной источник «${topIncomeSource.name}» внесен на ${formatRub(topIncomeSource.amount)}.`
          : "Доход не внесен или неполный. Без подтвержденного дохода расходы просто уменьшают остаток и двигают к новому долгу."
        : "",
      lowRealMoney
        ? "При остатке ниже 1000 ₽ вопрос не в комфорте, а в ближайших обязательных платежах."
        : "",
      summary.totals.daysUntilZero !== null
        ? `При текущем темпе трат деньги закончатся примерно через ${Math.floor(summary.totals.daysUntilZero)} дн.`
        : "",
      debtAboveMoney
        ? `Чтобы выйти в ноль, не хватает ${formatRub(Math.abs(Math.min(0, summary.totals.netPosition)))}.`
        : "",
      creditCardDebt > 0
        ? "Кредитка — инструмент долга. Ее доступный остаток нельзя прибавлять к деньгам на счетах."
        : "",
      weeklyTakt?.monthlyGap
        ? `До месячного такта C2 не хватает ${formatRub(weeklyTakt.monthlyGap)}. Это не закроется экономией на мелочах, если доход не внесен или неполный.`
        : ""
    ])
  };
}

function buildOpenAiAdvisorContext(summary: AdvisorSummary) {
  const totalCreditLimit = summary.creditCards.reduce(
    (sum, card) => sum + card.creditLimit,
    0
  );
  const creditCardCurrentDebt = summary.creditCards.reduce(
    (sum, card) => sum + card.currentDebt,
    0
  );
  const availableCreditNotOwnMoney = summary.creditCards.reduce(
    (sum, card) => sum + card.availableCredit,
    0
  );
  const totalLoanDebt = summary.loans.reduce((sum, loan) => sum + loan.remainingDebt, 0);
  const minimumPayments = [
    ...summary.creditCards.map((card) => ({
      name: card.name,
      kind: "credit_card",
      amount: card.minimalPayment ?? 0,
      dueDate: card.paymentDate,
      currentDebt: card.currentDebt,
      overLimit: card.overLimit
    })),
    ...summary.loans.map((loan) => ({
      name: loan.title,
      kind: loan.debtType,
      amount: loan.plannedPayment,
      dueDate: loan.paymentDate,
      currentDebt: loan.remainingDebt,
      overLimit: 0
    }))
  ]
    .filter((payment) => payment.amount > 0 || payment.overLimit > 0 || payment.dueDate)
    .sort((a, b) => {
      if (a.overLimit !== b.overLimit) {
        return b.overLimit - a.overLimit;
      }

      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }

      if (a.dueDate) {
        return -1;
      }

      if (b.dueDate) {
        return 1;
      }

      return b.currentDebt - a.currentDebt;
    });
  const totalMinimumPayments = minimumPayments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );
  const incomeDataIncomplete = summary.dataQuality.incomeStatus !== "present";
  const cashFlowGap = summary.totals.monthlyIncome - summary.totals.monthlyExpense;
  const trendChange = summary.transactions.trend.change;
  const trendDirection =
    trendChange > 0
      ? "spending_accelerated"
      : trendChange < 0
        ? "spending_slowed"
        : "spending_flat";
  const accountsByType = [
    ...summary.accounts.map((account) => ({
      type: account.type,
      balance: account.balance,
      count: 1
    })),
    ...summary.creditCards.map(() => ({
      type: "CREDIT_CARD",
      balance: 0,
      count: 1
    }))
  ].reduce(
    (acc, item) => {
      const current = acc.get(item.type) ?? {
        type: item.type,
        balance: 0,
        count: 0
      };
      current.balance += item.balance;
      current.count += item.count;
      acc.set(item.type, current);
      return acc;
    },
    new Map<string, { type: string; balance: number; count: number }>()
  );

  return {
    contextType: "personal_survival_finance_tracker",
    period: summary.period,
    rulesForAdvisor: [
      "availableCredit is bank credit, not user-owned money",
      "creditLimit is never income and never cash",
      "debt reduction has priority over comfort spending",
      "cash flow matters more than account count or nominal limits",
      "if incomeDataStatus is missing_or_zero or suspiciously_low, say: доход не внесен или неполный",
      "do not calculate debt/income ratios when income data is incomplete",
      "balance adjustments are not income or expense",
      "annual income goals are targets only, not real income",
      "weekly takt and weekly hypotheses are operating targets only, not real income",
      "weeklyExecution shows actual client/project seeking actions and should influence recommendations",
      "if weekly actions are low and cash is low, prioritize action volume over abstract strategy",
      "if hypotheses exist but actions are low, say hypotheses are not tested",
      "crisis warnings should outrank cosmetic optimization",
      "must use actual categories, accounts and transactions listed in this context",
      "recommend concrete actions with numbers, categories and deadlines"
    ],
    accounts: {
      realMoneyOnAccounts: summary.totals.realMoney,
      byType: Array.from(accountsByType.values()),
      cashDebitAccounts: summary.accounts,
      creditCardAccountsAreSeparatedBelow: true
    },
    financialPosition: {
      realMoney: summary.totals.realMoney,
      totalDebt: summary.totals.totalDebt,
      netPosition: summary.totals.netPosition,
      totalLoanDebt,
      creditCardCurrentDebt,
      safeDailySpendingLimit: Math.max(0, summary.totals.safeDailyLimit),
      daysLeftInMonth: summary.totals.daysLeftInMonth,
      daysUntilZeroAtCurrent7DaySpendingRate: summary.totals.daysUntilZero,
      requiredPaymentsBeforeMonthEnd: summary.totals.requiredPaymentsBeforeMonthEnd
    },
    creditCards: {
      warning: "availableCredit below is NOT OWN MONEY and must not be added to cash balance",
      totalCreditLimit,
      totalCurrentDebt: creditCardCurrentDebt,
      totalAvailableCreditNotOwnMoney: availableCreditNotOwnMoney,
      cards: summary.creditCards.map((card) => ({
        name: card.name,
        creditLimit: card.creditLimit,
        currentDebt: card.currentDebt,
        availableCreditNotOwnMoney: card.availableCredit,
        overLimit: card.overLimit,
        minimumPayment: card.minimalPayment,
        paymentDeadline: card.paymentDate,
        monthlySpendingFromCard: card.monthlySpending,
        last30DaysSpendingFromCard: card.last30DaysSpending,
        last30DaysRepaymentsToCard: card.last30DaysRepayments,
        recentSpendingFromCard: card.recentSpending,
        recentRepaymentsToCard: card.recentRepayments
      }))
    },
    loans: summary.loans.map((loan) => ({
      title: loan.title,
      lender: loan.lender,
      debtType: loan.debtType,
      remainingDebt: loan.remainingDebt,
      plannedOrMinimumPayment: loan.plannedPayment,
      priority: loan.priority,
      progressPercent: loan.progressPercent,
      paymentDeadline: loan.paymentDate,
      monthRepaymentTotal: loan.monthRepaymentTotal,
      monthRepaymentCount: loan.monthRepaymentCount,
      recentRepaymentHistory: loan.recentPayments
    })),
    cashFlow: {
      monthlyIncome: summary.totals.monthlyIncome,
      incomeDataStatus: summary.dataQuality.incomeStatus,
      monthlyExpenses: summary.totals.monthlyExpense,
      cashFlowGap,
      debtToIncomeRatioAllowed: !incomeDataIncomplete,
      incomeSources: summary.transactions.incomeSources,
      note:
        "When incomeDataStatus is not present, say доход не внесен или неполный and do not write ratios like debt exceeds income N times."
    },
    spending: {
      expensesByCategoryTop10: summary.transactions.topExpenseCategories,
      top10LargestTransactions: summary.transactions.largestTransactions,
      expensesByAccount: summary.transactions.expensesByAccount,
      categoriesWithFastestGrowth: summary.transactions.fastestGrowingCategories,
      biggestLeaks: {
        threshold: summary.transactions.leakage.threshold,
        totalSmallExpenses: summary.transactions.leakage.totalSmallExpenses,
        percentOfMonthlyIncome: incomeDataIncomplete
          ? null
          : summary.transactions.leakage.percentOfMonthlyIncome,
        topCategories: summary.transactions.leakage.topCategories,
        repeatedExpenses: summary.transactions.leakage.repeatedExpenses
      },
      trend: {
        last7DaysExpense: summary.transactions.trend.last7DaysExpense,
        previous7DaysExpense: summary.transactions.trend.previous7DaysExpense,
        last30DaysExpense: summary.transactions.trend.last30DaysExpense,
        averageDailyLast7Days: summary.transactions.trend.averageDailyLast7Days,
        averageDailyLast30Days: summary.transactions.trend.averageDailyLast30Days,
        changeVsPrevious7Days: trendChange,
        direction: trendDirection
      }
    },
    obligations: {
      totalMinimumPayments,
      requiredPaymentsBeforeMonthEnd: summary.totals.requiredPaymentsBeforeMonthEnd,
      paymentItems: minimumPayments,
      upcomingDeadlines: minimumPayments.filter((payment) => payment.dueDate).slice(0, 6)
    },
    dataQuality: {
      ...summary.dataQuality,
      missingDataMustBeCalledOut: summary.dataQuality.warnings
    },
    crisisControl: summary.crisis
      ? {
          ...summary.crisis,
          note: "Crisis control describes survival cash flow. It is not a separate balance."
        }
      : null,
    annualIncomeGoals: summary.annualGoals
      ? {
          ...summary.annualGoals,
          warning: "Goals are targets only. They are not real income and must not improve cash flow calculations."
        }
      : null,
    weeklyTakt: summary.weeklyTakt
      ? {
          ...summary.weeklyTakt,
          warning: "Weekly takt is an operating target only, not real income."
        }
      : null,
    weeklyExecution: {
      ...summary.weeklyExecution,
      note:
        "Daily actions are real execution signals for finding clients, customers and projects. They are not income, but they explain whether income hypotheses are being tested."
    },
    weeklyHypotheses: summary.weeklyHypotheses.map((hypothesis) => ({
      title: hypothesis.title,
      actionPlan: hypothesis.actionPlan,
      expectedResult: hypothesis.expectedResult,
      actualResult: hypothesis.actualResult,
      conclusion: hypothesis.conclusion,
      status: hypothesis.status,
      weekStartDate: hypothesis.weekStartDate
    })),
    spendingLimit: {
      safeDailySpendingLimit: Math.max(0, summary.totals.safeDailyLimit),
      daysLeftInMonth: summary.totals.daysLeftInMonth,
      formula: "realMoneyOnAccounts / daysLeftInMonth"
    }
  };
}

async function callOpenAi(summary: AdvisorSummary): Promise<AdvisorAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return buildRuleBasedAnalysis(summary);
  }

  const advisorContext = buildOpenAiAdvisorContext(summary);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Ты строгий персональный финансовый оператор внутри survival finance tracker.",
            "Твоя задача — не поддержать морально, а трезво оценить риск, денежный поток и долги.",
            "Говори на русском. Тон прямой, стратегический, без мотивационной воды и без общих советов.",
            "Кредитный лимит, availableCredit и доступный остаток кредитки — НЕ деньги пользователя.",
            "Долги и кассовый разрыв важнее красивого баланса.",
            "Каждый совет должен быть конкретным: сумма, категория, срок или действие.",
            "Каждая рекомендация должна опираться на реальные категории, счета, долги или операции из переданного контекста.",
            "Если наличных/дебетовых денег критически мало, приоритет — деньги на входе и обязательные платежи, а не косметическая оптимизация.",
            "Если crisisControl сообщает критический режим, начни с выживания денежного потока.",
            "Запрещены общие фразы без чисел: «save more», «spend less», «track expenses», «экономьте больше», «тратьте меньше», «ведите учет».",
            "Если доход за месяц 0, отсутствует или помечен как suspiciously_low, напиши точно: «доход не внесен или неполный». Не дели долг на такой доход и не пиши абсурдные коэффициенты.",
            "Не считай корректировки баланса доходом или расходом.",
            "Годовые цели дохода — это план, а не факт. Не улучшай cash flow и баланс на основе целей.",
            "Недельный такт и гипотезы недели — это операционный план, не фактический доход.",
            "Действия недели — это сигнал исполнения. Анализируй объем действий, follow-up, КП, названные цены и связь с гипотезами.",
            "Верни только валидный JSON без markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Проанализируй структурированный финансовый контекст ниже как строгий финансовый оператор.",
            "Верни JSON строго в таком формате:",
            "{",
            '"shortConclusion": string[],',
            '"mainRisk": string[],',
            '"todayActions": string[],',
            '"weeklyExecution": string[],',
            '"dontDo": string[],',
            '"debtPriority": string[],',
            '"spendingLimit": string[],',
            '"hardTruth": string[]',
            "}.",
            "Смысл секций:",
            "- shortConclusion = текущая ситуация: короткий реалистичный диагноз.",
            "- mainRisk = главная опасность, которая может ударить сейчас.",
            "- todayActions = ровно 3 конкретных действия на сегодня.",
            "- weeklyExecution = короткий вывод по действиям недели: объем, гипотезы, где застрял процесс.",
            "- dontDo = конкретные запреты: что не делать.",
            "- debtPriority = стратегия долга: какой долг атаковать первым и почему.",
            "- spendingLimit = безопасный дневной лимит и как его соблюдать.",
            "- hardTruth = жесткая правда без мотивации.",
            "Ограничения:",
            "- В каждом массиве 1-4 пункта, кроме todayActions: ровно 3 пункта.",
            "- Используй рубли и числа из контекста.",
            "- Используй actual user categories, accounts, largest transactions, leaks, payments and deadlines from context.",
            "- Не называй availableCredit деньгами, остатком пользователя или резервом.",
            "- Если есть превышение лимита кредитки, это главный приоритет долга.",
            "- Если incomeDataStatus не present, скажи «доход не внесен или неполный» и не рассчитывай проценты/разы к доходу.",
            "- Если annualIncomeGoals есть, используй gap и KPI как план действий, но не как фактический доход.",
            "- Если weeklyTakt есть, используй разрыв недели и месяца для действий на сегодня.",
            "- Если weeklyHypotheses есть, выбери одну активную/запланированную гипотезу и предложи следующий проверяемый шаг.",
            "- Если weeklyExecution.actionCount равен 0, напиши: «Сегодня минимум: 3 первых касания + 3 follow-up».",
            "- Если есть гипотезы, но мало действий, напиши что гипотеза не проверена, потому что объём действий не выполнен.",
            "- Если действий много, а дохода нет, предложи менять оффер / аудиторию / текст / цену.",
            "- Если есть follow-up, но нет КП, скажи дожимать до КП и цены.",
            "- Если есть КП, но денег нет, фокус на follow-up, сроках оплаты и конкретном следующем шаге.",
            "- Если crisisControl.isCritical true, главный риск должен быть кассовый разрыв.",
            "- Если safeDailySpendingLimit ниже 100 ₽, запрети все необязательные расходы.",
            "- Если топ категории включают кафе, кофе, алкоголь, фастфуд или развлечения — назови это прямо.",
            "- Если realMoneyOnAccounts ниже 1000 ₽, не предлагай мелкую оптимизацию как главный план; приоритет — ближайший денежный вход и обязательные платежи.",
            "- В debtPriority учитывай: over-limit кредитки, paymentDeadline, priority у долгов и minimum/planned payments.",
            "Финансовый контекст:",
            JSON.stringify(advisorContext)
          ].join("\n")
        }
      ]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`OpenAI API вернул статус ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenAI API вернул пустой анализ");
  }

  return normalizeAnalysis(JSON.parse(content), "ai");
}

export async function getAdvisorResponse(
  userId: string,
  generateAnalysis: boolean
): Promise<AdvisorResponse> {
  const summary = await getAdvisorSummary(userId);

  if (!generateAnalysis) {
    return {
      summary,
      analysis: null
    };
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      summary,
      analysis: buildRuleBasedAnalysis(summary),
      warning: "OPENAI_API_KEY не настроен. Показан расчетный анализ без AI."
    };
  }

  try {
    return {
      summary,
      analysis: await callOpenAi(summary)
    };
  } catch (error) {
    console.error("Advisor OpenAI error", error);

    return {
      summary,
      analysis: buildRuleBasedAnalysis(summary),
      warning: "OpenAI сейчас недоступен. Показан расчетный анализ без AI."
    };
  }
}
