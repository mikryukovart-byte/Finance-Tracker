import {
  endOfMonth,
  monthLabel,
  startOfDay,
  startOfMonth
} from "@/lib/date-ranges";
import {
  buildFinancialControlData,
  parseLeakageThreshold
} from "@/lib/financial-control";
import {
  getDebtProgress,
  getPlannedDebtPayment
} from "@/lib/debts";
import { prisma } from "@/lib/prisma";
import type {
  AdvisorAnalysis,
  AdvisorResponse,
  AdvisorSummary
} from "@/types/finance";

const advisorSections: Array<keyof Omit<AdvisorAnalysis, "source">> = [
  "shortConclusion",
  "mainRisk",
  "todayActions",
  "dontDo",
  "debtPriority",
  "spendingLimit",
  "hardTruth"
];

function daysBefore(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

function buildTopExpenseCategories(
  transactions: Array<{
    amount: number;
    type: string;
    categoryId: string | null;
    category: { name: string } | null;
  }>
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
    .slice(0, 5);
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

export async function getAdvisorSummary(userId: string): Promise<AdvisorSummary> {
  const now = new Date();
  const periodStart = startOfMonth(now);
  const periodEnd = endOfMonth(now);
  const todayStart = startOfDay(now);
  const last7Start = startOfDay(daysBefore(now, 6));
  const previous7Start = startOfDay(daysBefore(now, 13));
  const threshold = parseLeakageThreshold(null);

  const [monthTransactions, trendTransactions, loans, accounts] = await Promise.all([
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
        }
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: previous7Start,
          lt: new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1)
        }
      },
      select: {
        amount: true,
        type: true,
        date: true
      }
    }),
    prisma.loan.findMany({
      where: { userId, status: { not: "CLOSED" } },
      select: {
        debtType: true,
        title: true,
        initialAmount: true,
        remainingAmount: true,
        monthlyPayment: true,
        plannedPayment: true,
        minimalPayment: true,
        paymentDate: true,
        accountId: true,
        status: true,
        account: {
          select: {
            currentDebt: true,
            minimalPayment: true
          }
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
  const creditCards = accounts
    .filter((account) => account.type === "CREDIT_CARD")
    .map((account) => ({
      name: account.name,
      creditLimit: account.creditLimit ?? 0,
      currentDebt: account.currentDebt,
      availableCredit: account.availableCredit,
      overLimit: Math.max(0, account.currentDebt - (account.creditLimit ?? 0)),
      minimalPayment: account.minimalPayment,
      paymentDate: account.paymentDate?.toISOString() ?? null
    }));
  const activeLoans = loans
    .filter((loan) => loan.debtType !== "CREDIT_CARD")
    .map((loan) => ({
      title: loan.title,
      debtType: loan.debtType as AdvisorSummary["loans"][number]["debtType"],
      remainingDebt: loan.remainingAmount,
      plannedPayment: getPlannedDebtPayment(loan),
      progressPercent: getDebtProgress(loan),
      paymentDate: loan.paymentDate?.toISOString() ?? null
    }));
  const last7DaysExpense = sumExpenses(
    trendTransactions,
    last7Start,
    new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1)
  );
  const previous7DaysExpense = sumExpenses(trendTransactions, previous7Start, last7Start);

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
      daysLeftInMonth: control.survival.daysLeftInMonth
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
      topExpenseCategories: buildTopExpenseCategories(monthTransactions),
      trend: {
        last7DaysExpense,
        previous7DaysExpense,
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
    }
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
  const riskyTopCategory =
    biggestExpense && isLifestyleLeakCategory(biggestExpense.name) ? biggestExpense : null;
  const cashflowNegative = summary.totals.monthlyExpense > summary.totals.monthlyIncome;
  const noIncomeWithExpenses =
    summary.totals.monthlyIncome <= 0 && summary.totals.monthlyExpense > 0;
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
      noIncomeWithExpenses
        ? `Дохода за месяц нет, расходы уже ${formatRub(summary.totals.monthlyExpense)}. Главная задача — деньги на входе.`
        : cashflowNegative
          ? `Расходы за месяц выше доходов на ${formatRub(summary.totals.monthlyExpense - summary.totals.monthlyIncome)}.`
          : `Доходы за месяц: ${formatRub(summary.totals.monthlyIncome)}, расходы: ${formatRub(summary.totals.monthlyExpense)}.`,
      creditCardDebt > 0
        ? `Долг по кредиткам: ${formatRub(creditCardDebt)}. Доступно по кредиткам: ${formatRub(availableCredit)}, это не ваши деньги.`
        : ""
    ]),
    mainRisk: clampItems([
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
        ? "Нет дохода при положительных расходах. Оптимизация трат не решит проблему без нового дохода."
        : "",
      strictSpendingStop
        ? `Дневной лимит ниже ${formatRub(100)}. Все необязательные расходы нужно остановить.`
        : ""
    ]),
    todayActions: clampItems([
      noIncomeWithExpenses
        ? "Найти ближайший источник дохода: оплата, аванс, возврат долга, продажа лишнего, подработка."
        : "",
      overLimitCards[0]
        ? `Внести платеж по «${overLimitCards[0].name}» минимум на ${formatRub(overLimitCards[0].overLimit)} или зафиксировать дату платежа.`
        : "Проверить все расходы за сегодня и внести пропущенные операции.",
      nextPaymentText ? `Проверить ближайшие платежи: ${nextPaymentText}.` : "",
      largestDebt
        ? `Следующий свободный платеж направить в «${largestDebt.name}», долг ${formatRub(largestDebt.debt)}.`
        : "Не добавлять новые долги.",
      strictSpendingStop
        ? "Сегодня не покупать ничего необязательного."
        : `Держать траты сегодня в пределах ${formatRub(Math.max(0, summary.totals.safeDailyLimit))}.`
    ]),
    dontDo: clampItems([
      "Не считать доступный лимит кредитки своими деньгами.",
      noIncomeWithExpenses
        ? "Не тратить время на мелкую оптимизацию как главную стратегию. Сначала нужен доход."
        : cashflowNegative
          ? "Не увеличивать регулярные расходы, пока месячные расходы выше доходов."
          : "Не брать новые обязательства без отдельного источника погашения.",
      riskyTopCategory
        ? `Не продолжать траты в категории «${riskyTopCategory.name}» как будто это мелочь: уже ${formatRub(riskyTopCategory.amount)}.`
        : "",
      strictSpendingStop
        ? "Не использовать кредитку для бытовых покупок: это увеличит долг, а не деньги."
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
      riskyTopCategory
        ? `Категория «${riskyTopCategory.name}» бьет по бюджету напрямую. Закрыть ее до конца месяца.`
        : "",
      leakCategory
        ? `Мелкие утечки: «${leakCategory.name}» — ${formatRub(leakCategory.amount)} за ${leakCategory.count} операций.`
        : "",
      repeatedLeak
        ? `Повторяется: «${repeatedLeak.description}», ${repeatedLeak.count} раз, всего ${formatRub(repeatedLeak.total)}.`
        : ""
    ], 6),
    hardTruth: clampItems([
      summary.totals.totalDebt > 0
        ? "Пока долг не снижается, доступный лимит кредитки не улучшает финансовую позицию."
        : "Без долгов главная задача — не потерять контроль над регулярными расходами.",
      noIncomeWithExpenses
        ? "Без дохода расходы просто уменьшают остаток и двигают к новому долгу."
        : "",
      lowRealMoney
        ? "При остатке ниже 1000 ₽ вопрос не в комфорте, а в ближайших обязательных платежах."
        : "",
      debtAboveMoney
        ? `Чтобы выйти в ноль, не хватает ${formatRub(Math.abs(Math.min(0, summary.totals.netPosition)))}.`
        : "",
      creditCardDebt > 0
        ? "Кредитка — инструмент долга. Ее доступный остаток нельзя прибавлять к деньгам на счетах."
        : ""
    ])
  };
}

async function callOpenAi(summary: AdvisorSummary): Promise<AdvisorAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return buildRuleBasedAnalysis(summary);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты финансовый советник в личном финансовом трекере. Отвечай на русском, прямо и практично. Без мотивационной воды, без утешений, без медицинских/юридических гарантий. Кредитный лимит и availableCredit кредитной карты НЕ являются деньгами пользователя."
        },
        {
          role: "user",
          content: [
            "Проанализируй агрегированную сводку и верни только JSON.",
            "Формат: {",
            '"shortConclusion": string[],',
            '"mainRisk": string[],',
            '"todayActions": string[],',
            '"dontDo": string[],',
            '"debtPriority": string[],',
            '"spendingLimit": string[],',
            '"hardTruth": string[]',
            "}.",
            "Каждый пункт короткий, конкретный, с числами где они важны.",
            "Не считай availableCredit кредитки деньгами пользователя.",
            JSON.stringify(summary)
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
