'use client';
import { useForegroundRefresh } from '@/components/groups/foreground';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { CategoryIcon, AppIcon } from '@/components/workspace-identity';
import {
  useEffect,
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
  filterValues,
  datePreset,
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
import {
  Button,
  containDialogFocus,
  Money,
  Skeleton,
} from '@/components/primitives';
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
  const filters = expenseFilterText(params);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const restoreFilterScope = useRef<string | null>(null);
  useEffect(() => {
    const restore = restoreFilterScope.current === props.scope.id;
    restoreFilterScope.current = null;
    if (!restore) return;
    const frame = requestAnimationFrame(() =>
      filterTrigger.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
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
  const activeFilters = [...new URLSearchParams(filterText).entries()];
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
  const requestRef = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const summary = useRef<HTMLDivElement>(null);
  const change = (
    patch: Record<string, string | string[] | null>,
    replace = false,
  ) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      next.delete(key);
      for (const item of Array.isArray(value) ? value : value ? [value] : [])
        next.append(key, item);
    });
    const href = `${pathname}?${next}`;
    startNavigation(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };
  const invalidate = () => {
    generation.current++;
    requestRef.current?.unsubscribe();
    setRows([]);
    setPage(undefined);
    setAfter(null);
    setError('');
    setLoading(true);
  };
  const reset = () => {
    invalidate();
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
    requestRef.current = request;
    return () => {
      live = false;
      request.unsubscribe();
    };
    // Parent owns the denial boundary; URL filters and scope own this traversal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, groupId, filterText, after, version]);
  useForegroundRefresh(
    invalidate,
    () => {
      setVersion((v) => v + 1);
      void onRefreshContext?.();
    },
    !managedRefresh,
  );
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
          filterKeys.map((key) => [
            key,
            data.getAll(key).map(String).filter(Boolean),
          ]),
        );
        if (groupId) patch.groupId = [];
        if (patch.sort[0] === 'DATE_DESC') patch.sort = [];
        const applied = new URLSearchParams();
        for (const [key, values] of Object.entries(patch))
          for (const value of values) applied.append(key, value);
        onFilterApply(expenseFilterText(applied));
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
      <fieldset className="ledger-filter-options">
        <legend>Categories</legend>
        {categories.map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              name="categories"
              value={c}
              defaultChecked={filterValues(params, 'categories').includes(c)}
            />
            <span>{c[0] + c.slice(1).toLowerCase()}</span>
          </label>
        ))}
      </fieldset>
      {(['paidByIds', 'memberIds'] as const).map((key) => (
        <fieldset className="ledger-filter-options" key={key}>
          <legend>{key === 'paidByIds' ? 'Paid by' : 'Involving'}</legend>
          {key === 'memberIds' && (
            <p>Payer or included participant, including a zero share.</p>
          )}
          {spaces.map((space) => (
            <div key={space.groupId}>
              <strong>{space.name}</strong>
              {space.members.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    name={key}
                    value={member.id}
                    defaultChecked={filterValues(params, key).includes(
                      member.id,
                    )}
                  />
                  <span>
                    {member.displayName} · {space.name}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      ))}
      <label>
        <span>Date preset</span>
        <select
          defaultValue="custom"
          onChange={(event) => {
            if (event.target.value === 'custom') return;
            const range = datePreset(today, event.target.value);
            for (const key of ['from', 'to'] as const) {
              const input = event.currentTarget.form?.elements.namedItem(key);
              if (input instanceof HTMLInputElement) input.value = range[key];
            }
          }}
        >
          <option value="custom">Custom dates</option>
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="last7">Last 7 days</option>
          <option value="month">This month to date</option>
          <option value="previousMonth">Previous month</option>
        </select>
      </label>
      <p>
        Dates include both endpoints. Presets use the server calendar date (
        {today}); last 7 days includes today and the six preceding dates.
      </p>
      <label>
        <span>Sort</span>
        <select name="sort" defaultValue={params.get('sort') || 'DATE_DESC'}>
          <option value="DATE_DESC">Date: newest first</option>
          <option value="DATE_ASC">Date: oldest first</option>
          <option value="AMOUNT_DESC">Amount: highest first</option>
          <option value="AMOUNT_ASC">Amount: lowest first</option>
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
        <Button
          tone="text"
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form)
              for (const field of Array.from(form.elements)) {
                if (
                  field instanceof HTMLInputElement ||
                  field instanceof HTMLSelectElement
                )
                  if (
                    field instanceof HTMLInputElement &&
                    field.type === 'checkbox'
                  )
                    field.checked = false;
                  else
                    field.value =
                      field.getAttribute('name') === 'sort' ? 'DATE_DESC' : '';
              }
          }}
        >
          Reset filters
        </Button>
        <Button tone="text" type="button" onClick={() => setFiltersOpen(false)}>
          Cancel
        </Button>
        <Button type="submit">Apply filters</Button>
      </div>
    </form>
  );
  const createSpace = spaces.find((s) => s.groupId === create);
  return (
    <section className="expense-ledger" aria-label="Expenses">
      {!managedRefresh && (
        <WorkspaceRefresh
          busy={loading}
          error={error}
          onRefresh={refresh}
          label="Refresh expenses"
        />
      )}
      {navigationPending && <p role="status">Opening expense view…</p>}
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
        <details className="ledger-net">
          <summary>
            <AppIcon name="arrow-up-right" /> Balance details
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
            in each space. A zero net does not establish that every member is
            settled.{' '}
            <Link href={`${groupId ? pathname : '/household'}?tab=balances`}>
              View who owes whom
            </Link>
          </span>
        </details>
        <button
          aria-label={`Filters${activeFilters.length ? ` · ${activeFilters.length}` : ''}`}
          ref={filterTrigger}
          className="ledger-filter-button"
          onClick={() => setFiltersOpen(true)}
        >
          <AppIcon name="sliders" /> Filters
          {activeFilters.length ? ` · ${activeFilters.length}` : ''}
        </button>
        <div className="ledger-page-actions">
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
      </div>
      {activeFilters.length > 0 && (
        <div className="ledger-active-filters" aria-label="Active filters">
          {activeFilters.map(([key, value]) => {
            const memberSpaces =
              key === 'memberIds' || key === 'paidByIds'
                ? spaces.filter((space) =>
                    space.members.some((member) => member.id === value),
                  )
                : [];
            const memberSpace =
              memberSpaces.find(
                (space) => space.groupId === (params.get('groupId') || groupId),
              ) ?? memberSpaces[0];
            const date = new Date(`${value}T00:00:00Z`);
            const validDate =
              /^\d{4}-\d{2}-\d{2}$/.test(value) &&
              Number(value.slice(0, 4)) > 0 &&
              !Number.isNaN(date.getTime()) &&
              date.toISOString().slice(0, 10) === value;
            const label =
              key === 'groupId'
                ? `Space: ${spaces.find((space) => space.groupId === value)?.name ?? 'Selected space'}`
                : key === 'memberIds' || key === 'paidByIds'
                  ? memberSpace
                    ? `${key === 'paidByIds' ? 'Paid by' : 'Involving'}: ${memberSpace.members.find((member) => member.id === value)!.displayName} · ${memberSpace.name}`
                    : 'Selected member'
                  : key === 'categories'
                    ? value[0] + value.slice(1).toLowerCase()
                    : key === 'sort'
                      ? `Sort: ${{ DATE_ASC: 'Date: oldest first', AMOUNT_ASC: 'Amount: lowest first', AMOUNT_DESC: 'Amount: highest first' }[value] ?? value}`
                      : `${key === 'from' ? 'From' : 'To'} ${!validDate ? value : overviewDate(value, false, value.slice(0, 4) !== today.slice(0, 4))}`;
            return (
              <button
                key={`${key}:${value}`}
                className="ledger-filter-chip"
                aria-label={`Remove ${label}`}
                onClick={() => {
                  reset();
                  change({
                    [key]: filterValues(
                      new URLSearchParams(filterText),
                      key,
                    ).filter((item) => item !== value),
                    ...(key === 'categories'
                      ? { category: null }
                      : key === 'memberIds'
                        ? { memberId: null }
                        : {}),
                  });
                }}
              >
                {label} <AppIcon name="close" />
              </button>
            );
          })}
          <Button
            tone="text"
            className="ledger-clear-filters"
            onClick={() => {
              reset();
              change(Object.fromEntries(filterKeys.map((key) => [key, null])));
            }}
          >
            Clear all
          </Button>
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
      </div>
      {notice && <p role="status">{notice}</p>}
      {loading && <Skeleton label="Loading expenses" />}
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
                  if (
                    category &&
                    !filterValues(params, 'categories').includes(category)
                  )
                    reset();
                  change({
                    view: null,
                    ...(category
                      ? {
                          category: null,
                          categories: [
                            ...new Set([
                              ...filterValues(params, 'categories'),
                              category,
                            ]),
                          ],
                        }
                      : {}),
                  });
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
                {params.get('sort')?.startsWith('AMOUNT_') && (
                  <section
                    className="ledger-month-summaries"
                    aria-label="Monthly totals"
                  >
                    <h2>Monthly totals for all matching expenses</h2>
                    {page.months.map((month) => (
                      <p key={month.month}>
                        {month.month}:{' '}
                        <Money
                          value={money(month.totalExpenseMinor)}
                          currency="USD"
                        />{' '}
                        · {month.expenseCount} expenses
                      </p>
                    ))}
                  </section>
                )}
                {(params.get('sort')?.startsWith('AMOUNT_')
                  ? [
                      {
                        month: '',
                        totalExpenseMinor: page.totalExpenseMinor,
                        expenseCount: page.expenseCount,
                      },
                    ]
                  : [
                      ...new Set(
                        rows.map(({ node }) => node.effectiveDate.slice(0, 7)),
                      ),
                    ].flatMap((month) =>
                      page.months.filter((item) => item.month === month),
                    )
                )
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
                        <h2>
                          {month.month
                            ? new Intl.DateTimeFormat('en', {
                                month: 'long',
                                year: 'numeric',
                                timeZone: 'UTC',
                              }).format(new Date(`${month.month}-01T00:00:00Z`))
                            : 'Expenses in amount order'}
                        </h2>
                        <span className="ledger-month-total">
                          <Money
                            value={money(month.totalExpenseMinor)}
                            currency="USD"
                          />
                          {' · '}
                          {month.expenseCount}{' '}
                          {month.expenseCount === '1' ? 'expense' : 'expenses'}
                        </span>
                      </header>
                      <div className="ledger-columns" aria-hidden="true">
                        <span>Expense / source / date</span>
                        <span>Paid by</span>
                        <span>Amount</span>
                      </div>
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
                                      {node.category[0] +
                                        node.category
                                          .slice(1)
                                          .toLowerCase()}{' '}
                                      · {!groupId && <>{source.name} · </>}
                                      <time dateTime={node.effectiveDate}>
                                        {overviewDate(node.effectiveDate)}
                                      </time>
                                    </span>
                                  </span>
                                  <span className="ledger-payer">
                                    <span className="ledger-payer-label">
                                      Paid by{' '}
                                    </span>
                                    {node.payer.displayName}
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
          kind={selected ? 'detail' : 'create'}
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
              <p className="expense-create-context">
                {createSpace.name} · No money is moved.
              </p>
              <ExpenseForm
                embedded
                onCancel={close}
                key={createSpace.groupId}
                scope={scope}
                group={createSpace.groupId}
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
    <p role="status">Loading expense…</p>
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
