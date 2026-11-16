import {
  CategoryBreakdownItem,
  CategoryName,
  ChartBucket,
  CurrencyCode,
  DailyComparisonRow,
  PeriodSnapshot,
  TimeGranularity,
  Transaction,
} from '../types/finance';
import { CATEGORY_COLORS, parseQuantityFromNotes } from './categorizer';

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function formatShortDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function shiftAnchorDate(
  anchorIso: string,
  granularity: TimeGranularity,
  delta: number
): string {
  const d = parseIsoDate(anchorIso);
  if (granularity === 'day') d.setDate(d.getDate() + delta);
  else if (granularity === 'week') d.setDate(d.getDate() + delta * 7);
  else if (granularity === 'month') d.setMonth(d.getMonth() + delta);
  else d.setFullYear(d.getFullYear() + delta);
  return toIsoDate(d);
}

export function getPeriodBounds(
  anchorIso: string,
  granularity: TimeGranularity
): { start: string; end: string; label: string } {
  const d = parseIsoDate(anchorIso);

  if (granularity === 'day') {
    const label = d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return { start: anchorIso, end: anchorIso, label };
  }

  if (granularity === 'week') {
    const dayOfWeek = d.getDay();
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const startLabel = mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const endLabel = sun.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return {
      start: toIsoDate(mon),
      end: toIsoDate(sun),
      label: `${startLabel} – ${endLabel}`,
    };
  }

  if (granularity === 'month') {
    const first = new Date(d.getFullYear(), d.getMonth(), 1, 12);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    const label = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { start: toIsoDate(first), end: toIsoDate(last), label };
  }

  const first = new Date(d.getFullYear(), 0, 1, 12);
  const last = new Date(d.getFullYear(), 11, 31, 12);
  return {
    start: toIsoDate(first),
    end: toIsoDate(last),
    label: `${d.getFullYear()}`,
  };
}

function calcDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function sumTransactions(list: Transaction[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const tx of list) {
    if (tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  }
  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
  };
}

export function filterTransactionsInRange(
  transactions: Transaction[],
  start: string,
  end: string
): Transaction[] {
  return transactions.filter((tx) => tx.date >= start && tx.date <= end);
}

export function computePeriodSnapshot(
  transactions: Transaction[],
  granularity: TimeGranularity,
  anchorIso: string
): PeriodSnapshot {
  const { start, end, label } = getPeriodBounds(anchorIso, granularity);
  const prevAnchor = shiftAnchorDate(anchorIso, granularity, -1);
  const prevBounds = getPeriodBounds(prevAnchor, granularity);

  const currentTxs = filterTransactionsInRange(transactions, start, end);
  const prevTxs = filterTransactionsInRange(transactions, prevBounds.start, prevBounds.end);

  const { income, expense } = sumTransactions(currentTxs);
  const prevTotals = sumTransactions(prevTxs);

  const netProfit = Math.round((income - expense) * 100) / 100;
  const prevNet = Math.round((prevTotals.income - prevTotals.expense) * 100) / 100;
  const profitMarginPct = income > 0 ? Math.round((netProfit / income) * 1000) / 10 : 0;

  const buckets = buildBuckets(currentTxs, granularity, start, end);

  return {
    granularity,
    periodLabel: label,
    rangeStart: start,
    rangeEnd: end,
    income,
    expense,
    netProfit,
    profitMarginPct,
    transactionCount: currentTxs.filter((tx) => tx.type === 'expense').length,
    incomeDeltaPct: calcDeltaPct(income, prevTotals.income),
    expenseDeltaPct: calcDeltaPct(expense, prevTotals.expense),
    netDeltaPct: calcDeltaPct(netProfit, prevNet),
    buckets,
  };
}

