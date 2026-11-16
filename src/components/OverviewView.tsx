import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  CategoryName,
  CurrencyCode,
  EXPENSE_CATEGORIES,
  TimeGranularity,
  Transaction,
} from '../types/finance';
import {
  computeCategoryBreakdown,
  computeDailyComparisonBuckets,
  computeDailyComparisonRows,
  computePeriodSnapshot,
  computeRecurringTemplates,
  computeRestaurantAnalysis,
  filterTransactionsInRange,
  formatCurrency,
  RecurringExpenseTemplate,
  shiftAnchorDate,
  toIsoDate,
} from '../utils/analytics';
import { exportStructuredPdfReport } from '../utils/pdfReport';
import {
  buildNotesWithQuantity,
  formatQuantityLabel,
  getCategoryUnitMode,
  predictCategoryAndType,
} from '../utils/categorizer';
import { CashflowBarChart, CategoryDonutChart, NetCumulativeChart } from './Charts';
import { DailyQuickFill } from './DailyQuickFill';
import { NewTransactionInput } from '../hooks/useFinanceStore';

interface OverviewViewProps {
  transactions: Transaction[];
  currency: CurrencyCode;
  granularity: TimeGranularity;
  anchorDate: string;
  dismissedTemplates: string[];
  onChangeGranularity: (g: TimeGranularity) => void;
  onChangeAnchorDate: (iso: string) => void;
  onQuickAddExpense: (input: NewTransactionInput) => Promise<string>;
  onUpdateExpense: (id: string, input: NewTransactionInput) => Promise<void>;
  onSetDailyAmountLeft: (date: string, amountLeft: number | null) => Promise<void>;
  onSetDailyTotalSales: (date: string, totalSales: number | null) => Promise<void>;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => Promise<void>;
  onDismissTemplate: (key: string) => void;
  onNavigateEntries: (categoryFilter?: CategoryName) => void;
  onExportSuccess?: (reportLabel: string) => void;
}

const GRANULARITY_LABELS: Record<TimeGranularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
};

const PREV_HINT: Record<TimeGranularity, string> = {
  day: 'vs prev day',
  week: 'vs prev week',
  month: 'vs prev month',
  year: 'vs prev year',
};

