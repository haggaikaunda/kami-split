'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchQuery } from 'relay-runtime';
import contextDocument, {
  type expensesHouseholdContextQuery,
} from '@/lib/relay/__generated__/expensesHouseholdContextQuery.graphql';
import { useFinancialSession } from '@/components/groups/session';
import type { FinancialScope } from '@/lib/relay/environment';
import { WorkspaceHeader, WorkspaceTabs } from '@/components/primitives';
import { ExpenseLedger } from './ledger';
import '@/components/groups/journey.css';
export function HouseholdExpenses() {
  const access = useFinancialSession();
  return (
    <main className="financial-journey household-expenses" id="page-content">
      <Link href="/account">Kami Split · Account</Link>
      <WorkspaceHeader title="Household" context="Shared spaces" />
      {access.loading ? (
        <p role="status">Loading secure access…</p>
      ) : access.error ? (
        <p role="alert">{access.error}</p>
      ) : !access.scope ? (
        <p>
          <Link href="/sign-in?next=%2Fhousehold%2Fexpenses">Sign in</Link> to
          view Household expenses.
        </p>
      ) : (
        <HouseholdLedger key={access.scope.id} scope={access.scope} />
      )}
    </main>
  );
}
function HouseholdLedger({ scope }: { scope: FinancialScope }) {
  const [context, setContext] =
    useState<expensesHouseholdContextQuery['response']>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const request = fetchQuery<expensesHouseholdContextQuery>(
      scope.environment,
      contextDocument,
      {},
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next: (result) => {
        if (live && scope.isLive()) {
          if (
            result.viewer.__typename === 'Viewer' &&
            result.householdDashboard.__typename === 'HouseholdDashboard' &&
            result.householdDashboard.state === 'COMPLETE'
          )
            setContext(result);
          else
            setError(
              'Household expenses unavailable. Complete eligible spaces cannot be established.',
            );
        }
      },
      error: () => {
        if (live && scope.isLive())
          setError('Household access unavailable. Refresh to try again.');
      },
    });
    return () => {
      live = false;
      request.unsubscribe();
    };
  }, [scope, version]);
  const refresh = () => {
    setContext(undefined);
    setError('');
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    window.addEventListener('focus', refresh);
    const foreground = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, []);
  const dashboard = context?.householdDashboard,
    viewer = context?.viewer;
  if (error)
    return (
      <>
        <p role="alert">{error}</p>
        <button onClick={refresh}>Refresh Household access</button>
      </>
    );
  if (
    dashboard?.__typename !== 'HouseholdDashboard' ||
    viewer?.__typename !== 'Viewer'
  )
    return <p role="status">Loading complete Household access…</p>;
  const household = dashboard.spaces.find((space) => space.isHousehold);
  return (
    <>
      <WorkspaceTabs
        current="Expenses"
        hrefFor={(section) =>
          section === 'Expenses'
            ? '/household/expenses'
            : section === 'Activity'
              ? '/household/activity'
              : household
                ? `/groups/${encodeURIComponent(household.groupId)}?tab=${section.toLowerCase()}`
                : '/groups'
        }
      />
      <ExpenseLedger
        scope={scope}
        spaces={dashboard.spaces}
        today={viewer.today}
        net={
          dashboard.totals?.__typename === 'HouseholdDashboardTotals'
            ? dashboard.totals.viewerNetMinor
            : undefined
        }
        activeSpaces={
          dashboard.totals?.__typename === 'HouseholdDashboardTotals'
            ? dashboard.totals.activeSpaceCount
            : undefined
        }
        onRefreshContext={refresh}
        onDenied={() => {
          setContext(undefined);
          setError(
            'Household access changed. Refresh to recheck eligible spaces.',
          );
        }}
      />
    </>
  );
}
