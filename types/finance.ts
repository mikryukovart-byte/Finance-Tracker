export type CategoryKind = "INCOME" | "EXPENSE";
export type TransactionKind = CategoryKind | "ADJUSTMENT";
export type LoanState = "ACTIVE" | "PAUSED" | "CLOSED";
export type DebtPriority = "HIGH" | "MEDIUM" | "LOW";
export type DebtType = "BANK_LOAN" | "CREDIT_CARD" | "PERSONAL_DEBT";
export type CurrencyCode = "RUB" | "USD" | "EUR";
export type AccountType = "DEBIT" | "CREDIT_CARD";
export type GoalPointMode = "AUTO" | "MANUAL";
export type GoalGrowthMode = "LINEAR" | "MANUAL";
export type GoalScenarioKey = "C1" | "C2" | "C3";
export type WeeklyHypothesisStatus =
  | "PLANNED"
  | "ACTIVE"
  | "WON"
  | "FAILED"
  | "REPEAT"
  | "CHANGE"
  | "DROP";

export type Category = {
  id: string;
  userId?: string;
  name: string;
  type: CategoryKind;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    transactions: number;
  };
};

export type Transaction = {
  id: string;
  userId?: string;
  amount: number;
  type: TransactionKind;
  date: string;
  description: string | null;
  categoryId: string | null;
  accountId: string | null;
  category: Category | null;
  account?: Account | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Account = {
  id: string;
  userId?: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: CurrencyCode;
  creditLimit: number | null;
  currentDebt: number;
  availableCredit: number;
  minimalPayment: number | null;
  paymentDate: string | null;
  interestRate: number | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    transactions?: number;
    linkedLoans?: number;
    outgoingTransfers?: number;
    incomingTransfers?: number;
  };
};

export type Transfer = {
  id: string;
  userId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string | null;
  fromAccount?: Account;
  toAccount?: Account;
  createdAt?: string;
  updatedAt?: string;
};

export type Loan = {
  id: string;
  userId?: string;
  debtType: DebtType;
  title: string;
  lender: string | null;
  initialAmount: number | null;
  remainingAmount: number;
  monthlyPayment: number | null;
  plannedPayment: number | null;
  minimalPayment: number | null;
  creditLimit: number | null;
  interestRate: number | null;
  gracePeriodDays: number | null;
  paymentDate: string | null;
  accountId: string | null;
  account?: Account | null;
  priority: DebtPriority;
  status: LoanState;
  payments?: LoanPayment[];
  createdAt?: string;
  updatedAt?: string;
};