function buildBuckets(
  txs: Transaction[],
  granularity: TimeGranularity,
  start: string,
  end: string
): ChartBucket[] {
  const rawBuckets: Array<{ key: string; label: string; fullLabel: string; income: number; expense: number }> = [];

  if (granularity === 'day') {
    const slots = ['Morning', 'Lunch', 'Evening', 'Dinner'];
    const slotFull = ['06:00–11:59', '12:00–15:59', '16:00–19:59', '20:00–23:59'];
    for (let i = 0; i < 4; i++) {
      rawBuckets.push({ key: String(i), label: slots[i], fullLabel: slotFull[i], income: 0, expense: 0 });
    }
    for (const tx of txs) {
      const hour = Number((tx.time || '12:00').split(':')[0]) || 12;
      const idx = hour < 12 ? 0 : hour < 16 ? 1 : hour < 20 ? 2 : 3;
      if (tx.type === 'income') rawBuckets[idx].income += tx.amount;
      else rawBuckets[idx].expense += tx.amount;
    }
  } else if (granularity === 'week') {
    const mon = parseIsoDate(start);
    const weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const map = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const iso = toIsoDate(d);
      map.set(iso, i);
      rawBuckets.push({
        key: iso,
        label: weekdayShort[i],
        fullLabel: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        income: 0,
        expense: 0,
      });
    }
    for (const tx of txs) {
      const idx = map.get(tx.date);
      if (idx !== undefined) {
        if (tx.type === 'income') rawBuckets[idx].income += tx.amount;
        else rawBuckets[idx].expense += tx.amount;
      }
    }
  } else if (granularity === 'month') {
    const first = parseIsoDate(start);
    const last = parseIsoDate(end);
    const totalDays = last.getDate();
    const map = new Map<string, number>();
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(first.getFullYear(), first.getMonth(), day, 12);
      const iso = toIsoDate(d);
      map.set(iso, day - 1);
      rawBuckets.push({
        key: iso,
        label: day === 1 || day % 5 === 0 || day === totalDays ? String(day) : '',
        fullLabel: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        income: 0,
        expense: 0,
      });
    }
    for (const tx of txs) {
      const idx = map.get(tx.date);
      if (idx !== undefined) {
        if (tx.type === 'income') rawBuckets[idx].income += tx.amount;
        else rawBuckets[idx].expense += tx.amount;
      }
    }
  } else {
    const year = parseIsoDate(start).getFullYear();
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let m = 0; m < 12; m++) {
      rawBuckets.push({
        key: `${year}-${String(m + 1).padStart(2, '0')}`,
        label: monthShort[m],
        fullLabel: `${monthShort[m]} ${year}`,
        income: 0,
        expense: 0,
      });
    }
    for (const tx of txs) {
      const monthIdx = Number(tx.date.slice(5, 7)) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        if (tx.type === 'income') rawBuckets[monthIdx].income += tx.amount;
        else rawBuckets[monthIdx].expense += tx.amount;
      }
    }
  }

  let runningNet = 0;
  return rawBuckets.map((b) => {
    const income = Math.round(b.income * 100) / 100;
    const expense = Math.round(b.expense * 100) / 100;
    const net = Math.round((income - expense) * 100) / 100;
    runningNet = Math.round((runningNet + net) * 100) / 100;
    return {
      key: b.key,
      label: b.label,
      fullLabel: b.fullLabel,
      income,
      expense,
      net,
      cumulativeNet: runningNet,
    };
  });
}

export function computeDailyComparisonBuckets(
  transactions: Transaction[],
  anchorIso: string,
  days = 10
): ChartBucket[] {
  const end = parseIsoDate(anchorIso);
  const buckets: ChartBucket[] = [];
  const map = new Map<string, number>();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const iso = toIsoDate(d);
    map.set(iso, days - 1 - i);
    buckets.push({
      key: iso,
      label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      fullLabel: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      income: 0,
      expense: 0,
      net: 0,
      cumulativeNet: 0,
    });
  }

  for (const tx of transactions) {
    const idx = map.get(tx.date);
    if (idx !== undefined) {
      if (tx.type === 'income') buckets[idx].income += tx.amount;
      else buckets[idx].expense += tx.amount;
    }
  }

  let running = 0;
  return buckets.map((b) => {
    const income = Math.round(b.income * 100) / 100;
    const expense = Math.round(b.expense * 100) / 100;
    const net = Math.round((income - expense) * 100) / 100;
    running = Math.round((running + net) * 100) / 100;
    return {
      ...b,
      income,
      expense,
      net,
      cumulativeNet: running,
    };
  });
}

