'use client';
import activityStyles from './feed.module.css';
import { cx } from '../ui/classnames';

import shellStyles from '../workspace/shell.module.css';
import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { Timestamp } from '@/components/date-time';
import { spaceHref } from '@/lib/relay/space-routes';
import {
  AppIcon,
  CategoryIcon,
  WorkspaceNavigation,
} from '@/components/workspace-identity';
import Link from 'next/link';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { fetchQuery, readInlineData } from 'relay-runtime';
import { useFinancialSession } from '@/components/groups/session';
import { Button, Skeleton } from '../ui/primitives';
import { Money } from '../financial/presentation';
import { WorkspaceHeader, WorkspaceTabs } from '../workspace/patterns';
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

import { HistoricalDetail, eventAction } from './event-detail';
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
    <main
      className={`financial-journey activity-workspace ${shellStyles.shell}`}
      id="page-content"
    >
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
        <p role="status">Loading workspace…</p>
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
  kind: controlledKind,
  onKindChange,
  onReadState,
  scope,
  groupId,
  initialFeed,
  managedRefresh = false,
  onDenied,
}: {
  scope: FinancialScope;
  groupId: string;
  onReadState?: (state: { busy: boolean; error: string }) => void;
  kind?: string;
  onKindChange?: (kind: string) => void;
  initialFeed?: activityFeed$key;
  managedRefresh?: boolean;
  onDenied?: () => void;
}) {
  const headingId = useId();
  const initial = useRef(initialFeed);
  const generation = useRef(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const detailRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const feedScroll = useRef(0);
  const restoreFeedFocus = useRef(false);
  const [localKind, setLocalKind] = useState('');
  const kind = controlledKind ?? localKind;
  const setKind = onKindChange ?? setLocalKind;
  const source = '';
  const [version, setVersion] = useState(0);
  const [after, setAfter] = useState<string | null>(null);
  const [page, setPage] = useState<Connection>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reportRead = useEffectEvent(() =>
    onReadState?.({ busy: loading, error }),
  );
  useEffect(() => {
    reportRead();
  }, [loading, error]);
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
    <WorkspaceLoading
      busy={loading}
      data-ui={`activity-view ${selected ? 'activity-view-selected' : ''}`}
      className={cx(
        activityStyles['activity-view'],
        selected && activityStyles['activity-view-selected'],
      )}
    >
      {!managedRefresh && (
        <WorkspaceRefresh busy={loading} error={error} onRefresh={reset} />
      )}
      <section
        data-ui="activity-feed-panel"
        className={activityStyles['activity-feed-panel']}
        aria-labelledby={headingId}
      >
        <header
          data-ui="activity-feed-header"
          className={activityStyles['activity-feed-header']}
        >
          <h2 id={headingId}>Recent activity</h2>
          <div
            data-ui="activity-controls"
            className={activityStyles['activity-controls']}
          >
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
          </div>
        </header>
        {loading ? (
          <Skeleton label="Loading activity" />
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
              <ol
                data-ui="activity-events"
                className={activityStyles['activity-events']}
              >
                {page.edges.map(({ node }) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      aria-label={`${node.creator.displayName} ${eventAction(node.kind)}${node.description ? `: ${node.description}` : ''}. ${node.groupName}. ${money(node.amountMinor)} ${node.currency}.`}
                      onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        feedScroll.current = window.scrollY;
                        setDetailError('');
                        setSelected({ ...node });
                        setDetail(undefined);
                        setDetailLoading(true);
                      }}
                    >
                      {node.kind === 'EXPENSE_CREATED' && node.after ? (
                        <CategoryIcon category={node.after.category} />
                      ) : (
                        <span
                          data-ui={`activity-kind activity-kind-${node.kind.toLowerCase()}`}
                          className={cx(
                            activityStyles['activity-kind'],
                            activityStyles[
                              `activity-kind-${node.kind.toLowerCase()}`
                            ],
                          )}
                          aria-hidden="true"
                        >
                          <AppIcon
                            name={
                              node.kind === 'EXPENSE_UPDATED'
                                ? 'edit'
                                : node.kind === 'EXPENSE_CREATED'
                                  ? 'expense'
                                  : 'arrow-up-right'
                            }
                          />
                        </span>
                      )}
                      <span
                        data-ui="activity-row-content"
                        className={activityStyles['activity-row-content']}
                      >
                        <strong>
                          {node.creator.displayName}{' '}
                          {node.kind === 'EXPENSE_UPDATED'
                            ? 'updated'
                            : node.kind === 'EXPENSE_CREATED'
                              ? 'added'
                              : 'recorded'}{' '}
                          {node.description ||
                            (node.kind === 'REPAYMENT_RECORDED'
                              ? 'a repayment'
                              : 'an expense')}
                        </strong>
                        <span
                          data-ui="activity-row-metadata"
                          className={activityStyles['activity-row-metadata']}
                        >
                          <Money
                            value={money(node.amountMinor)}
                            currency={node.currency}
                          />
                          <span aria-hidden="true">·</span>
                          <span>{node.groupName}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Recorded <Timestamp value={node.timestamp} />
                          </span>
                          {node.payer &&
                          (node.payer.id !== node.creator.id ||
                            node.payer.displayName !==
                              node.creator.displayName) ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Paid by {node.payer.displayName}</span>
                            </>
                          ) : node.sender && node.recipient ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {node.sender.displayName} paid{' '}
                                {node.recipient.displayName}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div
                data-ui="activity-pagination"
                className={activityStyles['activity-pagination']}
              >
                {page.pageInfo.hasNextPage && (
                  <Button
                    tone="text"
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
                  </Button>
                )}
                {after && (
                  <Button tone="text" onClick={reset}>
                    Return to latest activity
                  </Button>
                )}
              </div>
            </>
          )
        )}
      </section>
      {selected && (
        <section
          data-ui="activity-detail"
          className={activityStyles['activity-detail']}
          aria-label="Historical event detail"
          tabIndex={-1}
          ref={detailRef}
        >
          <header
            data-ui="activity-detail-header"
            className={activityStyles['activity-detail-header']}
          >
            <h2>Activity detail</h2>
            <Button
              tone="text"
              onClick={() => {
                setSelected(undefined);
                setDetail(undefined);
                restoreFeedFocus.current = true;
              }}
            >
              Close detail
            </Button>
          </header>
          {detailLoading ? (
            <p role="status">Loading activity detail…</p>
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
    </WorkspaceLoading>
  );
}
