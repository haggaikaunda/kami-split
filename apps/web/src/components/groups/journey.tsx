'use client';
import { ExpenseEntryProvider } from '@/components/expenses/entry';

import { cx } from '../ui/classnames';
import { financialReadMessage as message } from '@/lib/relay/read-error';
import { NetworkQuery } from '@/lib/relay/query';
import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { AppIcon, WorkspaceNavigation } from '@/components/workspace-identity';
import Link from 'next/link';
import { expenseFilter, expenseFilterText } from '@/lib/relay/expense-filter';
import {
  WorkspaceTabs,
  WorkspacePrivacy,
  workspaceSections,
  WorkspaceHeader,
} from '../workspace/patterns';
import { ContentLoading, type LoadingLayout } from '../ui/loading';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { readInlineData } from 'relay-runtime';
import expenseView, {
  type expensesView$key,
} from '@/lib/relay/__generated__/expensesView.graphql';
import activityFeed, {
  type activityFeed$key,
} from '@/lib/relay/__generated__/activityFeed.graphql';
import groupDocument, {
  type journeyWorkspaceQuery,
} from '@/lib/relay/__generated__/journeyWorkspaceQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { RestoreSource, ScopedLink, SourceReturn } from './navigation';
import { householdLedgerHref, spaceHref } from '@/lib/relay/space-routes';
import { routeId } from '@/lib/relay/discovery';
import { ExpensePresentation } from '@/components/expenses/presentation';
import { ExpenseDetail } from './expense-detail';
import { GroupWorkspace } from './workspace';
import { useFinancialSession } from './session';
import { ViewerJourney } from './discovery';

import { workspaceRequest } from '@/lib/relay/workspace-request';
import { useForegroundRefresh } from './foreground';

import shellStyles from '../workspace/shell.module.css';
import formLayoutStyles from '../ui/form-layout.module.css';
import workspaceFeatureStyles from './workspace.module.css';