export function computeDailyComparisonRows(
  transactions: Transaction[],
  anchorIso: string,
  days = 7
): DailyComparisonRow[] {
  const todayIso = toIsoDate(new Date());
  const yesterdayIso = shiftAnchorDate(todayIso, 'day', -1);

  const end = parseIsoDate(anchorIso);
  const statsByDate = new Map<string, { income: number; expense: number; count: number }>();

  for (const tx of transactions) {
    const prev = statsByDate.get(tx.date) ?? { income: 0, expense: 0, count: 0 };
    if (tx.type === 'income') prev.income += tx.amount;
    else {
      prev.expense += tx.amount;
      prev.count += 1;
    }
    statsByDate.set(tx.date, prev);
  }

  const rows: DailyComparisonRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const iso = toIsoDate(d);

    const prevD = new Date(d);
    prevD.setDate(d.getDate() - 1);
    const prevIso = toIsoDate(prevD);

    const curr = statsByDate.get(iso) ?? { income: 0, expense: 0, count: 0 };
    const prev = statsByDate.get(prevIso) ?? { income: 0, expense: 0, count: 0 };

    const income = Math.round(curr.income * 100) / 100;
    const expense = Math.round(curr.expense * 100) / 100;
    const netProfit = Math.round((income - expense) * 100) / 100;

    const expenseDelta =
      prev.expense === 0 && expense === 0
        ? null
        : Math.round((expense - prev.expense) * 100) / 100;

    const expenseDeltaPct = calcDeltaPct(expense, prev.expense);

    const label =
      iso === todayIso
        ? 'Today'
        : iso === yesterdayIso
        ? 'Yesterday'
        : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

    rows.push({
      date: iso,
      label,
      income,
      expense,
      netProfit,
      expenseDelta,
      expenseDeltaPct,
      entryCount: curr.count,
    });
  }

  return rows;
}

export interface RestaurantEfficiencyMetrics {
  foodCostAmount: number;
  foodCostRatioPct: number;
  laborAndFuelAmount: number;
  primeCostRatioPct: number;
  expenseToSalesRatioPct: number;
  topExpenseCategory: CategoryName | null;
  topExpenseAmount: number;
  topExpenseSharePct: number;
}

const FOOD_CATEGORIES: ReadonlySet<CategoryName> = new Set([
  'Vegetables',
  'Chicken',
  'Beef',
  'Milk',
  'Supermarket & Packaging',
]);

const LABOR_FUEL_CATEGORIES: ReadonlySet<CategoryName> = new Set([
  'Staff Wages',
  'Gas',
  'Electricity',
]);

export function computeRestaurantEfficiency(
  periodTxs: Transaction[],
  totalSales: number,
  totalExpense: number
): RestaurantEfficiencyMetrics {
  let foodCostAmount = 0;
  let laborAndFuelAmount = 0;
  const catSums = new Map<CategoryName, number>();

  for (const tx of periodTxs) {
    if (tx.type !== 'expense') continue;
    if (FOOD_CATEGORIES.has(tx.category)) foodCostAmount += tx.amount;
    if (LABOR_FUEL_CATEGORIES.has(tx.category)) laborAndFuelAmount += tx.amount;
    catSums.set(tx.category, (catSums.get(tx.category) ?? 0) + tx.amount);
  }

  let topExpenseCategory: CategoryName | null = null;
  let topExpenseAmount = 0;
  for (const [cat, amt] of catSums.entries()) {
    if (amt > topExpenseAmount) {
      topExpenseAmount = amt;
      topExpenseCategory = cat;
    }
  }

  const foodCostRatioPct =
    totalSales > 0 ? Math.round((foodCostAmount / totalSales) * 1000) / 10 : 0;
  const primeCostRatioPct =
    totalSales > 0
      ? Math.round(((foodCostAmount + laborAndFuelAmount) / totalSales) * 1000) / 10
      : 0;
  const expenseToSalesRatioPct =
    totalSales > 0 ? Math.round((totalExpense / totalSales) * 1000) / 10 : 0;
  const topExpenseSharePct =
    totalExpense > 0 ? Math.round((topExpenseAmount / totalExpense) * 1000) / 10 : 0;

  return {
    foodCostAmount: Math.round(foodCostAmount * 100) / 100,
    foodCostRatioPct,
    laborAndFuelAmount: Math.round(laborAndFuelAmount * 100) / 100,
    primeCostRatioPct,
    expenseToSalesRatioPct,
    topExpenseCategory,
    topExpenseAmount: Math.round(topExpenseAmount * 100) / 100,
    topExpenseSharePct,
  };
}

