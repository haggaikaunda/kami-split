'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Status } from '@/components/primitives';
import type { FinancialScope } from '@/lib/relay/environment';
import { useOnboarding } from './controller';
import { InvitationPanel } from './invitations';
import { ActionRecovery } from './recovery';
import './onboarding.css';
/** Mounted only from an authorized owner's Members workspace. Requests and
 * pending operations retain their original scope through route transitions. */
export function ScopedInvitations({
  scope,
  group,
}: {
  scope: FinancialScope;
  group: { id: string; name: string };
}) {
  return (
    <InvitationVisit
      key={`${scope.id}:${group.id}`}
      scope={scope}
      group={group}
    />
  );
}
function InvitationVisit({
  scope,
  group,
}: {
  scope: FinancialScope;
  group: { id: string; name: string };
}) {
  const c = useOnboarding('invitations');
  const started = useRef(false);
  useEffect(() => {
    if (c.loading || !c.session || started.current) return;
    started.current = true;
    c.setGroup(group.id);
    void c.run(() => c.loadInvites(group.id));
  }, [c, group.id]);
  if (!scope.isLive() || (c.session && c.session.user.id !== scope.actor))
    return null;
  const otherAttempt = c.attempt && c.attempt.groupID !== group.id;
  return (
    <section
      id="invitations"
      className="scoped-invitations"
      aria-labelledby="invitations-heading"
    >
      <h2 id="invitations-heading">Invitations for {group.name}</h2>
      {c.loading ? (
        <Status kind="pending">Loading secure invitation access…</Status>
      ) : !c.session ? (
        <p>Sign in again to manage invitations.</p>
      ) : (
        <>
          {(c.notice || c.busy) && (
            <Status kind={c.failed ? 'error' : c.busy ? 'pending' : 'info'}>
              {c.busy ? 'Working…' : c.notice}
            </Status>
          )}
          {otherAttempt ? (
            <p>
              An unfinished invitation action belongs to another workspace.{' '}
              <Link
                href={`/invitations?group=${encodeURIComponent(c.attempt!.groupID ?? '')}`}
              >
                Return to its original workspace to recover it
              </Link>
              .
            </p>
          ) : (
            <ActionRecovery state={c} />
          )}
          <InvitationPanel state={c} />
        </>
      )}
    </section>
  );
}
