import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  User,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  getFriendlyFirebaseAuthError,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  CategoryName,
  CurrencyCode,
  Transaction,
  TransactionType,
  UserSettings,
} from '../types/finance';
import { toIsoDate } from '../utils/analytics';
import { normalizeCategory } from '../utils/categorizer';

const LOCAL_STORAGE_KEY = 'argon_local_v1';
const LEGACY_STORAGE_KEYS = [
  'rasoiledger_local_v3',
  'clearledger_local_workspace_v1',
  'rasoiledger_local_v1',
  'rasoiledger_local_v2',
] as const;

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME_REGEX = /^\d{2}:\d{2}$/;

interface LocalWorkspaceState {
  transactions: Transaction[];
  settings: UserSettings;
}

function makeDocId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_\-]/g, '') || 'tx';
  const rand = Math.random().toString(36).slice(2, 10);
  return `${safePrefix}_${Date.now()}_${rand}`.slice(0, 128);
}

function isSafeTransactionRecord(raw: unknown): raw is Transaction {
  if (!raw || typeof raw !== 'object') return false;
  const item = raw as Record<string, unknown>;
  const amount = Number(item.amount);
  return (
    typeof item.id === 'string' &&
    VALID_ID_REGEX.test(item.id) &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 100000000 &&
    (item.type === 'income' || item.type === 'expense') &&
    typeof item.date === 'string' &&
    VALID_DATE_REGEX.test(item.date)
  );
}

function loadInitialLocalState(): LocalWorkspaceState {
  try {
    let raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem('rasoiledger_local_v3');
      if (legacy) {
        raw = legacy;
        localStorage.setItem(LOCAL_STORAGE_KEY, legacy);
      }
    }
    for (const oldKey of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(oldKey);
    }

    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalWorkspaceState>;
      if (Array.isArray(parsed.transactions)) {
        const cleanTxs: Transaction[] = parsed.transactions
          .filter(isSafeTransactionRecord)
          .map((tx) => ({
            id: tx.id.slice(0, 128),
            userId: 'local',
            title: tx.title.trim().slice(0, 120),
            amount: Math.round(Number(tx.amount) * 100) / 100,
            type: tx.type,
            category: normalizeCategory(String(tx.category)),
            date: tx.date,
            time: VALID_TIME_REGEX.test(String(tx.time)) ? String(tx.time) : '12:00',
            notes: typeof tx.notes === 'string' ? tx.notes.slice(0, 300) : '',
            autoCategorized: Boolean(tx.autoCategorized),
            sourceBillId: '',
          }));

        const rawGoal = Number(parsed.settings?.monthlySavingsGoal ?? 100000);
        return {
          transactions: cleanTxs,
          settings: {
            userId: 'local',
            currency: parsed.settings?.currency === 'USD' ? 'USD' : 'INR',
            monthlySavingsGoal:
              Number.isFinite(rawGoal) && rawGoal >= 0 ? Math.min(100000000, rawGoal) : 100000,
          },
        };
      }
    }
  } catch {
    // Ignore invalid storage
  }
  return {
    transactions: [],
    settings: {
      userId: 'local',
      currency: 'INR',
      monthlySavingsGoal: 100000,
    },
  };
}

export interface NewTransactionInput {
  title: string;
  amount: number;
  type: TransactionType;
  category: CategoryName;
  date: string;
  time: string;
  notes?: string;
  autoCategorized?: boolean;
}

interface FinanceContextValue {
  user: User | null;
  authReady: boolean;
  cloudLoading: boolean;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  syncError: string | null;
  transactions: Transaction[];
  settings: UserSettings;
  hasLocalUnsyncedData: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  syncLocalToCloud: () => Promise<number>;
  addTransaction: (input: NewTransactionInput) => Promise<string>;
  updateTransaction: (id: string, input: NewTransactionInput) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setDailyAmountLeft: (date: string, amountLeft: number | null) => Promise<void>;
  setDailyTotalSales: (date: string, totalSales: number | null) => Promise<void>;
  dismissedTemplates: string[];
  dismissRecurringTemplate: (key: string) => void;
  updateSettings: (partial: { currency?: CurrencyCode; monthlySavingsGoal?: number }) => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'local' | 'syncing' | 'synced' | 'error'>('local');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [fatalFirestoreError, setFatalFirestoreError] = useState<string | null>(null);

