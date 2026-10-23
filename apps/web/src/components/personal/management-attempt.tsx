'use client';
import { useEffect, useRef, useState } from 'react';
import type { FinancialScope } from '@/lib/relay/environment';
import managementDocument, {
  type managementOperationQuery,
} from '@/lib/relay/__generated__/managementOperationQuery.graphql';
import replacementDocument, {
  type managementReplacementOperationQuery,
} from '@/lib/relay/__generated__/managementReplacementOperationQuery.graphql';
import repairDocument, {
  type managementRepairQuery,
} from '@/lib/relay/__generated__/managementRepairQuery.graphql';
import { readFresh } from './relay-command';
import { Button, Status } from '../ui/primitives';
export type AttemptKind = 'management' | 'plan' | 'repair';
type AttemptOutcome =
  | string
  | {
      readonly code: string;
      readonly state?: string | null;
      readonly attemptId?: string | null;
    };
type AttemptSource = 'command' | 'repair-start' | 'repair-finish' | 'receipt';
function resolvedOutcome(
  kind: AttemptKind,
  outcome: AttemptOutcome,
  source: AttemptSource,
  attemptId?: string,
) {
  const code = typeof outcome === 'string' ? outcome : outcome.code;
  const state = typeof outcome === 'string' ? undefined : outcome.state;
  if (kind === 'repair') {
    // Immediate provider inventory errors leave the existing repair prepared.
    // Only its durable completion or an authoritative expired/fenced read resolves it.
    const matches =
      typeof outcome !== 'string' && outcome.attemptId === attemptId;
    if (state === 'complete') return matches;
    if (source === 'receipt')
      return matches && ['REPAIR_REQUIRED', 'CONFLICT'].includes(code);
    // The start endpoint returns these before inserting this fresh UUID. In
    // particular ATTEMPT_IN_PROGRESS belongs to a different, existing handoff.
    return (
      source === 'repair-start' &&
      !state &&
      !(typeof outcome !== 'string' && outcome.attemptId) &&
      [
        'ATTEMPT_IN_PROGRESS',
        'NOT_FOUND',
        'CONFLICT',
        'INVALID_INPUT',
        'REPAIR_UNAVAILABLE',
        'FEATURE_DISABLED',
      ].includes(code)
    );
  }
  // Selection completes its operation receipt even when provider validation
  // returns INVALID_SELECTION; that code is not terminal for a prepared repair.
  return (
    (kind === 'management' && code === 'INVALID_SELECTION') ||
    [
      'READY',
      'CONFLICT',
      'INVALID_INPUT',
      'REPAIR_REQUIRED',
      'REPLACEMENT_REQUIRED',
      'EXPIRED',
      'FORBIDDEN',
      'UNAUTHENTICATED',
      'FEATURE_DISABLED',
    ].includes(code)
  );
}
export function attemptKey(scope: FinancialScope, kind: AttemptKind) {
  return `kami-personal-enrollment:${scope.actor}:manage:${kind}`;
}
export function managementMessage(code: string) {
  if (code === 'READY')
    return 'The local change is confirmed. Provider removal and active-copy purge have separate status; pending removal is not complete.';
  if (code === 'ATTEMPT_IN_PROGRESS')
    return 'Another repair handoff is still active. This new attempt was not reserved. Wait for the existing handoff to finish or expire, then reload the connection before trying again.';
  if (code === 'INVALID_SELECTION')
    return 'The provider could not validate that account selection. Reload current connection state and review the available accounts; saved collection and private history are unchanged.';
  if (code === 'CONFLICT')
    return 'The connection or preview changed. Reload its current state, then review and confirm again.';
  if (code === 'REPAIR_REQUIRED')
    return 'Repair this connection before adding accounts. Your saved selection and private history remain unchanged.';
  if (code === 'REPLACEMENT_REQUIRED')
    return 'Repair could not establish account continuity. Choose Replace existing, Different account or Cancel explicitly.';
  if (code === 'INVALID_INPUT')
    return 'Check the real, nonfuture posted-bank date and account selection. A latest transition must follow the preceding boundary.';
  if (['FORBIDDEN', 'UNAUTHENTICATED', 'FEATURE_DISABLED'].includes(code))
    return 'Private banking is unavailable. Check current access.';
  if (code === 'IMPORT_UNAVAILABLE')
    return 'The staged import is not usable yet. Current reporting is unchanged; check again later or cancel staging.';
  if (code === 'NOT_FOUND')
    return 'No receipt is available yet. This does not prove failure. Check the original attempt again before making another change.';
  if (code === 'PREPARED')
    return 'Repair is prepared. Canceling the screen preserves local selection; provider permission changes may already have occurred. The prepared attempt must complete or expire before a new repair.';
  if (code === 'EXPIRED')
    return 'The repair session expired. Reload current connection state before starting again.';
  return 'The outcome is not confirmed. Check the original attempt before making another change. Private history is not deleted by a temporary error.';
}
/** Only opaque attempt IDs survive navigation; scope teardown clears this prefix. */
export function useManagementAttempt(
  scope: FinancialScope,
  onChanged: () => void,
) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = () => mounted.current && scope.isLive();
  const accept = (
    kind: AttemptKind,
    outcome: AttemptOutcome,
    {
      source = 'command',
      attemptId,
    }: { source?: AttemptSource; attemptId?: string } = {},
  ) => {
    if (!live()) return;
    const key = attemptKey(scope, kind);
    // A late receipt must never settle a newer operation in the actor's slot.
    if (attemptId && sessionStorage.getItem(key) !== attemptId) return;
    if (
      typeof outcome !== 'string' &&
      outcome.attemptId &&
      outcome.attemptId !== attemptId
    )
      return;
    const code = typeof outcome === 'string' ? outcome : outcome.code;
    const resolved = resolvedOutcome(kind, outcome, source, attemptId);
    setMessage(
      source === 'repair-start' &&
        code === 'NOT_FOUND' &&
        !(typeof outcome !== 'string' && outcome.state) &&
        resolved
        ? 'This connection is unavailable. This new repair was not reserved. Reload current connection state before trying again.'
        : managementMessage(code === 'READY' && !resolved ? 'PENDING' : code),
    );
    if (resolved) {
      sessionStorage.removeItem(key);
      window.dispatchEvent(new Event('kami-banking-attempt'));
      if (code === 'READY') onChanged();
    }
  };
  const run = async (
    kind: AttemptKind | null,
    work: (id: string) => Promise<AttemptOutcome>,
    source: AttemptSource = 'command',
  ) => {
    if (locked.current || !live()) return;
    locked.current = true;
    setBusy(true);
    try {
      const key = kind ? attemptKey(scope, kind) : null;
      if (key && sessionStorage.getItem(key)) {
        setMessage(
          'An earlier operation is unresolved. Check its original attempt before making another change.',
        );
        return;
      }
      const id = crypto.randomUUID();
      if (key) {
        sessionStorage.setItem(key, id);
        window.dispatchEvent(new Event('kami-banking-attempt'));
      }
      const outcome = await work(id);
      if (kind) accept(kind, outcome, { source, attemptId: id });
    } catch {
      if (live())
        setMessage(
          'The response was lost or unavailable. Check the original attempt; no successful outcome is assumed.',
        );
    } finally {
      locked.current = false;
      if (live()) setBusy(false);
    }
  };
  return { busy, message, setMessage, live, accept, run };
}
export function ManagementRecovery({
  scope,
  onChanged,
}: {
  scope: FinancialScope;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<AttemptKind[]>([]);
  const work = useManagementAttempt(scope, onChanged);
  useEffect(() => {
    const update = () => {
      try {
        setPending(
          (['management', 'plan', 'repair'] as const).filter((kind) =>
            sessionStorage.getItem(attemptKey(scope, kind)),
          ),
        );
      } catch {
        work.setMessage(
          'Private recovery storage is unavailable. Restore browser storage before changing connections.',
        );
      }
    };
    update();
    window.addEventListener('kami-banking-attempt', update);
    return () => window.removeEventListener('kami-banking-attempt', update);
    // A financial scope owns this recovery visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  return (
    <>
      {pending.length > 0 && (
        <p>
          An earlier connection change has an unresolved outcome. Check its
          original attempt before making another change.
        </p>
      )}
      {work.message && <Status kind="info">{work.message}</Status>}
      {pending.map((kind) => (
        <Button
          key={kind}
          tone="secondary"
          disabled={work.busy}
          onClick={() =>
            void work.run(null, async () => {
              const attemptId = sessionStorage.getItem(attemptKey(scope, kind));
              if (!attemptId) return '';
              const outcome =
                kind === 'management'
                  ? (
                      await readFresh<managementOperationQuery>(
                        scope,
                        managementDocument,
                        { attemptId },
                      )
                    ).bankingOperation
                  : kind === 'plan'
                    ? (
                        await readFresh<managementReplacementOperationQuery>(
                          scope,
                          replacementDocument,
                          { attemptId },
                        )
                      ).bankingReplacementOperation
                    : (
                        await readFresh<managementRepairQuery>(
                          scope,
                          repairDocument,
                          { attemptId },
                        )
                      ).bankingRepair;
              work.accept(kind, outcome, { source: 'receipt', attemptId });
              return outcome;
            })
          }
        >
          Check {kind === 'plan' ? 'transition / recovery' : kind} outcome
        </Button>
      ))}
    </>
  );
}