export type LoanPayment = {
  id: string;
  userId?: string;
  loanId: string;
  amount: number;
  appliedAmount: number | null;
  date: string;
  description: string | null;
  transactionId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardStats = {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  assetBalance?: number;
  accountBalance: number;
  totalDebt: number;
  netPosition: number;
  accounts: Account[];
  expensesToday: number;
  expensesMonth: number;
  expensesYear: number;
  recentTransactions: Transaction[];
  dailyControl?: DailyControl;
  survival?: SurvivalStats;
};

export type LoansResponse = {
  loans: Loan[];
  summary: {
    totalDebt: number;
    paymentsThisMonth: number;
    totalInitialDebt?: number;
    paidAmount?: number;
    paidPercent?: number;
  };
};

export type DailyControl = {
  hasTransactionsToday: boolean;
  todaySpending: number;
  monthSpending: number;
  transactionStreakDays: number;
  lastTransactionDate: string | null;
};

export type SurvivalStats = {
  availableBalance: number;
  daysLeftInMonth: number;
  safeDailyLimit: number;
};

export type LeakageStats = {
  threshold: number;
  totalSmallExpenses: number;
  percentOfMonthlyIncome: number;
  transactions: Transaction[];
  topCategories: Array<{
    categoryId: string;
    name: string;
    amount: number;
    count: number;
  }>;
  repeatedExpenses: Array<{
    key: string;
    description: string;
    categoryName: string;
    count: number;
    total: number;
    lastDate: string;
  }>;
};

export type CrisisSettings = {
  id: string;
  userId?: string;
  acuteReliefTarget: number;
  normalWorkTarget: number;
  requiredDailyExpense: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CrisisControl = {
  settings: CrisisSettings;
  realMoney: number;
  totalDebt: number;
  monthlyRequiredPayments: number;
  interestLeakage: number | null;
  interestDataStatus: "complete" | "incomplete";
  requiredDailyExpenses: number | null;
  requiredExpenses7Days: number | null;
  requiredExpenses30Days: number | null;
  daysUntilZero: number | null;
  acuteReliefTarget: number;
  normalWorkTarget: number;
  isCritical: boolean;
  creditCardOverLimit: boolean;
  creditCardOverLimitAmount: number;
  warnings: string[];
};

export type TruthResponse = {
  balance: number;
  assetBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  totalDebt: number;
  netPosition: number;
  toZero: number;
  toPositive: number;
  dailyControl: DailyControl;
  survival: SurvivalStats;
  leakage: LeakageStats;
  debtSummary: LoansResponse["summary"];
  crisis: CrisisControl;
};

export type ReportsResponse = {
  byCategory: CategoryBreakdownItem[];
  byExpenseCategory: CategoryBreakdownItem[];
  byIncomeCategory: CategoryBreakdownItem[];
  byMonth: Array<{
    month: string;
    label: string;
    income: number;
    expense: number;
  }>;
  comparison: {
    totalIncome: number;
    totalExpense: number;
    balance: number;
  };
  currentMonth: {
    income: number;
    expense: number;
    balance: number;
  };
  previousMonth: {
    income: number;
    expense: number;
    balance: number;
  };
  monthChange: {
    income: number;
    expense: number;
    balance: number;
  };
  topExpenseCategories: CategoryBreakdownItem[];
  leakage: LeakageStats;
  debtProgress: LoansResponse["summary"];
};

export type AdvisorAnalysis = {
  shortConclusion: string[];
  mainRisk: string[];
  todayActions: string[];
  weeklyExecution: string[];
  dontDo: string[];
  debtPriority: string[];
  spendingLimit: string[];
  hardTruth: string[];
  source: "ai" | "rules";
};

export type AdvisorSummary = {
  generatedAt: string;
  period: {
    label: string;
    startDate: string;
    endDate: string;
  };
  totals: {
    realMoney: number;
    totalDebt: number;
    netPosition: number;
    monthlyIncome: number;
    monthlyExpense: number;
    safeDailyLimit: number;
    daysLeftInMonth: number;
    daysUntilZero: number | null;
    requiredPaymentsBeforeMonthEnd: number;
  };
  accounts: Array<{
    name: string;
    type: AccountType;
    balance: number;
    currency: CurrencyCode;
  }>;
  creditCards: Array<{
    name: string;
    creditLimit: number;
    currentDebt: number;
    availableCredit: number;
    overLimit: number;
    minimalPayment: number | null;
    paymentDate: string | null;
    monthlySpending: number;
    last30DaysSpending: number;
    last30DaysRepayments: number;
    recentSpending: Array<{
      date: string;
      amount: number;
      type: string;
      description: string;
      categoryName: string;
      accountName: string;
      accountType: string;
    }>;
    recentRepayments: Array<{
      date: string;
      amount: number;
      source: string;
      fromAccountName: string;
      description: string;
    }>;
  }>;
  loans: Array<{
    title: string;
    lender: string | null;
    debtType: DebtType;
    remainingDebt: number;
    plannedPayment: number;
    progressPercent: number | null;
    paymentDate: string | null;
    priority: DebtPriority;
    monthRepaymentTotal: number;
    monthRepaymentCount: number;
    recentPayments: Array<{
      date: string;
      amount: number;
      appliedAmount: number;
      description: string;
    }>;
  }>;
  transactions: {
    topExpenseCategories: Array<{
      name: string;
      amount: number;
      count: number;
    }>;
    largestTransactions: Array<{
      date: string;
      amount: number;
      type: string;
      description: string;
      categoryName: string;
      accountName: string;
      accountType: string;
    }>;
    expensesByAccount: Array<{
      accountName: string;
      accountType: string;
      amount: number;
      count: number;
    }>;
    incomeSources: Array<{
      name: string;
      amount: number;
      count: number;
    }>;
    fastestGrowingCategories: Array<{
      categoryName: string;
      last7Days: number;
      previous7Days: number;
      growth: number;
      growthPercent: number | null;
    }>;
    trend: {
      last7DaysExpense: number;
      previous7DaysExpense: number;
      last30DaysExpense: number;
      averageDailyLast7Days: number;
      averageDailyLast30Days: number;
      change: number;
    };
    leakage: {
      threshold: number;
      totalSmallExpenses: number;
      percentOfMonthlyIncome: number;
      topCategories: Array<{
        name: string;
        amount: number;
        count: number;
      }>;
      repeatedExpenses: Array<{
        description: string;
        categoryName: string;
        count: number;
        total: number;
      }>;
    };
  };
  dataQuality: {
    incomeStatus: "missing_or_zero" | "suspiciously_low" | "present";
    incomeTransactionCount: number;
    warnings: string[];
  };
  crisis: Pick<
    CrisisControl,
    | "realMoney"
    | "totalDebt"
    | "monthlyRequiredPayments"
    | "requiredDailyExpenses"
    | "daysUntilZero"
    | "acuteReliefTarget"
    | "normalWorkTarget"
    | "isCritical"
    | "creditCardOverLimit"
    | "creditCardOverLimitAmount"
    | "warnings"
  > | null;
  weeklyTakt: WeeklyTakt | null;
  weeklyExecution: {
    weekStartDate: string;
    weekEndDate: string;
    hypothesisCount: number;
    actionCount: number;
    actionCounts: {
      firstTouches: number;
      followUps: number;
      warmContacts: number;
      calls: number;
      proposals: number;
      priceNamed: number;
      other: number;
    };
    recentActions: Array<{
      date: string;
      type: DailyActionType;
      target: string | null;
      value: string | null;
      nextStep: string | null;
    }>;
    hypotheses: Array<{
      title: string;
      actionPlan: string;
      expectedResult: string | null;
      actualResult: string | null;
      status: WeeklyHypothesisStatus;
    }>;
  };
  weeklyHypotheses: WeeklyHypothesis[];
  annualGoals: {
    year: number;
    pointA: number;
    pointAMode: string;
    planStartDate: string;
    growthMode: string;
    finalTargets: {
      c1: number;
      c2: number;
      c3: number;
    };
    currentMonth: {
      month: number;
      rowKey: string | null;
      actualIncome: number;
      c1Plan: number | null;
      c2Plan: number | null;
      c3Plan: number | null;
      gapToC1: number | null;
      gapToC2: number | null;
      gapToC3: number | null;
      kpiText: string | null;
      signatureText: string | null;
      isClosed: boolean;
    };
    threeYearScenarios: Array<{
      speed: number;
      pointC: number;
      pointD: number;
      pointE: number;
      score: number;
    }>;
    note: string;
  } | null;
};

export type AdvisorResponse = {
  summary: AdvisorSummary;
  analysis: AdvisorAnalysis | null;
  warning?: string;
};

export type AnnualGoalRow = {
  id: string;
  planId: string;
  rowKey: string;
  month: number | null;
  calendarMonth?: number;
  calendarYear?: number;
  periodStart?: string;
  periodEnd?: string;
  isReserve?: boolean;
  c1Value: number;
  c2Value: number;
  c3Value: number;
  kpiText: string | null;
  signatureText: string | null;
  isClosed: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AnnualGoalPlan = {
  id: string;
  userId?: string;
  year: number;
  pointA: number;
  pointAMode: GoalPointMode;
  planStartDate: string;
  c1Target: number;
  c2Target: number;
  c3Target: number;
  growthMode: GoalGrowthMode;
  rows: AnnualGoalRow[];
  createdAt?: string;
  updatedAt?: string;
};

export type MonthlyTaktLevel = {
  id: string;
  userId?: string;
  year: number;
  level: number;
  description: string;
  amount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ThreeYearGoalScenario = {
  id: string;
  userId?: string;
  year: number;
  speed: number;
  pointC: number;
  pointD: number;
  pointE: number;
  score: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AnnualIncomeFact = {
  rowKey?: string;
  month: number;
  year?: number;
  periodStart?: string;
  periodEnd?: string;
  actualIncome: number;
};

export type WeeklyTakt = {
  status: "NOT_STARTED" | "ACTIVE" | "FINISHED";
  selectedScenario: GoalScenarioKey;
  rowKey: string | null;
  rowLabel: string;
  nextRowKey: string | null;
  nextRowLabel: string | null;
  planStartDate: string;
  monthlyTarget: number;
  weeklyTarget: number;
  dailyTarget: number;
  weeklyIncome: number;
  monthlyIncome: number;
  weeklyGap: number;
  monthlyGap: number;
  weekStartDate: string;
  weekEndDate: string;
  monthStartDate: string;
  monthEndDate: string;
};

export type GoalsResponse = {
  plan: AnnualGoalPlan;
  facts: AnnualIncomeFact[];
  taktLevels: MonthlyTaktLevel[];
  threeYearScenarios: ThreeYearGoalScenario[];
  weeklyTakt: WeeklyTakt;
  autoPointA: number;
};

export type WeeklyHypothesis = {
  id: string;
  userId?: string;
  weekStartDate: string;
  title: string;
  actionPlan: string;
  expectedResult: string | null;
  actualResult: string | null;
  conclusion: string | null;
  status: WeeklyHypothesisStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type DailyActionType =
  | "FIRST_TOUCH"
  | "FOLLOW_UP"
  | "WARM_CONTACT"
  | "CALL"
  | "PROPOSAL"
  | "PRICE_NAMED"
  | "OTHER";

export type DailyActionLog = {
  id: string;
  userId?: string;
  date: string;
  weekStartDate: string;
  type: DailyActionType;
  target: string | null;
  value: string | null;
  nextStep: string | null;
  note: string | null;
  deletedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CategoryBreakdownItem = {
    categoryId: string;
    name: string;
    amount: number;
    percent: number;
};
