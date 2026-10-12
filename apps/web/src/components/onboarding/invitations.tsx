import { Timestamp, ExactTimestamp } from '@/components/date-time';
import { Button, Field } from '@/components/primitives';
import type { OnboardingController } from './controller';
import { PeopleList, type Person } from './people-list';
export function InvitationPanel({
  state: c,
  members = [],
}: {
  state: OnboardingController;
  members?: readonly Person[];
}) {
  const {
    busy,
    run,
    attempt,
    loadInvites,
    group,
    ownerAction,
    email,
    setEmail,
    invites,
    call,
    tell,
    send,
    next,
  } = c;
  const renderInvitation = (
    item: OnboardingController['invites'][number],
    pending = false,
  ) => (
    <li key={item.id}>
      <strong>
        {item.kind === 'SHARED'
          ? 'Shared group link'
          : (item.recipient ?? 'Recipient removed')}
      </strong>
      <p>
        {pending
          ? 'Pending · Invitation only; no access'
          : invitationStatus(item.lifecycle)}{' '}
        · Expires <Timestamp value={item.expiresAt} />
      </p>
      <ExactTimestamp value={item.expiresAt} />
      {item.kind !== 'SHARED' && <p>{deliveryStatus(item.delivery)}</p>}
      {!['ACCEPTED', 'REVOKED'].includes(item.lifecycle) && (
        <details className="invitation-actions">
          <summary>Invitation options</summary>
          <div className="onboarding-actions">
            {item.kind === 'SHARED' && (
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await call('/api/onboarding/copy-shared', {
                      groupID: group,
                      invitationID: item.id,
                    });
                    await navigator.clipboard.writeText(result.link);
                    tell(
                      'Shared link copied. Copying does not renew it. Distribute it only to people you want to join.',
                    );
                  })
                }
              >
                Copy shared link
              </Button>
            )}
            <Button
              tone="secondary"
              disabled={busy || !!attempt}
              onClick={() =>
                void run(() =>
                  ownerAction(
                    item.kind === 'SHARED' ? 'RENEW_SHARED' : 'RESEND',
                    item.id,
                  ),
                )
              }
            >
              {item.kind === 'SHARED'
                ? 'Renew shared link for seven days'
                : 'Resend and renew for seven days'}
            </Button>
            <Button
              tone="secondary"
              disabled={busy || !!attempt}
              onClick={() => void run(() => ownerAction('REVOKE', item.id))}
            >
              Revoke invitation
            </Button>
            {item.actionID &&
              ['PENDING', 'UNKNOWN', 'FAILED_DEFINITE'].includes(
                item.delivery,
              ) && (
                <Button
                  tone="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await send(item.actionID!);
                      await loadInvites(group);
                    })
                  }
                >
                  Retry same email without renewing
                </Button>
              )}
          </div>
        </details>
      )}
    </li>
  );
  return (
    <>
      <section className="account-management">
        {group && (
          <>
            <details className="add-member">
              <summary>Add member</summary>
              <p>
                Joining shares the group’s ledger and full expense history.
                Household membership also enables the overview of eligible
                groups and trips shared by all active Household members, without
                an additional sharing confirmation.
              </p>
              <p>
                Shared links admit verified first-time members who explicitly
                join. Forwarded links work too. Former members need a new
                targeted invitation. No application email is sent for shared
                links.
              </p>
              <Button
                tone="secondary"
                disabled={busy || !!attempt}
                onClick={() => void run(() => ownerAction('CREATE_SHARED'))}
              >
                Create or retrieve shared link
              </Button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => ownerAction('CREATE'));
                }}
              >
                <Field
                  label="Invitee email address"
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy || !!attempt}
                />
                <Button type="submit" disabled={busy || !!attempt}>
                  Create invitation
                </Button>
              </form>
            </details>
            <PeopleList members={members}>
              {invites
                .filter(
                  (item) =>
                    item.kind !== 'SHARED' && item.lifecycle === 'PENDING',
                )
                .map((item) => renderInvitation(item, true))}
            </PeopleList>
            {invites.some(
              (item) => item.kind === 'SHARED' && item.lifecycle === 'PENDING',
            ) && (
              <section aria-label="Shared invitation links">
                <h3>Shared invitation links</h3>
                <p>
                  These links are not members. Access starts only after a valid
                  invitation is accepted.
                </p>
                <ul className="account-rows">
                  {invites
                    .filter(
                      (item) =>
                        item.kind === 'SHARED' && item.lifecycle === 'PENDING',
                    )
                    .map((item) => renderInvitation(item))}
                </ul>
              </section>
            )}
            <details className="invitation-history">
              <summary>Invitation history</summary>
              <ul className="account-rows">
                {invites
                  .filter((item) => item.lifecycle !== 'PENDING')
                  .map((item) => renderInvitation(item))}
              </ul>
              {!invites.some((item) => item.lifecycle !== 'PENDING') && (
                <p>No invitation history in the loaded records.</p>
              )}
            </details>
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() => void run(() => loadInvites(group))}
            >
              Refresh invitations
            </Button>
            {next && (
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => void run(() => loadInvites(group, next))}
              >
                Load more invitations
              </Button>
            )}
          </>
        )}
      </section>
    </>
  );
}

function invitationStatus(lifecycle: string) {
  switch (lifecycle) {
    case 'PENDING':
      return 'Available';
    case 'ACCEPTED':
      return 'Accepted';
    case 'REVOKED':
      return 'Cancelled';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Status unavailable';
  }
}
function deliveryStatus(delivery: string) {
  switch (delivery) {
    case 'PROVIDER_ACCEPTED':
      return 'Email sent; arrival is not confirmed.';
    case 'PENDING':
      return 'Email waiting to send.';
    case 'UNKNOWN':
      return 'Email delivery is uncertain. Check or retry the same email.';
    case 'FAILED_DEFINITE':
      return 'Email could not be sent. Retry the same email.';
    default:
      return 'Email delivery information unavailable.';
  }
}