  const [localState, setLocalState] = useState<LocalWorkspaceState>(() => loadInitialLocalState());
  const [cloudTransactions, setCloudTransactions] = useState<Transaction[]>([]);
  const [cloudSettings, setCloudSettings] = useState<UserSettings>({
    userId: '',
    currency: 'INR',
    monthlySavingsGoal: 100000,
  });

  const dismissedStorageKey = `argon_dismissed_tpl_${user?.uid ?? 'local'}`;
  const legacyDismissedKey = `rasoiledger_dismissed_tpl_${user?.uid ?? 'local'}`;
  const [dismissedTemplates, setDismissedTemplates] = useState<string[]>([]);

  useEffect(() => {
    try {
      let raw = localStorage.getItem(dismissedStorageKey);
      if (!raw) {
        const legacy = localStorage.getItem(legacyDismissedKey);
        if (legacy) {
          raw = legacy;
          localStorage.setItem(dismissedStorageKey, legacy);
          localStorage.removeItem(legacyDismissedKey);
        }
      }
      const parsed = raw ? JSON.parse(raw) : [];
      setDismissedTemplates(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      setDismissedTemplates([]);
    }
  }, [dismissedStorageKey, legacyDismissedKey]);

  const dismissRecurringTemplate = useCallback(
    (key: string) => {
      setDismissedTemplates((prev) => {
        if (prev.includes(key)) return prev;
        const next = [...prev, key];
        try {
          localStorage.setItem(dismissedStorageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [dismissedStorageKey]
  );

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localState));
    } catch {
      // Ignore storage quota
    }
  }, [localState]);

  useEffect(() => {
    void getRedirectResult(auth).catch((err) => {
      setSyncError(getFriendlyFirebaseAuthError(err));
    });

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      setFatalFirestoreError(null);
      if (!firebaseUser) {
        setSyncStatus('local');
        setSyncError(null);
        setCloudTransactions([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;

    if (!user.emailVerified) {
      setCloudLoading(false);
      setSyncStatus('error');
      setSyncError('Please verify your Google account email to enable cloud sync.');
      return;
    }

    const uid = user.uid;
    setCloudLoading(true);
    setSyncStatus('syncing');
    setSyncError(null);

    const surfaceListenerError = (err: unknown, op: OperationType, path: string) => {
      try {
        handleFirestoreError(err, op, path);
      } catch (wrapped) {
        const msg = wrapped instanceof Error ? wrapped.message : String(wrapped);
        const rawErr = err instanceof Error ? err.message : String(err);
        if (rawErr.toLowerCase().includes('permission') || rawErr.toLowerCase().includes('insufficient')) {
          setFatalFirestoreError(msg);
        } else {
          setSyncStatus('error');
          setSyncError('Cloud sync paused due to connection or quota limits. Retrying automatically.');
        }
      }
    };

    const profileRef = doc(db, 'users', uid);
    const txQuery = query(
      collection(db, 'users', uid, 'transactions'),
      where('userId', '==', uid),
      orderBy('date', 'desc')
    );

    const unsubProfile = onSnapshot(
      profileRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCloudSettings({
            userId: uid,
            currency: data.currency === 'USD' ? 'USD' : 'INR',
            monthlySavingsGoal: Number(data.monthlySavingsGoal ?? 100000),
          });
        } else {
          setDoc(profileRef, {
            userId: uid,
            currency: 'INR',
            monthlySavingsGoal: 100000,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch((err) => {
            surfaceListenerError(err, OperationType.CREATE, `users/${uid}`);
          });
        }
      },
      (err) => {
        setSyncStatus('error');
        setSyncError('Failed to sync settings.');
        surfaceListenerError(err, OperationType.GET, `users/${uid}`);
      }
    );

    const unsubTx = onSnapshot(
      txQuery,
      (snap) => {
        const list: Transaction[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            userId: String(data.userId),
            title: String(data.title),
            amount: Number(data.amount),
            type: data.type === 'income' ? 'income' : 'expense',
            category: normalizeCategory(String(data.category)),
            date: String(data.date),
            time: String(data.time || '12:00'),
            notes: String(data.notes || ''),
            autoCategorized: Boolean(data.autoCategorized),
            sourceBillId: String(data.sourceBillId || ''),
          };
        });
        setCloudTransactions(list);
        setCloudLoading(false);
        setSyncStatus('synced');
      },
      (err) => {
        setCloudLoading(false);
        setSyncStatus('error');
        setSyncError('Unable to sync restaurant entries.');
        surfaceListenerError(err, OperationType.LIST, `users/${uid}/transactions`);
      }
    );

    return () => {
      unsubProfile();
      unsubTx();
    };
  }, [authReady, user]);

  if (fatalFirestoreError) {
    throw new Error(fatalFirestoreError);
  }

  const activeTransactions = useMemo(() => {
    const base = user ? cloudTransactions : localState.transactions;
    return [...base].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.time || '00:00').localeCompare(a.time || '00:00');
    });
  }, [user, cloudTransactions, localState.transactions]);

  const activeSettings = user ? cloudSettings : localState.settings;

  const hasLocalUnsyncedData = useMemo(() => {
    return localState.transactions.length > 0;
  }, [localState.transactions]);

  const signInWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      const isTopLevelWindow = typeof window !== 'undefined' && window.self === window.top;
      if (code === 'auth/popup-blocked' && isTopLevelWindow) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw new Error(getFriendlyFirebaseAuthError(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const sanitizeAmount = (val: number): number => {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error('Amount must be a positive number.');
    }
    const rounded = Math.round(num * 100) / 100;
    return Math.min(100000000, Math.max(0.01, rounded));
  };

  const addTransaction = useCallback(
    async (input: NewTransactionInput): Promise<string> => {
      const cleanTitle = input.title.trim().slice(0, 120);
      if (!cleanTitle) {
        throw new Error('Item description cannot be empty.');
      }
      const cleanAmount = sanitizeAmount(input.amount);
      const cleanNotes = (input.notes ?? '').trim().slice(0, 300);
      const cleanTime = VALID_TIME_REGEX.test(input.time) ? input.time : '12:00';
      const cleanDate = VALID_DATE_REGEX.test(input.date)
        ? input.date
        : toIsoDate(new Date());
      const cleanCategory = normalizeCategory(input.category);

      if (!user) {
        const id = makeDocId('tx');
        const newTx: Transaction = {
          id,
          userId: 'local',
          title: cleanTitle,
          amount: cleanAmount,
          type: input.type,
          category: cleanCategory,
          date: cleanDate,
          time: cleanTime,
          notes: cleanNotes,
          autoCategorized: Boolean(input.autoCategorized),
          sourceBillId: '',
        };
        setLocalState((prev) => ({
          ...prev,
          transactions: [newTx, ...prev.transactions],
        }));
        return id;
      }

      const id = makeDocId('tx');
      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'transactions', id), {
          userId: user.uid,
          title: cleanTitle,
          amount: cleanAmount,
          type: input.type,
          category: cleanCategory,
          date: cleanDate,
          time: cleanTime,
          notes: cleanNotes,
          autoCategorized: Boolean(input.autoCategorized),
          sourceBillId: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
      return id;
    },
    [user]
  );

  const updateTransaction = useCallback(
    async (id: string, input: NewTransactionInput) => {
      if (!VALID_ID_REGEX.test(id) || id.length > 128) {
        throw new Error('Invalid entry identifier.');
      }
      const cleanTitle = input.title.trim().slice(0, 120);
      if (!cleanTitle) {
        throw new Error('Item description cannot be empty.');
      }
      const cleanAmount = sanitizeAmount(input.amount);
      const cleanNotes = (input.notes ?? '').trim().slice(0, 300);
      const cleanTime = VALID_TIME_REGEX.test(input.time) ? input.time : '12:00';
      const cleanDate = VALID_DATE_REGEX.test(input.date)
        ? input.date
        : toIsoDate(new Date());
      const cleanCategory = normalizeCategory(input.category);

      if (!user) {
        setLocalState((prev) => ({
          ...prev,
          transactions: prev.transactions.map((tx) =>
            tx.id === id
              ? {
                  ...tx,
                  title: cleanTitle,
                  amount: cleanAmount,
                  type: input.type,
                  category: cleanCategory,
                  date: cleanDate,
                  time: cleanTime,
                  notes: cleanNotes,
                  autoCategorized: Boolean(input.autoCategorized),
                }
              : tx
          ),
        }));
        return;
      }

      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'transactions', id), {
          title: cleanTitle,
          amount: cleanAmount,
          type: input.type,
          category: cleanCategory,
          date: cleanDate,
          time: cleanTime,
          notes: cleanNotes,
          autoCategorized: Boolean(input.autoCategorized),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user]
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      if (!VALID_ID_REGEX.test(id) || id.length > 128) {
        throw new Error('Invalid entry identifier.');
      }
      if (!user) {
        setLocalState((prev) => ({
          ...prev,
          transactions: prev.transactions.filter((tx) => tx.id !== id),
        }));
        return;
      }

      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'transactions', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const setDailyAmountLeft = useCallback(
    async (date: string, amountLeft: number | null) => {
      const cleanDate = VALID_DATE_REGEX.test(date) ? date : toIsoDate(new Date());
      const salesDocId = `sales_${cleanDate}`;

      const currentDayExpenses = activeTransactions
        .filter((tx) => tx.date === cleanDate && tx.type === 'expense')
        .reduce((acc, tx) => acc + tx.amount, 0);

      const safeLeft =
        amountLeft !== null && Number.isFinite(amountLeft) ? Math.max(0, amountLeft) : 0;

      const computedTotalSales =
        amountLeft === null
          ? 0
          : Math.round((currentDayExpenses + safeLeft) * 100) / 100;

      const noteText =
        amountLeft === null ? '' : `Amount left in shop: ${Math.round(safeLeft * 100) / 100}`;

      if (!user) {
        setLocalState((prev) => {
          const withoutDateIncome = prev.transactions.filter(
            (tx) => !(tx.date === cleanDate && tx.type === 'income')
          );
          if (computedTotalSales <= 0) {
            return { ...prev, transactions: withoutDateIncome };
          }
          const nextSales: Transaction = {
            id: salesDocId,
            userId: 'local',
            title: 'Daily Shop Closing',
            amount: sanitizeAmount(computedTotalSales),
            type: 'income',
            category: 'Daily Total Sales',
            date: cleanDate,
            time: '22:00',
            notes: noteText,
            autoCategorized: false,
            sourceBillId: '',
          };
          return { ...prev, transactions: [nextSales, ...withoutDateIncome] };
        });
        return;
      }

      const existingIncomeForDate = cloudTransactions.filter(
        (tx) => tx.date === cleanDate && tx.type === 'income'
      );
      const hasPrimarySalesDoc = existingIncomeForDate.some(
        (tx) => tx.id === salesDocId
      );

      const batch = writeBatch(db);
      for (const tx of existingIncomeForDate) {
        if (tx.id !== salesDocId || computedTotalSales <= 0) {
          batch.delete(doc(db, 'users', user.uid, 'transactions', tx.id));
        }
      }

      if (computedTotalSales > 0) {
        const ref = doc(db, 'users', user.uid, 'transactions', salesDocId);
        if (hasPrimarySalesDoc) {
          batch.update(ref, {
            title: 'Daily Shop Closing',
            category: 'Daily Total Sales',
            amount: sanitizeAmount(computedTotalSales),
            notes: noteText,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            userId: user.uid,
            title: 'Daily Shop Closing',
            amount: sanitizeAmount(computedTotalSales),
            type: 'income',
            category: 'Daily Total Sales',
            date: cleanDate,
            time: '22:00',
            notes: noteText,
            autoCategorized: false,
            sourceBillId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/transactions/${salesDocId}`);
      }
    },
    [user, activeTransactions, cloudTransactions]
  );

  const setDailyTotalSales = useCallback(
    async (date: string, totalSales: number | null) => {
      const cleanDate = VALID_DATE_REGEX.test(date) ? date : toIsoDate(new Date());
      const salesDocId = `sales_${cleanDate}`;

      const currentDayExpenses = activeTransactions
        .filter((tx) => tx.date === cleanDate && tx.type === 'expense')
        .reduce((acc, tx) => acc + tx.amount, 0);

      const cleanSales =
        totalSales === null || !Number.isFinite(totalSales) || totalSales <= 0
          ? 0
          : Math.round(totalSales * 100) / 100;

      const computedCashLeft = Math.round((cleanSales - currentDayExpenses) * 100) / 100;
      const noteText =
        cleanSales <= 0 ? '' : `Amount left in shop: ${computedCashLeft}`;

      if (!user) {
        setLocalState((prev) => {
          const withoutDateIncome = prev.transactions.filter(
            (tx) => !(tx.date === cleanDate && tx.type === 'income')
          );
          if (cleanSales <= 0) {
            return { ...prev, transactions: withoutDateIncome };
          }
          const nextSales: Transaction = {
            id: salesDocId,
            userId: 'local',
            title: 'Daily Shop Closing',
            amount: sanitizeAmount(cleanSales),
            type: 'income',
            category: 'Daily Total Sales',
            date: cleanDate,
            time: '22:00',
            notes: noteText,
            autoCategorized: false,
            sourceBillId: '',
          };
          return { ...prev, transactions: [nextSales, ...withoutDateIncome] };
        });
        return;
      }

      const existingIncomeForDate = cloudTransactions.filter(
        (tx) => tx.date === cleanDate && tx.type === 'income'
      );
      const hasPrimarySalesDoc = existingIncomeForDate.some(
        (tx) => tx.id === salesDocId
      );

      const batch = writeBatch(db);
      for (const tx of existingIncomeForDate) {
        if (tx.id !== salesDocId || cleanSales <= 0) {
          batch.delete(doc(db, 'users', user.uid, 'transactions', tx.id));
        }
      }

      if (cleanSales > 0) {
        const ref = doc(db, 'users', user.uid, 'transactions', salesDocId);
        if (hasPrimarySalesDoc) {
          batch.update(ref, {
            title: 'Daily Shop Closing',
            category: 'Daily Total Sales',
            amount: sanitizeAmount(cleanSales),
            notes: noteText,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            userId: user.uid,
            title: 'Daily Shop Closing',
            amount: sanitizeAmount(cleanSales),
            type: 'income',
            category: 'Daily Total Sales',
            date: cleanDate,
            time: '22:00',
            notes: noteText,
            autoCategorized: false,
            sourceBillId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/transactions/${salesDocId}`);
      }
    },
    [user, activeTransactions, cloudTransactions]
  );

  const updateSettings = useCallback(
    async (partial: { currency?: CurrencyCode; monthlySavingsGoal?: number }) => {
      const nextCurrency = partial.currency ?? activeSettings.currency;
      const rawGoal = Number(partial.monthlySavingsGoal ?? activeSettings.monthlySavingsGoal);
      const nextGoal = Number.isFinite(rawGoal)
        ? Math.min(100000000, Math.max(0, Math.round(rawGoal * 100) / 100))
        : activeSettings.monthlySavingsGoal;

      if (!user) {
        setLocalState((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            currency: nextCurrency,
            monthlySavingsGoal: nextGoal,
          },
        }));
        return;
      }

      const path = `users/${user.uid}`;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          currency: nextCurrency,
          monthlySavingsGoal: nextGoal,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user, activeSettings]
  );

  const syncLocalToCloud = useCallback(async () => {
    if (!user) return 0;
    const customTxs = localState.transactions;
    if (customTxs.length === 0) return 0;

    // Firestore writeBatch limit is 500 ops; chunk at 450 for safety
    const CHUNK_SIZE = 450;
    try {
      for (let i = 0; i < customTxs.length; i += CHUNK_SIZE) {
        const slice = customTxs.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const tx of slice) {
          const id =
            tx.id.startsWith('sales_') && VALID_ID_REGEX.test(tx.id) && tx.id.length <= 128
              ? tx.id
              : makeDocId('tx');
          batch.set(doc(db, 'users', user.uid, 'transactions', id), {
            userId: user.uid,
            title: (tx.title.trim() || 'Item').slice(0, 120),
            amount: sanitizeAmount(tx.amount),
            type: tx.type,
            category: normalizeCategory(tx.category),
            date: VALID_DATE_REGEX.test(tx.date) ? tx.date : toIsoDate(new Date()),
            time: VALID_TIME_REGEX.test(tx.time) ? tx.time : '12:00',
            notes: (tx.notes || '').slice(0, 300),
            autoCategorized: Boolean(tx.autoCategorized),
            sourceBillId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      setLocalState((prev) => ({
        ...prev,
        transactions: [],
      }));
      return customTxs.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/transactions`);
    }
  }, [user, localState.transactions]);

  return (
    <FinanceContext.Provider
      value={{
        user,
        authReady,
        cloudLoading,
        syncStatus,
        syncError,
        transactions: activeTransactions,
        settings: activeSettings,
        hasLocalUnsyncedData,
        signInWithGoogle,
        signOut,
        syncLocalToCloud,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        setDailyAmountLeft,
        setDailyTotalSales,
        dismissedTemplates,
        dismissRecurringTemplate,
        updateSettings,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinanceStore(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinanceStore must be used inside FinanceProvider');
  return ctx;
}
