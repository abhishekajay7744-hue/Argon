import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, Trash2, X } from 'lucide-react';
import {
  CategoryName,
  CurrencyCode,
  EXPENSE_CATEGORIES,
  Transaction,
} from '../types/finance';
import {
  buildNotesWithQuantity,
  getCategoryUnitMode,
  parseQuantityFromNotes,
  predictCategoryAndType,
} from '../utils/categorizer';
import { toIsoDate } from '../utils/analytics';
import { NewTransactionInput } from '../hooks/useFinanceStore';

interface EntrySheetModalProps {
  open: boolean;
  defaultDate?: string;
  currency?: CurrencyCode;
  editingTransaction?: Transaction | null;
  onClose: () => void;
  onSaveTransaction: (input: NewTransactionInput, editId?: string) => Promise<void>;
  onDeleteTransaction?: (id: string) => Promise<void>;
}

export function EntrySheetModal({
  open,
  defaultDate,
  currency = 'INR',
  editingTransaction,
  onClose,
  onSaveTransaction,
  onDeleteTransaction,
}: EntrySheetModalProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CategoryName>('Vegetables');
  const [manualCategoryLock, setManualCategoryLock] = useState(false);
  const [autoCategorized, setAutoCategorized] = useState(false);
  const [date, setDate] = useState(() => defaultDate || toIsoDate(new Date()));
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [aiClassifying, setAiClassifying] = useState(false);

  const isEditingIncome = editingTransaction?.type === 'income';
  const unitMode = isEditingIncome
    ? 'bill'
    : getCategoryUnitMode(category, title);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);

    if (editingTransaction) {
      const parsed = parseQuantityFromNotes(editingTransaction.notes || '');
      setTitle(editingTransaction.title);
      setAmount(String(editingTransaction.amount));
      setCategory(editingTransaction.category);
      setManualCategoryLock(true);
      setAutoCategorized(editingTransaction.autoCategorized);
      setDate(editingTransaction.date);
      setTime(editingTransaction.time || '12:00');
      setQty(parsed.quantity ? String(parsed.quantity) : '');
      setNotes(parsed.extraNotes);
      return;
    }

    const now = new Date();
    setTitle('');
    setAmount('');
    setQty('');
    setCategory('Vegetables');
    setManualCategoryLock(false);
    setAutoCategorized(false);
    setDate(defaultDate || toIsoDate(now));
    setTime(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    );
    setNotes('');
  }, [open, defaultDate, editingTransaction]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!manualCategoryLock && !isEditingIncome) {
      const prediction = predictCategoryAndType(val);
      if (prediction.confidence === 'high' && prediction.type === 'expense') {
        setCategory(prediction.category);
        setAutoCategorized(true);
      } else {
        setAutoCategorized(false);
      }
    }
  };

  const handleAiClassify = async () => {
    if (!title.trim() || isEditingIncome) return;
    setAiClassifying(true);
    try {
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: title }),
      });
      if (!res.ok) throw new Error('Categorization failed');
      const data = (await res.json()) as {
        category: CategoryName;
      };
      if ((EXPENSE_CATEGORIES as readonly string[]).includes(data.category)) {
        setCategory(data.category);
        setAutoCategorized(true);
        setManualCategoryLock(true);
      }
    } catch {
      const fallback = predictCategoryAndType(title);
      if (fallback.type === 'expense') {
        setCategory(fallback.category);
        setAutoCategorized(true);
      }
    } finally {
      setAiClassifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const numAmount = Number(amount);

    if (!title.trim()) {
      setErrorMsg('Please enter an item or description.');
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('Please enter a valid positive amount.');
      return;
    }

    const numQty = Number(qty);
    const compiledNotes = isEditingIncome
      ? notes
      : buildNotesWithQuantity(
          Number.isFinite(numQty) && numQty > 0 ? numQty : null,
          unitMode,
          notes
        );

    setSaving(true);
    try {
      await onSaveTransaction(
        {
          title: title.trim(),
          amount: numAmount,
          type: isEditingIncome ? 'income' : 'expense',
          category: isEditingIncome ? 'Daily Total Sales' : category,
          date,
          time,
          notes: compiledNotes,
          autoCategorized,
        },
        editingTransaction?.id
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTransaction || !onDeleteTransaction) return;
    setDeleting(true);
    try {
      await onDeleteTransaction(editingTransaction.id);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete entry.');
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={editingTransaction ? 'Edit entry' : 'Add expenditure'}
    >
      <div className="w-full md:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl md:rounded-2xl shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="md:hidden pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full" />
        </div>

        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {editingTransaction
              ? isEditingIncome
                ? 'Edit Closing Sales'
                : 'Edit Expenditure'
              : 'Add Expenditure'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {isEditingIncome ? 'Closing Description' : 'Item / Bill'}
              </label>
              {!isEditingIncome && (
                <button
                  type="button"
                  onClick={handleAiClassify}
                  disabled={aiClassifying || !title.trim()}
                  className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-40 inline-flex items-center gap-1"
                >
                  {aiClassifying ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Auto-detect
                </button>
              )}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              maxLength={120}
              placeholder="e.g., Chicken 15kg, Milk, Gas Cylinder, Supermarket Bill"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
              required
            />
          </div>

          <div className={`grid grid-cols-1 ${isEditingIncome ? '' : unitMode !== 'bill' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {isEditingIncome ? 'Total Sales' : 'Amount'} ({currency === 'INR' ? '₹' : '$'})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
                required
              />
            </div>

            {!isEditingIncome && unitMode !== 'bill' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {unitMode === 'kg' ? 'Weight (kg)' : 'Count'}
                </label>
                <input
                  type="number"
                  step={unitMode === 'kg' ? '0.1' : '1'}
                  min="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={unitMode === 'kg' ? 'e.g. 12' : 'e.g. 2'}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
                />
              </div>
            )}

            {!isEditingIncome && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Category
                  </label>
                  {autoCategorized && (
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      Auto
                    </span>
                  )}
                </div>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as CategoryName);
                    setManualCategoryLock(true);
                    setAutoCategorized(false);
                  }}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-w-0 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white"
                required
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full min-w-0 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular text-slate-900 dark:text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Note (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
              placeholder="Supermarket items, quantity, or bill number"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="pt-2 pb-safe flex items-center gap-2.5">
            {editingTransaction && onDeleteTransaction && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="min-h-[48px] min-w-[48px] px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center justify-center gap-1.5 text-sm font-medium disabled:opacity-50"
                aria-label="Delete entry"
                title="Delete entry"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">{deleting ? 'Deleting...' : 'Delete'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || deleting}
              className="flex-1 min-h-[48px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingTransaction ? 'Save Changes' : 'Add Expenditure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
