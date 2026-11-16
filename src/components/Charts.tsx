import React, { useId, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  CategoryBreakdownItem,
  CategoryName,
  ChartBucket,
  CurrencyCode,
} from '../types/finance';
import { formatCurrency } from '../utils/analytics';

interface CashflowBarChartProps {
  buckets: ChartBucket[];
  currency: CurrencyCode;
}

export function CashflowBarChart({ buckets, currency }: CashflowBarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');

  const chartStats = useMemo(() => {
    const maxVal = Math.max(
      100,
      ...buckets.map((b) => Math.max(b.income, b.expense))
    );
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const niceMax = Math.ceil(maxVal / magnitude) * magnitude;
    return { niceMax };
  }, [buckets]);

  const activeBucket =
    activeIndex !== null && buckets[activeIndex] ? buckets[activeIndex] : null;

  const svgWidth = 680;
  const svgHeight = 250;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 32;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const groupW = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.max(3, Math.min(20, groupW * 0.34));
  const barGap = Math.max(1, Math.min(4, groupW * 0.08));

  const hasAnyData = buckets.some((b) => b.income > 0 || b.expense > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
            Total Sales
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-slate-800 dark:bg-slate-300" />
            Expenditure
          </span>
        </div>

        <div className="min-h-[20px] text-xs font-mono-tabular text-slate-600 dark:text-slate-300">
          {activeBucket ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-900 dark:text-white">
                {activeBucket.fullLabel}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400">
                Sales {formatCurrency(activeBucket.income, currency)}
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                Exp {formatCurrency(activeBucket.expense, currency)}
              </span>
              <span
                className={
                  activeBucket.net >= 0
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-rose-600 dark:text-rose-400 font-semibold'
                }
              >
                Left {formatCurrency(activeBucket.net, currency, { signed: true })}
              </span>
            </span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">
              Hover or tap any bar to inspect
            </span>
          )}
        </div>
      </div>

      {!hasAnyData ? (
        <div className="h-[220px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500 dark:text-slate-400 px-4 text-center">
          Add daily expenditures and set Amount Left in Shop to compare performance.
        </div>
      ) : (
        <div className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto select-none touch-manipulation"
            role="img"
            aria-label="Total sales versus expenditure bar chart"
          >
            <defs>
              <linearGradient id={`salesGrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="1" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.82" />
              </linearGradient>
            </defs>

            {yTicks.map((ratio) => {
              const y = padTop + plotH - ratio * plotH;
              const val = chartStats.niceMax * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={svgWidth - padRight}
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeWidth="1"
                    strokeDasharray={ratio === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 dark:fill-slate-500 text-[12px] font-mono-tabular"
                  >
                    {formatCurrency(val, currency, { compact: true })}
                  </text>
                </g>
              );
            })}

            {buckets.map((bucket, idx) => {
              const groupX = padLeft + idx * groupW;
              const centerX = groupX + groupW / 2;
              const incomeH = (bucket.income / chartStats.niceMax) * plotH;
              const expenseH = (bucket.expense / chartStats.niceMax) * plotH;
              const incomeX = centerX - barW - barGap / 2;
              const expenseX = centerX + barGap / 2;
              const isSelected = activeIndex === idx;

              return (
                <g
                  key={bucket.key}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={() => setActiveIndex(isSelected ? null : idx)}
                  className="cursor-pointer"
                >
                  <rect
                    x={groupX + 2}
                    y={padTop}
                    width={Math.max(4, groupW - 4)}
                    height={plotH}
                    rx="6"
                    className={
                      isSelected
                        ? 'fill-slate-900/5 dark:fill-white/5'
                        : 'fill-transparent'
                    }
                  />

                  <rect
                    x={incomeX}
                    y={padTop + plotH - Math.max(incomeH, bucket.income > 0 ? 3 : 0)}
                    width={barW}
                    height={Math.max(incomeH, bucket.income > 0 ? 3 : 0)}
                    rx="3"
                    fill={`url(#salesGrad-${uid})`}
                    className="transition-opacity duration-150"
                    opacity={activeIndex === null || isSelected ? 1 : 0.35}
                  />

                  <rect
                    x={expenseX}
                    y={padTop + plotH - Math.max(expenseH, bucket.expense > 0 ? 3 : 0)}
                    width={barW}
                    height={Math.max(expenseH, bucket.expense > 0 ? 3 : 0)}
                    rx="3"
                    className="fill-slate-800 dark:fill-slate-300 transition-opacity duration-150"
                    opacity={activeIndex === null || isSelected ? 1 : 0.35}
                  />

                  {bucket.label && (
                    <text
                      x={centerX}
                      y={svgHeight - 8}
                      textAnchor="middle"
                      className={`text-[12px] ${
                        isSelected
                          ? 'fill-slate-900 dark:fill-white font-semibold'
                          : 'fill-slate-500 dark:fill-slate-400'
                      }`}
                    >
                      {bucket.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

interface NetCumulativeChartProps {
  buckets: ChartBucket[];
  currency: CurrencyCode;
}

export function NetCumulativeChart({ buckets, currency }: NetCumulativeChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');

  const svgWidth = 680;
  const svgHeight = 250;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 32;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const { minVal, maxVal, zeroY, points, linePath, areaPath, lastNet } = useMemo(() => {
    const values = buckets.map((b) => b.cumulativeNet);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const span = Math.max(100, rawMax - rawMin);
    const paddedMin = rawMin - span * 0.12;
    const paddedMax = rawMax + span * 0.12;
    const totalSpan = paddedMax - paddedMin || 1;

    const toY = (val: number) => padTop + ((paddedMax - val) / totalSpan) * plotH;
    const zY = toY(0);

    const pts = buckets.map((b, idx) => {
      const x =
        buckets.length <= 1
          ? padLeft + plotW / 2
          : padLeft + (idx / (buckets.length - 1)) * plotW;
      const y = toY(b.cumulativeNet);
      return { x, y, bucket: b };
    });

    const lPath = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    const aPath =
      pts.length > 0
        ? `${lPath} L ${pts[pts.length - 1].x.toFixed(1)} ${zY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zY.toFixed(1)} Z`
        : '';

    return {
      minVal: paddedMin,
      maxVal: paddedMax,
      zeroY: zY,
      points: pts,
      linePath: lPath,
      areaPath: aPath,
      lastNet: values.length > 0 ? values[values.length - 1] : 0,
    };
  }, [buckets, plotH, plotW]);

  const activePoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const isPositiveEnd = lastNet >= 0;
  const hasAnyData = buckets.some((b) => b.income > 0 || b.expense > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          Cumulative Profit (Amount Left)
        </span>
        <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
          {activePoint ? (
            <>
              {activePoint.bucket.fullLabel}:{' '}
              <span
                className={
                  activePoint.bucket.cumulativeNet >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }
              >
                {formatCurrency(activePoint.bucket.cumulativeNet, currency, {
                  signed: true,
                })}
              </span>
            </>
          ) : (
            <span
              className={
                isPositiveEnd
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              Total Left: {formatCurrency(lastNet, currency, { signed: true })}
            </span>
          )}
        </span>
      </div>

      {!hasAnyData ? (
        <div className="h-[220px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500 dark:text-slate-400 px-4 text-center">
          Profit trend updates automatically as entries are added.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto select-none touch-manipulation"
          role="img"
          aria-label="Cumulative profit trend"
        >
          <defs>
            <linearGradient id={`areaPos-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`areaNeg-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E11D48" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#E11D48" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <line
            x1={padLeft}
            y1={padTop}
            x2={svgWidth - padRight}
            y2={padTop}
            className="stroke-slate-200 dark:stroke-slate-800"
            strokeDasharray="3 3"
          />
          <line
            x1={padLeft}
            y1={zeroY}
            x2={svgWidth - padRight}
            y2={zeroY}
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth="1.25"
          />
          <line
            x1={padLeft}
            y1={padTop + plotH}
            x2={svgWidth - padRight}
            y2={padTop + plotH}
            className="stroke-slate-200 dark:stroke-slate-800"
            strokeDasharray="3 3"
          />

          <text
            x={padLeft - 8}
            y={padTop + 4}
            textAnchor="end"
            className="fill-slate-400 dark:fill-slate-500 text-[12px] font-mono-tabular"
          >
            {formatCurrency(maxVal, currency, { compact: true })}
          </text>
          <text
            x={padLeft - 8}
            y={zeroY + 4}
            textAnchor="end"
            className="fill-slate-500 dark:fill-slate-400 text-[12px] font-mono-tabular"
          >
            0
          </text>
          <text
            x={padLeft - 8}
            y={padTop + plotH + 4}
            textAnchor="end"
            className="fill-slate-400 dark:fill-slate-500 text-[12px] font-mono-tabular"
          >
            {formatCurrency(minVal, currency, { compact: true })}
          </text>

          {areaPath && (
            <path
              d={areaPath}
              fill={`url(#${isPositiveEnd ? `areaPos-${uid}` : `areaNeg-${uid}`})`}
            />
          )}

          {linePath && (
            <path
              d={linePath}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={
                isPositiveEnd
                  ? 'stroke-emerald-600 dark:stroke-emerald-400'
                  : 'stroke-rose-600 dark:stroke-rose-400'
              }
            />
          )}

          {points.map((pt, idx) => {
            const sliceW = points.length > 1 ? plotW / points.length : plotW;
            const isHovered = hoverIdx === idx;
            return (
              <g
                key={pt.bucket.key}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => setHoverIdx(isHovered ? null : idx)}
                className="cursor-pointer"
              >
                <rect
                  x={pt.x - sliceW / 2}
                  y={padTop}
                  width={sliceW}
                  height={plotH}
                  fill="transparent"
                />
                {isHovered && (
                  <>
                    <line
                      x1={pt.x}
                      y1={padTop}
                      x2={pt.x}
                      y2={padTop + plotH}
                      className="stroke-slate-400 dark:stroke-slate-600"
                      strokeDasharray="2 2"
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="5"
                      className={
                        pt.bucket.cumulativeNet >= 0
                          ? 'fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-slate-900'
                          : 'fill-rose-600 dark:fill-rose-400 stroke-white dark:stroke-slate-900'
                      }
                      strokeWidth="2.5"
                    />
                  </>
                )}
                {pt.bucket.label && (
                  <text
                    x={pt.x}
                    y={svgHeight - 8}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[12px]"
                  >
                    {pt.bucket.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

interface CategoryDonutChartProps {
  items: CategoryBreakdownItem[];
  totalExpense: number;
  currency: CurrencyCode;
  onDrilldownCategory?: (category: CategoryName) => void;
}

export function CategoryDonutChart({
  items,
  totalExpense,
  currency,
  onDrilldownCategory,
}: CategoryDonutChartProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryName | null>(null);

  const radius = 58;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;

  let offsetAcc = 0;
  const slices = items.map((item) => {
    const ratio = totalExpense > 0 ? item.spent / totalExpense : 0;
    const dash = ratio * circumference;
    const slice = {
      ...item,
      dashArray: `${dash} ${circumference}`,
      dashOffset: -offsetAcc,
    };
    offsetAcc += dash;
    return slice;
  });

  const activeItem =
    items.find((i) => i.category === selectedCategory) ?? null;

  if (items.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500 dark:text-slate-400 px-4 text-center">
        No categorized spending in this period yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[156px_1fr] gap-5 items-center">
        <div className="relative mx-auto w-[152px] h-[152px] flex items-center justify-center">
          <svg viewBox="0 0 156 156" className="w-full h-full -rotate-90">
            <circle
              cx="78"
              cy="78"
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              className="stroke-slate-100 dark:stroke-slate-800"
            />
            {slices.map((s) => {
              const isDimmed =
                selectedCategory !== null && selectedCategory !== s.category;
              return (
                <circle
                  key={s.category}
                  cx="78"
                  cy="78"
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={
                    selectedCategory === s.category ? strokeWidth + 3 : strokeWidth
                  }
                  strokeDasharray={s.dashArray}
                  strokeDashoffset={s.dashOffset}
                  className="cursor-pointer transition-opacity duration-150"
                  opacity={isDimmed ? 0.28 : 1}
                  onMouseEnter={() => setSelectedCategory(s.category)}
                  onMouseLeave={() => setSelectedCategory(null)}
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === s.category ? null : s.category
                    )
                  }
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[100px]">
              {activeItem ? activeItem.category : 'Total Spend'}
            </span>
            <span className="text-sm font-bold font-mono-tabular text-slate-900 dark:text-white mt-0.5">
              {formatCurrency(activeItem ? activeItem.spent : totalExpense, currency, {
                compact: true,
              })}
            </span>
            {activeItem && (
              <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                {activeItem.sharePct}%
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          {items.slice(0, 6).map((item) => {
            const isSelected = selectedCategory === item.category;
            return (
              <button
                key={item.category}
                type="button"
                onMouseEnter={() => setSelectedCategory(item.category)}
                onMouseLeave={() => setSelectedCategory(null)}
                onClick={() =>
                  onDrilldownCategory
                    ? onDrilldownCategory(item.category)
                    : setSelectedCategory(isSelected ? null : item.category)
                }
                className={`w-full min-h-[44px] sm:min-h-[38px] text-left rounded-lg px-2.5 py-2 sm:py-1.5 transition-colors ${
                  isSelected
                    ? 'bg-slate-100 dark:bg-slate-800/80'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 truncate">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.category}</span>
                  </span>
                  <span className="font-mono-tabular text-slate-700 dark:text-slate-300 shrink-0">
                    {formatCurrency(item.spent, currency)}{' '}
                    <span className="text-slate-400 dark:text-slate-500">
                      ({item.sharePct}%)
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${Math.min(100, item.sharePct)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {onDrilldownCategory && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>Tap a category to filter entries</span>
          <button
            type="button"
            onClick={() => onDrilldownCategory(items[0].category)}
            className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200 hover:underline whitespace-nowrap"
          >
            <span>View {items[0].category}</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
