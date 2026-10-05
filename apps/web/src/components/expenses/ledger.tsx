'use client';
import { CategoryIcon } from '@/components/workspace-identity';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fetchQuery, readInlineData } from 'relay-runtime';
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
  containDialogFocus,
  SummaryMetric,
  SignedBalanceMetric,
  Money,
  SpaceChip,
} from '@/components/primitives';
import { ExpenseDetail } from '@/components/groups/expense-detail';
import { ExpenseForm } from '@/components/groups/expense-form';
import './ledger.css';

type View = Extract<expensesView$data, { readonly __typename: 'ExpenseView' }>;
export type LedgerSpace = {
  groupId: string;
  name: string;
  viewerMembership: { readonly id: string };
  members: readonly Member[];
};
const filterKeys = ['groupId', 'category', 'memberId', 'from', 'to'] as const;
export function ExpenseLedger(
  props: Omit<
    Parameters<typeof LedgerContent>[0],
    'filterTrigger' | 'onFilterApply'
  >,
) {
  const params = useSearchParams();
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
  activeSpaces,
  onDenied,
  onRefreshContext,
  filterTrigger,
  onFilterApply,
}: {
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
}) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const filterText = new URLSearchParams(
    filterKeys.flatMap((key) =>
      params.get(key) ? [[key, params.get(key)!]] : [],
    ),
  ).toString();
  const selected = params.get('expense') ?? '',
    source = params.get('expenseGroup') ?? groupId;
  const create = params.get('create') ?? '';
  const [page, setPage] = useState<View>();
  const [rows, setRows] = useState<View['edges']>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
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
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
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
    reset();
    void onRefreshContext?.();
  };
  useEffect(() => {
    let live = true;
    const ticket = ++generation.current;
    const values = new URLSearchParams(filterText);
    const filter = Object.fromEntries(
      filterKeys.map((key) => [key, values.get(key) || null]),
    ) as NonNullable<expensesGroupQuery['variables']['filter']>;
    const accept = (reference: expensesView$key) => {
      if (!live || !scope.isLive() || ticket !== generation.current) return;
      const result = readInlineData<expensesView$key>(viewDocument, reference);
      if (result.__typename === 'ExpenseView') {
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
        if ('code' in result && result.code === 'NOT_FOUND') onDenied();
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
  }, []);
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
          Space
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
        Category
        <select name="category" defaultValue={params.get('category') ?? ''}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        Member
        <select name="memberId" defaultValue={params.get('memberId') ?? ''}>
          <option value="">All members</option>
          {spaces.map((s) => (
            <optgroup label={s.name} key={s.groupId}>
              {s.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        From
        <input
          name="from"
          type="date"
          defaultValue={params.get('from') ?? ''}
        />
      </label>
      <label>
        To
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
        <button type="submit">Apply filters</button>
      </div>
    </form>
  );
  const createSpace = spaces.find((s) => s.groupId === create);
  return (
    <section className="expense-ledger" aria-label="Expenses">
      <div className="ui-summary-row" ref={summary} tabIndex={-1}>
        <SummaryMetric
          label={groupId ? 'Total expenses' : 'Total shared expenses'}
        >
          {page && !error ? (
            <>
              <Money value={money(page.totalExpenseMinor)} currency="USD" />
              <span>
                {page.expenseCount} expenses{filterText && ' · filtered'}
              </span>
            </>
          ) : (
            <span>{loading ? 'Loading total…' : 'Total unavailable'}</span>
          )}
        </SummaryMetric>
        {net === '0' ? (
          <SummaryMetric
            label={groupId ? 'Your balance' : 'Your net balance'}
            detail={
              groupId ? 'Unfiltered' : 'Net zero across spaces · unfiltered'
            }
          >
            <Money value={money(net)} currency="USD" />
          </SummaryMetric>
        ) : net !== undefined ? (
          <SignedBalanceMetric
            label={groupId ? 'Your balance' : 'Your net balance'}
            scope={groupId ? 'group' : 'household'}
            position={
              minor(net) > 0n
                ? 'positive'
                : minor(net) < 0n
                  ? 'negative'
                  : 'zero'
            }
            value={`${minor(net) > 0n ? '+' : ''}${money(net)}`}
            currency="USD"
            detail={`${minor(net) > 0n ? "You're owed" : 'You owe'} · unfiltered`}
          />
        ) : (
          <SummaryMetric label="Your balance">Unavailable</SummaryMetric>
        )}
        {!groupId && (
          <SummaryMetric label="Active spaces">
            {activeSpaces ?? 'Unavailable'}
          </SummaryMetric>
        )}
      </div>
      <div className="ledger-toolbar">
        <button
          ref={filterTrigger}
          className="ledger-filter-button"
          onClick={() => setFiltersOpen(true)}
        >
          Filters{filterText ? ' · active' : ''}
        </button>
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
          disabled={!spaces.length}
          onClick={() =>
            choose('ledger-add', {
              create: groupId || params.get('groupId') || spaces[0].groupId,
            })
          }
        >
          Add expense
        </button>
      </div>
      {filterText && (
        <div className="ledger-active-filters">
          <p>
            Active filters:{' '}
            {filterKeys
              .filter((key) => params.get(key))
              .map(
                (key) =>
                  `${key === 'groupId' ? 'Space' : key === 'memberId' ? 'Member' : key}: ${key === 'groupId' ? (spaces.find((s) => s.groupId === params.get(key))?.name ?? 'Selected space') : key === 'memberId' ? (spaces.flatMap((s) => s.members).find((m) => m.id === params.get(key))?.displayName ?? 'Selected member') : params.get(key)}`,
              )
              .join(' · ')}
          </p>
          <button
            onClick={() => {
              reset();
              change(Object.fromEntries(filterKeys.map((key) => [key, null])));
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading authorized expenses…</p>}
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        page && (
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
                    <h2>
                      {new Intl.DateTimeFormat('en', {
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      }).format(new Date(`${month.month}-01T00:00:00Z`))}
                    </h2>
                    <span>
                      {money(month.totalExpenseMinor)} USD ·{' '}
                      {month.expenseCount} expenses
                    </span>
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
                                origin.current = { id, scroll: window.scrollY };
                              }}
                            >
                              <time dateTime={node.effectiveDate}>
                                {node.effectiveDate.slice(8)}
                              </time>
                              <CategoryIcon category={node.category} />
                              <span className="ledger-description">
                                <strong>{node.description}</strong>
                                <span>
                                  {!groupId && (
                                    <SpaceChip>{source.name}</SpaceChip>
                                  )}{' '}
                                  Paid by {node.payer.displayName}
                                </span>
                              </span>
                              <span className="ledger-money">
                                <Money
                                  value={money(node.totalMinor)}
                                  currency={source.currency}
                                />
                                <span>
                                  Your share{' '}
                                  {viewer ? money(share ?? '0') : 'unavailable'}
                                </span>
                              </span>
                              <span aria-hidden="true">›</span>
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
        <LedgerDialog
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
        </LedgerDialog>
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
}: {
  scope: FinancialScope;
  groupId: string;
  source: string;
  id: string;
  onDenied: () => void;
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
      <p>Source: {name}</p>
      <ExpenseDetail
        scope={scope}
        group={source}
        id={id}
        onUnavailable={onDenied}
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
        <h2>{title}</h2>
        <button autoFocus onClick={onClose}>
          Back to expenses
        </button>
      </header>
      {children}
    </dialog>
  );
}
