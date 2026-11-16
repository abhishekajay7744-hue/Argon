import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { CurrencyCode } from '../types/finance';
import { formatCurrency, RecurringExpenseTemplate } from '../utils/analytics';
import {
  buildNotesWithQuantity,
  getCategoryUnitMode,
  parseQuantityFromNotes,
} from '../utils/categorizer';

interface DailyQuickFillProps {
  anchorDate: string;
  todayIso: string;
  currency: CurrencyCode;
  templates: RecurringExpenseTemplate[];
  onAutoSaveAmount: (
    template: RecurringExpenseTemplate,
    amount: number,
    notes: string,
    existingTxId?: string
  ) => Promise<string>;
  onDeleteSavedItem: (txId: string) => Promise<void>;
  onDismissTemplate: (key: string) => void;
  onAddNewExpenditure: () => void;
}

function QuickFillRow({
  anchorDate,
  currency,
  template,
  onAutoSaveAmount,
  onDeleteSavedItem,
  onDismissTemplate,
}: {
  anchorDate: string;
  currency: CurrencyCode;
  template: RecurringExpenseTemplate;
  onAutoSaveAmount: (
    template: RecurringExpenseTemplate,
    amount: number,
    notes: string,
    existingTxId?: string
  ) => Promise<string>;
  onDeleteSavedItem: (txId: string) => Promise<void>;
  onDismissTemplate: (key: string) => void;
}) {
  const unitMode = getCategoryUnitMode(template.category, template.title);
  const parsedToday = parseQuantityFromNotes(template.todayTx?.notes || '');

  const [value, setValue] = useState<string>(
    template.todayTx ? String(template.todayTx.amount) : ''
  );
  const [qtyValue, setQtyValue] = useState<string>(
    parsedToday.quantity ? String(parsedToday.quantity) : ''
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>(
    template.todayTx ? 'saved' : 'idle'
  );

  const isFocusedRef = useRef(false);
  const activeTxIdRef = useRef<string | null>(template.todayTx?.id ?? null);
  const lastCommittedRef = useRef<{ amount: number | null; notes: string }>({
    amount: template.todayTx ? template.todayTx.amount : null,
    notes: template.todayTx?.notes || '',
  });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const todayNotes = template.todayTx?.notes || '';
    const todayParsed = parseQuantityFromNotes(todayNotes);
    activeTxIdRef.current = template.todayTx?.id ?? null;
    lastCommittedRef.current = {
      amount: template.todayTx ? template.todayTx.amount : null,
      notes: todayNotes,
    };
    if (!isFocusedRef.current) {
      setValue(template.todayTx ? String(template.todayTx.amount) : '');
      setQtyValue(todayParsed.quantity ? String(todayParsed.quantity) : '');
      setStatus(template.todayTx ? 'saved' : 'idle');
    }
  }, [anchorDate, template.todayTx]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const commitValues = async (rawAmount: string, rawQty: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const trimmed = rawAmount.trim();
    const num = Number(trimmed);

    if (!trimmed || !Number.isFinite(num) || num <= 0) {
      const existingId = activeTxIdRef.current;
      if (existingId) {
        setStatus('saving');
        try {
          await onDeleteSavedItem(existingId);
          activeTxIdRef.current = null;
          lastCommittedRef.current = { amount: null, notes: '' };
          setStatus('idle');
        } catch {
          setStatus('idle');
        }
      } else {
        setStatus('idle');
      }
      return;
    }

    const rounded = Math.round(num * 100) / 100;
    const parsedQty = Number(rawQty);
    const notesStr = buildNotesWithQuantity(
      Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null,
      unitMode,
      parsedToday.extraNotes
    );

    if (
      activeTxIdRef.current &&
      lastCommittedRef.current.amount === rounded &&
      lastCommittedRef.current.notes === notesStr
    ) {
      setStatus('saved');
      return;
    }

    setStatus('saving');
    try {
      const savedId = await onAutoSaveAmount(
        template,
        rounded,
        notesStr,
        activeTxIdRef.current ?? undefined
      );
      activeTxIdRef.current = savedId;
      lastCommittedRef.current = { amount: rounded, notes: notesStr };
      setStatus('saved');
    } catch {
      setStatus('idle');
    }
  };

  const scheduleCommit = (nextAmount: string, nextQty: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const trimmed = nextAmount.trim();
    const num = Number(trimmed);

    if (!trimmed) {
      if (activeTxIdRef.current) {
        timerRef.current = window.setTimeout(() => {
          void commitValues('', nextQty);
        }, 900);
      } else {
        setStatus('idle');
      }
      return;
    }

    if (Number.isFinite(num) && num > 0) {
      setStatus('idle');
      timerRef.current = window.setTimeout(() => {
        void commitValues(nextAmount, nextQty);
      }, 900);
    }
  };

  const isSaved = Boolean(template.todayTx) || status === 'saved';

  return (
    <div
      className={`flex flex-col min-[460px]:flex-row min-[460px]:items-center justify-between gap-2.5 p-3 rounded-xl border transition-colors ${
        isSaved
          ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/60'
          : 'bg-slate-50/70 dark:bg-slate-950/50 border-slate-200/80 dark:border-slate-800'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
          {template.title}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
          {template.category} · Last {formatCurrency(template.lastAmount, currency)}
        </p>
      </div>

      <div className="flex items-center justify-end gap-1.5 shrink-0">
        {unitMode !== 'bill' && (
          <div className="relative">
            <input
              type="number"
              min="0"
              step={unitMode === 'kg' ? '0.1' : '1'}
              value={qtyValue}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onBlur={() => {
                isFocusedRef.current = false;
                void commitValues(value, qtyValue);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitValues(value, qtyValue);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onChange={(e) => {
                const nextQty = e.target.value;
                setQtyValue(nextQty);
                scheduleCommit(value, nextQty);
              }}
              placeholder={unitMode === 'kg' ? 'kg' : 'Qty'}
              aria-label={`${unitMode === 'kg' ? 'Weight in kg' : 'Count'} for ${template.title}`}
              className="min-h-[44px] sm:min-h-[40px] w-16 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
            />
          </div>
        )}

        <div className="relative flex-1 min-[460px]:flex-initial">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono-tabular">
            {currency === 'INR' ? '₹' : '$'}
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onFocus={() => {
              isFocusedRef.current = true;
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              void commitValues(value, qtyValue);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitValues(value, qtyValue);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            onChange={(e) => {
              const nextVal = e.target.value;
              setValue(nextVal);
              scheduleCommit(nextVal, qtyValue);
            }}
            placeholder="0"
            aria-label={`Amount for ${template.title} on ${anchorDate}`}
            className="min-h-[44px] sm:min-h-[40px] w-full min-[460px]:w-24 pl-6 pr-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right text-xs font-mono-tabular font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
          />
        </div>

        <div className="w-10 sm:w-8 flex items-center justify-center">
          {status === 'saving' ? (
            <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
          ) : isSaved ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                setQtyValue('');
                void commitValues('', '');
              }}
              className="min-h-[44px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-emerald-700 dark:text-emerald-400 hover:text-rose-600 dark:hover:text-rose-400"
              title={`Clear ${template.title} for ${anchorDate}`}
              aria-label={`Clear ${template.title} for ${anchorDate}`}
            >
              <Check className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDismissTemplate(template.key)}
              className="min-h-[44px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title={`Hide ${template.title} from daily quick-fill`}
              aria-label={`Hide ${template.title} from daily quick-fill`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DailyQuickFill({
  anchorDate,
  todayIso,
  currency,
  templates,
  onAutoSaveAmount,
  onDeleteSavedItem,
  onDismissTemplate,
  onAddNewExpenditure,
}: DailyQuickFillProps) {
  const [expanded, setExpanded] = useState(false);

  if (templates.length === 0) return null;

  const visibleTemplates = expanded ? templates : templates.slice(0, 6);
  const enteredCount = templates.filter((t) => t.todayTx !== null).length;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Daily Quick-Fill ({anchorDate === todayIso ? 'Today' : anchorDate})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enter amount (and kg for meat / count for LPG) · Unfilled items are skipped ({enteredCount}/{templates.length} saved)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {templates.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="min-h-[36px] px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
            >
              {expanded ? 'Show fewer' : `Show all (${templates.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={onAddNewExpenditure}
            className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Expenditure</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {visibleTemplates.map((tpl) => (
          <QuickFillRow
            key={`${anchorDate}_${tpl.key}`}
            anchorDate={anchorDate}
            currency={currency}
            template={tpl}
            onAutoSaveAmount={onAutoSaveAmount}
            onDeleteSavedItem={onDeleteSavedItem}
            onDismissTemplate={onDismissTemplate}
          />
        ))}
      </div>
    </div>
  );
}