export function computeCategoryBreakdown(periodTxs: Transaction[]): CategoryBreakdownItem[] {
  const expenseOnly = periodTxs.filter((tx) => tx.type === 'expense');
  const totalSpent = expenseOnly.reduce((acc, tx) => acc + tx.amount, 0);

  const map = new Map<CategoryName, { sum: number; count: number }>();
  for (const tx of expenseOnly) {
    const existing = map.get(tx.category) ?? { sum: 0, count: 0 };
    map.set(tx.category, {
      sum: existing.sum + tx.amount,
      count: existing.count + 1,
    });
  }

  const items: CategoryBreakdownItem[] = [];
  for (const [category, stats] of map.entries()) {
    const spent = Math.round(stats.sum * 100) / 100;
    const sharePct = totalSpent > 0 ? Math.round((spent / totalSpent) * 1000) / 10 : 0;
    items.push({
      category,
      spent,
      sharePct,
      color: CATEGORY_COLORS[category] ?? '#64748B',
      transactionCount: stats.count,
    });
  }

  return items.sort((a, b) => b.spent - a.spent);
}

export interface DaySummaryPoint {
  date: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  topCategory: CategoryName | null;
}

export interface StructuredInsightPoint {
  index: string;
  label: string;
  detail: string;
  tone: 'positive' | 'warning' | 'neutral';
}

export interface RestaurantAnalysisPlan {
  bestProfitDay: DaySummaryPoint | null;
  periodBestDay: DaySummaryPoint | null;
  periodLowestDay: DaySummaryPoint | null;
  worstProfitDay: DaySummaryPoint | null;
  highestSpendDay: DaySummaryPoint | null;
  bestWeekdayName: string | null;
  bestWeekdayAvgNet: number;
  avgDailySpend: number;
  avgDailySales: number;
  avgDailyProfit: number;
  kitchenSharePct: number;
  utilitiesStaffSharePct: number;
  chickenKg: number;
  chickenAvgRate: number;
  beefKg: number;
  beefAvgRate: number;
  lpgCount: number;
  lpgAvgRate: number;
  unclosedDates: string[];
  periodUnclosedDates: string[];
  actionPlan: string[];
  structuredInsights: StructuredInsightPoint[];
}

