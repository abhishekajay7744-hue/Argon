import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Cloud,
  CloudOff,
  ListOrdered,
  LogOut,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import {
  FinanceProvider,
  NewTransactionInput,
  useFinanceStore,
} from './hooks/useFinanceStore';
import { CategoryName, TimeGranularity, Transaction } from './types/finance';
import { toIsoDate } from './utils/analytics';
import { OverviewView } from './components/OverviewView';
import { TransactionsView } from './components/TransactionsView';
import { EntrySheetModal } from './components/EntrySheetModal';

type NavTab = 'overview' | 'entries';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">
              Something went wrong
            </h1>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 min-h-[44px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function DashboardShell() {
  const store = useFinanceStore();

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [anchorDate, setAnchorDate] = useState<string>(() => toIsoDate(new Date()));
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<
    CategoryName | 'all'
  >('all');

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved =
        localStorage.getItem('argon_theme') ?? localStorage.getItem('rasoiledger_theme');
      return saved === 'dark';
    } catch {
      return false;
    }
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('argon_theme', darkMode ? 'dark' : 'light');
      localStorage.removeItem('rasoiledger_theme');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (msg: string) => setToast(msg);

  const handleSaveTransaction = async (input: NewTransactionInput, editId?: string) => {
    if (editId) {
      await store.updateTransaction(editId, input);
      showToast('Entry updated.');
    } else {
      await store.addTransaction(input);
      showToast('Expenditure added.');
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    await store.deleteTransaction(id);
    showToast('Entry deleted.');
  };

  const handleSignIn = async () => {
    try {
      await store.signInWithGoogle();
      showToast('Signed in. Cloud sync active.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in cancelled.');
    }
  };

  const handleSyncLocal = async () => {
    const count = await store.syncLocalToCloud();
    showToast(
      count > 0 ? `Uploaded ${count} local entries to cloud.` : 'Already synced.'
    );
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 h-14 sm:h-16 px-3.5 sm:px-6 lg:px-8 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1320px] mx-auto h-full flex items-center justify-between gap-2 sm:gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="text-lg sm:text-xl font-extrabold uppercase tracking-[0.12em] text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            ARGON
          </button>

          <nav
            className="hidden md:flex items-center gap-6 text-sm font-medium"
            aria-label="Primary navigation"
          >
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'overview'
                  ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('entries')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'entries'
                  ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Expense Ledger
            </button>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {store.user ? (
              <div className="flex items-center gap-1.5">
                {store.hasLocalUnsyncedData && (
                  <button
                    type="button"
                    onClick={handleSyncLocal}
                    className="min-h-[40px] px-2.5 rounded-lg bg-emerald-600 text-white text-xs font-medium whitespace-nowrap"
                  >
                    <span className="sm:hidden">Upload</span>
                    <span className="hidden sm:inline">Upload Local</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await store.signOut();
                    showToast('Signed out.');
                  }}
                  className="min-h-[40px] min-w-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  title={`Cloud synced as ${store.user.email ?? 'User'} (click to sign out)`}
                  aria-label="Sign out of cloud sync"
                >
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline">Synced</span>
                  <LogOut className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="min-h-[40px] min-w-[40px] px-2.5 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                aria-label="Sign in for cloud sync"
              >
                <CloudOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="hidden sm:inline">Cloud Sync</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingTx(null);
                setModalOpen(true);
              }}
              className="min-h-[40px] px-3 sm:px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="hidden min-[380px]:inline">Add Expense</span>
              <span className="min-[380px]:hidden">Add</span>
            </button>
          </div>
        </div>
      </header>

      {store.syncError && (
        <div className="max-w-[1320px] w-full mx-auto px-3.5 sm:px-6 lg:px-8 pt-4">
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
            {store.syncError}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1320px] mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-5 pb-24 md:pb-10">
        {store.cloudLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl"
              />
            ))}
          </div>
        ) : activeTab === 'overview' ? (
          <OverviewView
            transactions={store.transactions}
            currency={store.settings.currency}
            granularity={granularity}
            anchorDate={anchorDate}
            dismissedTemplates={store.dismissedTemplates}
            onChangeGranularity={setGranularity}
            onChangeAnchorDate={setAnchorDate}
            onQuickAddExpense={async (input) => {
              const id = await store.addTransaction(input);
              showToast('Expenditure saved.');
              return id;
            }}
            onUpdateExpense={async (id, input) => {
              await store.updateTransaction(id, input);
              showToast('Expenditure updated.');
            }}
            onSetDailyAmountLeft={async (date, amountLeft) => {
              await store.setDailyAmountLeft(date, amountLeft);
              showToast(
                amountLeft === null
                  ? `Cleared closing balance for ${date}.`
                  : `Total sales updated for ${date}.`
              );
            }}
            onSetDailyTotalSales={async (date, totalSales) => {
              await store.setDailyTotalSales(date, totalSales);
              showToast(
                totalSales === null
                  ? `Cleared total sales for ${date}.`
                  : `Total sales updated for ${date}.`
              );
            }}
            onEditTransaction={(tx) => {
              setEditingTx(tx);
              setModalOpen(true);
            }}
            onDeleteTransaction={handleDeleteTransaction}
            onDismissTemplate={(key) => {
              store.dismissRecurringTemplate(key);
              showToast('Removed from daily quick-fill.');
            }}
            onNavigateEntries={(cat) => {
              setLedgerCategoryFilter(cat ?? 'all');
              setActiveTab('entries');
            }}
            onExportSuccess={(reportLabel) => {
              showToast(`Downloaded ${reportLabel} PDF.`);
            }}
          />
        ) : (
          <TransactionsView
            transactions={store.transactions}
            currency={store.settings.currency}
            anchorDate={anchorDate}
            initialCategoryFilter={ledgerCategoryFilter}
            onClearInitialCategory={() => setLedgerCategoryFilter('all')}
            onOpenNewEntry={() => {
              setEditingTx(null);
              setModalOpen(true);
            }}
            onEditTransaction={(tx) => {
              setEditingTx(tx);
              setModalOpen(true);
            }}
            onDeleteTransaction={handleDeleteTransaction}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-2 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 ${
              activeTab === 'overview'
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[11px] whitespace-nowrap">Dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('entries')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 ${
              activeTab === 'entries'
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <ListOrdered className="w-5 h-5" />
            <span className="text-[11px] whitespace-nowrap">Expense Ledger</span>
          </button>
        </div>
      </nav>

      <EntrySheetModal
        open={modalOpen}
        defaultDate={anchorDate}
        currency={store.settings.currency}
        editingTransaction={editingTx}
        onClose={() => setModalOpen(false)}
        onSaveTransaction={handleSaveTransaction}
        onDeleteTransaction={handleDeleteTransaction}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 px-4 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium shadow-lg no-print max-w-[calc(100vw-2rem)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <FinanceProvider>
        <DashboardShell />
      </FinanceProvider>
    </AppErrorBoundary>
  );
}
