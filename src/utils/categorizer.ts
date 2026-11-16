import { CATEGORIES, CategoryName, TransactionType } from '../types/finance';

export const CATEGORY_COLORS: Record<CategoryName, string> = {
  Vegetables: '#059669',
  Chicken: '#F97316',
  Beef: '#E11D48',
  Milk: '#0EA5E9',
  Gas: '#EA580C',
  Electricity: '#EAB308',
  'Staff Wages': '#4F46E5',
  Rent: '#2563EB',
  Maintenance: '#8B5CF6',
  'Supermarket & Packaging': '#14B8A6',
  'Other Expenditure': '#64748B',
  'Daily Total Sales': '#10B981',
};

const LEGACY_CATEGORY_MAP: Record<string, CategoryName> = {
  'Vegetables & Sabzi': 'Vegetables',
  'Dairy & Paneer': 'Milk',
  'Groceries & Spices': 'Supermarket & Packaging',
  'Meat & Poultry': 'Chicken',
  'Gas & Electricity': 'Gas',
  'Staff Wages': 'Staff Wages',
  'Packaging & Delivery': 'Supermarket & Packaging',
  'Rent & Maintenance': 'Rent',
  'Dine-In Sales': 'Daily Total Sales',
  'Swiggy & Zomato': 'Daily Total Sales',
  'Takeaway & Catering': 'Daily Total Sales',
  Other: 'Other Expenditure',
};

export function normalizeCategory(raw: string): CategoryName {
  if ((CATEGORIES as readonly string[]).includes(raw)) {
    return raw as CategoryName;
  }
  return LEGACY_CATEGORY_MAP[raw] ?? 'Other Expenditure';
}

const RULES: Array<{
  keywords: string[];
  category: CategoryName;
  type: TransactionType;
}> = [
  {
    keywords: ['chicken', 'broiler', 'poultry', 'leg piece', 'wings', 'breast'],
    category: 'Chicken',
    type: 'expense',
  },
  {
    keywords: ['beef', 'buffalo', 'steak', 'keema', 'meat'],
    category: 'Beef',
    type: 'expense',
  },
  {
    keywords: [
      'milk',
      'doodh',
      'curd',
      'dahi',
      'paneer',
      'butter',
      'ghee',
      'cream',
      'amul',
      'dairy',
    ],
    category: 'Milk',
    type: 'expense',
  },
  {
    keywords: [
      'sabzi',
      'vegetable',
      'vegetables',
      'mandi',
      'onion',
      'tomato',
      'potato',
      'aloo',
      'pyaz',
      'tamatar',
      'coriander',
      'lemon',
      'ginger',
      'garlic',
      'palak',
      'bhindi',
      'cabbage',
      'carrot',
      'chilli',
    ],
    category: 'Vegetables',
    type: 'expense',
  },
  {
    keywords: ['lpg', 'gas', 'cylinder', 'indane', 'hp gas', 'bharat gas', 'png'],
    category: 'Gas',
    type: 'expense',
  },
  {
    keywords: ['electricity', 'electric', 'bijli', 'power bill', 'current bill', 'eb bill', 'kseb'],
    category: 'Electricity',
    type: 'expense',
  },
  {
    keywords: [
      'staff',
      'salary',
      'wage',
      'wages',
      'chef',
      'cook',
      'master',
      'waiter',
      'helper',
      'cleaner',
      'karigar',
      'advance',
    ],
    category: 'Staff Wages',
    type: 'expense',
  },
  {
    keywords: ['rent', 'kiraya', 'lease', 'shop rent'],
    category: 'Rent',
    type: 'expense',
  },
  {
    keywords: [
      'maintenance',
      'maintainance',
      'repair',
      'plumber',
      'electrician',
      'service',
      'pest',
      'fridge repair',
      'stove repair',
    ],
    category: 'Maintenance',
    type: 'expense',
  },
  {
    keywords: [
      'supermarket',
      'hypermarket',
      'dmart',
      'lulu',
      'reliance',
      'package',
      'packaging',
      'parcel',
      'box',
      'container',
      'foil',
      'bag',
      'spoon',
      'tissue',
      'napkin',
      'cup',
      'rice',
      'basmati',
      'oil',
      'atta',
      'maida',
      'flour',
      'masala',
      'spice',
      'sauce',
      'salt',
      'sugar',
      'tea',
      'coffee',
      'kirana',
      'grocery',
      'groceries',
      'food prep',
    ],
    category: 'Supermarket & Packaging',
    type: 'expense',
  },
];

export function predictCategoryAndType(input: string): {
  category: CategoryName;
  type: TransactionType;
  confidence: 'high' | 'low';
} {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return { category: 'Other Expenditure', type: 'expense', confidence: 'low' };
  }

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      return {
        category: rule.category,
        type: rule.type,
        confidence: 'high',
      };
    }
  }

  return { category: 'Other Expenditure', type: 'expense', confidence: 'low' };
}

export type ItemUnitMode = 'kg' | 'count' | 'bill';

export function getCategoryUnitMode(
  category: CategoryName,
  title?: string
): ItemUnitMode {
  if (category === 'Chicken' || category === 'Beef') return 'kg';
  if (category === 'Gas') return 'count';
  if (category === 'Vegetables') return 'bill';
  const lower = (title || '').toLowerCase();
  if (
    category === 'Other Expenditure' &&
    (lower.includes('lpg') || lower.includes('cylinder'))
  ) {
    return 'count';
  }
  return 'bill';
}

export function parseQuantityFromNotes(notes: string): {
  quantity: number | null;
  unit: 'kg' | 'count' | null;
  extraNotes: string;
} {
  const trimmed = (notes || '').trim();
  if (!trimmed) return { quantity: null, unit: null, extraNotes: '' };

  const match = trimmed.match(
    /^(\d+(?:\.\d+)?)\s*(kg|count|cyl)\b(?:\s*[·\-|]\s*(.*))?$/i
  );
  if (!match) {
    return { quantity: null, unit: null, extraNotes: trimmed };
  }

  const num = Number(match[1]);
  const rawUnit = match[2].toLowerCase();
  const unit: 'kg' | 'count' = rawUnit === 'kg' ? 'kg' : 'count';
  const extraNotes = (match[3] || '').trim();

  return {
    quantity: Number.isFinite(num) && num > 0 ? num : null,
    unit,
    extraNotes,
  };
}

export function buildNotesWithQuantity(
  quantity: number | null | undefined,
  unitMode: ItemUnitMode,
  extraNotes?: string
): string {
  const cleanExtra = (extraNotes || '').trim();
  if (unitMode === 'bill' || !quantity || !Number.isFinite(quantity) || quantity <= 0) {
    return cleanExtra.slice(0, 300);
  }
  const roundedQty = Math.round(quantity * 100) / 100;
  const qtyText = `${roundedQty} ${unitMode}`;
  const combined = cleanExtra ? `${qtyText} · ${cleanExtra}` : qtyText;
  return combined.slice(0, 300);
}

export function formatQuantityLabel(notes: string): string | null {
  const parsed = parseQuantityFromNotes(notes);
  if (!parsed.quantity || !parsed.unit) return null;
  return `${parsed.quantity} ${parsed.unit}`;
}
