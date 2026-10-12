'use client';
import Link from 'next/link';
import { useHouseholdMembers } from './household-members';
import type { FinancialScope } from '@/lib/relay/environment';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFinancialSession } from './session';
import { createWorkspaceIntent } from '@/lib/relay/intent';
import householdDocument from '@/lib/relay/__generated__/householdWorkspaceQuery.graphql';
import activityDocument from '@/lib/relay/__generated__/activityHouseholdQuery.graphql';
import accessDocument from '@/lib/relay/__generated__/householdAccessQuery.graphql';
import expensesDocument from '@/lib/relay/__generated__/expensesHouseholdInitialQuery.graphql';
import { expenseFilter } from '@/lib/relay/expense-filter';
import { usePathname, useSearchParams } from 'next/navigation';
import { AppIcon, WorkspaceNavigation } from '@/components/workspace-identity';
import {
  WorkspaceHeader,
  WorkspacePrivacy,
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
      <div className="workspace-content">
        <p className="workspace-crumb">Your household</p>
        <WorkspaceHeader
          title={ledger ? 'Household ledger' : 'Household'}
          context={
            ledger
              ? 'Household source ledger only. Expenses and repayments stay in this space.'
              : 'Household ledger and currently eligible groups and trips.'
          }
          appearance="household"
          compact={current !== 'Overview'}
        >
          {access.scope && (
            <HouseholdInvitationEntry
              key={access.scope.id}
              scope={access.scope}
            />
          )}
        </WorkspaceHeader>
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
        {access.scope && <WorkspacePrivacy />}
      </div>
    </main>
  );
}

function HouseholdInvitationEntry({ scope }: { scope: FinancialScope }) {
  const { members } = useHouseholdMembers(scope);
  return members?.viewerMembership.role === 'OWNER' ? (
    <Link className="banner-action" href="/household?tab=members#invitations">
      <AppIcon name="invite" />
      Manage invitations
    </Link>
  ) : null;
}
