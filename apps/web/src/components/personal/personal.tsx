'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFinancialSession } from '../groups/session';
import { RestoreSource } from '../groups/navigation';
import { NetworkQuery } from '@/lib/relay/query';
import type { FinancialScope } from '@/lib/relay/environment';
import document, {
  type personalInventoryQuery,
} from '@/lib/relay/__generated__/personalInventoryQuery.graphql';
import { Button, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { WorkspaceRefresh } from '../workspace-refresh';
import { WorkspaceLoading } from '../workspace-loading';
import { useForegroundRefresh } from '../groups/foreground';
import { Enrollment } from './enrollment';
import { ReportingTimezoneInitialization } from './reporting-timezone-control';
import { importSummary, coverageSummary } from './status';
import styles from './personal.module.css';
export const personalSections = [
  'Overview',
  'Transactions',
  'Connections',
] as const;
export type PersonalSection = (typeof personalSections)[number];
export function personalSection(value: string | null): PersonalSection {
  return (
    personalSections.find((section) => section.toLowerCase() === value) ??
    'Overview'
  );
}
export function PersonalWorkspace() {
  const access = useFinancialSession();
  const params = useSearchParams(),
    pathname = usePathname();
  const section = personalSection(params.get('tab'));
  if (access.loading) return <ContentLoading layout="cards" label="Personal" />;
  if (access.error) return <Status kind="error">{access.error}</Status>;
  if (!access.scope)
    return (
      <p>
        <Link
          href={`/sign-in?next=${encodeURIComponent(pathname + '?' + params)}`}
        >
          Sign in
        </Link>{' '}
        to see your private accounts.
      </p>
    );
  return (
    <PersonalRead
      key={`${access.scope.id}:${section}`}
      scope={access.scope}
      section={section}
    />
  );
}
function PersonalRead({
  scope,
  section,
}: {
  scope: FinancialScope;
  section: PersonalSection;
}) {
  const [version, setVersion] = useState(0),
    [active, setActive] = useState(true);
  const [state, setState] = useState({ busy: true, error: false });
  const [denied, setDenied] = useState(false);
  const refresh = () => {
    scope.invalidate();
    setState({ busy: true, error: false });
    setDenied(false);
    setVersion((v) => v + 1);
    setActive(true);
  };
  useForegroundRefresh(() => {
    setActive(false);
    setState({ busy: true, error: false });
  }, refresh);
  const loading = <ContentLoading layout="cards" label="Personal accounts" />;
  const failure = (
    <Status kind="error">
      Private accounts could not be loaded. Retry to check current access.
    </Status>
  );
  const error =
    denied || state.error
      ? 'Private accounts are unavailable. Retry to check current access.'
      : '';
  return (
    <WorkspaceLoading busy={state.busy}>
      <WorkspaceRefresh
        contentPending
        busy={state.busy}
        error={error}
        onRefresh={refresh}
      />
      {active ? (
        <NetworkQuery<personalInventoryQuery>
          key={version}
          scope={scope}
          document={document}
          variables={{ first: 20 }}
          fallback={loading}
          failure={failure}
          onState={setState}
        >
          {(data) =>
            data.bankingConnections.code === 'READY' ? (
              <>
                <RestoreSource scope={scope} allowed={[]} />
                <ReportingTimezoneInitialization
                  showPeriod={section !== 'Connections'}
                />
                <p className={styles.privacy}>
                  Only you can see these bank accounts and their activity.
                </p>
                {section === 'Connections' ? (
                  <>
                    <Enrollment scope={scope} onConnected={refresh} />
                    <section
                      id="existing-connections"
                      aria-labelledby="connections-heading"
                      className={styles.stack}
                    >
                      <h2 id="connections-heading">Your connections</h2>
                      {!data.bankingConnections.connections.length && (
                        <div className={styles.empty}>
                          <h3>No connected accounts yet</h3>
                          <p>
                            Connect an institution above, then explicitly choose
                            the accounts to include.
                          </p>
                        </div>
                      )}
                      <InventoryPage
                        scope={scope}
                        result={data.bankingConnections}
                      />
                    </section>
                  </>
                ) : (
                  <ActivityBoundary
                    section={section}
                    connected={
                      data.bankingConnections.connections.some(
                        (connection) => connection.accounts.length > 0,
                      ) || data.bankingConnections.hasNextPage
                    }
                  />
                )}
              </>
            ) : (
              <Denied onDenied={() => setDenied(true)} />
            )
          }
        </NetworkQuery>
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function Denied({ onDenied }: { onDenied: () => void }) {
  // Domain failures never become an empty private account list.
  useEffect(() => {
    onDenied();
  }, [onDenied]);
  return (
    <Status kind="error">
      Private banking is unavailable for this account. Check access before
      continuing.
    </Status>
  );
}
function ActivityBoundary({
  section,
  connected,
}: {
  section: PersonalSection;
  connected: boolean;
}) {
  const params = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', 'connections');
  return (
    <section
      className={styles.empty}
      aria-labelledby="personal-content-heading"
    >
      <p className={styles.eyebrow}>
        {params.get('period') === null ? 'This month' : 'Applied period'}
      </p>
      <h2 id="personal-content-heading">
        {section === 'Overview'
          ? 'Spending from your accounts'
          : 'Your private transactions'}
      </h2>
      {connected ? (
        <p>
          Your connected accounts and import status are available in
          Connections.{' '}
          {section === 'Overview'
            ? 'Spending summaries'
            : 'Transaction browsing'}{' '}
          will be available separately; no activity or zero total is inferred
          here.
        </p>
      ) : (
        <p>
          Set up your private accounts in Connections to begin importing
          history. Available history depends on your institution.
        </p>
      )}
      <Link className={styles.link} href={`/personal?${next}`}>
        Go to Connections
      </Link>
    </section>
  );
}
function InventoryPage({
  scope,
  result,
}: {
  scope: FinancialScope;
  result: personalInventoryQuery['response']['bankingConnections'];
}) {
  const [next, setNext] = useState(false),
    [retry, setRetry] = useState(0);
  return (
    <>
      {result.connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      {result.hasNextPage &&
        result.endCursor &&
        (next ? (
          <NetworkQuery<personalInventoryQuery>
            key={retry}
            document={document}
            scope={scope}
            variables={{ first: 20, after: result.endCursor }}
            fallback={
              <ContentLoading layout="cards" label="more connections" />
            }
            failure={
              <Status kind="error">
                More connections could not be loaded.{' '}
                <Button tone="text" onClick={() => setRetry((v) => v + 1)}>
                  Retry more connections
                </Button>
              </Status>
            }
          >
            {(data) =>
              data.bankingConnections.code === 'READY' ? (
                <InventoryPage scope={scope} result={data.bankingConnections} />
              ) : (
                <Status kind="error">
                  More connections are unavailable. Check current access.
                </Status>
              )
            }
          </NetworkQuery>
        ) : (
          <Button tone="secondary" onClick={() => setNext(true)}>
            Load more connections
          </Button>
        ))}
    </>
  );
}
function ConnectionCard({
  connection,
}: {
  connection: personalInventoryQuery['response']['bankingConnections']['connections'][number];
}) {
  return (
    <article className={styles.panel}>
      <h3>Bank connection</h3>
      <p>
        {connection.health === 'repair_required'
          ? 'Connection needs repair. Existing-account management is not available on this screen.'
          : 'Private connection'}{' '}
        · {connection.state.replaceAll('_', ' ')}
      </p>
      {[...connection.accounts]
        .sort((a, b) => Number(b.selected) - Number(a.selected))
        .map((account) => (
          <section
            className={styles.account}
            key={account.streamId}
            aria-label={account.name}
          >
            <div className={styles.accountHeading}>
              <div>
                <h4>{account.name}</h4>
                <p>
                  {account.kind.replaceAll('_', ' ')} · {account.currency}
                </p>
              </div>
              <strong>
                {account.selected ? 'Included' : 'Not collecting'}
              </strong>
            </div>
            <p>{importSummary(account.importStatus)}</p>
            <p>{coverageSummary(account.importStatus)}</p>
            <dl className={styles.facts}>
              <div>
                <dt>Last local import</dt>
                <dd>
                  {account.importStatus.lastLocalCommit
                    ? new Date(
                        account.importStatus.lastLocalCommit,
                      ).toLocaleString()
                    : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Bank success observation</dt>
                <dd>
                  {account.importStatus.providerSuccessAt
                    ? new Date(
                        account.importStatus.providerSuccessAt,
                      ).toLocaleString()
                    : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Initial history requested</dt>
                <dd>
                  {account.requestedHistoryDays} days, subject to institution
                  availability
                </dd>
              </div>
            </dl>
            <p className={styles.muted}>
              Local persistence does not prove the bank is up to date. Imported
              history remains private.
            </p>
            {account.importStatus.discrepancyCount !== '0' && (
              <p>
                Historical discrepancy reported. Retained history may need
                inspection in account management.
              </p>
            )}
          </section>
        ))}
      {!connection.accounts.length && (
        <p>
          No visible retained account history is available for this connection.
        </p>
      )}
      <details>
        <summary>About existing-account management</summary>
        <p>
          Repair, selection changes, disconnect, history deletion and
          replacement recovery are separate account-management actions. This
          screen does not change an existing account’s history or selection.
        </p>
      </details>
    </article>
  );
}
