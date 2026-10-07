'use client';
import { spaceHref } from '@/lib/relay/space-routes';
import { WorkspaceNavigation } from '@/components/workspace-identity';
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { fetchQuery, readInlineData } from 'relay-runtime';
import { useFinancialSession } from '@/components/groups/session';
import { WorkspaceHeader, WorkspaceTabs } from '@/components/primitives';
import type { FinancialScope } from '@/lib/relay/environment';
import { money } from '@/lib/relay/money';
import groupDocument, {
  type activityGroupQuery,
} from '@/lib/relay/__generated__/activityGroupQuery.graphql';
import householdDocument, {
  type activityHouseholdQuery,
} from '@/lib/relay/__generated__/activityHouseholdQuery.graphql';
import feedDocument, {
  type activityFeed$data,
  type activityFeed$key,
} from '@/lib/relay/__generated__/activityFeed.graphql';
import detailDocument, {
  type activityDetailQuery,
} from '@/lib/relay/__generated__/activityDetailQuery.graphql';
import './feed.css';
import { Member } from '@/components/primitives';
import { HistoricalDetail, eventDay, eventSummary } from './event-detail';
import { useForegroundRefresh } from '@/components/groups/foreground';
type Connection = Extract<
  activityFeed$data,
  { readonly __typename: 'ActivityConnection' }
>;
type Event = Connection['edges'][number]['node'];
type Detail = Extract<
  activityDetailQuery['response']['activityEvent'],
  { readonly __typename: 'ActivityEvent' }
>;

export function ActivityWorkspace({ groupId = '' }: { groupId?: string }) {
  const access = useFinancialSession();
  return (
    <main className="financial-journey activity-workspace" id="page-content">
      <WorkspaceNavigation />
      <WorkspaceHeader
        title="Activity"
        context={groupId ? 'Group workspace' : 'Household workspace'}
      />
      <WorkspaceTabs
        current="Activity"
        hrefFor={(section) =>
          section === 'Activity'
            ? groupId
              ? `/groups/${encodeURIComponent(groupId)}/activity`
              : '/household/activity'
            : groupId
              ? `/groups/${encodeURIComponent(groupId)}?tab=${section.toLowerCase()}`
              : section === 'Expenses'
                ? '/household/expenses'
                : `/groups?section=${section.toLowerCase()}`
        }
      />
      {access.loading ? (
        <p role="status">Loading secure access…</p>
      ) : access.error ? (
        <p role="alert">{access.error}</p>
      ) : !access.scope ? (
        <p>
          <Link href="/sign-in">Sign in</Link> to see your activity.
        </p>
      ) : (
        <ActivityFeed
          key={`${access.scope.id}:${groupId}`}
          scope={access.scope}
          groupId={groupId}
        />
      )}
    </main>
  );
}

