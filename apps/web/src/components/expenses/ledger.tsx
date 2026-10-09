'use client';
import { CategoryIcon, AppIcon } from '@/components/workspace-identity';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fetchQuery, readInlineData } from 'relay-runtime';
import {
  filterKeys,
  expenseFilterText,
  expenseFilter,
} from '@/lib/relay/expense-filter';
import type { FinancialScope } from '@/lib/relay/environment';
import { categories, type Member } from '@/lib/relay/draft';
import { minor, money } from '@/lib/relay/money';
import viewDocument, {
  type expensesView$data,
  type expensesView$key,
} from '@/lib/relay/__generated__/expensesView.graphql';
import groupDocument, {
  type expensesGroupQuery,
} from '@/lib/relay/__generated__/expensesGroupQuery.graphql';
import householdDocument, {
  type expensesHouseholdQuery,
} from '@/lib/relay/__generated__/expensesHouseholdQuery.graphql';
import { containDialogFocus, Money } from '@/components/primitives';
import { ExpenseDetail } from '@/components/groups/expense-detail';
import { ExpenseForm } from '@/components/groups/expense-form';
import { ExpensePresentation } from './presentation';
import { ExpenseBreakdown } from './breakdown';
import './ledger.css';
import { overviewDate } from '../groups/overview-date';