function DeltaIndicator({
  deltaPct,
  hint,
  invertGood,
}: {
  deltaPct: number | null;
  hint: string;
  invertGood?: boolean;
}) {
  if (deltaPct === null) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500">
        No prior baseline
      </span>
    );
  }
  const isUp = deltaPct > 0;
  const isFlat = deltaPct === 0;
  const isGood = invertGood ? deltaPct <= 0 : deltaPct >= 0;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${
        isFlat
          ? 'text-slate-500 dark:text-slate-400'
          : isGood
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {!isFlat &&
        (isUp ? (
          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
        ))}
      <span>
        {deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`} {hint}
      </span>
    </span>
  );
}

export function OverviewView({
  transactions,
  currency,
  granularity,
  anchorDate,
  dismissedTemplates,
  onChangeGranularity,
  onChangeAnchorDate,
  onQuickAddExpense,
  onUpdateExpense,
  onSetDailyAmountLeft,
  onSetDailyTotalSales,
  onEditTransaction,
  onDeleteTransaction,
  onDismissTemplate,
  onNavigateEntries,
  onExportSuccess,
}: OverviewViewProps) {
  const todayIso = toIsoDate(new Date());

  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expQty, setExpQty] = useState('');
  const [expCategory, setExpCategory] = useState<CategoryName>('Vegetables');
  const [expCategoryLocked, setExpCategoryLocked] = useState(false);
  const [expAutoDetected, setExpAutoDetected] = useState(false);
  const [expSaving, setExpSaving] = useState(false);
  const expTitleInputRef = useRef<HTMLInputElement | null>(null);

  const expUnitMode = getCategoryUnitMode(expCategory, expTitle);

  const [chartMode, setChartMode] = useState<'bars' | 'curve'>('bars');

  const [editingCashLeft, setEditingCashLeft] = useState(false);
  const [cashLeftInput, setCashLeftInput] = useState('');

  const [editingTotalSales, setEditingTotalSales] = useState(false);
  const [totalSalesInput, setTotalSalesInput] = useState('');

  const [savingClosing, setSavingClosing] = useState(false);
  const pendingEditRef = useRef<'cashLeft' | 'totalSales' | null>(null);

  const dayCurrentExpense = useMemo(() => {
    return transactions
      .filter((tx) => tx.date === anchorDate && tx.type === 'expense')
      .reduce((acc, tx) => acc + tx.amount, 0);
  }, [transactions, anchorDate]);

  const dayCurrentSales = useMemo(() => {
    return transactions
      .filter((tx) => tx.date === anchorDate && tx.type === 'income')
      .reduce((acc, tx) => acc + tx.amount, 0);
  }, [transactions, anchorDate]);

  const hasDayClosingSales = dayCurrentSales > 0;
  const dayCurrentCashLeft = Math.round((dayCurrentSales - dayCurrentExpense) * 100) / 100;

  useEffect(() => {
    const pending = pendingEditRef.current;
    pendingEditRef.current = null;
    setEditingCashLeft(pending === 'cashLeft');
    setEditingTotalSales(pending === 'totalSales');
    setCashLeftInput(hasDayClosingSales ? String(Math.max(0, dayCurrentCashLeft)) : '');
    setTotalSalesInput(hasDayClosingSales ? String(dayCurrentSales) : '');
  }, [anchorDate, hasDayClosingSales, dayCurrentCashLeft, dayCurrentSales]);

  const handleExpenseTitleChange = (val: string) => {
    setExpTitle(val);
    if (!expCategoryLocked) {
      const pred = predictCategoryAndType(val);
      if (pred.confidence === 'high' && pred.type === 'expense') {
        setExpCategory(pred.category);
        setExpAutoDetected(true);
      } else {
        setExpAutoDetected(false);
      }
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(expAmount);
    if (!expTitle.trim() || !Number.isFinite(num) || num <= 0) return;
    const numQty = Number(expQty);
    const compiledNotes = buildNotesWithQuantity(
      Number.isFinite(numQty) && numQty > 0 ? numQty : null,
      expUnitMode
    );
    setExpSaving(true);
    try {
      const now = new Date();
      await onQuickAddExpense({
        title: expTitle.trim(),
        amount: num,
        type: 'expense',
        category: expCategory,
        date: anchorDate,
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        notes: compiledNotes,
        autoCategorized: expAutoDetected,
      });
      setExpTitle('');
      setExpAmount('');
      setExpQty('');
      setExpCategoryLocked(false);
      setExpAutoDetected(false);
    } finally {
      setExpSaving(false);
    }
  };

  const handleSaveCashLeft = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(cashLeftInput || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSavingClosing(true);
    try {
      await onSetDailyAmountLeft(anchorDate, parsed);
      setEditingCashLeft(false);
    } finally {
      setSavingClosing(false);
    }
  };

  const handleSaveTotalSales = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(totalSalesInput || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setSavingClosing(true);
    try {
      await onSetDailyTotalSales(anchorDate, parsed);
      setEditingTotalSales(false);
    } finally {
      setSavingClosing(false);
    }
  };

  const handleClearClosing = async (targetDate: string) => {
    setSavingClosing(true);
    try {
      await onSetDailyAmountLeft(targetDate, null);
      if (targetDate === anchorDate) {
        setEditingCashLeft(false);
        setEditingTotalSales(false);
        setCashLeftInput('');
        setTotalSalesInput('');
      }
    } finally {
      setSavingClosing(false);
    }
  };

  const snapshot = useMemo(
    () => computePeriodSnapshot(transactions, granularity, anchorDate),
    [transactions, granularity, anchorDate]
  );

  const chartBuckets = useMemo(() => {
    if (granularity === 'day') {
      return computeDailyComparisonBuckets(transactions, anchorDate, 10);
    }
    return snapshot.buckets;
  }, [granularity, transactions, anchorDate, snapshot.buckets]);

  const dailyRows = useMemo(
    () => computeDailyComparisonRows(transactions, anchorDate, 7),
    [transactions, anchorDate]
  );

  const periodTxs = useMemo(
    () => filterTransactionsInRange(transactions, snapshot.rangeStart, snapshot.rangeEnd),
    [transactions, snapshot.rangeStart, snapshot.rangeEnd]
  );

  const periodExpenses = useMemo(
    () => periodTxs.filter((tx) => tx.type === 'expense'),
    [periodTxs]
  );

  const categoryBreakdown = useMemo(
    () => computeCategoryBreakdown(periodTxs),
    [periodTxs]
  );

  const analysis = useMemo(
    () => computeRestaurantAnalysis(transactions, periodTxs, currency, snapshot),
    [transactions, periodTxs, currency, snapshot]
  );

  const recurringTemplates = useMemo(
    () => computeRecurringTemplates(transactions, anchorDate, dismissedTemplates),
    [transactions, anchorDate, dismissedTemplates]
  );

  const handleAutoSaveTemplate = async (
    template: RecurringExpenseTemplate,
    amount: number,
    notes: string,
    existingTxId?: string
  ): Promise<string> => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const payload: NewTransactionInput = {
      title: template.title,
      amount,
      type: 'expense',
      category: template.category,
      date: anchorDate,
      time: template.todayTx?.time || hhmm,
      notes,
      autoCategorized: false,
    };

    if (existingTxId) {
      await onUpdateExpense(existingTxId, payload);
      return existingTxId;
    }
    return onQuickAddExpense(payload);
  };

  const previewCashLeftNum = Number(cashLeftInput || 0);
  const previewTotalSalesFromCashLeft =
    dayCurrentExpense +
    (Number.isFinite(previewCashLeftNum) && previewCashLeftNum > 0
      ? previewCashLeftNum
      : 0);

  const previewSalesNum = Number(totalSalesInput || 0);
  const previewCashLeftFromSales =
    (Number.isFinite(previewSalesNum) ? previewSalesNum : 0) - dayCurrentExpense;

  const handleDownloadPdf = () => {
    const label = exportStructuredPdfReport({
      transactions,
      granularity,
      anchorDate,
      currency,
    });
    onExportSuccess?.(label);
  };

  return (
    <div className="space-y-5">
      {/* Row 1: Period Selector + Quick Expenditure Entry */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Timeframe
            </span>
            <div className="flex items-center gap-3">
              {anchorDate !== todayIso && (
                <button
                  type="button"
                  onClick={() => onChangeAnchorDate(todayIso)}
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
                >
                  Today
                </button>
              )}
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                title={`Download structured ${GRANULARITY_LABELS[granularity]} PDF report`}
              >
                <FileDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{GRANULARITY_LABELS[granularity]} PDF</span>
              </button>
            </div>
          </div>

          <div
            className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl"
            role="tablist"
            aria-label="Timeframe"
          >
            {(['day', 'week', 'month', 'year'] as TimeGranularity[]).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={granularity === g}
                onClick={() => onChangeGranularity(g)}
                className={`min-h-[38px] px-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  granularity === g
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                onChangeAnchorDate(shiftAnchorDate(anchorDate, granularity, -1))
              }
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Previous period"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {granularity === 'day' ? (
              <div className="flex-1 min-w-0 flex justify-center">
                <input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => e.target.value && onChangeAnchorDate(e.target.value)}
                  aria-label="Select date"
                  className="w-full max-w-[185px] min-h-[40px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm font-semibold font-mono-tabular text-slate-900 dark:text-white text-center"
                />
              </div>
            ) : (
              <span className="text-sm font-semibold text-slate-900 dark:text-white text-center truncate">
                {snapshot.periodLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                onChangeAnchorDate(shiftAnchorDate(anchorDate, granularity, 1))
              }
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
              aria-label="Next period"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <form
          onSubmit={handleExpenseSubmit}
          className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              Add New Expenditure
            </span>
            <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
              {anchorDate === todayIso ? 'Today' : anchorDate}
            </span>
          </div>

          <div
            className={`grid ${
              expUnitMode !== 'bill'
                ? 'grid-cols-2 sm:grid-cols-[1fr_92px_120px_185px]'
                : 'grid-cols-1 sm:grid-cols-[1fr_130px_200px]'
            } gap-2.5`}
          >
            <input
              ref={expTitleInputRef}
              type="text"
              value={expTitle}
              onChange={(e) => handleExpenseTitleChange(e.target.value)}
              maxLength={120}
              placeholder="New item or bill (e.g., Chicken, Beef, LPG, Vegetables)"
              className={`${
                expUnitMode !== 'bill' ? 'col-span-2 sm:col-span-1' : ''
              } min-h-[44px] min-w-0 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300`}
              required
            />
            {expUnitMode !== 'bill' && (
              <input
                type="number"
                step={expUnitMode === 'kg' ? '0.1' : '1'}
                min="0"
                value={expQty}
                onChange={(e) => setExpQty(e.target.value)}
                placeholder={expUnitMode === 'kg' ? 'kg' : 'Count'}
                aria-label={expUnitMode === 'kg' ? 'Weight in kg' : 'Count'}
                className="min-h-[44px] min-w-0 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
              />
            )}
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              placeholder={currency === 'INR' ? '₹ Amount' : '$ Amount'}
              className="min-h-[44px] min-w-0 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
              required
            />
            <select
              value={expCategory}
              onChange={(e) => {
                setExpCategory(e.target.value as CategoryName);
                setExpCategoryLocked(true);
                setExpAutoDetected(false);
              }}
              aria-label="Expense category"
              className={`${
                expUnitMode !== 'bill' ? 'col-span-2 sm:col-span-1' : ''
              } min-h-[44px] min-w-0 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200`}
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {expAutoDetected
                ? `Auto-selected: ${expCategory}`
                : 'Items logged carry forward to future days for quick amount entry'}
            </span>
            <button
              type="submit"
              disabled={expSaving}
              className="min-h-[42px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {expSaving ? 'Adding...' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>

      {/* Daily Quick-Fill Sheet (auto-carries previous expenditures; enter amount to auto-save) */}
      {granularity === 'day' && recurringTemplates.length > 0 && (
        <DailyQuickFill
          anchorDate={anchorDate}
          todayIso={todayIso}
          currency={currency}
          templates={recurringTemplates}
          onAutoSaveAmount={handleAutoSaveTemplate}
          onDeleteSavedItem={onDeleteTransaction}
          onDismissTemplate={onDismissTemplate}
          onAddNewExpenditure={() => {
            expTitleInputRef.current?.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      {/* Row 2: 4 Balanced KPI Cards (2x2 on mobile, 4-col on desktop) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Expenditure */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-t-2 border-t-slate-800 dark:border-t-slate-300 rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Total Expenditure
            </span>
            <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
          </div>
          <p className="mt-2 text-lg sm:text-2xl font-bold tracking-tight font-mono-tabular text-slate-900 dark:text-white truncate">
            {formatCurrency(snapshot.expense, currency)}
          </p>
          <div className="mt-2 sm:mt-2.5 flex items-center justify-between gap-1.5">
            <DeltaIndicator
              deltaPct={snapshot.expenseDeltaPct}
              hint={PREV_HINT[granularity]}
              invertGood
            />
            <span className="hidden sm:inline text-[11px] font-mono-tabular text-slate-400 dark:text-slate-500 shrink-0">
              {snapshot.transactionCount} items
            </span>
          </div>
        </div>

        {/* Card 2: Amount Left in Shop (Edit & Delete directly accessible) */}
        <div
          className={`${
            editingCashLeft ? 'col-span-2 sm:col-span-1' : ''
          } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-t-2 rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between min-w-0 ${
            snapshot.netProfit >= 0
              ? 'border-t-emerald-600 dark:border-t-emerald-500'
              : 'border-t-rose-600 dark:border-t-rose-500'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Left in Shop
            </span>
            {!editingCashLeft && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTotalSales(false);
                    setEditingCashLeft(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
                  title={`Edit amount left in shop for ${anchorDate}`}
                >
                  <Pencil className="w-3 h-3" />
                  <span>{hasDayClosingSales ? 'Edit' : 'Set'}</span>
                </button>
                {hasDayClosingSales && (
                  <button
                    type="button"
                    disabled={savingClosing}
                    onClick={() => handleClearClosing(anchorDate)}
                    className="inline-flex items-center text-slate-400 hover:text-rose-600"
                    title={`Delete closing entry for ${anchorDate}`}
                    aria-label={`Delete closing entry for ${anchorDate}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {editingCashLeft ? (
            <form onSubmit={handleSaveCashLeft} className="mt-2 space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={cashLeftInput}
                  onChange={(e) => setCashLeftInput(e.target.value)}
                  placeholder="Cash left"
                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={savingClosing}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0"
                  aria-label="Save amount left in shop"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCashLeft(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 shrink-0"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                Total Sales = {formatCurrency(previewTotalSalesFromCashLeft, currency)}
              </p>
            </form>
          ) : (
            <>
              <p
                className={`mt-2 text-lg sm:text-2xl font-bold tracking-tight font-mono-tabular truncate ${
                  snapshot.netProfit >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(snapshot.netProfit, currency, { signed: true })}
              </p>
              <div className="mt-2 sm:mt-2.5 flex items-center justify-between gap-1.5">
                <DeltaIndicator
                  deltaPct={snapshot.netDeltaPct}
                  hint={PREV_HINT[granularity]}
                />
                <span className="hidden sm:inline text-[11px] font-mono-tabular text-slate-400 dark:text-slate-500 shrink-0">
                  {snapshot.profitMarginPct}%
                </span>
              </div>
            </>
          )}
        </div>

        {/* Card 3: Total Sales (Edit & Delete directly accessible) */}
        <div
          className={`${
            editingTotalSales ? 'col-span-2 sm:col-span-1' : ''
          } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-t-2 border-t-sky-600 dark:border-t-sky-400 rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between min-w-0`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Total Sales
            </span>
            {!editingTotalSales && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCashLeft(false);
                    setEditingTotalSales(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
                  title={`Edit total sales for ${anchorDate}`}
                >
                  <Pencil className="w-3 h-3" />
                  <span>{hasDayClosingSales ? 'Edit' : 'Set'}</span>
                </button>
                {hasDayClosingSales && (
                  <button
                    type="button"
                    disabled={savingClosing}
                    onClick={() => handleClearClosing(anchorDate)}
                    className="inline-flex items-center text-slate-400 hover:text-rose-600"
                    title={`Delete total sales entry for ${anchorDate}`}
                    aria-label={`Delete total sales entry for ${anchorDate}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {editingTotalSales ? (
            <form onSubmit={handleSaveTotalSales} className="mt-2 space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={totalSalesInput}
                  onChange={(e) => setTotalSalesInput(e.target.value)}
                  placeholder="Total sales"
                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                  autoFocus
                  required
                />
                <button
                  type="submit"
                  disabled={savingClosing}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0"
                  aria-label="Save total sales"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTotalSales(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 shrink-0"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                Left in Shop ={' '}
                <span
                  className={
                    previewCashLeftFromSales >= 0
                      ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : 'font-semibold text-rose-600 dark:text-rose-400'
                  }
                >
                  {formatCurrency(previewCashLeftFromSales, currency, { signed: true })}
                </span>
              </p>
            </form>
          ) : (
            <>
              <p className="mt-2 text-lg sm:text-2xl font-bold tracking-tight font-mono-tabular text-slate-900 dark:text-white truncate">
                {formatCurrency(snapshot.income, currency)}
              </p>
              <div className="mt-2 sm:mt-2.5 flex items-center justify-between gap-1.5">
                <DeltaIndicator
                  deltaPct={snapshot.incomeDeltaPct}
                  hint={PREV_HINT[granularity]}
                />
                <span className="hidden sm:inline text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  Exp + Left
                </span>
              </div>
            </>
          )}
        </div>

        {/* Card 4: Highest Profit Date */}
        <button
          type="button"
          onClick={() => {
            if (analysis.bestProfitDay) {
              onChangeGranularity('day');
              onChangeAnchorDate(analysis.bestProfitDay.date);
            }
          }}
          disabled={!analysis.bestProfitDay}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-t-2 border-t-amber-500 dark:border-t-amber-400 rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors disabled:cursor-default min-w-0"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Best Profit Date
            </span>
            {analysis.bestProfitDay ? (
              <span className="text-[11px] font-mono-tabular text-emerald-700 dark:text-emerald-400 font-semibold shrink-0">
                {formatCurrency(analysis.bestProfitDay.net, currency, { signed: true })}
              </span>
            ) : (
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
            )}
          </div>
          <p className="mt-2 text-sm sm:text-xl font-bold text-slate-900 dark:text-white truncate">
            {analysis.bestProfitDay ? analysis.bestProfitDay.label : 'No closing yet'}
          </p>
          <div className="mt-2 sm:mt-2.5 text-[11px] sm:text-xs font-mono-tabular text-slate-500 dark:text-slate-400 truncate">
            {analysis.bestProfitDay
              ? `Sales ${formatCurrency(analysis.bestProfitDay.income, currency)}`
              : 'Set cash left or sales'}
          </div>
        </button>
      </div>

      {/* Row 3: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {granularity === 'day'
                  ? '10-Day Sales vs. Expenditure'
                  : `${GRANULARITY_LABELS[granularity]} Sales vs. Expenditure`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Compare expenditure, cash left, and total sales
              </p>
            </div>

            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setChartMode('bars')}
                className={`min-h-[34px] px-3 text-xs font-medium rounded-lg whitespace-nowrap ${
                  chartMode === 'bars'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Bars
              </button>
              <button
                type="button"
                onClick={() => setChartMode('curve')}
                className={`min-h-[34px] px-3 text-xs font-medium rounded-lg whitespace-nowrap ${
                  chartMode === 'curve'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Profit Trend
              </button>
            </div>
          </div>

          {chartMode === 'bars' ? (
            <CashflowBarChart buckets={chartBuckets} currency={currency} />
          ) : (
            <NetCumulativeChart buckets={chartBuckets} currency={currency} />
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Expenditure by Category
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {snapshot.periodLabel}
            </p>
          </div>
          <CategoryDonutChart
            items={categoryBreakdown}
            totalExpense={snapshot.expense}
            currency={currency}
            onDrilldownCategory={(cat) => onNavigateEntries(cat)}
          />
        </div>
      </div>

      {/* Row 4: Daily Comparison & Logged Expenditures */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Daily Comparison
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tap a day to inspect, or edit Cash Left / Total Sales directly
              </p>
            </div>

            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto -mx-2 px-2">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-2">Day</th>
                    <th className="py-2.5 px-2 text-right">Expenditure</th>
                    <th className="py-2.5 px-2 text-right">Left in Shop</th>
                    <th className="py-2.5 px-2 text-right">Total Sales</th>
                    <th className="py-2.5 pl-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {dailyRows.map((row) => {
                    const isSelected = row.date === anchorDate;
                    const hasClosing = row.income > 0;
                    const isPeakDay =
                      analysis.bestProfitDay?.date === row.date && row.netProfit > 0;
                    return (
                      <tr
                        key={row.date}
                        onClick={() => {
                          onChangeGranularity('day');
                          onChangeAnchorDate(row.date);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-slate-50 dark:bg-slate-800/60'
                            : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2.5 pr-2 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{row.label}</span>
                            {isSelected && (
                              <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                Active
                              </span>
                            )}
                            {isPeakDay && (
                              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                Peak
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-normal text-slate-400 font-mono-tabular">
                            {row.date}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-900 dark:text-white font-medium whitespace-nowrap">
                          {formatCurrency(row.expense, currency)}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                            row.netProfit >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatCurrency(row.netProfit, currency, {
                            signed: true,
                          })}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatCurrency(row.income, currency)}
                        </td>
                        <td
                          className="py-2.5 pl-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                pendingEditRef.current = 'totalSales';
                                onChangeGranularity('day');
                                onChangeAnchorDate(row.date);
                                setEditingCashLeft(false);
                                setEditingTotalSales(true);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
                              title={`Edit Total Sales for ${row.date}`}
                              aria-label={`Edit Total Sales for ${row.date}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {hasClosing && (
                              <button
                                type="button"
                                onClick={() => handleClearClosing(row.date)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600"
                                title={`Delete closing for ${row.date}`}
                                aria-label={`Delete closing for ${row.date}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List (zero horizontal scrolling) */}
            <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {dailyRows.map((row) => {
                const isSelected = row.date === anchorDate;
                const hasClosing = row.income > 0;
                const isPeakDay =
                  analysis.bestProfitDay?.date === row.date && row.netProfit > 0;
                return (
                  <div
                    key={row.date}
                    onClick={() => {
                      onChangeGranularity('day');
                      onChangeAnchorDate(row.date);
                    }}
                    className={`py-3 flex items-center justify-between gap-2 rounded-lg px-2 -mx-2 cursor-pointer ${
                      isSelected ? 'bg-slate-50 dark:bg-slate-800/60' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                        <span className="truncate">{row.label}</span>
                        {isSelected && (
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                            Active
                          </span>
                        )}
                        {isPeakDay && (
                          <span className="text-[10px] text-amber-700 dark:text-amber-400">
                            Peak
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        Exp {formatCurrency(row.expense, currency)} · Sales{' '}
                        {formatCurrency(row.income, currency)}
                      </p>
                    </div>
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={`text-xs font-mono-tabular font-semibold mr-1 ${
                          row.netProfit >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(row.netProfit, currency, { signed: true })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          pendingEditRef.current = 'totalSales';
                          onChangeGranularity('day');
                          onChangeAnchorDate(row.date);
                          setEditingCashLeft(false);
                          setEditingTotalSales(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        aria-label={`Edit Total Sales for ${row.date}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {hasClosing && (
                        <button
                          type="button"
                          onClick={() => handleClearClosing(row.date)}
                          className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600"
                          aria-label={`Delete closing for ${row.date}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Logged Expenditures
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {snapshot.periodLabel} · {periodExpenses.length} items
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateEntries()}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
              >
                View all
              </button>
            </div>

            {periodExpenses.length === 0 ? (
              <p className="py-10 text-sm text-slate-500 dark:text-slate-400 text-center">
                No expenditures logged for {snapshot.periodLabel} yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {periodExpenses.slice(0, 6).map((tx) => {
                  const qtyLabel = formatQuantityLabel(tx.notes);
                  return (
                    <div
                      key={tx.id}
                      className="py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onEditTransaction(tx)}
                        className="min-w-0 flex-1 text-left min-h-[44px] flex flex-col justify-center"
                      >
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {tx.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {tx.category}
                          {qtyLabel ? ` · ${qtyLabel}` : ''} · {tx.date}
                        </p>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-sm font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 mr-1">
                          -{formatCurrency(tx.amount, currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onEditTransaction(tx)}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
                          aria-label={`Edit ${tx.title}`}
                          title={`Edit ${tx.title}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTransaction(tx.id)}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600"
                          aria-label={`Delete ${tx.title}`}
                          title={`Delete ${tx.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 5: Structured Point-Wise Key Insights & Analysis */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Key Insights &amp; Analysis
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Avg Spend {formatCurrency(analysis.avgDailySpend, currency)}/day · Avg Left{' '}
              {formatCurrency(analysis.avgDailyProfit, currency, { signed: true })}/day ·{' '}
              Kitchen {analysis.kitchenSharePct}% / Fuel &amp; Staff{' '}
              {analysis.utilitiesStaffSharePct}%
              {(analysis.chickenKg > 0 || analysis.beefKg > 0 || analysis.lpgCount > 0) && (
                <>
                  {' '}
                  · Stock:{' '}
                  {[
                    analysis.chickenKg > 0 ? `Chicken ${analysis.chickenKg} kg` : '',
                    analysis.beefKg > 0 ? `Beef ${analysis.beefKg} kg` : '',
                    analysis.lpgCount > 0 ? `LPG ${analysis.lpgCount} count` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </>
              )}
            </p>
          </div>
          {analysis.unclosedDates.length > 0 && (
            <button
              type="button"
              onClick={() => {
                pendingEditRef.current = 'totalSales';
                onChangeGranularity('day');
                onChangeAnchorDate(analysis.unclosedDates[0]);
                setEditingCashLeft(false);
                setEditingTotalSales(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="min-h-[36px] text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
            >
              Set sales for {analysis.unclosedDates[0]}
            </button>
          )}
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
          {analysis.structuredInsights.map((pt) => (
            <li
              key={pt.index}
              className="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800/80"
            >
              <span className="text-xs font-mono-tabular font-semibold text-slate-400 dark:text-slate-500 pt-0.5 shrink-0">
                {pt.index}.
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-xs font-semibold ${
                    pt.tone === 'positive'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : pt.tone === 'warning'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {pt.label}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">
                  {pt.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
