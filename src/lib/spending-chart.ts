import type { ExpenseRecord, Snapshot, Trip } from './data/port';
import { checkedSum, spending, validDate } from './ledger';
export type ChartMode = 'daily' | 'monthly' | 'yearly';
export type ChartScope = 'household' | 'share';
export type ChartPeriod = { mode: ChartMode; year: number; month: number };
export type Bucket = {
  id: string;
  label: string;
  shortLabel: string;
  start?: string;
  end?: string;
  category?: string;
};
export type SpendingBucket = Bucket & {
  total: number;
  count: number;
  expenses: ExpenseRecord[];
};
export type SpendingSeries = {
  buckets: SpendingBucket[];
  total: number;
  count: number;
  start: string;
  end: string;
  granularity: 'day' | 'month' | 'year' | 'years';
  coverage: string;
};
const pad = (value: number, size = 2) => String(value).padStart(size, '0');
const yearText = (year: number) => pad(year, 4);
export function monthLastDay(year: number, month: number): number {
  if (
    !Number.isInteger(year) ||
    year < 0 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new Error('Unsupported period');
  return [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
}
const monthStart = (year: number, month: number) =>
  `${yearText(year)}-${pad(month)}-01`;
const monthEnd = (year: number, month: number) =>
  `${yearText(year)}-${pad(month)}-${pad(monthLastDay(year, month))}`;
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
function dayBucket(date: string): Bucket {
  return {
    id: `day:${date}`,
    label: `${dateLabel(date, { month: 'short', day: 'numeric' })}, ${date.slice(0, 4)}`,
    shortLabel: String(Number(date.slice(8))),
    start: date,
    end: date,
  };
}
function monthBucket(year: number, month: number): Bucket {
  const start = monthStart(year, month);
  return {
    id: `month:${start.slice(0, 7)}`,
    label: `${dateLabel(start, { month: 'long' })} ${yearText(year)}`,
    shortLabel: dateLabel(start, { month: 'short' }),
    start,
    end: monthEnd(year, month),
  };
}
function yearBucket(startYear: number, endYear = startYear): Bucket {
  const start = yearText(startYear),
    end = yearText(endYear);
  return {
    id: startYear === endYear ? `year:${start}` : `years:${start}-${end}`,
    label: start === end ? start : `${start}–${end}`,
    shortLabel: start === end ? start : `${start}–${end}`,
    start: `${start}-01-01`,
    end: `${end}-12-31`,
  };
}
/** An independent URL bucket identity survives when its last contributing record moves. */
export function bucketFromId(id: string): Bucket | undefined {
  let match = id.match(/^day:(\d{4}-\d{2}-\d{2})$/);
  if (match && validDate(match[1])) return dayBucket(match[1]);
  match = id.match(/^month:(\d{4})-(\d{2})$/);
  if (match && validDate(`${match[1]}-${match[2]}-01`))
    return monthBucket(Number(match[1]), Number(match[2]));
  match = id.match(/^year:(\d{4})$/);
  if (match) return yearBucket(Number(match[1]));
  match = id.match(/^years:(\d{4})-(\d{4})$/);
  if (match && Number(match[1]) <= Number(match[2]))
    return yearBucket(Number(match[1]), Number(match[2]));
  if (id.startsWith('category:') && id.length > 9 && id.length <= 129)
    return {
      id,
      label: id.slice(9),
      shortLabel: id.slice(9),
      category: id.slice(9),
    };
  return undefined;
}
export function readChartPeriod(
  params: URLSearchParams,
  today: string,
): ChartPeriod {
  if (!validDate(today)) throw new Error('A valid injected date is required');
  const mode: ChartMode =
    params.get('chartMode') === 'daily'
      ? 'daily'
      : params.get('chartMode') === 'yearly'
        ? 'yearly'
        : 'monthly';
  const requested = params.get('period');
  const date =
    requested && /^\d{4}-\d{2}$/.test(requested) && validDate(`${requested}-01`)
      ? requested
      : today.slice(0, 7);
  return {
    mode,
    year: Math.max(mode === 'yearly' ? 4 : 0, Number(date.slice(0, 4))),
    month: Number(date.slice(5, 7)),
  };
}
export function periodParam(period: ChartPeriod): string {
  return `${yearText(period.year)}-${pad(period.month)}`;
}
export function shiftChartPeriod(
  period: ChartPeriod,
  direction: -1 | 1,
): ChartPeriod | undefined {
  let { year, month } = period;
  if (period.mode === 'daily') {
    month += direction;
    if (month === 0) {
      month = 12;
      year--;
    }
    if (month === 13) {
      month = 1;
      year++;
    }
  } else year += direction * (period.mode === 'yearly' ? 5 : 1);
  if (year < (period.mode === 'yearly' ? 4 : 0) || year > 9999)
    return undefined;
  return { ...period, year, month };
}
export function householdDefinitions(period: ChartPeriod): Bucket[] {
  monthLastDay(period.year, period.month);
  if (period.mode === 'daily')
    return Array.from(
      { length: monthLastDay(period.year, period.month) },
      (_, index) =>
        dayBucket(
          `${yearText(period.year)}-${pad(period.month)}-${pad(index + 1)}`,
        ),
    );
  if (period.mode === 'monthly')
    return Array.from({ length: 12 }, (_, index) =>
      monthBucket(period.year, index + 1),
    );
  if (period.year < 4)
    throw new Error('Five-year window must have five supported years');
  return Array.from({ length: 5 }, (_, index) =>
    yearBucket(period.year - 4 + index),
  );
}
export function expenseScopeAmount(
  expense: ExpenseRecord,
  scope: ChartScope,
  actorId: string,
): number {
  return scope === 'household'
    ? expense.amount
    : (expense.allocations.find((row) => row.memberId === actorId)?.amount ??
        0);
}
export function spendingBucket(
  snapshot: Snapshot,
  bucket: Bucket,
  scope: ChartScope,
  tripId?: string,
): SpendingBucket {
  const selected = spending(snapshot.expenses, {
    currency: snapshot.household.currency,
    memberId: scope === 'share' ? snapshot.actorId : undefined,
    tripId,
    start: bucket.start,
    end: bucket.end,
    category: bucket.category,
  });
  const ids = new Set(selected.expenses.map((row) => row.id));
  return {
    ...bucket,
    total: selected.total,
    count: selected.count,
    expenses: snapshot.expenses
      .filter((row) => ids.has(row.id))
      .sort(
        (a, b) =>
          b.effectiveDate.localeCompare(a.effectiveDate) ||
          a.id.localeCompare(b.id),
      ),
  };
}
function series(
  snapshot: Snapshot,
  definitions: Bucket[],
  scope: ChartScope,
  start: string,
  end: string,
  granularity: SpendingSeries['granularity'],
  tripId?: string,
): SpendingSeries {
  const buckets = definitions.map((bucket) =>
    spendingBucket(snapshot, bucket, scope, tripId),
  );
  return {
    buckets,
    total: checkedSum(buckets.map((row) => row.total)),
    count: checkedSum(buckets.map((row) => row.count)),
    start,
    end,
    granularity,
    coverage: `${start} to ${end}`,
  };
}
export function householdSeries(
  snapshot: Snapshot,
  period: ChartPeriod,
  scope: ChartScope,
): SpendingSeries {
  const definitions = householdDefinitions(period);
  return series(
    snapshot,
    definitions,
    scope,
    definitions[0].start!,
    definitions.at(-1)!.end!,
    period.mode === 'daily'
      ? 'day'
      : period.mode === 'monthly'
        ? 'month'
        : 'year',
  );
}
/** Full travel plus recorded expense extent. Long ranges aggregate explicitly, never truncate. */
export function tripSeries(
  snapshot: Snapshot,
  trip: Trip,
  scope: ChartScope = 'household',
): SpendingSeries {
  const expenses = spending(snapshot.expenses, {
    currency: snapshot.household.currency,
    tripId: trip.id,
  }).expenses;
  const dates = [
    trip.start,
    trip.end,
    ...expenses.map((row) => row.effectiveDate),
  ].sort();
  const start = dates[0],
    end = dates.at(-1)!;
  if (!validDate(start) || !validDate(end))
    throw new Error('Valid trip extent is required');
  const first = Date.parse(`${start}T00:00:00Z`),
    last = Date.parse(`${end}T00:00:00Z`);
  const days = (last - first) / 86400000 + 1;
  let definitions: Bucket[], granularity: SpendingSeries['granularity'];
  if (days <= 93) {
    granularity = 'day';
    definitions = Array.from({ length: days }, (_, index) =>
      dayBucket(new Date(first + index * 86400000).toISOString().slice(0, 10)),
    );
  } else {
    const sy = Number(start.slice(0, 4)),
      ey = Number(end.slice(0, 4));
    const sm = Number(start.slice(5, 7)),
      em = Number(end.slice(5, 7));
    const months = (ey - sy) * 12 + em - sm + 1;
    if (months <= 60) {
      granularity = 'month';
      definitions = Array.from({ length: months }, (_, index) => {
        const ordinal = sy * 12 + sm - 1 + index;
        return monthBucket(Math.floor(ordinal / 12), (ordinal % 12) + 1);
      });
    } else {
      const step = Math.ceil((ey - sy + 1) / 60);
      granularity = step === 1 ? 'year' : 'years';
      definitions = [];
      for (let year = sy; year <= ey; year += step)
        definitions.push(yearBucket(year, Math.min(ey, year + step - 1)));
    }
  }
  return series(snapshot, definitions, scope, start, end, granularity, trip.id);
}
export function categoryBuckets(
  snapshot: Snapshot,
  tripId: string,
  scope: ChartScope = 'household',
): SpendingBucket[] {
  const categories = [
    ...new Set(
      spending(snapshot.expenses, {
        currency: snapshot.household.currency,
        tripId,
      }).expenses.map((row) => row.category),
    ),
  ].sort();
  return categories.map((category) =>
    spendingBucket(
      snapshot,
      {
        id: `category:${category}`,
        label: category,
        shortLabel: category,
        category,
      },
      scope,
      tripId,
    ),
  );
}
