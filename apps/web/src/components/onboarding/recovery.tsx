import { Timestamp, ExactTimestamp } from '@/components/date-time';
import { Button, Field } from '../ui/primitives';
import type { OnboardingController } from './controller';
export function ActionRecovery({ state: c }: { state: OnboardingController }) {
  const {
    mode,
    attempt,
    session,
    busy,
    run,
    recover,
    email,
    setEmail,
    call,
    showReceipt,
    ownerAction,
    receipt,
  } = c;
  return (
    <>
      {attempt && session && (
        <aside>
          <h2>Unfinished action</h2>
          <p>
            Your request may still be processing. Check its result before trying
            again.
          </p>
          <Button
            tone="secondary"
            disabled={busy}
            onClick={() => void run(() => recover())}
          >
            Check the original request
          </Button>
          {attempt.kind === 'CREATE' && (
            <>
              <Field
                label="Original invitee email (re-enter after navigation)"
                id="original-invite-email"
                type="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </>
          )}
          <Button
            tone="secondary"
            disabled={busy || (attempt.kind === 'CREATE' && !email)}
            onClick={() =>
              void run(async () => {
                if (attempt.kind === 'ACCEPT') {
                  const currentDigest = sessionStorage.getItem(
                    'kami-onboarding-link-digest',
                  );
                  if (
                    attempt.tokenDigest &&
                    attempt.tokenDigest !== currentDigest
                  )
                    throw new Error('ORIGINAL_LINK_REQUIRED');
                  const out = await call('/api/onboarding/accept', {
                    key: attempt.key,
                    tokenDigest: attempt.tokenDigest,
                  });
                  showReceipt({
                    outcome: out.code,
                    groupID: out.groupID,
                    hasAccess: out.hasAccess,
                  });
                } else
                  await ownerAction(
                    attempt.kind,
                    attempt.invitationID,
                    attempt,
                  );
              })
            }
          >
            Try the original request again
          </Button>
          <p>
            Try again only with the same details. We will check for an earlier
            completion to avoid duplicates.
          </p>
        </aside>
      )}
      {receipt && mode !== 'join' && (
        <section data-ui="form-region">
          <h2>Action result</h2>
          <p>{receipt.outcome}</p>
          {receipt.committedExpiresAt && (
            <div>
              Expiry saved by this action:{' '}
              <Timestamp value={receipt.committedExpiresAt} />
              <ExactTimestamp value={receipt.committedExpiresAt} />
            </div>
          )}
          {receipt.currentExpiresAt && (
            <div>
              Current expiry: <Timestamp value={receipt.currentExpiresAt} />
              <ExactTimestamp value={receipt.currentExpiresAt} />
            </div>
          )}
          {receipt.delivery && <p>Send status: {receipt.delivery}</p>}
        </section>
      )}
    </>
  );
}
