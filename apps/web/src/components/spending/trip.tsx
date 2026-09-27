'use client';
import type { Snapshot, Trip } from '@/lib/data/port';
import { categoryBuckets, tripSeries } from '@/lib/spending-chart';
import { Card } from '../primitives';
import { SpendingChart } from './chart';
import { SpendingDrilldown } from './drilldown';
import { useSpendingNavigation } from './navigation';
import './spending.css';
export function TripSpending({
  snapshot,
  trip,
}: {
  snapshot: Snapshot;
  trip: Trip;
}) {
  const route = `/trips/${encodeURIComponent(trip.id)}`;
  const { searchParams, isActive, change, open } = useSpendingNavigation(route);
  const data = tripSeries(snapshot, trip),
    categories = categoryBuckets(snapshot, trip.id);
  const title =
    data.granularity === 'day'
      ? 'Spending by day'
      : data.granularity === 'month'
        ? 'Spending by month'
        : 'Spending by year';
  return (
    <div className="trip-spending-charts">
      <Card title={title}>
        <p>
          Household expense totals · {snapshot.household.currency} · Full
          coverage: {data.coverage}
        </p>
        <p>
          {data.granularity === 'day'
            ? 'Every travel day and out-of-range booking date is included, including zero days.'
            : `This long range is shown in ${data.granularity === 'month' ? 'monthly' : data.granularity === 'years' ? 'grouped yearly' : 'yearly'} buckets. No dates or expenses are omitted.`}{' '}
          Scroll the chart to inspect every bucket.
        </p>
        <SpendingChart
          title={`Trip ${title.toLowerCase()} chart`}
          namespace="trip-days"
          rows={data.buckets}
          currency={snapshot.household.currency}
          tableOpen={searchParams.get('dayData') === '1'}
          onTableChange={() =>
            change({ dayData: searchParams.get('dayData') === '1' ? '' : '1' })
          }
          onSelect={open}
          disabled={!isActive}
        />
      </Card>
      <Card title="Where it went">
        <p>
          Household trip expenses by category · {snapshot.household.currency}
        </p>
        <SpendingChart
          title="Trip categories"
          namespace="trip-categories"
          rows={categories}
          currency={snapshot.household.currency}
          tableOpen={searchParams.get('categoryData') === '1'}
          onTableChange={() =>
            change({
              categoryData: searchParams.get('categoryData') === '1' ? '' : '1',
            })
          }
          onSelect={open}
          horizontal
          disabled={!isActive}
        />
      </Card>
      <SpendingDrilldown
        snapshot={snapshot}
        scope="household"
        route={route}
        tripId={trip.id}
      />
    </div>
  );
}