export function computeRestaurantAnalysis(
  allTransactions: Transaction[],
  periodTxs: Transaction[],
  currency: CurrencyCode,
  snapshot?: PeriodSnapshot
): RestaurantAnalysisPlan {
  const scope = periodTxs;

  const groupDays = (list: Transaction[]): { days: DaySummaryPoint[]; unclosed: string[] } => {
    const map = new Map<
      string,
      { income: number; expense: number; cats: Map<CategoryName, number> }
    >();
    for (const tx of list) {
      const cur = map.get(tx.date) ?? {
        income: 0,
        expense: 0,
        cats: new Map<CategoryName, number>(),
      };
      if (tx.type === 'income') cur.income += tx.amount;
      else {
        cur.expense += tx.amount;
        cur.cats.set(tx.category, (cur.cats.get(tx.category) ?? 0) + tx.amount);
      }
      map.set(tx.date, cur);
    }

    const days: DaySummaryPoint[] = [];
    const unclosed: string[] = [];

    for (const [date, stats] of map.entries()) {
      let topCategory: CategoryName | null = null;
      let topAmt = 0;
      for (const [c, a] of stats.cats.entries()) {
        if (a > topAmt) {
          topAmt = a;
          topCategory = c;
        }
      }
      const income = Math.round(stats.income * 100) / 100;
      const expense = Math.round(stats.expense * 100) / 100;
      const net = Math.round((income - expense) * 100) / 100;
      days.push({
        date,
        label: formatShortDate(date),
        income,
        expense,
        net,
        topCategory,
      });
      if (expense > 0 && income === 0) {
        unclosed.push(date);
      }
    }
    unclosed.sort((a, b) => b.localeCompare(a));
    return { days, unclosed };
  };

  const { days: allDays, unclosed: unclosedDates } = groupDays(allTransactions);
  const { days: periodDays, unclosed: periodUnclosedDates } = groupDays(periodTxs);

  const closedDaysAll = allDays.filter((d) => d.income > 0);
  const profitPoolAll = closedDaysAll.length > 0 ? closedDaysAll : allDays;

  const bestProfitDay =
    profitPoolAll.length > 0
      ? [...profitPoolAll].sort((a, b) => b.net - a.net || b.income - a.income)[0]
      : null;

  const worstProfitDay =
    allDays.length > 1
      ? [...allDays].sort((a, b) => a.net - b.net)[0]
      : null;

  const expenseDaysAll = allDays.filter((d) => d.expense > 0);
  const highestSpendDay =
    expenseDaysAll.length > 0
      ? [...expenseDaysAll].sort((a, b) => b.expense - a.expense)[0]
      : null;

  const closedDaysPeriod = periodDays.filter((d) => d.income > 0);
  const periodBestDay =
    closedDaysPeriod.length > 0
      ? [...closedDaysPeriod].sort((a, b) => b.net - a.net || b.income - a.income)[0]
      : null;
  const periodLowestDay =
    closedDaysPeriod.length > 1
      ? [...closedDaysPeriod].sort((a, b) => a.net - b.net)[0]
      : null;

  // Weekday averages across closed days
  const weekdayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const wdMap = new Map<number, { sumNet: number; count: number }>();
  for (const d of profitPoolAll) {
    const wd = parseIsoDate(d.date).getDay();
    const prev = wdMap.get(wd) ?? { sumNet: 0, count: 0 };
    wdMap.set(wd, { sumNet: prev.sumNet + d.net, count: prev.count + 1 });
  }
  let bestWeekdayName: string | null = null;
  let bestWeekdayAvgNet = 0;
  for (const [wd, stats] of wdMap.entries()) {
    const avg = Math.round(stats.sumNet / stats.count);
    if (bestWeekdayName === null || avg > bestWeekdayAvgNet) {
      bestWeekdayName = weekdayNames[wd];
      bestWeekdayAvgNet = avg;
    }
  }

  // Averages across active scope
  const scopeDateSet = new Set(scope.map((t) => t.date));
  const scopeDaysCount = Math.max(1, scopeDateSet.size);
  const scopeTotals = sumTransactions(scope);
  const avgDailySpend = scope.length > 0 ? Math.round(scopeTotals.expense / scopeDaysCount) : 0;
  const avgDailySales = scope.length > 0 ? Math.round(scopeTotals.income / scopeDaysCount) : 0;
  const avgDailyProfit =
    scope.length > 0
      ? Math.round((scopeTotals.income - scopeTotals.expense) / scopeDaysCount)
      : 0;

  let kitchenAmt = 0;
  let utilStaffAmt = 0;
  let chickenKg = 0;
  let chickenSpendForQty = 0;
  let beefKg = 0;
  let beefSpendForQty = 0;
  let lpgCount = 0;
  let lpgSpendForQty = 0;

  for (const tx of scope) {
    if (tx.type !== 'expense') continue;
    if (FOOD_CATEGORIES.has(tx.category)) kitchenAmt += tx.amount;
    if (LABOR_FUEL_CATEGORIES.has(tx.category)) utilStaffAmt += tx.amount;
    const parsedQty = parseQuantityFromNotes(tx.notes || '');
    if (parsedQty.quantity && parsedQty.quantity > 0) {
      if (tx.category === 'Chicken' && parsedQty.unit === 'kg') {
        chickenKg += parsedQty.quantity;
        chickenSpendForQty += tx.amount;
      } else if (tx.category === 'Beef' && parsedQty.unit === 'kg') {
        beefKg += parsedQty.quantity;
        beefSpendForQty += tx.amount;
      } else if (tx.category === 'Gas' && parsedQty.unit === 'count') {
        lpgCount += parsedQty.quantity;
        lpgSpendForQty += tx.amount;
      }
    }
  }

  chickenKg = Math.round(chickenKg * 100) / 100;
  beefKg = Math.round(beefKg * 100) / 100;
  lpgCount = Math.round(lpgCount * 100) / 100;

  const chickenAvgRate = chickenKg > 0 ? Math.round(chickenSpendForQty / chickenKg) : 0;
  const beefAvgRate = beefKg > 0 ? Math.round(beefSpendForQty / beefKg) : 0;
  const lpgAvgRate = lpgCount > 0 ? Math.round(lpgSpendForQty / lpgCount) : 0;

  const kitchenSharePct =
    scopeTotals.expense > 0 ? Math.round((kitchenAmt / scopeTotals.expense) * 100) : 0;
  const utilitiesStaffSharePct =
    scopeTotals.expense > 0 ? Math.round((utilStaffAmt / scopeTotals.expense) * 100) : 0;

  const breakdown = computeCategoryBreakdown(scope);
  const topCat = breakdown[0] ?? null;

  // Build structured, zero-fluff point-wise insights
  const rawPoints: Array<Omit<StructuredInsightPoint, 'index'>> = [];

  if (scope.length === 0) {
    rawPoints.push({
      label: 'Period Status',
      detail: 'No expenditures or closing sales logged in this timeframe yet.',
      tone: 'neutral',
    });
  } else {
    const net = Math.round((scopeTotals.income - scopeTotals.expense) * 100) / 100;
    const marginPct =
      scopeTotals.income > 0 ? Math.round((net / scopeTotals.income) * 1000) / 10 : 0;

    // 1. Closing / Margin point
    if (scopeTotals.income === 0 && scopeTotals.expense > 0) {
      rawPoints.push({
        label: 'Closing Pending',
        detail: `Expenditure is ${formatCurrency(scopeTotals.expense, currency)}, with closing sales not entered yet. Enter Amount Left in Shop or Total Sales to calculate profit.`,
        tone: 'warning',
      });
    } else if (net >= 0) {
      rawPoints.push({
        label: 'Net Profit',
        detail: `Retained ${formatCurrency(net, currency)} (${marginPct}% margin) on ${formatCurrency(scopeTotals.income, currency)} sales after ${formatCurrency(scopeTotals.expense, currency)} expenditure.`,
        tone: 'positive',
      });
    } else {
      rawPoints.push({
        label: 'Operating Loss',
        detail: `Expenditure (${formatCurrency(scopeTotals.expense, currency)}) exceeded sales (${formatCurrency(scopeTotals.income, currency)}) by ${formatCurrency(Math.abs(net), currency)}.`,
        tone: 'warning',
      });
    }

    // 2. Top Spend & Cost Split
    if (topCat) {
      rawPoints.push({
        label: 'Cost Structure',
        detail: `${topCat.category} is the highest spend at ${formatCurrency(topCat.spent, currency)} (${topCat.sharePct}% share). Kitchen ingredients: ${kitchenSharePct}% | Fuel & staff: ${utilitiesStaffSharePct}%.`,
        tone: 'neutral',
      });
    }

    // 3. Period-over-Period Shift
    if (snapshot && (snapshot.expenseDeltaPct !== null || snapshot.incomeDeltaPct !== null)) {
      const unitWord =
        snapshot.granularity === 'day'
          ? 'day'
          : snapshot.granularity === 'week'
          ? 'week'
          : snapshot.granularity === 'month'
          ? 'month'
          : 'year';
      const parts: string[] = [];
      if (snapshot.expenseDeltaPct !== null) {
        parts.push(
          `Expenditure ${snapshot.expenseDeltaPct >= 0 ? 'up' : 'down'} ${Math.abs(snapshot.expenseDeltaPct)}%`
        );
      }
      if (snapshot.incomeDeltaPct !== null) {
        parts.push(
          `sales ${snapshot.incomeDeltaPct >= 0 ? 'up' : 'down'} ${Math.abs(snapshot.incomeDeltaPct)}%`
        );
      }
      const isFavorable =
        (snapshot.netDeltaPct !== null && snapshot.netDeltaPct > 0) ||
        (snapshot.expenseDeltaPct !== null && snapshot.expenseDeltaPct < 0);
      rawPoints.push({
        label: 'Period Comparison',
        detail: `${parts.join('; ')} vs. previous ${unitWord}.`,
        tone: isFavorable ? 'positive' : 'neutral',
      });
    }

    // 4. Stock & Average Unit Rates (only when kg/count logged)
    const stockNotes: string[] = [];
    if (chickenKg > 0) {
      stockNotes.push(`Chicken ${chickenKg} kg (avg ${formatCurrency(chickenAvgRate, currency)}/kg)`);
    }
    if (beefKg > 0) {
      stockNotes.push(`Beef ${beefKg} kg (avg ${formatCurrency(beefAvgRate, currency)}/kg)`);
    }
    if (lpgCount > 0) {
      stockNotes.push(`LPG ${lpgCount} count (avg ${formatCurrency(lpgAvgRate, currency)}/unit)`);
    }
    if (stockNotes.length > 0) {
      rawPoints.push({
        label: 'Stock & Unit Rates',
        detail: `${stockNotes.join(' · ')}.`,
        tone: 'neutral',
      });
    }

    // 5. Performance Benchmark
    if (snapshot?.granularity === 'day') {
      const allSpendAvg =
        expenseDaysAll.length > 0
          ? Math.round(
              expenseDaysAll.reduce((acc, d) => acc + d.expense, 0) / expenseDaysAll.length
            )
          : 0;
      if (allSpendAvg > 0 && expenseDaysAll.length > 1) {
        const diffPct = Math.round(((scopeTotals.expense - allSpendAvg) / allSpendAvg) * 100);
        const dir = diffPct === 0 ? 'in line with' : diffPct > 0 ? `${diffPct}% above` : `${Math.abs(diffPct)}% below`;
        rawPoints.push({
          label: 'Daily Benchmark',
          detail: `Day spend is ${dir} your ${expenseDaysAll.length}-day average (${formatCurrency(allSpendAvg, currency)}/day).${bestProfitDay ? ` Peak day overall: ${bestProfitDay.label} (${formatCurrency(bestProfitDay.net, currency, { signed: true })}).` : ''}`,
          tone: diffPct <= 0 ? 'positive' : 'neutral',
        });
      }
    } else if (periodBestDay) {
      const lowSuffix =
        periodLowestDay && periodLowestDay.date !== periodBestDay.date
          ? ` Lowest closed day: ${periodLowestDay.label} (${formatCurrency(periodLowestDay.net, currency, { signed: true })}).`
          : '';
      const wdSuffix =
        bestWeekdayName && closedDaysAll.length >= 3
          ? ` Strongest weekday overall: ${bestWeekdayName}.`
          : '';
      rawPoints.push({
        label: 'Peak Performance',
        detail: `Best day in period: ${periodBestDay.label} with ${formatCurrency(periodBestDay.net, currency, { signed: true })} left on ${formatCurrency(periodBestDay.income, currency)} sales.${lowSuffix}${wdSuffix}`,
        tone: periodBestDay.net >= 0 ? 'positive' : 'neutral',
      });
    }

    // 6. Pending Closing Reconciliation Alert
    if (periodUnclosedDates.length > 0 && !(snapshot?.granularity === 'day')) {
      const preview = periodUnclosedDates
        .slice(0, 3)
        .map((d) => formatShortDate(d))
        .join(', ');
      const extra =
        periodUnclosedDates.length > 3 ? ` +${periodUnclosedDates.length - 3} more` : '';
      rawPoints.push({
        label: 'Reconciliation',
        detail: `${periodUnclosedDates.length} ${periodUnclosedDates.length === 1 ? 'day needs' : 'days need'} closing sales (${preview}${extra}) for complete profit accuracy.`,
        tone: 'warning',
      });
    }
  }

  const structuredInsights: StructuredInsightPoint[] = rawPoints.map((pt, idx) => ({
    index: String(idx + 1).padStart(2, '0'),
    ...pt,
  }));

  return {
    bestProfitDay,
    periodBestDay,
    periodLowestDay,
    worstProfitDay,
    highestSpendDay,
    bestWeekdayName,
    bestWeekdayAvgNet,
    avgDailySpend,
    avgDailySales,
    avgDailyProfit,
    kitchenSharePct,
    utilitiesStaffSharePct,
    chickenKg,
    chickenAvgRate,
    beefKg,
    beefAvgRate,
    lpgCount,
    lpgAvgRate,
    unclosedDates,
    periodUnclosedDates,
    actionPlan: structuredInsights.map((i) => `${i.label}: ${i.detail}`),
    structuredInsights,
  };
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'INR',
  options?: { compact?: boolean; signed?: boolean }
): string {
  const abs = Math.abs(amount);
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: options?.compact && abs >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: abs % 1 === 0 ? 0 : 2,
  });

  const formatted = formatter.format(abs);
  if (amount < 0) return `-${formatted}`;
  if (options?.signed && amount > 0) return `+${formatted}`;
  return formatted;
}

