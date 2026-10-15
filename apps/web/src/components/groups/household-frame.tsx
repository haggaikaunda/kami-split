'use client';
import { ExpenseEntryProvider } from '@/components/expenses/entry';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFinancialSession } from './session';
import { HouseholdBannerAction } from './household-banner-action';
import { RichHelp, householdScopeHelp } from '@/components/rich-help';
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
  WorkspacePrivacy,
  WorkspaceTabs,
  workspaceSections,
  type WorkspaceSection,
} from '../workspace/patterns';
import { cx } from '../ui/classnames';

import shellStyles from '../workspace/shell.module.css';
import formLayoutStyles from '../ui/form-layout.module.css';

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
    <ExpenseEntryProvider scope={access.scope} visit={`${pathname}:${current}`}>
      <main
        data-ui="form-scope group-workspace household-workspace"
        className={cx(formLayoutStyles['form-scope'], shellStyles.shell)}
        id="page-content"
      >
        <WorkspaceNavigation />
        <div
          data-ui="workspace-content"
          className={shellStyles['workspace-content']}
        >
          <p
            data-ui="workspace-crumb"
            className={shellStyles['workspace-crumb']}
          >
            Your household
          </p>
          <WorkspaceHeader
            title="Household"
            context={
              <>
                <span>Shared spending, at home and away.</span>
                <br />
                <RichHelp label="What’s included">
                  {householdScopeHelp}
                </RichHelp>
              </>
            }
            appearance="household"
          >
            {access.scope && (
              <HouseholdBannerAction
                key={`${access.scope.id}:${intentVisit}`}
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
    </ExpenseEntryProvider>
  );
}
