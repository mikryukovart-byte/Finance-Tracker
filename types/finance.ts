export type TransactionKind = "INCOME" | "EXPENSE";
export type LoanState = "ACTIVE" | "PAUSED" | "CLOSED";
export type DebtPriority = "HIGH" | "MEDIUM" | "LOW";

export type Category = {
  id: string;
  userId?: string;
  name: string;
  type: TransactionKind;
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
  categoryId: string;
  category: Category;
  createdAt?: string;
  updatedAt?: string;
};

export type Loan = {
  id: string;
  userId?: string;
  title: string;
  lender: string | null;
  initialAmount: number;
  remainingAmount: number;
  monthlyPayment: number;
  interestRate: number;
  paymentDate: string;
  priority: DebtPriority;
  status: LoanState;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardStats = {
  totalIncome: number;
  totalExpense: number;
  balance: number;
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

export type TruthResponse = {
  balance: number;
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

export type CategoryBreakdownItem = {
    categoryId: string;
    name: string;
    amount: number;
    percent: number;
};
