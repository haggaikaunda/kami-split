'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Status } from '../ui/primitives';
import { flushSync } from 'react-dom';
import { acquireBodyScrollLock } from '../ui/scroll-lock';
import type { FinancialScope } from '@/lib/relay/environment';
import startDocument, {
  type enrollmentStartMutation,
} from '@/lib/relay/__generated__/enrollmentStartMutation.graphql';
import finishDocument, {
  type enrollmentFinishMutation,
} from '@/lib/relay/__generated__/enrollmentFinishMutation.graphql';
import cancelDocument, {
  type enrollmentCancelMutation,
} from '@/lib/relay/__generated__/enrollmentCancelMutation.graphql';
import recoveryDocument, {
  type enrollmentRecoveryQuery,
} from '@/lib/relay/__generated__/enrollmentRecoveryQuery.graphql';
import { command, readFresh } from './relay-command';
import {
  eligibleLinkAccount,
  loadPlaid,
  type LinkAccount,
  type LinkHandler,
} from './plaid-link';
import styles from './personal.module.css';

type Result = {
  code: string;
  state?: string | null;
  attemptId?: string | null;
  connectionId?: string | null;
};
type Handoff = { publicToken: string; accounts: LinkAccount[] };
const completed = new Set(['AWAITING_INITIAL_IMPORT']);
const ended = new Set(['RETRY_ALLOWED']);
export function enrollmentMessage(result: Result) {
  if (result.code === 'FEATURE_DISABLED')
    return 'New bank connections are not enabled for this account. Existing imported history is unchanged.';
  if (result.code === 'NOT_FOUND')
    return 'No saved outcome is available yet. Continue the original secure setup with the same attempt, or check again; a missing receipt does not prove an in-flight request failed.';
  if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(result.code))
    return 'This connection attempt is unavailable. Check current account access.';
  if (result.code === 'INVALID_INPUT' || result.code === 'INVALID_SELECTION')
    return 'The account selection could not be accepted. Check the attempt and cancel it before trying again.';
  if (result.code === 'NEEDS_ATTENTION')
    return 'This connection needs support attention. A new attempt is blocked until the existing attempt is resolved.';
  if (completed.has(result.code))
    return 'Accounts connected. Initial history is awaiting import; activity and coverage are not confirmed yet.';
  if (result.code === 'PREPARED')
    return 'Connection is prepared. Continue with Plaid or cancel this attempt.';
  if (result.code === 'EXPIRED')
    return 'The connection session expired. Cancel this attempt before starting again.';
  if (result.code === 'CANCELLED')
    return 'Connection canceled. Previously imported history is unchanged.';
  if (
    result.code === 'REPLACEMENT_REQUIRED' ||
    result.code === 'DUPLICATE_ACCOUNT'
  )
    return 'This may be an existing account. Review your existing accounts before connecting again; reporting history has not been replaced.';
  if (result.code === 'CLEANUP_PENDING')
    return 'Connection canceled locally. Provider cleanup is still pending.';
  if (result.code === 'RETRY_ALLOWED')
    return 'The prior attempt has been cleaned up. You can start a new connection.';
  return 'The connection outcome is not confirmed. Check this attempt before starting another connection.';
}