/** Network-only refreshes discard prior rows before rechecking current access. */
export function ActivityFeed({
  scope,
  groupId,
  initialFeed,
  managedRefresh = false,
  onDenied,
}: {
  scope: FinancialScope;
  groupId: string;
  initialFeed?: activityFeed$key;
  managedRefresh?: boolean;
  onDenied?: () => void;
}) {
  const initial = useRef(initialFeed);
  const generation = useRef(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const detailRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const feedScroll = useRef(0);
  const restoreFeedFocus = useRef(false);
  const [kind, setKind] = useState('');
  const source = '';
  const [version, setVersion] = useState(0);
  const [after, setAfter] = useState<string | null>(null);
  const [page, setPage] = useState<Connection>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Event>();
  const [detail, setDetail] = useState<Detail>();
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const invalidate = () => {
    generation.current++;
    request.current?.unsubscribe();
    setPage(undefined);
    setSelected(undefined);
    setDetail(undefined);
    setError('');
    setAfter(null);
    setLoading(true);
  };
  const reset = () => {
    invalidate();
    setVersion((v) => v + 1);
  };
  useForegroundRefresh(
    invalidate,
    () => setVersion((v) => v + 1),
    !managedRefresh,
  );
  useEffect(() => {
    let live = true;
    const ticket = generation.current;
    const filter = {
      kind: kind
        ? (kind as 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'REPAYMENT_RECORDED')
        : null,
      sourceGroupId: source || null,
    };
    const accept = (reference: activityFeed$key) => {
      if (!live || !scope.isLive() || ticket !== generation.current) return;
      const result = readInlineData<activityFeed$key>(feedDocument, reference);
      if (result.__typename === 'ActivityConnection') {
        setPage(result);
        setError('');
      } else {
        onDenied?.();
        setSelected(undefined);
        setDetail(undefined);
        setError(
          'Activity is unavailable. Your access or this page may have changed. Refresh to try again.',
        );
      }
      setLoading(false);
    };
    const fail = () => {
      if (live && scope.isLive() && ticket === generation.current) {
        setSelected(undefined);
        setDetail(undefined);
        setError('Activity is unavailable. Refresh to try again.');
        setLoading(false);
      }
    };
    const prepared = initial.current;
    initial.current = undefined;
    if (prepared && !after && !kind && version === 0) {
      accept(prepared);
      return () => {
        live = false;
      };
    }
    const subscription = groupId
      ? fetchQuery<activityGroupQuery>(
          scope.environment,
          groupDocument,
          { groupId, after, filter },
          { fetchPolicy: 'network-only' },
        ).subscribe({
          next: (result) => accept(result.groupActivity),
          error: fail,
        })
      : fetchQuery<activityHouseholdQuery>(
          scope.environment,
          householdDocument,
          { after, filter },
          { fetchPolicy: 'network-only' },
        ).subscribe({
          next: (result) => accept(result.householdActivity),
          error: fail,
        });
    request.current = subscription;
    return () => {
      live = false;
      subscription.unsubscribe();
    };
    // The parent owns access denial; query variables and generation own the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, groupId, kind, source, after, version]);
  useEffect(() => {
    if (selected || !restoreFeedFocus.current) return;
    restoreFeedFocus.current = false;
    const trigger = triggerRef.current;
    if (!scope.isLive() || !trigger?.isConnected) return;
    trigger.focus({ preventScroll: true });
    if (window.scrollY !== feedScroll.current)
      window.scrollTo({ top: feedScroll.current });
  }, [selected, scope]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const ticket = generation.current;
    detailRef.current?.focus();
    void fetchQuery<activityDetailQuery>(
      scope.environment,
      detailDocument,
      { eventId: selected.id, groupId: groupId || null },
      { fetchPolicy: 'network-only' },
    )
      .toPromise()
      .then((result) => {
        if (!live || !scope.isLive() || ticket !== generation.current) return;
        const event = result?.activityEvent;
        if (
          event?.__typename !== 'ActivityEvent' ||
          event.id !== selected.id ||
          event.groupId !== selected.groupId ||
          event.recordId !== selected.recordId
        )
          throw new Error('access');
        setDetail(event);
        setDetailLoading(false);
      })
      .catch(() => {
        if (live && scope.isLive() && ticket === generation.current) {
          setPage(undefined);
          setSelected(undefined);
          setDetail(undefined);
          setError('Activity access changed. Refresh to recheck access.');
          setDetailError('This record is unavailable.');
          setDetailLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [scope, groupId, selected]);

  return (
    <div
      className={`activity-view ${selected ? 'activity-view-selected' : ''}`}
    >
      <div className="activity-controls">
        <label>
          Event type
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              reset();
            }}
          >
            <option value="">All events</option>
            <option value="EXPENSE_CREATED">Expenses created</option>
            <option value="EXPENSE_UPDATED">Expenses updated</option>
            <option value="REPAYMENT_RECORDED">Repayments recorded</option>
          </select>
        </label>
        <button type="button" onClick={reset}>
          Refresh activity
        </button>
      </div>
      {loading ? (
        <p role="status">Loading activity…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : page && page.edges.length === 0 ? (
        <p role="status">
          {kind || source
            ? 'No activity matches these filters.'
            : 'No activity yet.'}
        </p>
      ) : (
        page && (
          <>
            <ol className="activity-events">
              {page.edges.map(({ node }, index) => (
                <Fragment key={node.id}>
                  {(index === 0 ||
                    eventDay(page.edges[index - 1].node.timestamp) !==
                      eventDay(node.timestamp)) && (
                    <li className="activity-day">
                      <h2>{eventDay(node.timestamp)}</h2>
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        feedScroll.current = window.scrollY;
                        setDetailError('');
                        setSelected({ ...node });
                        setDetail(undefined);
                        setDetailLoading(true);
                      }}
                    >
                      <span
                        className={`activity-kind activity-kind-${node.kind.toLowerCase()}`}
                        aria-hidden="true"
                      >
                        {node.kind === 'EXPENSE_UPDATED'
                          ? '✎'
                          : node.kind === 'EXPENSE_CREATED'
                            ? '+'
                            : '⇄'}
                      </span>
                      <span className="activity-row-content">
                        <span className="activity-row-actor">
                          <Member name={node.creator.displayName} />
                          <strong>
                            {node.kind === 'EXPENSE_UPDATED'
                              ? 'updated an expense'
                              : node.kind === 'EXPENSE_CREATED'
                                ? 'added an expense'
                                : 'recorded a repayment'}
                          </strong>
                        </span>
                        <span>
                          {node.description ||
                            `Paid ${node.recipient?.displayName ?? 'recipient'}`}
                        </span>
                        <span>{eventSummary(node)}</span>
                        <span>
                          {node.groupName} · Effective {node.effectiveDate}
                        </span>
                        <span>
                          Recorded{' '}
                          <time dateTime={node.timestamp}>
                            {new Date(node.timestamp).toLocaleString()}
                          </time>
                        </span>
                      </span>
                      <strong className="activity-row-amount">
                        {money(node.amountMinor)} {node.currency}
                      </strong>
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                </Fragment>
              ))}
            </ol>
            {page.pageInfo.hasNextPage && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setSelected(undefined);
                  setDetail(undefined);
                  setPage(undefined);
                  setLoading(true);
                  setAfter(page.pageInfo.endCursor ?? null);
                }}
              >
                Next activity page
              </button>
            )}
            {after && (
              <button type="button" onClick={reset}>
                Return to latest activity
              </button>
            )}
          </>
        )
      )}
      {selected && (
        <section
          className="activity-detail"
          aria-label="Historical event detail"
          tabIndex={-1}
          ref={detailRef}
        >
          <h2>Activity · {selected.groupName}</h2>
          <button
            type="button"
            onClick={() => {
              setSelected(undefined);
              setDetail(undefined);
              restoreFeedFocus.current = true;
            }}
          >
            Close detail
          </button>
          {detailLoading ? (
            <p role="status">Checking historical event access…</p>
          ) : detailError ? (
            <p role="alert">{detailError}</p>
          ) : (
            detail && (
              <>
                <HistoricalDetail event={detail} />
                <Link
                  href={`${spaceHref({ id: detail.groupId, isHousehold: detail.isHousehold, kind: detail.groupKind })}${detail.kind === 'REPAYMENT_RECORDED' ? '?tab=balances' : `?tab=expenses&expense=${encodeURIComponent(detail.recordId)}&expenseGroup=${encodeURIComponent(detail.groupId)}`}`}
                >
                  {detail.kind === 'REPAYMENT_RECORDED'
                    ? 'View source balances'
                    : 'View current expense'}
                </Link>
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
