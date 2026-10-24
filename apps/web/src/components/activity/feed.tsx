'use client';
import { ContentLoading } from '../ui/loading';

import { cx } from '../ui/classnames';

import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { spaceHref } from '@/lib/relay/space-routes';
import { AppIcon, WorkspaceNavigation } from '@/components/workspace-identity';
import { CategoryIcon } from '@/components/financial/category';
import Link from 'next/link';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import {
  workspaceFetchPolicy,
  NetworkQuery,
  useWorkspaceQuery,
} from '@/lib/relay/query';
import { fetchQuery, readInlineData } from 'relay-runtime';
import { useFinancialSession } from '@/components/groups/session';
import { Button } from '../ui/primitives';
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

import activityStyles from './feed.module.css';
import shellStyles from '../workspace/shell.module.css';
import formLayoutStyles from '../ui/form-layout.module.css';

type Connection = Extract<
  activityFeed$data,
  { readonly __typename: 'ActivityConnection' }
>;
type Event = Connection['edges'][number]['node'];
const recordedDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
export function ActivityWorkspace({ groupId = '' }: { groupId?: string }) {
  const access = useFinancialSession();
  return (
    <main
      data-ui="form-scope activity-workspace"
      className={cx(formLayoutStyles['form-scope'], shellStyles.shell)}
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
        <ContentLoading layout="activity" />
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
  const [cacheAllowed, setCacheAllowed] = useState(true);
  const [after, setAfter] = useState<string | null>(null);
  const [acceptedPage, setPage] = useState<{
    identity: string;
    value: Connection;
  }>();
  const [error, setError] = useState('');
  const [readPending, setLoading] = useState(true);
  const [selected, setSelected] =
    useState<Pick<Event, 'id' | 'groupId' | 'recordId'>>();
  const identity = JSON.stringify([scope.id, groupId, kind, after, version]);
  // A queued acceptance belongs to its captured request, even if React commits
  // it after the URL-controlled filter has moved to another read.
  const filter = {
    kind: kind
      ? (kind as 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'REPAYMENT_RECORDED')
      : null,
    sourceGroupId: source || null,
  };
  const warmGroup = useWorkspaceQuery<activityGroupQuery>(
    scope,
    groupDocument,
    { groupId, after, filter },
    cacheAllowed && !!groupId && !after && version === 0,
  );
  const warmHousehold = useWorkspaceQuery<activityHouseholdQuery>(
    scope,
    householdDocument,
    { after, filter },
    cacheAllowed && !groupId && !after && version === 0,
  );
  const prepared =
    cacheAllowed && !after && !kind && version === 0 ? initialFeed : undefined;
  const warmReference =
    prepared ?? warmGroup?.groupActivity ?? warmHousehold?.householdActivity;
  const warmPage = warmReference
    ? readInlineData<activityFeed$key>(feedDocument, warmReference)
    : undefined;
  const page =
    acceptedPage?.identity === identity
      ? acceptedPage.value
      : warmPage?.__typename === 'ActivityConnection'
        ? warmPage
        : undefined;
  const loading = !page && (readPending || !error);
  const reportRead = useEffectEvent(() =>
    onReadState?.({ busy: loading, error }),
  );
  useEffect(() => {
    reportRead();
  }, [loading, error]);
  const [readIdentity, setReadIdentity] = useState(identity);
  // URL-owned filters can arrive after a foreground response. Adjust this
  // component's state before committing a different read's presentation.
  if (readIdentity !== identity) {
    setReadIdentity(identity);
    setPage(undefined);
    setSelected(undefined);
    setError('');
    setLoading(true);
  }
  const invalidate = () => {
    scope.invalidate?.();
    setCacheAllowed(false);
    generation.current++;
    request.current?.unsubscribe();
    setPage(undefined);
    setSelected(undefined);
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
    const ticket = ++generation.current;
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
        setPage({ identity, value: result });
        setError('');
      } else {
        onDenied?.();
        setSelected(undefined);
        setError(
          'Activity is unavailable. Your access or this page may have changed. Refresh to try again.',
        );
      }
      setLoading(false);
    };
    const fail = () => {
      if (live && scope.isLive() && ticket === generation.current) {
        setSelected(undefined);
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
          {
            fetchPolicy:
              after || version > 0
                ? 'network-only'
                : workspaceFetchPolicy(scope.environment, groupDocument, {
                    groupId,
                    after,
                    filter,
                  }),
          },
        ).subscribe({
          next: (result) => accept(result.groupActivity),
          error: fail,
        })
      : fetchQuery<activityHouseholdQuery>(
          scope.environment,
          householdDocument,
          { after, filter },
          {
            fetchPolicy:
              after || version > 0
                ? 'network-only'
                : workspaceFetchPolicy(scope.environment, householdDocument, {
                    after,
                    filter,
                  }),
          },
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
    if (selected) detailRef.current?.focus();
  }, [selected]);
  const denyDetail = () => {
    setPage(undefined);
    setSelected(undefined);
    setError('Activity access changed. Refresh to recheck access.');
  };

  return (
    <WorkspaceLoading
      busy={loading}
      className={cx(
        activityStyles['activity-view'],
        selected && activityStyles['activity-view-selected'],
      )}
    >
      {!managedRefresh && (
        <WorkspaceRefresh
          contentPending
          busy={loading}
          error={error}
          onRefresh={reset}
        />
      )}
      <section
        data-ui="activity-feed-panel form-region"
        className={activityStyles['activity-feed-panel']}
        aria-labelledby={headingId}
      >
        <header
          data-ui="activity-feed-header form-region"
          className={activityStyles['activity-feed-header']}
        >
          <h2 id={headingId}>Recent activity</h2>
          <div
            data-ui="activity-controls"
            className={activityStyles['activity-controls']}
          >
            <label data-ui="form-label">
              Event type
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  reset();
                }}
                data-ui="form-control"
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
          <ContentLoading layout="activity" />
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
                        setSelected({
                          id: node.id,
                          groupId: node.groupId,
                          recordId: node.recordId,
                        });
                      }}
                      data-ui="form-button"
                    >
                      <span
                        data-ui="activity-row-icon"
                        className={activityStyles['activity-row-icon']}
                        aria-hidden="true"
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
                      </span>
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
                          <span>{node.groupName}</span>
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={node.timestamp}
                            title={node.timestamp}
                          >
                            Recorded{' '}
                            {recordedDate.format(new Date(node.timestamp))}
                          </time>
                        </span>
                      </span>
                      <span
                        data-ui="activity-row-amount"
                        className={activityStyles['activity-row-amount']}
                      >
                        <Money
                          value={money(node.amountMinor)}
                          currency={node.currency}
                          focusable={false}
                        />
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
          data-ui="activity-detail form-region"
          className={activityStyles['activity-detail']}
          aria-label="Historical event detail"
          tabIndex={-1}
          ref={detailRef}
        >
          <header
            data-ui="activity-detail-header form-region"
            className={activityStyles['activity-detail-header']}
          >
            <h2>Activity detail</h2>
            <Button
              tone="text"
              onClick={() => {
                setSelected(undefined);
                restoreFeedFocus.current = true;
              }}
            >
              Close detail
            </Button>
          </header>
          <NetworkQuery<activityDetailQuery>
            scope={scope}
            key={selected.id}
            document={detailDocument}
            variables={{ eventId: selected.id, groupId: groupId || null }}
            fallback={<p role="status">Loading activity detail…</p>}
            failure={<ActivityUnavailable onUnavailable={denyDetail} />}
          >
            {(result) => (
              <ActivityDetail
                result={result}
                selected={selected}
                onUnavailable={denyDetail}
              />
            )}
          </NetworkQuery>
        </section>
      )}
    </WorkspaceLoading>
  );
}

function ActivityUnavailable({ onUnavailable }: { onUnavailable: () => void }) {
  const deny = useEffectEvent(onUnavailable);
  useEffect(() => {
    deny();
  }, []);
  return <p role="alert">This record is unavailable.</p>;
}
function ActivityDetail({
  result,
  selected,
  onUnavailable,
}: {
  result: activityDetailQuery['response'];
  selected: Pick<Event, 'id' | 'groupId' | 'recordId'>;
  onUnavailable: () => void;
}) {
  const detail = result.activityEvent;
  if (
    detail?.__typename !== 'ActivityEvent' ||
    detail.id !== selected.id ||
    detail.groupId !== selected.groupId ||
    detail.recordId !== selected.recordId
  )
    return <ActivityUnavailable onUnavailable={onUnavailable} />;
  return (
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
  );
}
