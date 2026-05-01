export type TransactionKind = "INCOME" | "EXPENSE";
export type LoanState = "ACTIVE" | "PAUSED" | "CLOSED";
export type DebtPriority = "HIGH" | "MEDIUM" | "LOW";
export type DebtType = "BANK_LOAN" | "CREDIT_CARD" | "PERSONAL_DEBT";
export type CurrencyCode = "RUB" | "USD" | "EUR";
export type AccountType = "DEBIT" | "CREDIT_CARD";

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
  accountId: string | null;
  category: Category;
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
  minimalPayment: number | null;
  paymentDate: string | null;
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
  accountBalance: number;
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
