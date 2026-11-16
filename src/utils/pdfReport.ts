import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CategoryName, CurrencyCode, TimeGranularity, Transaction } from '../types/finance';
import {
  computeCategoryBreakdown,
  computePeriodSnapshot,
  computeRestaurantAnalysis,
  filterTransactionsInRange,
  formatShortDate,
  getPeriodBounds,
  parseIsoDate,
  toIsoDate,
} from './analytics';
import { getCategoryUnitMode, parseQuantityFromNotes } from './categorizer';

const MARGIN = 14;

const GRANULARITY_TITLE: Record<TimeGranularity, string> = {
  day: 'Daily Financial Report',
  week: 'Weekly Financial Report',
  month: 'Monthly Financial Report',
  year: 'Yearly Financial Report',
};

const BREAKDOWN_TITLE: Record<TimeGranularity, string> = {
  day: 'Daily Breakdown',
  week: 'Day-by-Day Summary (Mon - Sun)',
  month: 'Active Days Summary',
  year: 'Month-by-Month Summary',
};

const BREAKDOWN_COL_HEAD: Record<TimeGranularity, string> = {
  day: 'Day',
  week: 'Day',
  month: 'Date',
  year: 'Month',
};

function cleanPdfText(text: string): string {
  return (text || '')
    .replace(/₹/g, 'Rs. ')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPdfCurrency(
  amount: number,
  currency: CurrencyCode,
  options?: { signed?: boolean }
): string {
  const abs = Math.abs(amount);
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const numStr = new Intl.NumberFormat(locale, {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);

  const prefix = currency === 'INR' ? 'Rs. ' : '$';
  const sign = amount < 0 ? '-' : options?.signed && amount > 0 ? '+' : '';
  return `${sign}${prefix}${numStr}`;
}

function formatCompactDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

function getLastAutoTableY(doc: jsPDF, fallbackY: number): number {
  const withTable = doc as jsPDF & { lastAutoTable?: { finalY?: number } };
  return withTable.lastAutoTable?.finalY ?? fallbackY;
}

function ensureSpace(doc: jsPDF, currentY: number, minNeeded: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (currentY + minNeeded > pageHeight - 20) {
    doc.addPage();
    return 18;
  }
  return currentY;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number, subtitle?: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(cleanPdfText(title), MARGIN, y);

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(cleanPdfText(subtitle), pageWidth - MARGIN, y, { align: 'right' });
  }

  return y + 3.2;
}

function attachPageFooters(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, pageHeight - 13, pageWidth - MARGIN, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'ARGON  |  Total Sales = Total Expenditure + Amount Left in Shop',
      MARGIN,
      pageHeight - 8
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 8, {
      align: 'right',
    });
  }
}

interface PdfKpiCard {
  label: string;
  value: string;
  sub: string;
  valueColor: [number, number, number];
  accentColor: [number, number, number];
}

