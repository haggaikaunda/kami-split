'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { FinancialScope } from '@/lib/relay/environment';
import { NetworkQuery } from '@/lib/relay/query';
import connectionDocument, {
  type managementConnectionQuery,
} from '@/lib/relay/__generated__/managementConnectionQuery.graphql';
import selectionDocument, {
  type managementSelectionMutation,
} from '@/lib/relay/__generated__/managementSelectionMutation.graphql';
import disconnectDocument, {
  type managementDisconnectMutation,
} from '@/lib/relay/__generated__/managementDisconnectMutation.graphql';
import deleteDocument, {
  type managementDeleteMutation,
} from '@/lib/relay/__generated__/managementDeleteMutation.graphql';
import repairStartDocument, {
  type managementRepairStartMutation,
} from '@/lib/relay/__generated__/managementRepairStartMutation.graphql';
import repairFinishDocument, {
  type managementRepairFinishMutation,
} from '@/lib/relay/__generated__/managementRepairFinishMutation.graphql';
import { Button, Dialog, Status } from '../ui/primitives';
import { acquireBodyScrollLock } from '../ui/scroll-lock';
import { ContentLoading } from '../ui/loading';
import { command } from './relay-command';
import {
  eligibleLinkAccount,
  loadPlaid,
  type LinkAccount,
  type LinkHandler,
} from './plaid-link';
import { ManagementRecovery, useManagementAttempt } from './management-attempt';
import { Replacement } from './replacement';
import styles from './personal.module.css';
type Connection = NonNullable<
  managementConnectionQuery['response']['bankingConnection']['connection']
