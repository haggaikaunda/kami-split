'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
type Connection = Extract<
  activityFeed$data,
  { readonly __typename: 'ActivityConnection' }
>;
type Event = Connection['edges'][number]['node'];
type Detail = activityDetailQuery['response']['node'];

export function ActivityWorkspace({ groupId = '' }: { groupId?: string }) {
  const access = useFinancialSession();
  return (
    <main className="activity-workspace" id="page-content">
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
}: {
  scope: FinancialScope;
  groupId: string;
}) {
  const detailRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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
  const reset = () => {
    setPage(undefined);
    setSelected(undefined);
    setDetail(undefined);
    setError('');
    setAfter(null);
    setLoading(true);
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    let live = true;
    const filter = {
      kind: kind ? (kind as 'EXPENSE_CREATED' | 'REPAYMENT_RECORDED') : null,
      sourceGroupId: source || null,
    };
    const accept = (reference: activityFeed$key) => {
      if (!live || !scope.isLive()) return;
      const result = readInlineData<activityFeed$key>(feedDocument, reference);
      if (result.__typename === 'ActivityConnection') {
        setPage(result);
        setError('');
      } else {
        setSelected(undefined);
        setDetail(undefined);
        setError(
          'Activity is unavailable. Your access or this page may have changed. Refresh to try again.',
        );
      }
      setLoading(false);
    };
    const fail = () => {
      if (live && scope.isLive()) {
        setSelected(undefined);
        setDetail(undefined);
        setError('Activity is unavailable. Refresh to try again.');
        setLoading(false);
      }
    };
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
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, [scope, groupId, kind, source, after, version]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    detailRef.current?.focus();
    // Reauthorize the feed and record together: Household eligibility can be
    // lost while ordinary group membership still permits the source record.
    const filter = { kind: null, sourceGroupId: selected.groupId };
    const check = groupId
      ? fetchQuery<activityGroupQuery>(
          scope.environment,
          groupDocument,
          { groupId, filter },
          { fetchPolicy: 'network-only' },
        ).toPromise()
      : fetchQuery<activityHouseholdQuery>(
          scope.environment,
          householdDocument,
          { filter },
          { fetchPolicy: 'network-only' },
        ).toPromise();
    void check
      .then((result) => {
        if (!live || !scope.isLive()) return;
        const reference =
          result &&
          ('groupActivity' in result
            ? result.groupActivity
            : result.householdActivity);
        if (
          !reference ||
          readInlineData<activityFeed$key>(feedDocument, reference)
            .__typename !== 'ActivityConnection'
        )
          throw new Error('access');
        return fetchQuery<activityDetailQuery>(
          scope.environment,
          detailDocument,
          { id: selected.recordId },
          { fetchPolicy: 'network-only' },
        ).toPromise();
      })
      .then((result) => {
        if (!live || !scope.isLive()) return;
        if (
          !result?.node ||
          !('groupId' in result.node) ||
          result.node.groupId !== selected.groupId
        )
          throw new Error('access');
        setDetail(result.node);
        setDetailLoading(false);
      })
      .catch(() => {
        if (live && scope.isLive()) {
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
  useEffect(() => {
    const refresh = () => {
      setError('');
      setPage(undefined);
      setSelected(undefined);
      setDetail(undefined);
      setAfter(null);
      setLoading(true);
      setVersion((v) => v + 1);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return (
    <>
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
              {page.edges.map(({ node }) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setDetailError('');
                      setSelected({ ...node });
                      setDetail(undefined);
                      setDetailLoading(true);
                    }}
                  >
                    <span>
                      <strong>
                        {node.kind === 'EXPENSE_CREATED'
                          ? 'Expense created'
                          : 'Repayment recorded'}
                      </strong>
                      <span>
                        {node.creator.displayName} ·{' '}
                        {node.payer
                          ? `${node.payer.displayName} paid`
                          : `${node.sender?.displayName} sent to ${node.recipient?.displayName}`}
                      </span>
                      <span>
                        {!node.isHousehold || groupId
                          ? node.groupName
                          : 'Household'}{' '}
                        · Effective {node.effectiveDate}
                      </span>
                      <span>
                        Recorded{' '}
                        <time dateTime={node.timestamp}>
                          {node.timestamp
                            .replace('T', ' ')
                            .replace('Z', ' UTC')}
                        </time>
                      </span>
                    </span>
                    <strong>
                      {money(node.amountMinor)} {node.currency}
                    </strong>
                  </button>
                </li>
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
          aria-label="Current record detail"
          tabIndex={-1}
          ref={detailRef}
        >
          <h2>Current record · {selected.groupName}</h2>
          <button
            type="button"
            onClick={() => {
              setSelected(undefined);
              setDetail(undefined);
              triggerRef.current?.focus();
            }}
          >
            Close detail
          </button>
          {detailLoading ? (
            <p role="status">Checking current record access…</p>
          ) : detailError ? (
            <p role="alert">{detailError}</p>
          ) : (
            detail &&
            'groupId' in detail && (
              <>
                <h3>
                  {detail.__typename === 'Expense'
                    ? detail.description
                    : 'Repayment'}
                </h3>
                <p>
                  {money(
                    detail.__typename === 'Expense'
                      ? detail.totalMinor
                      : detail.amountMinor,
                  )}{' '}
                  {detail.currency}
                </p>
                <p>Effective {detail.effectiveDate}</p>
                <Link href={`/groups/${encodeURIComponent(detail.groupId)}`}>
                  Open {selected.groupName}
                </Link>
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