function drawKpiGrid(doc: jsPDF, y: number, cards: PdfKpiCard[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  const gap = 3.5;
  const boxW = (contentWidth - gap * (cards.length - 1)) / cards.length;
  const boxH = 21;

  cards.forEach((card, idx) => {
    const x = MARGIN + idx * (boxW + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, boxW, boxH, 1.8, 1.8, 'FD');

    doc.setFillColor(...card.accentColor);
    doc.rect(x + 0.6, y, boxW - 1.2, 1.1, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(100, 116, 139);
    doc.text(cleanPdfText(card.label), x + 3, y + 6.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...card.valueColor);
    const valChunks = doc.splitTextToSize(cleanPdfText(card.value), boxW - 6);
    doc.text(valChunks[0] || '', x + 3, y + 12.6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.9);
    doc.setTextColor(100, 116, 139);
    const subChunks = doc.splitTextToSize(cleanPdfText(card.sub), boxW - 6);
    doc.text(subChunks[0] || '', x + 3, y + 17.6);
  });

  return y + boxH;
}

function drawHeaderBanner(
  doc: jsPDF,
  title: string,
  subtitle: string,
  rightTop: string,
  rightBottom: string
): void {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 29, 'F');

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 29, pageWidth, 1.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  doc.setTextColor(255, 255, 255);
  doc.text(cleanPdfText(title), MARGIN, 12.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(cleanPdfText(subtitle), MARGIN, 20.5);

  doc.setFontSize(8.2);
  doc.setTextColor(148, 163, 184);
  doc.text(cleanPdfText(rightTop), pageWidth - MARGIN, 12.5, { align: 'right' });
  doc.text(cleanPdfText(rightBottom), pageWidth - MARGIN, 20.5, { align: 'right' });
}

function summarizeDayStats(periodTxs: Transaction[]): {
  activeDaysCount: number;
  closedDaysCount: number;
  dayCountByDate: Map<string, number>;
} {
  const byDate = new Map<string, { income: number; expense: number; expCount: number }>();

  for (const tx of periodTxs) {
    const cur = byDate.get(tx.date) ?? { income: 0, expense: 0, expCount: 0 };
    if (tx.type === 'income') {
      cur.income += tx.amount;
    } else {
      cur.expense += tx.amount;
      cur.expCount += 1;
    }
    byDate.set(tx.date, cur);
  }

  const dayCountByDate = new Map<string, number>();
  let closedDaysCount = 0;

  for (const [date, stats] of byDate.entries()) {
    dayCountByDate.set(date, stats.expCount);
    if (stats.income > 0) {
      closedDaysCount += 1;
    }
  }

  return {
    activeDaysCount: byDate.size,
    closedDaysCount,
    dayCountByDate,
  };
}

export function exportStructuredPdfReport(params: {
  transactions: Transaction[];
  granularity: TimeGranularity;
  anchorDate: string;
  currency: CurrencyCode;
}): string {
  const { transactions, granularity, anchorDate, currency } = params;
  const bounds = getPeriodBounds(anchorDate, granularity);
  const snapshot = computePeriodSnapshot(transactions, granularity, anchorDate);
  const periodTxs = filterTransactionsInRange(transactions, bounds.start, bounds.end);
  const expenseTxs = periodTxs.filter((tx) => tx.type === 'expense');
  const categories = computeCategoryBreakdown(periodTxs);
  const dayStats = summarizeDayStats(periodTxs);
  const analysis = computeRestaurantAnalysis(transactions, periodTxs, currency, snapshot);

  const isPendingClosing = snapshot.income === 0 && snapshot.expense > 0;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  const rangeLabel =
    granularity === 'day'
      ? `Date: ${bounds.start}`
      : `Range: ${bounds.start} to ${bounds.end}`;

  drawHeaderBanner(
    doc,
    'ARGON',
    `${GRANULARITY_TITLE[granularity]}  |  ${snapshot.periodLabel}`,
    `${rangeLabel}  |  Currency: ${currency}`,
    `Generated: ${toIsoDate(new Date())}`
  );

  let y = 37;

  // 4 Executive KPI Cards
  const topCategory = categories[0] ?? null;

  const fourthCard: PdfKpiCard =
    granularity === 'day'
      ? {
          label: 'Top Expense Category',
          value: topCategory ? topCategory.category : 'None',
          sub: topCategory
            ? `${formatPdfCurrency(topCategory.spent, currency)} (${topCategory.sharePct}% share)`
            : 'No expenses logged',
          valueColor: [15, 23, 42],
          accentColor: [245, 158, 11],
        }
      : {
          label: 'Best Profit Day',
          value: analysis.periodBestDay
            ? formatPdfCurrency(analysis.periodBestDay.net, currency, { signed: true })
            : 'Pending',
          sub: analysis.periodBestDay
            ? `${analysis.periodBestDay.label} (Sales ${formatPdfCurrency(analysis.periodBestDay.income, currency)})`
            : 'No closed days in period',
          valueColor: analysis.periodBestDay ? [5, 150, 105] : [100, 116, 139],
          accentColor: [245, 158, 11],
        };

  const kpiCards: PdfKpiCard[] = [
    {
      label: 'Total Expenditure',
      value: formatPdfCurrency(snapshot.expense, currency),
      sub:
        granularity === 'day'
          ? `${expenseTxs.length} ${expenseTxs.length === 1 ? 'item' : 'items'} logged`
          : `${expenseTxs.length} items across ${dayStats.activeDaysCount} ${
              dayStats.activeDaysCount === 1 ? 'day' : 'days'
            }`,
      valueColor: [15, 23, 42],
      accentColor: [30, 41, 59],
    },
    {
      label: 'Amount Left in Shop',
      value: isPendingClosing
        ? 'Pending'
        : formatPdfCurrency(snapshot.netProfit, currency, { signed: true }),
      sub: isPendingClosing
        ? 'Closing sales not entered'
        : snapshot.income > 0
        ? `${snapshot.profitMarginPct}% profit margin`
        : 'No closing logged',
      valueColor: isPendingClosing
        ? [180, 83, 9]
        : snapshot.netProfit >= 0
        ? [5, 150, 105]
        : [225, 29, 72],
      accentColor: isPendingClosing
        ? [217, 119, 6]
        : snapshot.netProfit >= 0
        ? [5, 150, 105]
        : [225, 29, 72],
    },
    {
      label: 'Total Sales',
      value: isPendingClosing
        ? 'Pending'
        : formatPdfCurrency(snapshot.income, currency),
      sub: isPendingClosing
        ? 'Set Left in Shop or Sales'
        : 'Exp + Left in Shop',
      valueColor: isPendingClosing ? [180, 83, 9] : [15, 23, 42],
      accentColor: [2, 132, 199],
    },
    fourthCard,
  ];

  y = drawKpiGrid(doc, y, kpiCards) + 7;

  // Section 1: Structured Point-Wise Key Insights & Analysis
  y = ensureSpace(doc, y, 42);
  y = drawSectionTitle(
    doc,
    'Key Insights & Analysis',
    y,
    granularity === 'day'
      ? 'Daily financial summary'
      : `${dayStats.closedDaysCount}/${dayStats.activeDaysCount} active days closed`
  );

  const insightRows = analysis.structuredInsights.map((pt) => [
    pt.index,
    cleanPdfText(pt.label),
    cleanPdfText(pt.detail),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 18 },
    head: [['#', 'Focus Area', 'Point-Wise Insight']],
    body: insightRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.1,
      cellPadding: 2.4,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', textColor: [100, 116, 139] },
      1: { cellWidth: 38, fontStyle: 'bold' },
      2: { cellWidth: contentWidth - 48 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 1) {
        const insight = analysis.structuredInsights[data.row.index];
        if (insight?.tone === 'positive') {
          data.cell.styles.textColor = [5, 150, 105];
        } else if (insight?.tone === 'warning') {
          data.cell.styles.textColor = [180, 83, 9];
        } else {
          data.cell.styles.textColor = [15, 23, 42];
        }
      }
    },
  });

  y = getLastAutoTableY(doc, y + 20) + 8;

  // Section 2: Category Expenditure & Stock Summary
  const catStatsMap = new Map<
    CategoryName,
    { qtyTotal: number; qtyUnit: 'kg' | 'count' | null; qtySpend: number }
  >();
  for (const tx of expenseTxs) {
    const parsed = parseQuantityFromNotes(tx.notes || '');
    if (parsed.quantity && parsed.quantity > 0 && parsed.unit) {
      const prev = catStatsMap.get(tx.category) ?? {
        qtyTotal: 0,
        qtyUnit: parsed.unit,
        qtySpend: 0,
      };
      if (prev.qtyUnit === parsed.unit) {
        prev.qtyTotal += parsed.quantity;
        prev.qtySpend += tx.amount;
        catStatsMap.set(tx.category, prev);
      }
    }
  }

  y = ensureSpace(doc, y, 36);
  y = drawSectionTitle(
    doc,
    'Category Expenditure & Stock Summary',
    y,
    `${categories.length} active categories`
  );

  const categoryRows =
    categories.length > 0
      ? categories.map((item) => {
          const unitMode = getCategoryUnitMode(item.category);
          const stat = catStatsMap.get(item.category);
          let qtyCol = unitMode === 'bill' ? 'Bill' : '-';
          let rateCol = '-';

          if (stat && stat.qtyTotal > 0 && stat.qtyUnit) {
            const roundedQty = Math.round(stat.qtyTotal * 100) / 100;
            qtyCol = `${roundedQty} ${stat.qtyUnit}`;
            const avgRate = Math.round(stat.qtySpend / stat.qtyTotal);
            const rateUnit = stat.qtyUnit === 'kg' ? '/kg' : '/unit';
            rateCol = `${formatPdfCurrency(avgRate, currency)}${rateUnit}`;
          }

          return [
            cleanPdfText(item.category),
            String(item.transactionCount),
            qtyCol,
            rateCol,
            `${item.sharePct}%`,
            formatPdfCurrency(item.spent, currency),
          ];
        })
      : [['No expenditures logged in this period', '0', '-', '-', '0%', formatPdfCurrency(0, currency)]];

  autoTable(doc, {
    startY: y,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 18 },
    head: [['Category', 'Items', 'Qty / Stock', 'Avg Rate', 'Share', 'Amount']],
    body: categoryRows,
    foot: [
      [
        'Total Expenditure',
        String(expenseTxs.length),
        '-',
        '-',
        '100%',
        formatPdfCurrency(snapshot.expense, currency),
      ],
    ],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.3,
      cellPadding: 2.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 16, halign: 'right' },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 40, halign: 'right' },
    },
    didParseCell(data) {
      if (data.section === 'foot' && data.column.index >= 1) {
        data.cell.styles.halign = 'right';
      }
    },
  });

  y = getLastAutoTableY(doc, y + 20) + 8;

  // Section 3: Period Breakdown (Week, Month, Year only)
  if (granularity !== 'day') {
    const activeBuckets =
      granularity === 'week'
        ? snapshot.buckets
        : snapshot.buckets.filter((b) => b.income > 0 || b.expense > 0);

    y = ensureSpace(doc, y, 36);
    y = drawSectionTitle(doc, BREAKDOWN_TITLE[granularity], y);

    const monthCountMap = new Map<string, number>();
    if (granularity === 'year') {
      for (const tx of expenseTxs) {
        const ym = tx.date.slice(0, 7);
        monthCountMap.set(ym, (monthCountMap.get(ym) ?? 0) + 1);
      }
    }

    const bucketRows =
      activeBuckets.length > 0
        ? activeBuckets.map((b) => {
            const count =
              granularity === 'year'
                ? monthCountMap.get(b.key) ?? 0
                : dayStats.dayCountByDate.get(b.key) ?? 0;

            if (b.expense === 0 && b.income === 0) {
              return [b.fullLabel, '0', '-', '-', '-', 'No Activity'];
            }

            const isPending = b.expense > 0 && b.income === 0;
            const leftCell = isPending
              ? 'Pending'
              : formatPdfCurrency(b.net, currency, { signed: true });
            const salesCell = isPending
              ? 'Pending'
              : formatPdfCurrency(b.income, currency);
            const statusCell = isPending
              ? 'Open'
              : b.income > 0
              ? `${Math.round((b.net / b.income) * 1000) / 10}%`
              : '-';

            return [
              b.fullLabel,
              String(count),
              formatPdfCurrency(b.expense, currency),
              leftCell,
              salesCell,
              statusCell,
            ];
          })
        : [['No activity recorded in this period', '0', formatPdfCurrency(0, currency), '-', '-', '-']];

    autoTable(doc, {
      startY: y,
      margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 18 },
      head: [
        [
          BREAKDOWN_COL_HEAD[granularity],
          'Items',
          'Expenditure',
          'Left in Shop',
          'Total Sales',
          'Margin',
        ],
      ],
      body: bucketRows,
      foot: [
        [
          'Period Total',
          String(expenseTxs.length),
          formatPdfCurrency(snapshot.expense, currency),
          isPendingClosing
            ? 'Pending'
            : formatPdfCurrency(snapshot.netProfit, currency, { signed: true }),
          isPendingClosing ? 'Pending' : formatPdfCurrency(snapshot.income, currency),
          snapshot.income > 0 ? `${snapshot.profitMarginPct}%` : '-',
        ],
      ],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.2,
        cellPadding: 2.4,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: 18, halign: 'right' },
        2: { cellWidth: 32, halign: 'right' },
        3: { cellWidth: 32, halign: 'right' },
        4: { cellWidth: 32, halign: 'right' },
        5: { cellWidth: 24, halign: 'right' },
      },
      didParseCell(data) {
        if (data.section === 'foot' && data.column.index >= 1) {
          data.cell.styles.halign = 'right';
        }
        if (data.section === 'body') {
          const text = String(data.cell.raw ?? '');
          if (data.column.index === 3) {
            if (text === 'Pending') {
              data.cell.styles.textColor = [180, 83, 9];
              data.cell.styles.fontStyle = 'bold';
            } else if (text.startsWith('+')) {
              data.cell.styles.textColor = [5, 150, 105];
              data.cell.styles.fontStyle = 'bold';
            } else if (text.startsWith('-')) {
              data.cell.styles.textColor = [225, 29, 72];
              data.cell.styles.fontStyle = 'bold';
            }
          }
          if (data.column.index === 4 && text === 'Pending') {
            data.cell.styles.textColor = [180, 83, 9];
          }
          if (data.column.index === 5 && text === 'Open') {
            data.cell.styles.textColor = [180, 83, 9];
          }
        }
      },
    });

    y = getLastAutoTableY(doc, y + 20) + 8;
  }

  // Section 4: Itemized Expenditure Register (Expenses only)
  y = ensureSpace(doc, y, 36);
  y = drawSectionTitle(
    doc,
    'Itemized Expenditure Register',
    y,
    `${expenseTxs.length} ${expenseTxs.length === 1 ? 'item' : 'items'}`
  );

  const sortedExpenses = [...expenseTxs].sort((a, b) =>
    granularity === 'day'
      ? a.category.localeCompare(b.category) || b.amount - a.amount
      : a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  );

  const ledgerRows =
    sortedExpenses.length > 0
      ? sortedExpenses.map((tx, idx) => {
          const parsed = parseQuantityFromNotes(tx.notes || '');
          const qtyCell =
            parsed.quantity && parsed.unit
              ? `${parsed.quantity} ${parsed.unit}`
              : getCategoryUnitMode(tx.category, tx.title) === 'bill'
              ? 'Bill'
              : '-';

          const itemLabel = parsed.extraNotes
            ? `${tx.title} - ${parsed.extraNotes}`
            : tx.title;

          return [
            granularity === 'day' ? String(idx + 1) : formatCompactDate(tx.date),
            cleanPdfText(itemLabel),
            cleanPdfText(tx.category),
            qtyCell,
            formatPdfCurrency(tx.amount, currency),
          ];
        })
      : [
          [
            '-',
            'No expenditures logged for this period',
            '-',
            '-',
            formatPdfCurrency(0, currency),
          ],
        ];

  autoTable(doc, {
    startY: y,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 18 },
    head: [
      [
        granularity === 'day' ? '#' : 'Date',
        'Item / Bill',
        'Category',
        'Qty / Unit',
        'Amount',
      ],
    ],
    body: ledgerRows,
    foot: [
      [
        '',
        `Total Expenditure (${sortedExpenses.length} items)`,
        '',
        '',
        formatPdfCurrency(snapshot.expense, currency),
      ],
    ],
    theme: 'striped',
    styles: {
      font: 'helvetica',
      fontSize: 8.1,
      cellPadding: 2.3,
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles:
      granularity === 'day'
        ? {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 68 },
            2: { cellWidth: 44 },
            3: { cellWidth: 24, halign: 'right' },
            4: { cellWidth: 36, halign: 'right' },
          }
        : {
            0: { cellWidth: 22 },
            1: { cellWidth: 60 },
            2: { cellWidth: 40 },
            3: { cellWidth: 24, halign: 'right' },
            4: { cellWidth: 36, halign: 'right' },
          },
    didParseCell(data) {
      if (data.section === 'foot' && data.column.index >= 3) {
        data.cell.styles.halign = 'right';
      }
    },
  });

  attachPageFooters(doc);

  const slug =
    granularity === 'month'
      ? bounds.start.slice(0, 7)
      : granularity === 'year'
      ? bounds.start.slice(0, 4)
      : bounds.start;
  doc.save(`argon-${granularity}-report-${slug}.pdf`);

  return `${GRANULARITY_TITLE[granularity]} (${formatShortDate(bounds.start)})`;
}