/** One user-owned handoff and durable attempt. Duplicate SDK callbacks never exchange twice. */
export function Enrollment({
  scope,
  onConnected,
}: {
  scope: FinancialScope;
  onConnected: () => void;
}) {
  const [attempt, setAttempt] = useState<string>();
  const [handoff, setHandoff] = useState<Handoff>();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState(false);
  const [setup, setSetup] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const active = useRef(true),
    lock = useRef(false),
    callback = useRef(false);
  const handler = useRef<LinkHandler | undefined>(undefined);
  const setupTrigger = useRef<HTMLButtonElement>(null);
  const presentationIntent = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const openSetup = () => {
    presentationIntent.current = true;
    setSetup(true);
  };
  const closeSetup = () => {
    presentationIntent.current = false;
    setSetup(false);
  };
  useEffect(() => {
    if (setup) return acquireBodyScrollLock(document.body);
  }, [setup]);
  const key = `kami-personal-enrollment:${scope.actor}`;
  const live = () => active.current && scope.isLive();
  const forget = () => {
    sessionStorage.removeItem(key);
    setAttempt(undefined);
    setHandoff(undefined);
    setSelected([]);
  };
  const accept = (result: Result) => {
    if (!live()) return;
    setMessage(enrollmentMessage(result));
    setPrepared(result.code === 'PREPARED' || result.code === 'NOT_FOUND');
    setHandoff(undefined);
    if (completed.has(result.code)) {
      forget();
      onConnected();
    }
    // Only a durable terminal outcome permits a separate attempt. Cleanup pending remains recoverable.
    else if (ended.has(result.code)) {
      forget();
      closeSetup();
    } else if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(result.code)) {
      forget();
      setChecking(true);
    }
  };
  const recover = async (id: string) => {
    const result = await readFresh<enrollmentRecoveryQuery>(
      scope,
      recoveryDocument,
      { attemptId: id },
    );
    accept(result.bankingEnrollment);
  };
  const action = async (work: () => Promise<void>) => {
    if (lock.current || !live()) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      if (live()) {
        callback.current = true;
        handler.current?.destroy();
        handler.current = undefined;
        setLinkOpen(false);
        if (presentationIntent.current) setSetup(true);
        setHandoff(undefined);
        setMessage(
          'The outcome could not be confirmed. Check the same connection attempt before trying again.',
        );
      }
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  };
  // Admission from client-only recovery storage happens after hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    active.current = true;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        openSetup();
        setAttempt(stored);
        void action(() => recover(stored)).finally(() => {
          if (live()) setChecking(false);
        });
      } else setChecking(false);
    } catch {
      openSetup();
      setMessage(
        'Private recovery storage is unavailable. Restore browser storage before connecting.',
      );
    }
    return () => {
      active.current = false;
      handler.current?.destroy();
      handler.current = undefined;
    };
    // The owner keys this component by the current financial scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const start = async (resume?: string) => {
    const id = resume ?? crypto.randomUUID();
    // Persist only the opaque ID before any server effect. No provider token or account details are stored.
    sessionStorage.setItem(key, id);
    setAttempt(id);
    callback.current = false;
    const result = await command<enrollmentStartMutation>(
      scope,
      startDocument,
      { input: { attemptId: id, intent: 'DIFFERENT' } },
    );
    if (!live()) return;
    const value = result.startBankingEnrollment;
    if (
      ['FEATURE_DISABLED', 'INVALID_INPUT', 'NEEDS_ATTENTION'].includes(
        value.code,
      ) &&
      !value.attemptId
    ) {
      forget();
      setMessage(enrollmentMessage(value));
      return;
    }
    if (
      value.code !== 'PREPARED' ||
      !value.linkToken ||
      !value.expiresAt ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      accept(value);
      if (value.code === 'PREPARED') {
        setPrepared(false);
        setMessage(
          'The secure session is unavailable or expired. Cancel this attempt before starting again.',
        );
      }
      return;
    }
    if (!presentationIntent.current) {
      setPrepared(true);
      setMessage(enrollmentMessage(value));
      return;
    }
    const sdk = await loadPlaid();
    if (!live()) return;
    if (!presentationIntent.current) {
      setPrepared(true);
      setMessage(enrollmentMessage(value));
      return;
    }
    handler.current?.destroy();
    setPrepared(false);
    handler.current = sdk.create({
      token: value.linkToken,
      onSuccess: (publicToken, metadata) => {
        if (!live() || callback.current) return;
        callback.current = true;
        setLinkOpen(false);
        openSetup();
        if (!publicToken) {
          setMessage(
            'Plaid did not return a usable connection. Cancel this attempt and start again.',
          );
          return;
        }
        const accounts = metadata.accounts.filter(eligibleLinkAccount);
        setHandoff({ publicToken, accounts });
        setSelected([]);
        setMessage(
          accounts.length
            ? 'Choose exactly which accounts to include. Nothing is selected yet.'
            : 'No supported checking, savings or credit-card accounts were returned. Cancel this attempt to try another institution.',
        );
      },
      onExit: (error) => {
        if (!live() || callback.current) return;
        callback.current = true;
        setLinkOpen(false);
        openSetup();
        setMessage(
          error?.error_code === 'INVALID_LINK_TOKEN'
            ? 'Plaid session expired. Cancel this attempt before starting again.'
            : error
              ? 'Plaid could not complete the connection. Cancel this attempt or check its status.'
              : 'Plaid closed without enrollment. Cancel this attempt before starting again.',
        );
      },
    });
    // Plaid mounts its iframe outside this component. Release the native top
    // layer and scroll lock before handing focus to the provider's own modal.
    flushSync(() => {
      setSetup(false);
      setLinkOpen(true);
    });
    handler.current.open();
    setMessage(
      'Complete the secure Plaid connection, then choose the accounts to include.',
    );
  };
  const finish = async () => {
    if (!attempt || !handoff || !selected.length) return;
    const input = {
      attemptId: attempt,
      publicToken: handoff.publicToken,
      accountIds: [...selected],
    };
    // The public token is one-use. A lost response moves to status recovery, never another exchange.
    setHandoff(undefined);
    accept(
      (
        await command<enrollmentFinishMutation>(scope, finishDocument, {
          input,
        })
      ).finishBankingEnrollment,
    );
  };
  const expanded = setup;
  return (
    <>
      <div className={styles.connectionsToolbar}>
        <h2 id="connections-heading">Your connections</h2>
        {(!checking || Boolean(attempt)) && (
          <Button
            ref={setupTrigger}
            tone="secondary"
            disabled={linkOpen}
            aria-haspopup="dialog"
            aria-expanded={expanded}
            aria-controls="connection-setup"
            onClick={openSetup}
          >
            {attempt ? 'Resume connection' : 'Connect account'}
          </Button>
        )}
      </div>
      {expanded && (
        <div className={styles.dialogHost}>
          <Dialog
            open
            panel
            title="Connect your accounts"
            returnFocusRef={setupTrigger}
            onClose={closeSetup}
          >
            <div id="connection-setup" className={styles.setupContent}>
              <p>
                US checking, savings and credit-card accounts, with USD
                activity. We request 365 days of history; actual availability
                depends on your institution. This is not a retention deadline.
              </p>
              <p>
                Your authorized account activity stays private, including full
                joint-account activity. Connecting never creates shared expenses
                or moves money.
              </p>
              {message && <Status kind="info">{message}</Status>}
              {busy && (
                <Status kind="pending">Checking your connection…</Status>
              )}
              {handoff && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(finish);
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>Accounts to include</legend>
                    <p>
                      Only the accounts you check will be requested. The server
                      verifies account eligibility and USD support.
                    </p>
                    {handoff.accounts.map((account) => (
                      <label key={account.id} className={styles.choice}>
                        <input
                          type="checkbox"
                          checked={selected.includes(account.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, account.id]
                                : current.filter((id) => id !== account.id),
                            )
                          }
                        />
                        <span>
                          {account.name}
                          {account.mask ? ` · ending ${account.mask}` : ''}
                          <small>{account.subtype}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <Button type="submit" disabled={busy || !selected.length}>
                    Include selected accounts
                  </Button>
                </form>
              )}
              <div className={styles.actions}>
                {!attempt && !checking && (
                  <Button disabled={busy} onClick={() => void action(start)}>
                    Continue with Plaid
                  </Button>
                )}
                {!attempt && !checking && (
                  <Button
                    tone="secondary"
                    onClick={() => setExisting((value) => !value)}
                  >
                    Replace existing account
                  </Button>
                )}
                {!attempt && !checking && (
                  <Button
                    tone="text"
                    disabled={busy}
                    onClick={() => {
                      closeSetup();
                      setExisting(false);
                      setMessage('');
                    }}
                  >
                    Cancel setup
                  </Button>
                )}
                {attempt && (
                  <>
                    {prepared && !handoff && (
                      <Button
                        disabled={busy}
                        onClick={() => void action(() => start(attempt))}
                      >
                        Continue secure connection
                      </Button>
                    )}
                    <Button
                      tone="secondary"
                      disabled={busy}
                      onClick={() => void action(() => recover(attempt))}
                    >
                      Check connection status
                    </Button>
                    <Button
                      tone="text"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          callback.current = true;
                          handler.current?.destroy();
                          handler.current = undefined;
                          setHandoff(undefined);
                          accept(
                            (
                              await command<enrollmentCancelMutation>(
                                scope,
                                cancelDocument,
                                { attemptId: attempt },
                              )
                            ).cancelBankingEnrollment,
                          );
                        })
                      }
                    >
                      Cancel connection
                    </Button>
                  </>
                )}
              </div>
              {existing && (
                <div className={styles.notice}>
                  <h3>Existing account management</h3>
                  <p>
                    Prefer repairing your existing connection. Replacement needs
                    a confirmed transition date and preview that preserves prior
                    history. Those management actions are not available on this
                    initial-connection screen.
                  </p>
                  <a href="#existing-connections" onClick={closeSetup}>
                    Review existing accounts
                  </a>
                  <Button tone="text" onClick={() => setExisting(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </Dialog>
        </div>
      )}
    </>
  );
}