export function GroupJourney({
  initialGroup: pathGroup = '',
  expense: pathExpense = '',
  repayment = false,
  trips = false,
  filter = 'all',
  selection = 'all',
  creation,
  household = false,
}: {
  household?: boolean;
  creation?: 'ORDINARY' | 'TRIP';
  initialGroup?: string;
  expense?: string;
  repayment?: boolean;
  trips?: boolean;
  filter?: string;
  selection?: string;
}) {
  const initialGroup = routeId(pathGroup),
    expense = routeId(pathExpense);
  const access = useFinancialSession();
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const params = useSearchParams(),
    pathname = usePathname();
  const groupBase = `${pathname.startsWith('/trips/') ? '/trips' : '/groups'}/${encodeURIComponent(initialGroup)}`;
  const currentTab =
    workspaceSections.find((t) => t.toLowerCase() === params.get('tab')) ??
    (params.has('after') ? 'Expenses' : 'Overview');
  const visitParams = new URLSearchParams(params);
  for (const key of [
    'tab',
    'expense',
    'expenseGroup',
    'detailSource',
    'view',
    'basis',
    'create',
    'groupId',
    'category',
    'memberId',
    'categories',
    'memberIds',
    'paidByIds',
    'sort',
    'activityKind',
    'from',
    'to',
  ])
    visitParams.delete(key);
  const returnQuery = new URLSearchParams();
  for (const key of ['tab', 'sender', 'recipient', 'amount', 'kind']) {
    const value = params.get(key);
    if (value) returnQuery.set(key, value);
  }
  const signInReturn = pathname + (returnQuery.size ? `?${returnQuery}` : '');
  const body = access.loading ? (
    <ContentLoading layout={currentTab.toLowerCase() as LoadingLayout} />
  ) : access.error ? (
    <p role="alert">{access.error}</p>
  ) : !access.scope ? (
    <p>
      <Link href={`/sign-in?next=${encodeURIComponent(signInReturn)}`}>
        Sign in
      </Link>{' '}
      with your invited account to see your groups.
    </p>
  ) : initialGroup ? (
    <>
      {household && <SourceReturn scope={access.scope} household />}
      <GroupDetails
        key={`${access.scope.id}:${initialGroup}:${expense}:${repayment}:${currentTab}:${visitParams}`}
        scope={access.scope}
        household={household}
        headerTarget={headerTarget}
        actionTarget={actionTarget}
        id={initialGroup}
        expense={expense}
        repayment={repayment}
      />
    </>
  ) : (
    <ViewerJourney
      key={`${access.scope.id}:${initialGroup}:${expense}:${repayment}:${trips}:${selection}:${filter}:${pathname}:${visitParams.toString()}`}
      scope={access.scope}
      trips={trips}
      selection={trips ? 'trips' : selection}
      filter={filter}
      creation={creation}
    />
  );
  if (household) return body;
  return (
    <ExpenseEntryProvider
      scope={access.scope}
      visit={`${pathname}:${currentTab}`}
    >
      <main
        data-ui="form-scope"
        className={cx(formLayoutStyles['form-scope'], shellStyles.shell)}
        id="page-content"
      >
        <WorkspaceNavigation
          headerRef={initialGroup ? setHeaderTarget : undefined}
          actionRef={initialGroup ? setActionTarget : undefined}
        />
        <div
          data-ui="workspace-content"
          className={shellStyles['workspace-content']}
        >
          <header
            data-ui="journey-page-heading form-region"
            className={workspaceFeatureStyles['journey-page-heading']}
          >
            {!initialGroup && (
              <h1 data-page-heading tabIndex={-1}>
                {creation
                  ? creation === 'TRIP'
                    ? 'New trip'
                    : 'New group'
                  : 'Groups'}
              </h1>
            )}
          </header>
          {initialGroup && (
            <>
              {access.scope && (
                <div
                  data-ui="workspace-crumb"
                  className={shellStyles['workspace-crumb']}
                >
                  <SourceReturn scope={access.scope} />
                </div>
              )}
              <WorkspaceTabs
                current={repayment ? 'Balances' : currentTab}
                label={trips ? 'Trip workspace' : 'Group workspace'}
                hrefFor={(section) =>
                  `${groupBase}?tab=${section.toLowerCase()}`
                }
              />
            </>
          )}
          {body}
          {initialGroup && access.scope && <WorkspacePrivacy />}
        </div>
      </main>
    </ExpenseEntryProvider>
  );
}
function GroupDetails({
  headerTarget,
  actionTarget,
  scope,
  id,
  expense,
  repayment,
  household = false,
}: {
  household?: boolean;
  headerTarget: HTMLDivElement | null;
  actionTarget: HTMLDivElement | null;
  scope: FinancialScope;
  id: string;
  expense: string;
  repayment: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    pathname = usePathname();
  const after = params.get('after');
  const tab = (
    workspaceSections.find((s) => s.toLowerCase() === params.get('tab')) ??
    (after ? 'Expenses' : 'Overview')
  ).toLowerCase();
  const filters = expenseFilterText(params);
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const [state, setState] = useState({ busy: true, error: false });
  const [domainError, setDomainError] = useState('');
  const [heading, setHeading] = useState('Workspace');
  const [saved, setSaved] = useState('');
  const [activityRead, setActivityRead] = useState({ busy: false, error: '' });
  const savedStatus = useRef<HTMLParagraphElement>(null);
  const invalidate = () => {
    setActive(false);
    setDomainError('');
    setHeading('Workspace');
    setState({ busy: true, error: false });
  };
  const read = async () => {
    scope.invalidate?.();
    setVersion((v) => v + 1);
    setActive(true);
    setDomainError('');
    setHeading('Workspace');
    setState({ busy: true, error: false });
  };
  useForegroundRefresh(invalidate, () => void read());
  const midnightRead = useEffectEvent(read);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (document.visibilityState === 'visible') void midnightRead();
      },
      86400000 - (Date.now() % 86400000),
    );
    return () => clearTimeout(timer);
  }, [version]);
  useEffect(() => {
    if (!saved || state.busy) return;
    const frame = requestAnimationFrame(() => {
      if (scope.isLive()) savedStatus.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [saved, state.busy, scope]);
  const error = domainError || (state.error ? message('UNAVAILABLE') : '');
  const loading = (
    <>
      {!household &&
        headerTarget &&
        createPortal(
          <WorkspaceHeader
            title={pathname.startsWith('/trips/') ? 'Trip' : 'Group'}
            appearance={pathname.startsWith('/trips/') ? 'trip' : 'group'}
          />,
          headerTarget,
        )}
      <ContentLoading
        layout={
          expense ? 'expenses' : repayment ? 'balances' : (tab as LoadingLayout)
        }
      />
    </>
  );
  const failure = (
    <GroupFailure
      household={household}
      pathname={pathname}
      error={error || message('UNAVAILABLE')}
    />
  );
  return (
    <WorkspaceLoading busy={state.busy}>
      {!household && !state.busy && heading && (
        <h1 tabIndex={-1} data-page-heading>
          {heading}
        </h1>
      )}
      {saved && (
        <p ref={savedStatus} role="status" tabIndex={-1}>
          {saved}
        </p>
      )}
      <WorkspaceRefresh
        contentPending
        busy={state.busy || activityRead.busy}
        error={error || activityRead.error}
        onRefresh={() => {
          scope.expensePositions?.clear();
          if (after) {
            const next = new URLSearchParams(params);
            next.delete('after');
            router.replace(`${pathname}?${next}`, { scroll: false });
          } else void read();
        }}
      />
      {active ? (
        <NetworkQuery<journeyWorkspaceQuery>
          reuse={
            !expense && !repayment && !params.has('create') && version === 0
          }
          scope={scope}
          key={`${version}:${after}`}
          document={groupDocument}
          variables={
            workspaceRequest(id, tab, filters, !!expense, repayment).variables
          }
          fallback={loading}
          failure={failure}
          onError={(error) => {
            setHeading('Workspace unavailable');
            setDomainError(message(error.message));
          }}
          onState={(state) => {
            if (state.busy) setHeading('Workspace');
            setState(state);
          }}
        >
          {(result, requestedVariables) => (
            <GroupDestination
              result={result}
              scope={scope}
              id={id}
              household={household}
              expense={expense}
              repayment={repayment}
              tab={tab}
              filters={filters}
              requestedFilter={requestedVariables.filter}
              saved={saved}
              setSaved={setSaved}
              read={read}
              headerTarget={headerTarget}
              actionTarget={actionTarget}
              setActivityRead={setActivityRead}
              onError={(error, heading) => {
                setHeading(heading);
                setDomainError(error);
              }}
              onDenied={() => {
                setActive(false);
                setState({ busy: false, error: false });
                setHeading('Group unavailable');
                setDomainError(message('NOT_FOUND'));
              }}
            />
          )}
        </NetworkQuery>
      ) : error ? (
        failure
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function GroupFailure({
  household,
  pathname,
  error,
}: {
  household: boolean;
  pathname: string;
  error: string;
}) {
  return (
    <>
      <p role="alert">{error}</p>
      <Link
        href={
          household
            ? '/household'
            : pathname.startsWith('/trips/')
              ? '/trips'
              : '/groups'
        }
      >
        {household
          ? 'Back to Household'
          : pathname.startsWith('/trips/')
            ? 'Back to Trips'
            : 'Back to Groups'}
      </Link>
    </>
  );
}
function GroupDestination({
  result,
  scope,
  id,
  household,
  expense,
  repayment,
  tab,
  filters,
  requestedFilter,
  saved,
  setSaved,
  read,
  headerTarget,
  actionTarget,
  setActivityRead,
  onError,
  onDenied,
}: {
  result: journeyWorkspaceQuery['response'];
  scope: FinancialScope;
  id: string;
  household: boolean;
  expense: string;
  repayment: boolean;
  tab: string;
  filters: string;
  requestedFilter: journeyWorkspaceQuery['variables']['filter'];
  saved: string;
  setSaved: (message: string) => void;
  read: () => Promise<void>;
  headerTarget: HTMLDivElement | null;
  actionTarget: HTMLDivElement | null;
  setActivityRead: (state: { busy: boolean; error: string }) => void;
  onError: (error: string, heading: string) => void;
  onDenied: () => void;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    pathname = usePathname();
  const group =
    result.group?.__typename === 'Group' &&
    result.group.id === id &&
    (!household || result.group.isHousehold)
      ? result.group
      : undefined;
  const canonical = group && !household ? spaceHref(group) : undefined;
  const currentBase = `${pathname.startsWith('/trips/') ? '/trips' : '/groups'}/${encodeURIComponent(id)}`;
  const redirect = !!canonical && canonical !== currentBase;
  const ledger = result.groupExpenses
    ? readInlineData<expensesView$key>(expenseView, result.groupExpenses)
    : undefined;
  const activity = result.groupActivity
    ? readInlineData<activityFeed$key>(activityFeed, result.groupActivity)
    : undefined;
  let code = '',
    heading = 'Group unavailable';
  if (!group)
    code =
      result.group?.__typename === 'Problem'
        ? result.group.code
        : 'UNAVAILABLE';
  else if (result.viewer?.__typename !== 'Viewer') {
    heading = 'Account access unavailable';
    code =
      result.viewer && 'code' in result.viewer
        ? result.viewer.code
        : result.viewer && 'state' in result.viewer
          ? result.viewer.state
          : 'UNAVAILABLE';
  } else if (
    !expense &&
    !repayment &&
    tab === 'expenses' &&
    ledger?.__typename !== 'ExpenseView'
  ) {
    heading = 'Expenses unavailable';
    code = ledger && 'code' in ledger ? ledger.code : 'UNAVAILABLE';
  } else if (
    !expense &&
    !repayment &&
    tab === 'activity' &&
    activity?.__typename !== 'ActivityConnection'
  ) {
    heading = 'Activity unavailable';
    code = activity && 'code' in activity ? activity.code : 'UNAVAILABLE';
  }
  useEffect(() => {
    onError(
      code ? message(code) : '',
      redirect ? 'Workspace' : code ? heading : '',
    );
    if (redirect && group) {
      const tail = expense
        ? `/expenses/${encodeURIComponent(expense)}`
        : repayment
          ? '/repayments/new'
          : '';
      const query = params.toString();
      router.replace(
        group.isHousehold
          ? householdLedgerHref(new URLSearchParams(params), expense, repayment)
          : `${canonical}${tail}${query ? `?${query}` : ''}`,
      );
    } else if (
      params.has('restore') &&
      !scope.restored.has(params.get('restore')!) &&
      result.group?.__typename === 'Problem' &&
      result.group.code === 'NOT_FOUND'
    ) {
      router.replace(
        `${household ? '/household' : pathname.startsWith('/trips/') ? '/trips' : '/groups'}?restore=${encodeURIComponent(params.get('restore')!)}`,
      );
    }
    // This result belongs to a single keyed authorization visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, code, redirect]);
  const activityKind = params.get('activityKind') ?? '';
  const setActivityKind = (kind: string) => {
    const next = new URLSearchParams(params);
    if (kind) next.set('activityKind', kind);
    else next.delete('activityKind');
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  if (redirect) return <ContentLoading layout={tab as LoadingLayout} />;
  if (code || !group)
    return (
      <GroupFailure
        household={household}
        pathname={pathname}
        error={message(code)}
      />
    );
  return (
    <>
      <RestoreSource scope={scope} allowed={[id]} />
      {expense ? (
        <>
          {!household &&
            headerTarget &&
            createPortal(
              <WorkspaceHeader
                title={group.name}
                appearance={group.kind === 'TRIP' ? 'trip' : 'group'}
              />,
              headerTarget,
            )}
          {!household &&
            actionTarget &&
            createPortal(
              <ScopedLink
                scope={scope}
                id="workspace-add"
                href={`${spaceHref(group)}?tab=expenses&create=${encodeURIComponent(group.id)}`}
              >
                <AppIcon name="plus" />
                <span>Add expense</span>
              </ScopedLink>,
              actionTarget,
            )}
          {!household && (
            <h1 data-page-heading tabIndex={-1}>
              {group.name}
            </h1>
          )}
          <ExpensePresentation
            title="Expense detail"
            onClose={() => {
              const token = params.get('source');
              const visit = token ? scope.visits.get(token) : undefined;
              if (token) scope.restored.delete(token);
              router.replace(
                visit
                  ? `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${token}`
                  : `${spaceHref(group)}?tab=expenses`,
                { scroll: false },
              );
            }}
          >
            <p>Original source: {group.name}</p>
            <ExpenseDetail
              scope={scope}
              group={id}
              id={expense}
              onCommitted={async () => {
                setSaved(
                  'Expense edited. Current expense and balances are being refreshed.',
                );
                await read();
              }}
            />
          </ExpensePresentation>
        </>
      ) : (
        <GroupWorkspace
          onActivityReadState={setActivityRead}
          activityKind={activityKind}
          onActivityKindChange={setActivityKind}
          onEditSaved={() =>
            setSaved(
              'Expense edit saved. Current expense and balances are a separate authorized refresh; any unavailable data below does not undo your edit.',
            )
          }
          showTabs={false}
          headerTarget={headerTarget}
          actionTarget={actionTarget}
          showHeader={!household}
          initialView={
            // The request may finish after Back/Forward changes the URL. Only
            // seed the ledger when its filters match the query reference.
            result.groupExpenses &&
            JSON.stringify(requestedFilter) ===
              JSON.stringify(expenseFilter(filters))
              ? {
                  filterText: filters,
                  reference: result.groupExpenses,
                }
              : undefined
          }
          initialFeed={result.groupActivity}
          scope={scope}
          groupRef={group.workspace!}
          identity={group}
          today={
            result.viewer.__typename === 'Viewer' ? result.viewer.today : ''
          }
          repayment={repayment}
          completed={repayment && !!saved}
          onRefresh={async () => {
            await read();
          }}
          onDenied={onDenied}
          onCommitted={async () => {
            setSaved(
              'Repayment recorded once. No money was moved. Current balances and recent repayments are a separately authorized read.',
            );
            await read();
          }}
        />
      )}
    </>
  );
}