type View = Extract<expensesView$data, { readonly __typename: 'ExpenseView' }>;
export type LedgerSpace = {
  groupId: string;
  name: string;
  viewerMembership: { readonly id: string };
  members: readonly Member[];
};
export function ExpenseLedger(
  props: Omit<
    Parameters<typeof LedgerContent>[0],
    'filterTrigger' | 'onFilterApply' | 'onInitialConsumed'
  >,
) {
  const params = useSearchParams();
  const [initialView, setInitialView] = useState(props.initialView);
  const filters = filterKeys.map((key) => params.get(key) ?? '').join('\n');
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const restoreFilterScope = useRef<string | null>(null);
  useEffect(() => {
    if (restoreFilterScope.current === props.scope.id)
      filterTrigger.current?.focus({ preventScroll: true });
    restoreFilterScope.current = null;
  }, [filters, props.scope.id]);
  return (
    <LedgerContent
      key={`${props.scope.id}:${props.groupId ?? 'household'}:${filters}`}
      {...props}
      initialView={initialView}
      onInitialConsumed={() => setInitialView(undefined)}
      filterTrigger={filterTrigger}
      onFilterApply={(next) => {
        restoreFilterScope.current = next === filters ? null : props.scope.id;
      }}
    />
  );
}
function LedgerContent({
  scope,
  groupId = '',
  spaces,
  today,
  net,
  onDenied,
  onRefreshContext,
  onEditSaved,
  filterTrigger,
  onFilterApply,
  initialView,
  onInitialConsumed,
  contextVersion,
  managedRefresh = false,
}: {
  onInitialConsumed: () => void;
  contextVersion?: string;
  initialView?: { filterText: string; reference: expensesView$key };
  managedRefresh?: boolean;
  filterTrigger: RefObject<HTMLButtonElement | null>;
  onFilterApply: (filters: string) => void;
  scope: FinancialScope;
  groupId?: string;
  spaces: readonly LedgerSpace[];
  today: string;
  net?: string;
  activeSpaces?: string;
  onDenied: () => void;
  onRefreshContext?: () => Promise<void> | void;
  onEditSaved?: () => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const filterText = expenseFilterText(params);
  const activeFilterKeys = filterKeys.filter((key) => params.get(key));
  const initial = useRef(initialView);
  const selected = params.get('expense') ?? '',
    source = params.get('expenseGroup') ?? groupId;
  const create = params.get('create') ?? '';
  const breakdown = params.get('view') === 'breakdown';
  const basis = params.get('basis') === 'share' ? 'share' : 'total';
  const [page, setPage] = useState<View>();
  const [rows, setRows] = useState<View['edges']>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [navigationPending, startNavigation] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const origin = useRef<{ id: string; scroll: number } | null>(null);
  const opened = useRef(false);
  const generation = useRef(0);
  const summary = useRef<HTMLDivElement>(null);
  const change = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    const href = `${pathname}?${next}`;
    startNavigation(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };
  const reset = () => {
    generation.current++;
    setRows([]);
    setPage(undefined);
    setAfter(null);
    setError('');
    setLoading(true);
    setVersion((v) => v + 1);
  };
  const refresh = () => {
    if (managedRefresh && onRefreshContext) {
      void onRefreshContext();
      return;
    }
    reset();
    void onRefreshContext?.();
  };
  useEffect(() => {
    let live = true;
    const ticket = ++generation.current;
    const filter = expenseFilter(filterText);
    const accept = (reference: expensesView$key) => {
      if (!live || !scope.isLive() || ticket !== generation.current) return;
      const result = readInlineData<expensesView$key>(viewDocument, reference);
      if (
        result.__typename === 'ExpenseView' &&
        (!contextVersion || result.contextVersion === contextVersion)
      ) {
        setNotice('');
        setPage(result);
        setRows((previous) =>
          after ? [...previous, ...result.edges] : result.edges,
        );
      } else {
        setPage(undefined);
        setRows([]);
        setError(
          'Expenses unavailable. Access or this traversal may have changed. Refresh to restart; no zero total can be established.',
        );
        if (
          result.__typename === 'ExpenseView' ||
          ('code' in result && result.code === 'NOT_FOUND')
        )
          onDenied();
      }
      setLoading(false);
    };
    const fail = () => {
      if (live && scope.isLive() && ticket === generation.current) {
        setPage(undefined);
        setRows([]);
        setError('Expenses unavailable. Refresh to recheck current access.');
        setLoading(false);
      }
    };
    const prepared = initial.current;
    initial.current = undefined;
    if (prepared) onInitialConsumed();
    if (
      prepared &&
      prepared.filterText === filterText &&
      !after &&
      version === 0
    ) {
      accept(prepared.reference);
      return () => {
        live = false;
      };
    }
    const request = groupId
      ? fetchQuery<expensesGroupQuery>(
          scope.environment,
          groupDocument,
          { groupId, after, filter },
          { fetchPolicy: 'network-only' },
        ).subscribe({ next: (r) => accept(r.groupExpenses), error: fail })
      : fetchQuery<expensesHouseholdQuery>(
          scope.environment,
          householdDocument,
          { after, filter },
          { fetchPolicy: 'network-only' },
        ).subscribe({ next: (r) => accept(r.householdExpenses), error: fail });
    return () => {
      live = false;
      request.unsubscribe();
    };
    // Parent owns the denial boundary; URL filters and scope own this traversal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, groupId, filterText, after, version]);
  const refreshFromForeground = useEffectEvent(() => {
    setNotice('Access is stale. Refreshing expenses…');
    refresh();
  });
  useEffect(() => {
    if (managedRefresh) return;
    const refreshOnFocus = () => refreshFromForeground();
    const foreground = () => {
      if (document.visibilityState === 'visible') refreshOnFocus();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [managedRefresh]);
  useEffect(() => {
    if (selected || create) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    requestAnimationFrame(() => {
      const target =
        origin.current && document.getElementById(origin.current.id);
      (target || summary.current)?.focus({ preventScroll: true });
      if (origin.current) window.scrollTo(0, origin.current.scroll);
    });
  }, [selected, create]);
  const choose = (id: string, patch: Record<string, string>) => {
    origin.current = { id, scroll: window.scrollY };
    change(patch);
  };
  const close = () => {
    if (origin.current) router.back();
    else change({ expense: null, expenseGroup: null, create: null }, true);
  };
  const filterForm = (
    <form
      className="ledger-filters"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const patch = Object.fromEntries(
          filterKeys.map((key) => [key, String(data.get(key) || '')]),
        );
        if (groupId) patch.groupId = '';
        onFilterApply(filterKeys.map((key) => patch[key]).join('\n'));
        reset();
        change({ ...patch, expense: null, expenseGroup: null, create: null });
        setFiltersOpen(false);
      }}
    >
      {!groupId && (
        <label>
          <span>Space</span>
          <select name="groupId" defaultValue={params.get('groupId') ?? ''}>
            <option value="">All spaces</option>
            {spaces.map((s) => (
              <option value={s.groupId} key={s.groupId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>Category</span>
        <select name="category" defaultValue={params.get('category') ?? ''}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c[0] + c.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Member</span>
        <select name="memberId" defaultValue={params.get('memberId') ?? ''}>
          <option value="">All members</option>
          {spaces.map((s) => (
            <optgroup label={s.name} key={s.groupId}>
              {s.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} · {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        <span>From</span>
        <input
          name="from"
          type="date"
          defaultValue={params.get('from') ?? ''}
        />
      </label>
      <label>
        <span>To</span>
        <input name="to" type="date" defaultValue={params.get('to') ?? ''} />
      </label>
      <div className="ledger-filter-actions">
        <button
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form)
              for (const field of Array.from(form.elements)) {
                if (
                  field instanceof HTMLInputElement ||
                  field instanceof HTMLSelectElement
                )
                  field.value = '';
              }
          }}
        >
          Reset filters
        </button>
        <button type="button" onClick={() => setFiltersOpen(false)}>
          Cancel
        </button>
        <button type="submit">Apply filters</button>
      </div>
    </form>
  );
  const createSpace = spaces.find((s) => s.groupId === create);
  return (
    <section className="expense-ledger" aria-label="Expenses">
      {navigationPending && <p role="status">Opening expense view…</p>}
      <div className="ledger-page-actions">
        {' '}
        <button
          className="ledger-refresh"
          aria-label="Refresh expenses"
          title="Refresh expenses"
          onClick={refresh}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
        </button>
        <button
          id="ledger-add"
          className="ledger-add"
          aria-label="Add expense"
          disabled={!spaces.length}
          onClick={() =>
            choose('ledger-add', {
              create: groupId || params.get('groupId') || spaces[0].groupId,
            })
          }
        >
          <AppIcon name="plus" /> <span>Add expense</span>
        </button>
      </div>
      <div className="ledger-toolbar">
        <nav className="ledger-view-switch" aria-label="Expense view">
          <button
            aria-label="List"
            aria-pressed={!breakdown}
            onClick={() => change({ view: null })}
          >
            <AppIcon name="list" /> List
          </button>
          <button
            aria-label="Breakdown"
            aria-pressed={breakdown}
            onClick={() => change({ view: 'breakdown' })}
          >
            <AppIcon name="pie" /> Breakdown
          </button>
        </nav>
        <button
          aria-label={`Filters${activeFilterKeys.length ? ` · ${activeFilterKeys.length}` : ''}`}
          ref={filterTrigger}
          className="ledger-filter-button"
          onClick={() => setFiltersOpen(true)}
        >
          <AppIcon name="sliders" /> Filters
          {activeFilterKeys.length ? ` · ${activeFilterKeys.length}` : ''}
        </button>
      </div>
      {activeFilterKeys.length > 0 && (
        <div className="ledger-active-filters" aria-label="Active filters">
          {activeFilterKeys.map((key) => {
            const value = params.get(key)!;
            const memberSpace =
              key === 'memberId'
                ? spaces.find((space) =>
                    space.members.some((member) => member.id === value),
                  )
                : undefined;
            const date = new Date(`${value}T00:00:00Z`);
            const label =
              key === 'groupId'
                ? `Space: ${spaces.find((space) => space.groupId === value)?.name ?? 'Selected space'}`
                : key === 'memberId'
                  ? memberSpace
                    ? `${memberSpace.members.find((member) => member.id === value)!.displayName} · ${memberSpace.name}`
                    : 'Selected member'
                  : key === 'category'
                    ? value[0] + value.slice(1).toLowerCase()
                    : `${key === 'from' ? 'From' : 'To'} ${Number.isNaN(date.getTime()) ? value : overviewDate(value, false, value.slice(0, 4) !== today.slice(0, 4))}`;
            return (
              <button
                key={key}
                className="ledger-filter-chip"
                aria-label={`Remove ${label}`}
                onClick={() => {
                  reset();
                  change({ [key]: null });
                }}
              >
                {label} <AppIcon name="close" />
              </button>
            );
          })}
          <button
            className="ledger-clear-filters"
            onClick={() => {
              reset();
              change(Object.fromEntries(filterKeys.map((key) => [key, null])));
            }}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="ledger-summary" ref={summary} tabIndex={-1}>
        {page && !error ? (
          <span>
            {page.expenseCount}{' '}
            {page.expenseCount === '1' ? 'expense' : 'expenses'} ·{' '}
            <span aria-label="Total expenses">
              <Money value={money(page.totalExpenseMinor)} currency="USD" />{' '}
              total
            </span>{' '}
            · <Money value={money(page.viewerShareMinor)} currency="USD" /> your
            share
            {filterText && ' · All filters combined'}
          </span>
        ) : (
          <span>{loading ? 'Loading totals…' : 'Total unavailable'}</span>
        )}
        <details className="ledger-net">
          <summary aria-label="Your net balance" title="Your net balance">
            <AppIcon name="arrow-up-right" />
          </summary>
          <span>
            {net === undefined ? (
              'Unavailable'
            ) : (
              <>
                {minor(net) > 0n
                  ? "You're owed "
                  : minor(net) < 0n
                    ? 'You owe '
                    : 'Net zero '}
                <Money value={money(net)} currency="USD" />
              </>
            )}{' '}
            · Unfiltered{!groupId && ' across spaces'}. Balances stay separate
            in each space.
          </span>
        </details>
      </div>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading authorized expenses…</p>}
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        page && (
          <>
            {breakdown ? (
              <ExpenseBreakdown
                context={
                  groupId
                    ? (spaces.find((space) => space.groupId === groupId)
                        ?.name ?? 'This space')
                    : 'Across your spaces'
                }
                categories={page.categories}
                totalExpenseMinor={page.totalExpenseMinor}
                viewerShareMinor={page.viewerShareMinor}
                expenseCount={page.expenseCount}
                basis={basis}
                onBasis={(next) =>
                  change({ basis: next === 'share' ? 'share' : null })
                }
                onViewExpenses={(category) => {
                  if (category && category !== params.get('category')) reset();
                  change({ view: null, ...(category ? { category } : {}) });
                }}
              />
            ) : (
              <>
                {!rows.length && !loading && (
                  <p>
                    {filterText
                      ? 'No expenses match these filters.'
                      : 'No expenses yet.'}
                  </p>
                )}
                {page.months
                  .filter((month) =>
                    rows.some(({ node }) =>
                      node.effectiveDate.startsWith(month.month),
                    ),
                  )
                  .map((month) => (
                    <section
                      className="ledger-month"
                      key={month.month}
                      aria-label={month.month}
                    >
                      <header>
                        <h2>Expenses</h2>
                        <span className="ledger-month-context">
                          {new Intl.DateTimeFormat('en', {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          }).format(new Date(`${month.month}-01T00:00:00Z`))}
                        </span>
                        <details className="ledger-month-total">
                          <summary>Month totals</summary>
                          <span>
                            {money(month.totalExpenseMinor)} USD ·{' '}
                            {month.expenseCount} expenses
                          </span>
                        </details>
                      </header>
                      <ul>
                        {rows
                          .filter(({ node }) =>
                            node.effectiveDate.startsWith(month.month),
                          )
                          .map(({ node, source }) => {
                            const viewer = spaces.find(
                              (s) => s.groupId === node.groupId,
                            )?.viewerMembership.id;
                            const share = node.allocations.find(
                              (a) => a.participant.id === viewer,
                            )?.amountMinor;
                            const next = new URLSearchParams(params);
                            next.set('expense', node.id);
                            next.set('expenseGroup', node.groupId);
                            const id = `ledger-expense-${node.id}`;
                            return (
                              <li key={node.id}>
                                <Link
                                  id={id}
                                  href={`${pathname}?${next}`}
                                  scroll={false}
                                  onNavigate={() => {
                                    origin.current = {
                                      id,
                                      scroll: window.scrollY,
                                    };
                                  }}
                                >
                                  <CategoryIcon category={node.category} />
                                  <span className="ledger-description">
                                    <strong>{node.description}</strong>
                                    <span>
                                      {!groupId && <>{source.name} · </>}
                                      <time dateTime={node.effectiveDate}>
                                        {overviewDate(node.effectiveDate)}
                                      </time>
                                    </span>
                                  </span>
                                  <span className="ledger-money">
                                    <Money
                                      value={money(node.totalMinor)}
                                      currency={source.currency}
                                    />
                                    <span>
                                      Your share{' '}
                                      {viewer
                                        ? money(share ?? '0')
                                        : 'unavailable'}
                                    </span>
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                      </ul>
                    </section>
                  ))}
                {page.pageInfo.hasNextPage && (
                  <button
                    disabled={loading}
                    onClick={() => {
                      setLoading(true);
                      setAfter(page.pageInfo.endCursor ?? null);
                    }}
                  >
                    Load more expenses
                  </button>
                )}
              </>
            )}
          </>
        )
      )}
      {filtersOpen && (
        <LedgerDialog
          title="Expense filters"
          onClose={() => setFiltersOpen(false)}
        >
          <div key={filterText}>{filterForm}</div>
        </LedgerDialog>
      )}
      {(selected || create) && (
        <ExpensePresentation
          title={selected ? 'Expense detail' : 'Add expense'}
          onClose={close}
        >
          {selected ? (
            <AuthorizedDetail
              key={`${source}:${selected}:${version}`}
              scope={scope}
              groupId={groupId}
              source={source}
              id={selected}
              onCommitted={async () => {
                onEditSaved?.();
                setNotice(
                  'Expense edited. Refreshing current authorized expenses and balances.',
                );
                reset();
                await onRefreshContext?.();
              }}
              onDenied={() => {
                setPage(undefined);
                setRows([]);
                setError('Expense access changed. Refresh to recheck.');
                close();
              }}
            />
          ) : createSpace ? (
            <>
              {!groupId && (
                <label>
                  Source space
                  <select
                    value={create}
                    onChange={(e) => change({ create: e.target.value }, true)}
                  >
                    {spaces.map((s) => (
                      <option key={s.groupId} value={s.groupId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>{createSpace.name}</p>
              <ExpenseForm
                key={createSpace.groupId}
                scope={scope}
                group={createSpace.groupId}
                today={today}
                payer={createSpace.viewerMembership.id}
                members={createSpace.members}
                onCommitted={async () => {
                  setNotice('Expense saved. Refreshing authorized expenses.');
                  reset();
                  close();
                  await onRefreshContext?.();
                }}
                onDenied={() => {
                  reset();
                  close();
                  onDenied();
                }}
              />
            </>
          ) : (
            <p role="alert">
              Source space unavailable. Refresh current access.
            </p>
          )}
        </ExpensePresentation>
      )}
    </section>
  );
}
function AuthorizedDetail({
  scope,
  groupId,
  source,
  id,
  onDenied,
  onCommitted,
}: {
  scope: FinancialScope;
  groupId: string;
  source: string;
  id: string;
  onDenied: () => void;
  onCommitted: () => Promise<void>;
}) {
  const [name, setName] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const accept = (reference: expensesView$key) => {
      if (!live || !scope.isLive()) return;
      const view = readInlineData<expensesView$key>(viewDocument, reference);
      if (view.__typename !== 'ExpenseView') {
        setFailed(true);
        onDenied();
      } else setName(view.edges[0]?.source.name ?? 'Authorized source space');
    };
    const fail = () => {
      if (live && scope.isLive()) {
        setFailed(true);
        onDenied();
      }
    };
    const request = groupId
      ? fetchQuery<expensesGroupQuery>(
          scope.environment,
          groupDocument,
          { groupId, filter: { groupId: source } },
          { fetchPolicy: 'network-only' },
        ).subscribe({ next: (r) => accept(r.groupExpenses), error: fail })
      : fetchQuery<expensesHouseholdQuery>(
          scope.environment,
          householdDocument,
          { filter: { groupId: source } },
          { fetchPolicy: 'network-only' },
        ).subscribe({ next: (r) => accept(r.householdExpenses), error: fail });
    return () => {
      live = false;
      request.unsubscribe();
    };
    // Denial invalidates the owning list; request identities own the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, groupId, source]);
  return failed ? (
    <p role="alert">Expense unavailable.</p>
  ) : name ? (
    <>
      <p className="expense-detail-source">Source: {name}</p>
      <ExpenseDetail
        scope={scope}
        group={source}
        id={id}
        onUnavailable={onDenied}
        onCommitted={onCommitted}
      />
    </>
  ) : (
    <p role="status">Checking current source access…</p>
  );
}
export function LedgerDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      className="ledger-dialog"
      ref={ref}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => containDialogFocus(event, ref.current)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>Filter expenses</h2>
        <button
          className="ledger-dialog-close"
          aria-label="Back to expenses"
          autoFocus
          onClick={onClose}
        >
          <AppIcon name="close" />
        </button>
      </header>
      <p className="ledger-filter-description">
        Show expenses matching all selected filters.
      </p>
      {children}
    </dialog>
  );
}
