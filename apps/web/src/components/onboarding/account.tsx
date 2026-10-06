import Link from 'next/link';
import { Button, Field } from '@/components/primitives';
import type { OnboardingController } from './controller';
export function AccountPanel({ state: c }: { state: OnboardingController }) {
  const {
    mode,
    session,
    busy,
    run,
    loadGroups,
    groups,
    attempt,
    setGroup,
    setInvites,
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
  return (
    <>
      {(mode === 'account' || mode === 'invitations') && session && (
        <section className="account-management">
          <Button
            tone="secondary"
            disabled={busy}
            onClick={() => void run(loadGroups)}
          >
            {mode === 'account' ? 'Refresh groups' : 'Load my groups'}
          </Button>
          {groups.length > 0 && (
            <ul className="account-rows">
              {groups.map((item) => (
                <li key={item.id}>
                  <Link href={`/groups?group=${encodeURIComponent(item.id)}`}>
                    {item.name}
                  </Link>{' '}
                  <Button
                    tone="secondary"
                    disabled={busy || !!attempt}
                    onClick={() =>
                      void run(async () => {
                        setGroup('');
                        setInvites([]);
                        await loadInvites(item.id);
                        setGroup(item.id);
                      })
                    }
                  >
                    Manage invitations for {item.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {group && (
            <>
              <h2>Group invitations</h2>
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
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => void run(() => loadInvites(group))}
              >
                Refresh invitations
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
              <ul className="account-rows">
                {invites.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.kind === 'SHARED'
                        ? 'Shared group link'
                        : (item.recipient ?? 'Recipient removed')}
                    </strong>
                    <p>
                      {item.lifecycle} · Expires{' '}
                      {new Date(item.expiresAt).toLocaleString()}
                    </p>
                    {item.kind !== 'SHARED' && (
                      <p>
                        Send status: {item.delivery}. Provider acceptance does
                        not confirm recipient delivery.
                      </p>
                    )}
                    {!['ACCEPTED', 'REVOKED'].includes(item.lifecycle) && (
                      <div className="onboarding-actions">
                        {item.kind === 'SHARED' && (
                          <Button
                            tone="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await call(
                                  '/api/onboarding/copy-shared',
                                  { groupID: group, invitationID: item.id },
                                );
                                await navigator.clipboard.writeText(
                                  result.link,
                                );
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
                                item.kind === 'SHARED'
                                  ? 'RENEW_SHARED'
                                  : 'RESEND',
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
                          onClick={() =>
                            void run(() => ownerAction('REVOKE', item.id))
                          }
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
                    )}
                  </li>
                ))}
              </ul>
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
      )}
    </>
  );
}
