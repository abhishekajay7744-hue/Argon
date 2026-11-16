import React, { useEffect, useMemo, useState } from 'react';
import {
  FileDown,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  CategoryName,
  CurrencyCode,
  EXPENSE_CATEGORIES,
  Transaction,
} from '../types/finance';
import {
  formatCurrency,
  getPeriodBounds,
  toIsoDate,
} from '../utils/analytics';
import { formatQuantityLabel } from '../utils/categorizer';
import { exportLedgerPdfReport } from '../utils/pdfReport';

type DateRangePreset = 'all' | 'today' | 'week' | 'month';
type EntryTypeFilter = 'expense' | 'income' | 'all';

interface TransactionsViewProps {
  transactions: Transaction[];
  currency: CurrencyCode;
  anchorDate: string;
  initialCategoryFilter?: CategoryName | 'all';
  onClearInitialCategory?: () => void;
  onOpenNewEntry: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => Promise<void>;
}

export function TransactionsView({
  transactions,
  currency,
  anchorDate,
  initialCategoryFilter = 'all',
  onClearInitialCategory,
  onOpenNewEntry,
  onEditTransaction,
  onDeleteTransaction,
}: TransactionsViewProps) {
  const [search, setSearch] = useState('');
  const [entryType, setEntryType] = useState<EntryTypeFilter>('expense');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CategoryName>(
    initialCategoryFilter
  );
  const [dateRange, setDateRange] = useState<DateRangePreset>('all');

  useEffect(() => {
    setCategoryFilter(initialCategoryFilter);
    if (initialCategoryFilter !== 'all') {
      setEntryType(
        initialCategoryFilter === 'Daily Total Sales' ? 'income' : 'expense'
      );
    }
  }, [initialCategoryFilter]);

  const rangeBounds = useMemo(() => {
    const today = toIsoDate(new Date());
    if (dateRange === 'today') return { start: today, end: today };
    if (dateRange === 'week') return getPeriodBounds(anchorDate, 'week');
    if (dateRange === 'month') return getPeriodBounds(anchorDate, 'month');
    return null;
  }, [dateRange, anchorDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (entryType !== 'all' && tx.type !== entryType) return false;
      if (categoryFilter !== 'all' && tx.category !== categoryFilter) return false;
      if (rangeBounds && (tx.date < rangeBounds.start || tx.date > rangeBounds.end)) {
        return false;
      }
      if (
        q &&
        !tx.title.toLowerCase().includes(q) &&
        !tx.category.toLowerCase().includes(q) &&
        !(tx.notes || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [transactions, entryType, search, categoryFilter, rangeBounds]);

  const summaryTotals = useMemo(() => {
    let expenses = 0;
    let sales = 0;
    for (const tx of filtered) {
      if (tx.type === 'income') sales += tx.amount;
      else expenses += tx.amount;
    }
    return { expenses, sales, net: sales - expenses };
  }, [filtered]);

  const handleCategoryChange = (val: 'all' | CategoryName) => {
    setCategoryFilter(val);
    if (val === 'all') {
      onClearInitialCategory?.();
    } else if (val === 'Daily Total Sales') {
      setEntryType('income');
    } else if (entryType === 'income') {
      setEntryType('expense');
    }
  };

  const handleEntryTypeChange = (next: EntryTypeFilter) => {
    setEntryType(next);
    if (next === 'income' && categoryFilter !== 'all' && categoryFilter !== 'Daily Total Sales') {
      setCategoryFilter('all');
      onClearInitialCategory?.();
    } else if (next === 'expense' && categoryFilter === 'Daily Total Sales') {
      setCategoryFilter('all');
      onClearInitialCategory?.();
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vegetables, chicken, gas, staff, closing..."
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) =>
                handleCategoryChange(e.target.value as 'all' | CategoryName)
              }
              aria-label="Filter by category"
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Categories</option>
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              {entryType !== 'expense' && (
                <option value="Daily Total Sales">Daily Total Sales</option>
              )}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                exportLedgerPdfReport({
                  transactions: filtered,
                  filterLabel: `${entryType === 'all' ? 'All Entries' : entryType === 'income' ? 'Closing Sales' : 'Expenses'} · ${dateRange === 'all' ? 'All Time' : dateRange}`,
                  currency,
                })
              }
              disabled={filtered.length === 0}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>

            <button
              type="button"
              onClick={onOpenNewEntry}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Expense</span>
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {(
                [
                  ['expense', 'Expenses'],
                  ['income', 'Closing Sales'],
                  ['all', 'All'],
                ] as Array<[EntryTypeFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleEntryTypeChange(key)}
                  className={`min-h-[32px] px-3 text-xs font-medium rounded-lg whitespace-nowrap ${
                    entryType === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {(
                [
                  ['all', 'All Time'],
                  ['today', 'Today'],
                  ['week', 'Week'],
                  ['month', 'Month'],
                ] as Array<[DateRangePreset, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDateRange(key)}
                  className={`min-h-[32px] px-3 text-xs font-medium rounded-lg whitespace-nowrap ${
                    dateRange === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
            </span>
            {entryType === 'expense' && (
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                Total: {formatCurrency(summaryTotals.expenses, currency)}
              </span>
            )}
            {entryType === 'income' && (
              <span className="font-mono-tabular font-semibold text-emerald-600 dark:text-emerald-400">
                Total Sales: {formatCurrency(summaryTotals.sales, currency)}
              </span>
            )}
            {entryType === 'all' && (
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                Sales {formatCurrency(summaryTotals.sales, currency)} · Spend{' '}
                {formatCurrency(summaryTotals.expenses, currency)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {transactions.length === 0
                ? 'No entries logged yet. Click Add Expense to record your first item.'
                : 'No entries match your active filter.'}
            </p>
            {transactions.length === 0 && (
              <button
                type="button"
                onClick={onOpenNewEntry}
                className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Expense</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4">Date &amp; Time</th>
                    <th className="py-3 px-4">Item / Bill</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {filtered.map((tx) => {
                    const isIncome = tx.type === 'income';
                    const qtyLabel = !isIncome ? formatQuantityLabel(tx.notes) : null;
                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {tx.date} · {tx.time}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {tx.title}
                            {qtyLabel && (
                              <span className="ml-2 text-xs font-mono-tabular font-normal text-slate-500 dark:text-slate-400">
                                ({qtyLabel})
                              </span>
                            )}
                          </div>
                          {tx.notes && !qtyLabel && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                              {tx.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {tx.category}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {isIncome ? '+' : '-'}
                          {formatCurrency(tx.amount, currency)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditTransaction(tx)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                              aria-label={`Edit ${tx.title}`}
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteTransaction(tx.id)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              aria-label={`Delete ${tx.title}`}
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((tx) => {
                const isIncome = tx.type === 'income';
                const qtyLabel = !isIncome ? formatQuantityLabel(tx.notes) : null;
                return (
                  <div
                    key={tx.id}
                    className="p-4 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => onEditTransaction(tx)}
                      className="flex-1 min-w-0 text-left min-h-[44px] flex flex-col justify-center"
                    >
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {tx.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {tx.category}
                        {qtyLabel ? ` · ${qtyLabel}` : ''} · {tx.date}
                      </p>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <span
                        className={`text-sm font-mono-tabular font-semibold mr-1 ${
                          isIncome
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {isIncome ? '+' : '-'}
                        {formatCurrency(tx.amount, currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onEditTransaction(tx)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        aria-label={`Edit ${tx.title}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTransaction(tx.id)}
                        className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600"
                        aria-label={`Delete ${tx.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
