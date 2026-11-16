export const EXPENSE_CATEGORIES = [
  'Vegetables',
  'Chicken',
  'Beef',
  'Milk',
  'Gas',
  'Electricity',
  'Staff Wages',
  'Rent',
  'Maintenance',
  'Supermarket & Packaging',
  'Other Expenditure',
] as const;

export const INCOME_CATEGORIES = ['Daily Total Sales'] as const;

export const CATEGORIES = [
  'Vegetables',
  'Chicken',
  'Beef',
  'Milk',
  'Gas',
  'Electricity',
  'Staff Wages',
  'Rent',
  'Maintenance',
  'Supermarket & Packaging',
  'Other Expenditure',
  'Daily Total Sales',
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

export type CurrencyCode = 'INR' | 'USD';

export type TimeGranularity = 'day' | 'week' | 'month' | 'year';

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: CategoryName;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  notes: string;
  autoCategorized: boolean;
  sourceBillId: string;
}

export interface UserSettings {
  userId: string;
  currency: CurrencyCode;
  monthlySavingsGoal: number;
}

export interface ChartBucket {
  key: string;
  label: string;
  fullLabel: string;
  income: number;
  expense: number;
  net: number;
  cumulativeNet: number;
}

export interface PeriodSnapshot {
  granularity: TimeGranularity;
  periodLabel: string;
  rangeStart: string;
  rangeEnd: string;
  income: number;
  expense: number;
  netProfit: number;
  profitMarginPct: number;
  transactionCount: number;
  incomeDeltaPct: number | null;
  expenseDeltaPct: number | null;
  netDeltaPct: number | null;
  buckets: ChartBucket[];
}

export interface DailyComparisonRow {
  date: string;
  label: string;
  income: number;
  expense: number;
  netProfit: number;
  expenseDelta: number | null;
  expenseDeltaPct: number | null;
  entryCount: number;
}

export interface CategoryBreakdownItem {
  category: CategoryName;
  spent: number;
  sharePct: number;
  color: string;
  transactionCount: number;
}
