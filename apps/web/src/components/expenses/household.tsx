'use client';
import { workspaceFetchPolicy } from '@/lib/relay/query';
import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fetchQuery, readInlineData } from 'relay-runtime';
import initialDocument, {
  type expensesHouseholdInitialQuery,
} from '@/lib/relay/__generated__/expensesHouseholdInitialQuery.graphql';
import viewDocument, {
  type expensesView$key,
} from '@/lib/relay/__generated__/expensesView.graphql';
import { expenseFilterText, expenseFilter } from '@/lib/relay/expense-filter';
import { useFinancialSession } from '@/components/groups/session';
import { useForegroundRefresh } from '@/components/groups/foreground';
import type { FinancialScope } from '@/lib/relay/environment';
import { Skeleton } from '../ui/primitives';
import { ExpenseLedger } from './ledger';

export function HouseholdExpenses() {
  const access = useFinancialSession();
  return access.loading ? (
    <Skeleton size="workspace" label="Loading workspace" />
  ) : access.error ? (
    <p role="alert">{access.error}</p>
  ) : !access.scope ? (
    <p>
      <Link href="/sign-in?next=%2Fhousehold%2Fexpenses">Sign in</Link> to view
      Household expenses.
    </p>
  ) : (
    <HouseholdLedger key={access.scope.id} scope={access.scope} />
  );
}
/** The two root fields may use different transactions. Only matching server
 * context versions permit combining their private rows, totals and controls. */
export function HouseholdLedger({ scope }: { scope: FinancialScope }) {
  const params = useSearchParams();
  const filters = expenseFilterText(params);
  const [context, setContext] = useState<{
    result: expensesHouseholdInitialQuery['response'];
    filters: string;
  }>();
  const [saved, setSaved] = useState(false);
  const savedNotice = saved ? (
    <p role="status">
      Expense edit saved. Current expenses and balances are a separate
      authorized refresh; unavailable data does not undo your edit.
    </p>
  ) : null;
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const generation = useRef(0);
  const invalidate = () => {
    scope.invalidate?.();
    generation.current++;
    request.current?.unsubscribe();
    setContext(undefined);
    setError('');
  };
  const refresh = () => {
    invalidate();
    setVersion((v) => v + 1);
  };
  useForegroundRefresh(invalidate, () => setVersion((v) => v + 1));
  useEffect(() => {
    const ticket = ++generation.current;
    let active = true;
    const live = () =>
      active && scope.isLive() && generation.current === ticket;
    request.current = fetchQuery<expensesHouseholdInitialQuery>(
      scope.environment,
      initialDocument,
      { filter: expenseFilter(filters) },
      {
        fetchPolicy:
          version === 0 && !params.has('create')
            ? workspaceFetchPolicy(scope.environment, initialDocument, {
                filter: expenseFilter(filters),
              })
            : 'network-only',
      },
    ).subscribe({
      next: (result) => {
        if (!live()) return;
        const dashboard = result.householdDashboard;
        const view = result.householdExpenses
          ? readInlineData<expensesView$key>(
              viewDocument,
              result.householdExpenses,
            )
          : undefined;
        if (
          result.viewer?.__typename === 'Viewer' &&
          dashboard?.__typename === 'HouseholdDashboard' &&
          dashboard.state === 'COMPLETE' &&
          dashboard.contextVersion &&
          view?.__typename === 'ExpenseView' &&
          view.contextVersion === dashboard.contextVersion
        ) {
          setContext({ result, filters });
        } else {
          setContext(undefined);
          setError(
            'Household expenses unavailable. Access or eligible spaces changed between reads. Refresh to recheck complete access.',
          );
        }
      },
      error: () => {
        if (live()) {
          setContext(undefined);
          setError('Household access unavailable. Refresh to try again.');
        }
      },
    });
    return () => {
      active = false;
      request.current?.unsubscribe();
    };
    // Filter changes are owned by the ledger traversal. A response keeps its original filter identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, version]);
  const dashboard = context?.result.householdDashboard,
    viewer = context?.result.viewer;
  const refreshControl = (
    <WorkspaceRefresh
      busy={!context && !error}
      error={error}
      onRefresh={() => {
        scope.expensePositions?.clear();
        refresh();
      }}
    />
  );
  if (error)
    return (
      <WorkspaceLoading busy={!context && !error}>
        {savedNotice}
        {refreshControl}
        <p role="alert">{error}</p>
      </WorkspaceLoading>
    );
  if (
    dashboard?.__typename !== 'HouseholdDashboard' ||
    viewer?.__typename !== 'Viewer' ||
    !context
  )
    return (
      <WorkspaceLoading busy={!context && !error}>
        {savedNotice}
        {refreshControl}
        <Skeleton size="workspace" label="Loading expenses" />
      </WorkspaceLoading>
    );
  return (
    <WorkspaceLoading busy={!context && !error}>
      {savedNotice}
      {refreshControl}
      <ExpenseLedger
        key={version}
        scope={scope}
        spaces={dashboard.spaces}
        today={viewer.today}
        contextVersion={dashboard.contextVersion!}
        initialView={{
          filterText: context.filters,
          reference: context.result.householdExpenses,
        }}
        managedRefresh
        activeSpaces={
          dashboard.totals?.__typename === 'HouseholdDashboardTotals'
            ? dashboard.totals.activeSpaceCount
            : undefined
        }
        onRefreshContext={refresh}
        onEditSaved={() => setSaved(true)}
        onDenied={() => {
          invalidate();
          setError(
            'Household access changed. Refresh to recheck eligible spaces.',
          );
        }}
      />
    </WorkspaceLoading>
  );
}