>;
export function Management({
  scope,
  connectionId,
  needsRepair,
  onChanged,
}: {
  scope: FinancialScope;
  connectionId: string;
  needsRepair: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [version, setVersion] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        tone={needsRepair ? 'primary' : 'text'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {needsRepair ? 'Repair / manage accounts' : 'Manage accounts'}
      </Button>
      {open && (
        <ManagementDialog
          key={version}
          scope={scope}
          connectionId={connectionId}
          trigger={trigger}
          close={() => setOpen(false)}
          reload={() => setVersion((v) => v + 1)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
function ManagementDialog({
  scope,
  connectionId,
  trigger,
  close,
  reload,
  onChanged,
}: {
  scope: FinancialScope;
  connectionId: string;
  trigger: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
  reload: () => void;
  onChanged: () => void;
}) {
  const [providerOpen, setProviderOpen] = useState(false);
  useEffect(() => {
    if (!providerOpen) return acquireBodyScrollLock(document.body);
  }, [providerOpen]);
  return (
    <div className={styles.dialogHost}>
      <Dialog
        open={!providerOpen}
        panel
        title="Manage connection"
        returnFocusRef={trigger}
        onClose={close}
      >
        <div className={styles.setupContent}>
          <NetworkQuery<managementConnectionQuery>
            scope={scope}
            document={connectionDocument}
            variables={{ connectionId }}
            fallback={<ContentLoading label="connection" layout="cards" />}
            failure={
              <Status kind="error">
                Connection unavailable.{' '}
                <Button onClick={reload}>Retry connection</Button>
              </Status>
            }
          >
            {(data) =>
              data.bankingConnection.code === 'READY' &&
              data.bankingConnection.connection ? (
                <ConnectionManagement
                  key={data.bankingConnection.connection.generation}
                  scope={scope}
                  connection={data.bankingConnection.connection}
                  close={close}
                  reload={reload}
                  onChanged={onChanged}
                  setProviderOpen={setProviderOpen}
                />
              ) : (
                <Status kind="error">
                  Private connection unavailable. Check current access.
                </Status>
              )
            }
          </NetworkQuery>
        </div>
      </Dialog>
    </div>
  );
}
function ConnectionManagement({
  scope,
  connection,
  close,
  reload,
  onChanged,
  setProviderOpen,
}: {
  scope: FinancialScope;
  connection: Connection;
  close: () => void;
  reload: () => void;
  onChanged: () => void;
  setProviderOpen: (open: boolean) => void;
}) {
  // The fresh read is an explicit edit baseline; background records cannot advance its generation.
  const [selected, setSelected] = useState(() =>
    connection.accounts
      .filter((a) => a.selected)
      .map((a) => a.providerAccountId),
  );
  const [confirm, setConfirm] = useState<'disconnect' | 'delete'>();
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirm) confirmationHeading.current?.focus();
  }, [confirm]);
  const [confirmed, setConfirmed] = useState(false);
  const [repairChoices, setRepairChoices] = useState<LinkAccount[]>();
  const [repairId, setRepairId] = useState<string>();
  const [replacement, setReplacement] = useState<string>();
  const [lastAccount, setLastAccount] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const replacementTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!replacement) replacementTrigger.current?.focus();
  }, [replacement]);
  const handler = useRef<LinkHandler | undefined>(undefined),
    callback = useRef(false);
  const work = useManagementAttempt(scope, () => setConfirmed(true));
  useEffect(
    () => () => {
      callback.current = true;
      handler.current?.destroy();
    },
    [],
  );
  const accountNames = [
    ...new Set(connection.accounts.map((a) => a.name)),
  ].join(', ');
  const canCollect = connection.state === 'active';
  const choices = [
    ...(repairChoices ??
      connection.accounts
        .filter((a) =>
          ['CURRENT', 'STAGED'].includes(a.importStatus.reportingState),
        )
        .map((a) => ({
          id: a.providerAccountId,
          name: a.name,
          subtype: a.kind,
        }))),
  ].sort(
    (a, b) =>
      Number(
        connection.accounts.some(
          (saved) => saved.providerAccountId === b.id && saved.selected,
        ),
      ) -
      Number(
        connection.accounts.some(
          (saved) => saved.providerAccountId === a.id && saved.selected,
        ),
      ),
  );
  const changed =
    [...selected].sort().join() !==
    connection.accounts
      .filter((a) => a.selected)
      .map((a) => a.providerAccountId)
      .sort()
      .join();
  const repair = () =>
    work.run('repair', async (attemptId) => {
      setRepairId(attemptId);
      callback.current = false;
      const result = (
        await command<managementRepairStartMutation>(
          scope,
          repairStartDocument,
          {
            input: {
              attemptId,
              connectionId: connection.id,
              expectedGeneration: connection.generation,
            },
          },
        )
      ).startBankingRepair;
      if (!work.live()) return result.code;
      if (
        result.code !== 'PREPARED' ||
        !result.linkToken ||
        !result.expiresAt ||
        Date.parse(result.expiresAt) <= Date.now() ||
        !Number.isFinite(Date.parse(result.expiresAt))
      )
        return result.code;
      const sdk = await loadPlaid();
      if (!work.live()) return 'PENDING';
      handler.current = sdk.create({
        token: result.linkToken,
        onSuccess: (_token, metadata) => {
          if (!work.live() || callback.current) return;
          callback.current = true;
          setProviderOpen(false);
          const eligible = metadata.accounts.filter(eligibleLinkAccount);
          setRepairChoices(eligible);
          // Preserve only previously selected IDs present in the authorized handoff. New accounts start unchecked.
          setSelected((current) =>
            current.filter((id) => eligible.some((a) => a.id === id)),
          );
          work.setMessage(
            'Review exactly which accounts to include, then Apply repair. Link success alone is not renewed consent or a saved selection.',
          );
        },
        onExit: (error) => {
          if (!work.live() || callback.current) return;
          callback.current = true;
          setProviderOpen(false);
          work.setMessage(
            error
              ? 'Repair was interrupted or expired. Saved local selection and history remain; check the original repair outcome.'
              : 'Repair canceled. Saved local selection and history remain. Provider permissions may have changed; check the repair outcome before starting again.',
          );
        },
      });
      flushSync(() => setProviderOpen(true));
      handler.current.open();
      return 'PREPARED';
    });
  if (confirmed)
    return (
      <>
        <Status kind="info">
          The local change is confirmed. Provider removal and active-copy purge
          have separate status; pending removal is not complete. Reload to view
          current selection and cleanup.
        </Status>
        <Button
          onClick={() => {
            onChanged();
            reload();
          }}
        >
          Reload current state
        </Button>
        <Button tone="text" onClick={close}>
          Close management
        </Button>
      </>
    );
  if (replacement)
    return (
      <Replacement
        scope={scope}
        connection={connection}
        accountId={replacement}
        onBack={() => setReplacement(undefined)}
        onDifferent={close}
        onChanged={onChanged}
        setProviderOpen={setProviderOpen}
      />
    );
  return (
    <>
      <p>
        <strong>Institution:</strong>{' '}
        {connection.institutionName ??
          'Name unavailable for this retained connection'}
        .
      </p>
      <p>
        {connection.permission === 'revoked'
          ? 'Provider permission revoked'
          : connection.health.replaceAll('_', ' ')}{' '}
        · {connection.state.replaceAll('_', ' ')}.{' '}
        {canCollect
          ? 'Only selected accounts collect updates.'
          : 'Updates stopped; imported private history remains.'}
      </p>
      {(connection.cleanup !== 'not_requested' ||
        connection.purge !== 'not_requested' ||
        !canCollect) && (
        <p>
          Provider removal: {connection.cleanup.replaceAll('_', ' ')}.
          Active-copy purge: {connection.purge.replaceAll('_', ' ')}. These do
          not attest provider retention or backup erasure.
        </p>
      )}
      {work.message && <Status kind="info">{work.message}</Status>}
      <ManagementRecovery
        scope={scope}
        onChanged={() => {
          onChanged();
          reload();
        }}
      />
      {work.busy && <Status kind="pending">Checking the connection…</Status>}
      <fieldset disabled={work.busy || !canCollect}>
        <legend>Selected accounts</legend>
        <p>
          Only checked accounts collect updates. Deselecting keeps private
          history; additions require provider authorization.
        </p>
        {choices.map((a) => (
          <label className={styles.choice} key={a.id}>
            <input
              type="checkbox"
              checked={selected.includes(a.id)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, a.id]
                    : current.filter((id) => id !== a.id),
                )
              }
            />
            <span>
              {a.name}
              <small>{a.subtype}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <Button
          disabled={work.busy || !canCollect || (!repairChoices && !changed)}
          onClick={() =>
            void (repairChoices && repairId
              ? work.run(null, async () => {
                  const code = (
                    await command<managementRepairFinishMutation>(
                      scope,
                      repairFinishDocument,
                      {
                        input: {
                          attemptId: repairId,
                          accountIds: [...selected],
                        },
                      },
                    )
                  ).finishBankingRepair.code;
                  work.accept('repair', code);
                  setRepairChoices(undefined);
                  return code;
                })
              : work.run(
                  'management',
                  async (attemptId) =>
                    (
                      await command<managementSelectionMutation>(
                        scope,
                        selectionDocument,
                        {
                          input: {
                            attemptId,
                            connectionId: connection.id,
                            expectedGeneration: connection.generation,
                            accountIds: [...selected],
                          },
                        },
                      )
                    ).changeBankingSelection.code,
                ))
          }
        >
          {repairChoices ? 'Apply repair' : 'Apply selection'}
        </Button>
        {canCollect && (
          <Button
            tone={connection.health === 'healthy' ? 'secondary' : 'primary'}
            disabled={work.busy || Boolean(repairId)}
            onClick={() => void repair()}
          >
            {connection.health === 'healthy'
              ? 'Authorize account additions'
              : 'Reconnect with Plaid'}
          </Button>
        )}
        <Button tone="text" disabled={work.busy} onClick={close}>
          Cancel
        </Button>
        {work.message && (
          <Button
            tone="secondary"
            disabled={work.busy}
            onClick={() => {
              onChanged();
              reload();
            }}
          >
            Reload current state
          </Button>
        )}
      </div>
      <details
        className={styles.historyControls}
        open={historyOpen}
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>Disconnect &amp; history</summary>
        <h3>History and recovery</h3>
        {[...new Map(connection.accounts.map((a) => [a.id, a])).values()].map(
          (a) => (
            <div key={a.id} className={styles.account}>
              <p>{a.name}</p>
              {a.importStatus.discrepancyCount !== '0' && (
                <Status kind="info">
                  Historical discrepancy: {a.importStatus.discrepancyCount}.
                  Retained facts are preserved; changed dates may cause gaps or
                  differently identified duplicates.
                </Status>
              )}
              <Button
                ref={lastAccount === a.id ? replacementTrigger : undefined}
                tone="secondary"
                disabled={work.busy}
                onClick={() => {
                  setLastAccount(a.id);
                  setHistoryOpen(true);
                  setReplacement(a.id);
                }}
              >
                Replacement and recovery — {a.name}
              </Button>
            </div>
          ),
        )}
        <h3>Stop updates or erase history</h3>
        <p>
          Disconnect removes this provider connection and stops its updates
          while keeping imported private history. Delete connection and history
          also erases affected current, staged and archived private records and
          annotations across replacement bindings; siblings outside this
          connection’s affected logical accounts and shared expenses remain
          unchanged.
        </p>
        <div className={styles.actions}>
          <Button
            tone="secondary"
            disabled={work.busy || !canCollect}
            onClick={() => setConfirm('disconnect')}
          >
            Disconnect
          </Button>
          <Button
            tone="text"
            disabled={work.busy || connection.state === 'deleted'}
            onClick={() => setConfirm('delete')}
          >
            Delete connection and history
          </Button>
        </div>
        {confirm && (
          <section
            className={styles.notice}
            aria-label="Confirm connection change"
          >
            <h3 ref={confirmationHeading} tabIndex={-1}>
              {confirm === 'delete'
                ? 'Delete connection and private history?'
                : 'Disconnect this connection?'}
            </h3>
            <p>
              {connection.institutionName ?? 'Institution name unavailable'}:{' '}
              {accountNames}.{' '}
              {confirm === 'delete'
                ? 'Stop updates and irreversibly delete affected current, staged and archived private history and annotations across bindings. Shared expenses and other logical accounts are protected. Deleted data cannot be restored by recovery.'
                : 'Stop updates and request provider removal. Previously imported private history remains; provider removal may remain pending.'}
            </p>
            <div className={styles.actions}>
              <Button
                tone="secondary"
                disabled={work.busy}
                onClick={() => setConfirm(undefined)}
              >
                Keep connection
              </Button>
              <Button
                disabled={work.busy}
                onClick={() =>
                  void work.run('management', async (attemptId) => {
                    const input = {
                      attemptId,
                      connectionId: connection.id,
                      expectedGeneration: connection.generation,
                    };
                    return confirm === 'delete'
                      ? (
                          await command<managementDeleteMutation>(
                            scope,
                            deleteDocument,
                            { input },
                          )
                        ).deleteBankingHistory.code
                      : (
                          await command<managementDisconnectMutation>(
                            scope,
                            disconnectDocument,
                            { input },
                          )
                        ).disconnectBanking.code;
                  })
                }
              >
                {confirm === 'delete'
                  ? 'Confirm deletion'
                  : 'Confirm disconnect'}
              </Button>
            </div>
          </section>
        )}
      </details>
    </>
  );
}
