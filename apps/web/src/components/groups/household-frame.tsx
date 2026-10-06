'use client';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFinancialSession } from './session';
import { createWorkspaceIntent } from '@/lib/relay/intent';
import householdDocument from '@/lib/relay/__generated__/householdWorkspaceQuery.graphql';
import activityDocument from '@/lib/relay/__generated__/activityHouseholdQuery.graphql';
import accessDocument from '@/lib/relay/__generated__/householdAccessQuery.graphql';
import expensesDocument from '@/lib/relay/__generated__/expensesHouseholdInitialQuery.graphql';
import { expenseFilter } from '@/lib/relay/expense-filter';
import { usePathname, useSearchParams } from 'next/navigation';
import { WorkspaceNavigation } from '@/components/workspace-identity';
import {
  WorkspaceHeader,
  WorkspaceTabs,
  workspaceSections,
  type WorkspaceSection,
} from '@/components/primitives';
import './journey.css';
import './household-workspace.css';
export function householdHref(section: WorkspaceSection) {
  return section === 'Expenses'
    ? '/household/expenses'
    : section === 'Activity'
      ? '/household/activity'
      : `/household?tab=${section.toLowerCase()}`;
}
/** Public frame persists in the Household layout; it owns no private data. */
export function HouseholdFrame({ children }: { children: React.ReactNode }) {
  const access = useFinancialSession();
  const intent = useMemo(
    () => (access.scope ? createWorkspaceIntent(access.scope) : undefined),
    [access.scope],
  );
  useEffect(() => () => intent?.cancel(), [intent]);
  const pathname = usePathname(),
    params = useSearchParams();
  const intentVisit = pathname + '?' + params.toString();
  useLayoutEffect(() => {
    intent?.cancel();
  }, [intent, intentVisit]);
  useEffect(() => {
    const cancel = () => intent?.cancel();
    window.addEventListener('focus', cancel);
    window.addEventListener('pageshow', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('focus', cancel);
      window.removeEventListener('pageshow', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [intent]);
  const ledger = pathname === '/household/ledger';
  const current =
    params.get('repayment') === '1'
      ? 'Balances'
      : pathname.endsWith('/expenses')
        ? 'Expenses'
        : pathname.endsWith('/activity')
          ? 'Activity'
          : (workspaceSections.find(
              (s) => s.toLowerCase() === params.get('tab'),
            ) ?? 'Overview');
  return (
    <main
      className="financial-journey group-workspace household-workspace"
      id="page-content"
    >
      <WorkspaceNavigation />
      <WorkspaceHeader
        title={ledger ? 'Household ledger' : 'Household'}
        context={
          ledger
            ? 'Original home ledger. Expenses and repayments stay in this Household.'
            : 'Shared expenses across home, trips and groups.'
        }
        appearance="household"
      />
      <WorkspaceTabs
        current={current}
        hrefFor={
          ledger
            ? (section) => `/household/ledger?tab=${section.toLowerCase()}`
            : householdHref
        }
        label="Household workspace"
        onIntentEnd={(section) => intent?.cancel(section)}
        onIntent={(section) => {
          if (ledger) return;
          const document =
            section === 'Activity'
              ? activityDocument
              : section === 'Members'
                ? accessDocument
                : section === 'Expenses'
                  ? expensesDocument
                  : householdDocument;
          const variables =
            section === 'Activity' || section === 'Members'
              ? {}
              : section === 'Expenses'
                ? { filter: expenseFilter('') }
                : {
                    recent: section === 'Overview',
                    balances: section === 'Balances',
                  };
          intent?.warm({ document, variables, key: section });
        }}
      />
      {children}
    </main>
  );
}
