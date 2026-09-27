'use client';
import type { Snapshot } from '@/lib/data/port';
import {
  householdSeries,
  periodParam,
  readChartPeriod,
  shiftChartPeriod,
  type ChartMode,
  type ChartScope,
} from '@/lib/spending-chart';
import { formatMoney } from '@/lib/ledger';
import { Button, Card, SelectField } from '../primitives';
import { SpendingChart } from './chart';
import { SpendingDrilldown } from './drilldown';
import { useSpendingNavigation } from './navigation';
import './spending.css';
export function HouseholdSpending({ snapshot }: { snapshot: Snapshot }) {
  const { searchParams, isActive, change, open } = useSpendingNavigation('/');
  const period = readChartPeriod(searchParams, snapshot.today);
  const scope: ChartScope =
    searchParams.get('scope') === 'share' ? 'share' : 'household';
  const data = householdSeries(snapshot, period, scope);
  const previous = shiftChartPeriod(period, -1),
    next = shiftChartPeriod(period, 1);
  return (
    <Card title="Spending, in perspective">
      <div className="spending-heading">
        <div>
          <p className="spending-total ui-money">
            {formatMoney(data.total, snapshot.household.currency)}
          </p>
          <p>
            {scope === 'share'
              ? 'Your allocated share'
              : 'Household expense spending'}{' '}
            · {data.count} expenses
          </p>
          <p>{data.coverage}</p>
        </div>
        <div className="spending-controls">
          <div className="ui-actions" role="group" aria-label="Chart view">
            {(['daily', 'monthly', 'yearly'] as ChartMode[]).map((mode) => (
              <Button
                key={mode}
                tone={period.mode === mode ? 'primary' : 'secondary'}
                aria-pressed={period.mode === mode}
                disabled={!isActive}
                onClick={() => change({ chartMode: mode })}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
          <SelectField
            label="Spending scope"
            value={scope}
            disabled={!isActive}
            onChange={(event) => change({ scope: event.target.value })}
          >
            <option value="household">Household expense totals</option>
            <option value="share">My allocated share</option>
          </SelectField>
        </div>
      </div>
      <div className="spending-period">
        <Button
          tone="secondary"
          disabled={!isActive || !previous}
          onClick={() => previous && change({ period: periodParam(previous) })}
        >
          Previous{' '}
          {period.mode === 'daily'
            ? 'month'
            : period.mode === 'monthly'
              ? 'year'
              : 'five years'}
        </Button>
        <span>
          {period.mode === 'daily'
            ? periodParam(period)
            : period.mode === 'monthly'
              ? String(period.year)
              : `${period.year - 4}–${period.year}`}
        </span>
        <Button
          tone="secondary"
          disabled={!isActive || !next}
          onClick={() => next && change({ period: periodParam(next) })}
        >
          Next{' '}
          {period.mode === 'daily'
            ? 'month'
            : period.mode === 'monthly'
              ? 'year'
              : 'five years'}
        </Button>
      </div>
      <SpendingChart
        title={
          scope === 'share' ? 'Your allocated spending' : 'Household spending'
        }
        namespace="household-spending"
        rows={data.buckets}
        currency={snapshot.household.currency}
        tableOpen={searchParams.get('chartData') === '1'}
        onTableChange={() =>
          change({
            chartData: searchParams.get('chartData') === '1' ? '' : '1',
          })
        }
        onSelect={open}
        disabled={!isActive}
      />
      <SpendingDrilldown snapshot={snapshot} scope={scope} route="/" />
    </Card>
  );
}
