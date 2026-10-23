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
export function attemptKey(scope: FinancialScope, kind: AttemptKind) {
  return `kami-personal-enrollment:${scope.actor}:manage:${kind}`;
}
export function managementMessage(code: string) {
  if (code === 'READY')
    return 'The local change is confirmed. Provider removal and active-copy purge have separate status; pending removal is not complete.';
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
  const accept = (kind: AttemptKind, code: string) => {
    if (!live()) return;
    setMessage(managementMessage(code));
    // Missing/unknown status never unlocks a new command. Known rejects have no effect.
    if (
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
    ) {
      sessionStorage.removeItem(attemptKey(scope, kind));
      window.dispatchEvent(new Event('kami-banking-attempt'));
      if (code === 'READY') onChanged();
    }
  };
  const run = async (
    kind: AttemptKind | null,
    work: (id: string) => Promise<string>,
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
      const code = await work(id);
      if (kind) accept(kind, code);
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
              const code =
                kind === 'management'
                  ? (
                      await readFresh<managementOperationQuery>(
                        scope,
                        managementDocument,
                        { attemptId },
                      )
                    ).bankingOperation.code
                  : kind === 'plan'
                    ? (
                        await readFresh<managementReplacementOperationQuery>(
                          scope,
                          replacementDocument,
                          { attemptId },
                        )
                      ).bankingReplacementOperation.code
                    : (
                        await readFresh<managementRepairQuery>(
                          scope,
                          repairDocument,
                          { attemptId },
                        )
                      ).bankingRepair.code;
              work.accept(kind, code);
              return code;
            })
          }
        >
          Check {kind === 'plan' ? 'transition / recovery' : kind} outcome
        </Button>
      ))}
    </>
  );
}