export interface RecurringExpenseTemplate {
  key: string;
  title: string;
  category: CategoryName;
  lastAmount: number;
  lastDate: string;
  frequency: number;
  todayTx: Transaction | null;
}

export function computeRecurringTemplates(
  transactions: Transaction[],
  anchorDate: string,
  dismissedKeys: string[]
): RecurringExpenseTemplate[] {
  const dismissedSet = new Set(dismissedKeys);
  const priorMap = new Map<
    string,
    {
      title: string;
      category: CategoryName;
      lastAmount: number;
      lastDate: string;
      dates: Set<string>;
    }
  >();
  const todayMap = new Map<string, Transaction>();

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const cleanTitle = tx.title.trim();
    if (!cleanTitle) continue;
    const key = `${cleanTitle.toLowerCase()}::${tx.category}`;
    if (dismissedSet.has(key)) continue;

    if (tx.date === anchorDate) {
      if (!todayMap.has(key)) todayMap.set(key, tx);
      continue;
    }

    if (tx.date < anchorDate) {
      const existing = priorMap.get(key);
      if (!existing) {
        priorMap.set(key, {
          title: cleanTitle,
          category: tx.category,
          lastAmount: tx.amount,
          lastDate: tx.date,
          dates: new Set([tx.date]),
        });
      } else {
        existing.dates.add(tx.date);
        if (tx.date > existing.lastDate) {
          existing.lastDate = tx.date;
          existing.lastAmount = tx.amount;
          existing.title = cleanTitle;
        }
      }
    }
  }

  const list: RecurringExpenseTemplate[] = [];
  for (const [key, info] of priorMap.entries()) {
    list.push({
      key,
      title: info.title,
      category: info.category,
      lastAmount: info.lastAmount,
      lastDate: info.lastDate,
      frequency: info.dates.size,
      todayTx: todayMap.get(key) ?? null,
    });
  }

  return list.sort(
    (a, b) =>
      b.frequency - a.frequency ||
      b.lastDate.localeCompare(a.lastDate) ||
      a.title.localeCompare(b.title)
  );
}
