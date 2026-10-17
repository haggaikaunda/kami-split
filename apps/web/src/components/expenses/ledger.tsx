'use client';
import { ContentLoading } from '../ui/loading';
import { useExpenseEntry } from './entry';
import { useForegroundRefresh } from '@/components/groups/foreground';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { AppIcon } from '@/components/workspace-identity';
import { CategoryIcon } from '@/components/financial/category';
import {
  useEffect,
  useCallback,
  useMemo,
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
} from '@/lib/relay/expense-filter';
import type { FinancialScope } from '@/lib/relay/environment';
import type { Member } from '@/lib/relay/draft';
import { money } from '@/lib/relay/money';
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
import { Button, containDialogFocus } from '../ui/primitives';
import { Money } from '../financial/presentation';
import { AuthorizedDetail } from './authorized-detail';
import { ExpenseForm } from '@/components/groups/expense-form';
import { ExpensePresentation } from './presentation';
import { ExpenseBreakdown } from './breakdown';

import { ExpenseFilterForm } from './filter-form';
import { overviewDate } from '../groups/overview-date';
import { cx } from '../ui/classnames';

import ledgerFeatureStyles from './ledger.module.css';
import formsFeatureStyles from '../groups/forms.module.css';
import dialogFeatureStyles from './dialog.module.css';
import filterFeatureStyles from './filter-form.module.css';

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
  filterLayout = groupId ? 'group' : 'household',
  spaces,
  today,
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
  filterLayout?: 'group' | 'household';
  spaces: readonly LedgerSpace[];
  today: string;
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
  const [retry, setRetry] = useState(0);
  const [pageError, setPageError] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [navigationPending, startNavigation] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const visitKey = `${pathname}:${groupId}:${filterText}`;
  const positions = useMemo(
    () => (scope.expensePositions ??= new Map()),
    [scope],
  );
  const [savedPosition] = useState(() => positions.get(visitKey));
  const [reservedHeight, setReservedHeight] = useState(savedPosition?.height);
  const origin = useRef(savedPosition);
  const opened = useRef(!!selected || !!create);
  const restoreCount = useRef(savedPosition?.count ?? 0);
  const [restoring, setRestoring] = useState(!!savedPosition);
  const replayRemaining = useRef(
    Math.max(0, Math.ceil((savedPosition?.count ?? 0) / 6) - 1),
  );
  const container = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(true);
  const consumedCursors = useRef(new Set<string>());
  const automaticArmed = useRef(true);
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
    inFlight.current = true;
    consumedCursors.current.clear();
    setPageError('');
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
    positions.delete(visitKey);
    origin.current = undefined;
    restoreCount.current = 0;
    setRestoring(false);
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
        if (
          result.pageInfo.hasNextPage &&
          (!result.edges.length ||
            !result.pageInfo.endCursor ||
            consumedCursors.current.has(result.pageInfo.endCursor))
        ) {
          setPage(undefined);
          setRows([]);
          setError('Expense pagination changed. Refresh to restart the list.');
          inFlight.current = false;
          setLoading(false);
          return;
        }
        setNotice('');
        setPage(result);
        setRows((previous) => {
          const combined = after
            ? [...previous, ...result.edges]
            : result.edges;
          return [
            ...new Map(
              combined.map((edge) => [edge.node.expenseId, edge]),
            ).values(),
          ];
        });
        setPageError('');
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
      inFlight.current = false;
      setLoading(false);
    };
    const fail = (failure: Error) => {
      if (live && scope.isLive() && ticket === generation.current) {
        if (
          after &&
          !['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(failure?.message)
        ) {
          setPageError('More expenses could not be loaded. Retry when ready.');
        } else {
          setPage(undefined);
          setRows([]);
          setError('Expenses unavailable. Refresh to recheck current access.');
        }
        inFlight.current = false;
        setLoading(false);
      }
    };
    const prepared = initial.current;
    initial.current = undefined;
    if (prepared) onInitialConsumed();
    if (
      prepared &&
      // A saved visit survives reader remounts; its return must start a fresh anchor.
      !savedPosition &&
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
  }, [scope, groupId, filterText, after, version, retry]);
  useForegroundRefresh(
    invalidate,
    () => {
      setVersion((v) => v + 1);
      void onRefreshContext?.();
    },
    !managedRefresh,
  );
  const loadMore = useCallback(() => {
    const cursor = page?.pageInfo.endCursor;
    if (
      inFlight.current ||
      !scope.isLive() ||
      error ||
      pageError ||
      !page?.pageInfo.hasNextPage ||
      !cursor ||
      consumedCursors.current.has(cursor)
    )
      return;
    inFlight.current = true;
    automaticArmed.current = false;
    consumedCursors.current.add(cursor);
    setLoading(true);
    setAfter(cursor);
  }, [page, scope, error, pageError]);
  useEffect(() => {
    if (
      selected ||
      create ||
      breakdown ||
      restoring ||
      !sentinel.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const trigger = () => {
      if (automaticArmed.current) loadMore();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) trigger();
      },
      { rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(sentinel.current);
    // One automatic page per scroll gesture; a still-visible sentinel cannot drain the list.
    const scroll = () => {
      if (inFlight.current) return;
      automaticArmed.current = true;
      const rect = sentinel.current?.getBoundingClientRect();
      if (rect && rect.top <= window.innerHeight + 240 && rect.bottom >= 0)
        trigger();
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', scroll);
    };
  }, [loadMore, selected, create, breakdown, restoring]);
  useEffect(() => {
    if (selected || create) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    // Re-read the anchored traversal: detail may have changed externally as well as locally.
    restoreCount.current = origin.current?.count ?? rows.length;
    replayRemaining.current = Math.max(
      0,
      Math.ceil(restoreCount.current / 6) - 1,
    );
    setRestoring(true);
    reset();
    // Overlay transitions alone own reconciliation, not page insertions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, create]);
  useEffect(() => {
    if (
      inFlight.current ||
      !restoring ||
      loading ||
      error ||
      pageError ||
      !page
    )
      return;
    if (
      rows.length < restoreCount.current &&
      replayRemaining.current > 0 &&
      page.pageInfo.hasNextPage &&
      page.pageInfo.endCursor &&
      !consumedCursors.current.has(page.pageInfo.endCursor)
    ) {
      replayRemaining.current--;
      loadMore();
      return;
    }
    if (selected || create) return;
    const saved = origin.current;
    const returnGeneration = generation.current;
    const frame = requestAnimationFrame(() => {
      // A newer overlay intent supersedes this return frame, even before the
      // navigation commit can run the effect cleanup.
      if (
        inFlight.current ||
        generation.current !== returnGeneration ||
        saved !== origin.current
      )
        return;
      const nearest = rows[Math.min(saved?.index ?? 0, rows.length - 1)];
      const target =
        (saved && document.getElementById(saved.id)) ||
        (nearest &&
          document.getElementById(`ledger-expense-${nearest.node.expenseId}`));
      (target || summary.current)?.focus({ preventScroll: true });
      if (saved) {
        const top =
          target && !target.closest('[data-ui~="workspace-navigation"]')
            ? window.scrollY + target.getBoundingClientRect().top - saved.offset
            : saved.scroll;
        window.scrollTo(0, Math.max(0, top));
      }
      // Keep the source anchor for a Forward entry that remounts the ledger.
      // Explicit refresh and account disposal still invalidate these positions.
      if (saved) positions.set(visitKey, saved);
      setRestoring(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    restoring,
    loading,
    error,
    pageError,
    page,
    rows,
    selected,
    create,
    loadMore,
    positions,
    visitKey,
  ]);
  const remember = (id: string) => {
    origin.current = {
      id,
      scroll: window.scrollY,
      offset: document.getElementById(id)?.getBoundingClientRect().top ?? 0,
      index: Math.max(
        0,
        rows.findIndex(
          (edge) => `ledger-expense-${edge.node.expenseId}` === id,
        ),
      ),
      count: rows.length,
      height: container.current?.getBoundingClientRect().height ?? 0,
    };
    setReservedHeight(origin.current.height);
    positions.set(visitKey, origin.current);
  };
  const expenseEntry = useExpenseEntry();
  useEffect(() => {
    if (selected || create) return;
    return expenseEntry?.register({}, ({ source, focus }) => {
      if (!source || spaces.some((space) => space.groupId === source))
        remember(focus);
    });
    // Snapshot the current authorized rows only for this workspace's banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseEntry, selected, create, rows, visitKey, spaces]);
  const close = () => {
    if (origin.current) router.back();
    else {
      const token = params.get('source');
      const visit = token ? scope.visits.get(token) : undefined;
      if (create && visit) {
        scope.restored.delete(token!);
        router.replace(
          `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${token}`,
          { scroll: false },
        );
      } else change({ expense: null, expenseGroup: null, create: null }, true);
    }
  };
  const createSpace = spaces.find((s) => s.groupId === create);
  return (
    <section
      data-ui="expense-ledger form-region"
      className={ledgerFeatureStyles['expense-ledger']}
      aria-label="Expenses"
      ref={container}
      style={restoring ? { minHeight: reservedHeight } : undefined}
    >
      {!managedRefresh && (
        <WorkspaceRefresh
          contentPending={!page}
          busy={loading}
          error={error}
          onRefresh={refresh}
        />
      )}
      {navigationPending && <p role="status">Opening expense view…</p>}
      <div
        data-ui="ledger-toolbar"
        className={ledgerFeatureStyles['ledger-toolbar']}
      >
        <nav
          data-ui="ledger-view-switch"
          className={ledgerFeatureStyles['ledger-view-switch']}
          aria-label="Expense view"
        >
          <button
            aria-label="List"
            aria-pressed={!breakdown}
            onClick={() => change({ view: null })}
            data-ui="form-button"
          >
            <AppIcon name="list" /> List
          </button>
          <button
            aria-label="Breakdown"
            aria-pressed={breakdown}
            onClick={() => change({ view: 'breakdown' })}
            data-ui="form-button"
          >
            <AppIcon name="pie" /> Breakdown
          </button>
        </nav>
        <button
          aria-label={`Filters${activeFilters.length ? ` · ${activeFilters.length}` : ''}`}
          ref={filterTrigger}
          data-ui="ledger-filter-button form-button"
          className={ledgerFeatureStyles['ledger-filter-button']}
          onClick={() => setFiltersOpen(true)}
        >
          <AppIcon name="sliders" /> Filters
          {activeFilters.length ? ` · ${activeFilters.length}` : ''}
        </button>
      </div>
      {activeFilters.length > 0 && (
        <div
          data-ui="ledger-active-filters"
          className={ledgerFeatureStyles['ledger-active-filters']}
          aria-label="Active filters"
        >
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
                data-ui="ledger-filter-chip form-button"
                className={ledgerFeatureStyles['ledger-filter-chip']}
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
            onClick={() => {
              reset();
              change(Object.fromEntries(filterKeys.map((key) => [key, null])));
            }}
          >
            Clear all
          </Button>
        </div>
      )}
      <div
        data-ui="ledger-summary"
        className={ledgerFeatureStyles['ledger-summary']}
        ref={summary}
        tabIndex={-1}
      >
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
          !loading && <span>Total unavailable</span>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {loading && !page && <ContentLoading layout="expenses" />}
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
                    data-ui="ledger-month-summaries form-region"
                    className={ledgerFeatureStyles['ledger-month-summaries']}
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
                      data-ui="ledger-month form-region"
                      className={ledgerFeatureStyles['ledger-month']}
                      key={month.month}
                      aria-label={month.month}
                    >
                      <header data-ui="form-region">
                        <div
                          data-ui="ledger-month-heading"
                          className={
                            ledgerFeatureStyles['ledger-month-heading']
                          }
                        >
                          <h2>
                            {month.month
                              ? new Intl.DateTimeFormat('en', {
                                  month: 'long',
                                  year: 'numeric',
                                  timeZone: 'UTC',
                                }).format(
                                  new Date(`${month.month}-01T00:00:00Z`),
                                )
                              : 'Expenses in amount order'}
                          </h2>
                          <span
                            data-ui="ledger-month-count"
                            className={
                              ledgerFeatureStyles['ledger-month-count']
                            }
                          >
                            {month.expenseCount}{' '}
                            {month.expenseCount === '1'
                              ? 'expense'
                              : 'expenses'}
                          </span>
                        </div>
                        <span
                          data-ui="ledger-month-total"
                          className={ledgerFeatureStyles['ledger-month-total']}
                        >
                          <Money
                            value={money(month.totalExpenseMinor)}
                            currency="USD"
                          />
                        </span>
                      </header>
                      <div
                        data-ui="ledger-columns"
                        className={ledgerFeatureStyles['ledger-columns']}
                        aria-hidden="true"
                      >
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
                            next.set('expense', node.expenseId);
                            next.set('expenseGroup', node.groupId);
                            const id = `ledger-expense-${node.expenseId}`;
                            return (
                              <li key={node.expenseId}>
                                <Link
                                  id={id}
                                  href={`${pathname}?${next}`}
                                  scroll={false}
                                  onNavigate={() => {
                                    remember(id);
                                  }}
                                >
                                  <CategoryIcon category={node.category} />
                                  <span
                                    data-ui="ledger-description"
                                    className={
                                      ledgerFeatureStyles['ledger-description']
                                    }
                                  >
                                    <strong>{node.description}</strong>
                                    <span>
                                      <span
                                        data-ui="ledger-category-text"
                                        className={
                                          ledgerFeatureStyles[
                                            'ledger-category-text'
                                          ]
                                        }
                                      >
                                        {node.category[0] +
                                          node.category.slice(1).toLowerCase()}
                                        {' · '}
                                      </span>
                                      {!groupId && <>{source.name} · </>}
                                      <time dateTime={node.effectiveDate}>
                                        {overviewDate(node.effectiveDate)}
                                      </time>
                                    </span>
                                  </span>
                                  <span
                                    data-ui="ledger-payer"
                                    className={
                                      ledgerFeatureStyles['ledger-payer']
                                    }
                                  >
                                    <span
                                      data-ui="ledger-payer-label"
                                      className={
                                        ledgerFeatureStyles[
                                          'ledger-payer-label'
                                        ]
                                      }
                                    >
                                      Paid by{' '}
                                    </span>
                                    {node.payer.displayName}
                                  </span>
                                  <span
                                    data-ui="ledger-money"
                                    className={
                                      ledgerFeatureStyles['ledger-money']
                                    }
                                  >
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
                <div
                  ref={sentinel}
                  data-ui="ledger-pagination"
                  className={ledgerFeatureStyles['ledger-pagination']}
                  aria-live="polite"
                >
                  {loading ? (
                    <p role="status">Loading more expenses…</p>
                  ) : pageError ? (
                    <>
                      <p role="alert">{pageError}</p>
                      <button
                        onClick={() => {
                          if (inFlight.current) return;
                          inFlight.current = true;
                          automaticArmed.current = false;
                          setPageError('');
                          setLoading(true);
                          setRetry((value) => value + 1);
                        }}
                        data-ui="form-button"
                      >
                        Retry loading expenses
                      </button>
                    </>
                  ) : !page.pageInfo.hasNextPage ? (
                    <p role="status">All expenses loaded.</p>
                  ) : null}
                  {!pageError && rows.length > 0 && (
                    <button
                      aria-disabled={
                        loading ||
                        !page.pageInfo.hasNextPage ||
                        !page.pageInfo.endCursor
                      }
                      onClick={loadMore}
                      data-ui="form-button"
                    >
                      Load more expenses
                    </button>
                  )}
                </div>
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
          <ExpenseFilterForm
            layout={filterLayout}
            key={filterText}
            filterText={filterText}
            groupId={groupId}
            spaces={spaces}
            today={today}
            onApply={(data) => {
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
              change({
                ...patch,
                expense: null,
                expenseGroup: null,
                create: null,
              });
              setFiltersOpen(false);
            }}
          />
        </LedgerDialog>
      )}
      {(selected || create) && (
        <ExpensePresentation
          kind={selected ? 'detail' : 'create'}
          layout={filterLayout}
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
                restoreCount.current = origin.current?.count ?? rows.length;
                setRestoring(true);
                reset();
                setNotice(
                  'Expense access changed. Rechecking authorized expenses.',
                );
                close();
              }}
            />
          ) : create === 'choose' && !groupId ? (
            <label data-ui="form-label">
              Source space
              {spaces.length ? (
                <select
                  data-ui="form-control"
                  value=""
                  onChange={(event) =>
                    change({ create: event.target.value }, true)
                  }
                >
                  <option value="" disabled>
                    Choose a space
                  </option>
                  {spaces.map((space) => (
                    <option key={space.groupId} value={space.groupId}>
                      {space.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p role="alert">
                  No eligible source spaces are available. Return to Groups to
                  check your access.
                </p>
              )}
            </label>
          ) : createSpace ? (
            <>
              {!groupId && (
                <label data-ui="form-label">
                  Source space
                  <select
                    value={create}
                    onChange={(e) => change({ create: e.target.value }, true)}
                    data-ui="form-control"
                  >
                    {spaces.map((s) => (
                      <option key={s.groupId} value={s.groupId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p
                data-ui="expense-create-context"
                className={formsFeatureStyles['expense-create-context']}
              >
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
      data-ui="ledger-dialog ledger-dialog--filters"
      className={cx(
        dialogFeatureStyles['ledger-dialog'],
        filterFeatureStyles['ledger-dialog--filters'],
      )}
      ref={ref}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => containDialogFocus(event, ref.current)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header data-ui="form-region">
        <h2>Filter expenses</h2>
        <button
          data-ui="ledger-dialog-close form-button"
          className={filterFeatureStyles['ledger-dialog-close']}
          aria-label="Back to expenses"
          autoFocus
          onClick={onClose}
        >
          <AppIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