export function exportLedgerPdfReport(params: {
  transactions: Transaction[];
  filterLabel: string;
  currency: CurrencyCode;
}): void {
  const { transactions, filterLabel, currency } = params;

  let totalSales = 0;
  let totalExpenses = 0;
  let expenseCount = 0;
  let closingCount = 0;
  let chickenKg = 0;
  let beefKg = 0;
  let lpgCount = 0;

  for (const tx of transactions) {
    if (tx.type === 'income') {
      totalSales += tx.amount;
      closingCount += 1;
    } else {
      totalExpenses += tx.amount;
      expenseCount += 1;
      const parsed = parseQuantityFromNotes(tx.notes || '');
      if (parsed.quantity && parsed.quantity > 0) {
        if (tx.category === 'Chicken' && parsed.unit === 'kg') {
          chickenKg += parsed.quantity;
        } else if (tx.category === 'Beef' && parsed.unit === 'kg') {
          beefKg += parsed.quantity;
        } else if (tx.category === 'Gas' && parsed.unit === 'count') {
          lpgCount += parsed.quantity;
        }
      }
    }
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  drawHeaderBanner(
    doc,
    'ARGON  |  Ledger Report',
    `Filter: ${filterLabel}  |  ${transactions.length} entries`,
    `Currency: ${currency}`,
    `Generated: ${toIsoDate(new Date())}`
  );

  let y = 37;

  const net = Math.round((totalSales - totalExpenses) * 100) / 100;
  const kpis: PdfKpiCard[] = [
    {
      label: 'Filtered Expenses',
      value: formatPdfCurrency(totalExpenses, currency),
      sub: `${expenseCount} expense ${expenseCount === 1 ? 'item' : 'items'}`,
      valueColor: [15, 23, 42],
      accentColor: [30, 41, 59],
    },
    {
      label: 'Filtered Closing Sales',
      value: formatPdfCurrency(totalSales, currency),
      sub: `${closingCount} closing ${closingCount === 1 ? 'entry' : 'entries'}`,
      valueColor: [5, 150, 105],
      accentColor: [2, 132, 199],
    },
    {
      label: 'Net Balance',
      value:
        totalSales > 0
          ? formatPdfCurrency(net, currency, { signed: true })
          : 'Expenses Only',
      sub:
        totalSales > 0
          ? 'Closing Sales - Expenses'
          : 'No closing entries in filter',
      valueColor:
        totalSales > 0
          ? net >= 0
            ? [5, 150, 105]
            : [225, 29, 72]
          : [100, 116, 139],
      accentColor: [5, 150, 105],
    },
  ];

  y = drawKpiGrid(doc, y, kpis) + 5;

  const stockParts: string[] = [];
  if (chickenKg > 0) stockParts.push(`Chicken: ${Math.round(chickenKg * 100) / 100} kg`);
  if (beefKg > 0) stockParts.push(`Beef: ${Math.round(beefKg * 100) / 100} kg`);
  if (lpgCount > 0) stockParts.push(`LPG: ${Math.round(lpgCount * 100) / 100} count`);

  if (stockParts.length > 0) {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(MARGIN, y, contentWidth, 9, 1.8, 1.8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(`Stock Used:  ${stockParts.join('   |   ')}`, MARGIN + 4, y + 5.8);
    y += 14;
  } else {
    y += 3;
  }

  y = drawSectionTitle(
    doc,
    'Filtered Ledger Entries',
    y,
    `${transactions.length} records`
  );

  const sorted = [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)
  );

  const rows =
    sorted.length > 0
      ? sorted.map((tx) => {
          const isIncome = tx.type === 'income';
          const parsed = !isIncome ? parseQuantityFromNotes(tx.notes || '') : null;
          const qtyCell = isIncome
            ? 'Closing'
            : parsed?.quantity && parsed.unit
            ? `${parsed.quantity} ${parsed.unit}`
            : getCategoryUnitMode(tx.category, tx.title) === 'bill'
            ? 'Bill'
            : '-';
          const itemLabel = parsed?.extraNotes
            ? `${tx.title} - ${parsed.extraNotes}`
            : tx.title;

          return [
            formatCompactDate(tx.date),
            cleanPdfText(itemLabel),
            cleanPdfText(tx.category),
            qtyCell,
            isIncome ? 'Sales' : 'Expense',
            formatPdfCurrency(isIncome ? tx.amount : -tx.amount, currency, {
              signed: isIncome,
            }),
          ];
        })
      : [['-', 'No entries in active filter', '-', '-', '-', formatPdfCurrency(0, currency)]];

  const footerLabel =
    totalSales > 0 && totalExpenses > 0
      ? `Net: ${formatPdfCurrency(net, currency, { signed: true })}`
      : totalSales > 0
      ? formatPdfCurrency(totalSales, currency)
      : formatPdfCurrency(totalExpenses, currency);

  autoTable(doc, {
    startY: y,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 18 },
    head: [['Date', 'Item / Bill', 'Category', 'Qty / Unit', 'Type', 'Amount']],
    body: rows,
    foot: [['', `Total (${sorted.length} entries)`, '', '', '', footerLabel]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.1,
      cellPadding: 2.3,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 54 },
      2: { cellWidth: 36 },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 18 },
      5: { cellWidth: 30, halign: 'right' },
    },
    didParseCell(data) {
      if (data.section === 'foot' && data.column.index === 5) {
        data.cell.styles.halign = 'right';
      }
      if (data.section === 'body' && data.column.index === 5) {
        const text = String(data.cell.raw ?? '');
        if (text.startsWith('+')) {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  attachPageFooters(doc);
  doc.save(`argon-ledger-${toIsoDate(new Date())}.pdf`);
}
