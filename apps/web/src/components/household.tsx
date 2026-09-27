'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAppData } from './data-provider';
import { useHouseholdCommands } from './household-controller';
import { useRouteReady } from './navigation/provider';
import {
  Button,
  Confirmation,
  Field,
  SelectField,
  Skeleton,
  Status,
} from './primitives';
import { DemoPanel } from './demo-controls';
import type { Member, Snapshot } from '../lib/data/port';
import './household.css';
function Members({ snapshot }: { snapshot: Snapshot }) {
  const { status } = useAppData();
  const { state, submit } = useHouseholdCommands();
  const [name, setName] = useState(snapshot.household.name);
  const [invite, setInvite] = useState('');
  const [remove, setRemove] = useState<Member | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const actor = snapshot.members.find((row) => row.id === snapshot.actorId)!;
  const owner = actor.role === 'owner';
  const locked =
    status !== 'ready' ||
    state.phase === 'pending' ||
    state.phase === 'unknown';
  useEffect(() => {
    if (state.phase === 'done' || state.phase === 'failed')
      heading.current?.focus({ preventScroll: true });
  }, [state.phase]);
  return (
    <>
      <h1 ref={heading} data-page-heading tabIndex={-1}>
        {snapshot.household.name}
      </h1>
      <p>
        Signed in as {actor.name} · {actor.role}
      </p>
      <Status kind="info">
        Household preview. Invitations, role changes and removals affect only
        this session. No email is sent.
      </Status>
      {owner ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit({ kind: 'update-household', name });
          }}
        >
          <Field
            label="Household name"
            value={name}
            disabled={locked}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <SelectField label="Default currency" value="USD" disabled>
            <option value="USD">USD — US dollar</option>
          </SelectField>
          <p>Only USD is enabled. Existing expense currencies are retained.</p>
          <Button type="submit" disabled={locked}>
            Save household name
          </Button>
        </form>
      ) : (
        <p>Only an owner can manage household settings and invitations.</p>
      )}
      <h2>Members and invitations</h2>
      <ul className="household-members">
        {snapshot.members.map((member) => (
          <li key={member.id}>
            <div>
              <strong>{member.name}</strong>
              <p>
                {member.role} · {member.status}
                {member.invitationAttempts
                  ? ` · ${member.invitationAttempts} preview invitation${member.invitationAttempts === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <div className="ui-actions">
              {owner && member.status === 'pending' && (
                <>
                  <Button
                    tone="secondary"
                    disabled={locked}
                    onClick={() =>
                      void submit({
                        kind: 'resend-invite',
                        memberId: member.id,
                      })
                    }
                  >
                    Resend invitation for {member.name}
                  </Button>
                  <Button
                    tone="secondary"
                    disabled={locked}
                    onClick={() =>
                      void submit({
                        kind: 'revoke-invite',
                        memberId: member.id,
                      })
                    }
                  >
                    Revoke invitation for {member.name}
                  </Button>
                </>
              )}
              {owner && member.status === 'active' && (
                <Button
                  tone="secondary"
                  disabled={locked}
                  onClick={() =>
                    void submit({
                      kind: 'change-role',
                      memberId: member.id,
                      role: member.role === 'owner' ? 'member' : 'owner',
                    })
                  }
                >
                  Make {member.name}{' '}
                  {member.role === 'owner' ? 'a member' : 'an owner'}
                </Button>
              )}
              {member.status === 'active' &&
                (owner || member.id === actor.id) && (
                  <Button
                    tone="secondary"
                    disabled={locked}
                    onClick={() => setRemove(member)}
                  >
                    {member.id === actor.id
                      ? 'Leave household'
                      : `Remove ${member.name}`}
                  </Button>
                )}
              {member.status === 'inactive' && (
                <span>Access inactive · historical attribution retained</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {owner && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit({ kind: 'invite-member', name: invite });
          }}
        >
          <h2>Invite a member</h2>
          <Field
            label="Preview member name"
            value={invite}
            disabled={locked}
            maxLength={80}
            onChange={(event) => setInvite(event.target.value)}
          />
          <p>
            Use a made-up name. This creates a pending invitation; no email
            address or message is sent.
          </p>
          <Button type="submit" disabled={locked}>
            Create preview invitation
          </Button>
        </form>
      )}
      <p>
        <Link href="/sign-in">Preview accepting an invitation</Link>
      </p>
      <Confirmation
        open={!!remove}
        title={remove ? `Remove access for ${remove.name}?` : 'Remove member?'}
        confirmLabel="Remove access"
        pending={locked}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove)
            void submit({ kind: 'remove-member', memberId: remove.id });
          setRemove(null);
        }}
      >
        <p>
          Historical expenses and attribution remain. Removal is blocked for an
          outstanding balance or the last active owner. Make another active
          member an owner before leaving.
        </p>
      </Confirmation>
    </>
  );
}
export function Household() {
  const { snapshot, status, readyVersion, refresh } = useAppData();
  useRouteReady('/household', readyVersion);
  const readable =
    snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  return (
    <section className="household-screen">
      {readable ? (
        <>
          {status !== 'ready' && (
            <Status kind="stale">
              Previously loaded household details are shown. Restore connection
              before changing members.
              <Button onClick={() => void refresh()}>Refresh household</Button>
            </Status>
          )}
          <Members snapshot={snapshot} key={snapshot.household.id} />
        </>
      ) : status === 'loading' ? (
        <Skeleton label="Loading household" />
      ) : (
        <>
          <h1 data-page-heading tabIndex={-1}>
            Household unavailable
          </h1>
          <Status kind="denied">
            No financial or member fields are shown.{' '}
            <Link href="/sign-in">Return to sign-in preview</Link>
            <Button onClick={() => void refresh()}>Retry household</Button>
          </Status>
        </>
      )}
      <DemoPanel />
    </section>
  );
}
