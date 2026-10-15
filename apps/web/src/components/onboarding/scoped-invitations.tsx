'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Status } from '../ui/primitives';
import type { FinancialScope } from '@/lib/relay/environment';
import { useOnboarding } from './controller';
import { InvitationPanel } from './invitations';
import { ActionRecovery } from './recovery';
import { PeopleList, type Person } from './people-list';
import invitationStyles from './invitations.module.css';

/** Mounted only from an authorized owner's Members workspace. Requests and
 * pending operations retain their original scope through route transitions. */
export function ScopedInvitations({
  scope,
  group,
  members,
}: {
  scope: FinancialScope;
  group: { id: string; name: string };
  members: readonly Person[];
  onRefresh?: () => void | Promise<void>;
}) {
  return (
    <InvitationVisit
      key={`${scope.id}:${group.id}`}
      scope={scope}
      group={group}
      members={members}
    />
  );
}
function InvitationVisit({
  scope,
  group,
  members,
}: {
  scope: FinancialScope;
  group: { id: string; name: string };
  members: readonly Person[];
  onRefresh?: () => void | Promise<void>;
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
      data-ui="scoped-invitations form-region"
      className={invitationStyles['scoped-invitations']}
      aria-label={`People and invitations for ${group.name}`}
    >
      {(c.loading || !c.session) && <PeopleList members={members} />}
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
          <InvitationPanel state={c} members={members} />
        </>
      )}
    </section>
  );
}
