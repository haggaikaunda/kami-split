import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field } from '@/components/primitives';
import type { OnboardingController } from './controller';

export function InvitationCard({ state: c }: { state: OnboardingController }) {
  if (!c.preview) return null;
  return (
    <section
      className="onboarding-invitation"
      aria-labelledby="invitation-group-name"
    >
      <span className="onboarding-invitation-mark" aria-hidden="true">
        ⌂
      </span>
      <div>
        <h2 id="invitation-group-name">{c.preview.groupName}</h2>
        <p>
          {c.preview.kind === 'SHARED' ? 'Shared' : 'Invited'} by{' '}
          {c.preview.inviterDisplayName}
        </p>
        {c.session && <p>Signed in as {c.session.user.email}</p>}
      </div>
    </section>
  );
}
export function HouseIllustration() {
  return (
    <svg className="onboarding-art" viewBox="0 0 180 110" aria-hidden="true">
      <ellipse cx="90" cy="65" rx="79" ry="43" fill="var(--color-balance)" />
      <path
        d="M49 53 90 20 132 53v45H49Z"
        fill="var(--color-surface)"
        stroke="var(--color-primary)"
        strokeWidth="3"
      />
      <path
        d="m40 57 49-40 51 40-7 5-44-33-42 33Z"
        fill="var(--color-primary)"
      />
      <path
        d="M82 68h19v30H82zM59 64h13v15H59zM111 64h12v15h-12z"
        fill="var(--color-primary)"
      />
      <path
        d="M25 98V69m130 29V68"
        stroke="var(--color-primary)"
        strokeWidth="3"
      />
      <ellipse cx="25" cy="63" rx="11" ry="20" fill="#8ca67b" />
      <ellipse cx="155" cy="62" rx="12" ry="22" fill="#8ca67b" />
    </svg>
  );
}
export function PasswordSetup({ state: c }: { state: OnboardingController }) {
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmation !== c.password) {
          setMismatch(true);
          return;
        }
        void c.run(c.savePassword);
      }}
    >
      <Field
        id="new-password"
        label="Password"
        hint="Use at least 12 characters, including an uppercase letter, a lowercase letter and a number."
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        required
        minLength={12}
        pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}"
        value={c.password}
        disabled={c.busy}
        onChange={(e) => c.setPassword(e.target.value)}
      />
      <Field
        label="Confirm password"
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        required
        value={confirmation}
        error={mismatch ? 'The passwords must match.' : undefined}
        disabled={c.busy}
        onChange={(e) => {
          setConfirmation(e.target.value);
          setMismatch(false);
        }}
      />
      <label className="onboarding-check">
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />{' '}
        Show passwords
      </label>
      <Button type="submit" disabled={c.busy}>
        {c.mode === 'password' && !c.preview
          ? 'Save password'
          : 'Create account'}
      </Button>
    </form>
  );
}
export function SignIn({
  state: c,
  recovery = false,
}: {
  state: OnboardingController;
  recovery?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void c.run(recovery ? c.recoverPassword : () => c.auth('login'));
      }}
    >
      <Field
        id="onboarding-email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        value={c.email}
        disabled={c.busy}
        onChange={(e) => c.setEmail(e.target.value)}
      />
      {!recovery && (
        <Field
          id="onboarding-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={c.password}
          disabled={c.busy}
          onChange={(e) => c.setPassword(e.target.value)}
        />
      )}
      <Button type="submit" disabled={c.busy || !c.client}>
        {recovery ? 'Send reset link' : 'Sign in'}
      </Button>
      <Button
        tone="secondary"
        disabled={c.busy}
        onClick={() => c.setStep(recovery ? 'sign-in' : 'recovery')}
      >
        {recovery ? 'Back to sign in' : 'Forgot password'}
      </Button>
      {!c.preview && (
        <p>New accounts require an invitation from a group member.</p>
      )}
    </form>
  );
}
export function InvitationScreens({
  state: c,
}: {
  state: OnboardingController;
}) {
  const router = useRouter();
  const shared = c.preview?.kind === 'SHARED';
  const name = c.preview?.groupName ?? 'your group';
  if (c.wrongAccount)
    return (
      <>
        <h1>This invitation is for another account</h1>
        <p>Switch accounts to continue with this invitation.</p>
        <InvitationCard state={c} />
        <Button
          disabled={c.busy}
          onClick={() => void c.run(() => c.signOut(true))}
        >
          Switch account
        </Button>
      </>
    );
  if (c.step === 'success' && c.receipt?.hasAccess && c.receipt.groupID)
    return (
      <>
        <h1>You joined {name}!</h1>
        <p>
          You can now see the group’s expenses and start splitting together.
        </p>
        <InvitationCard state={c} />
        <Link
          className="ui-button ui-button--primary"
          href={`/groups?group=${encodeURIComponent(c.receipt.groupID)}`}
        >
          Open {name}
        </Link>
        <Link href="/account">Go to my account</Link>
      </>
    );
  if (c.step === 'ready')
    return (
      <>
        <h1>Your account is ready</h1>
        <p>
          {c.preview
            ? `Continue to ${name} to finish joining the group.`
            : 'Your password has been saved.'}
        </p>
        <InvitationCard state={c} />
        <Button
          onClick={() =>
            c.preview
              ? c.mode === 'password'
                ? router.replace('/join')
                : c.setStep('join')
              : router.replace('/account')
          }
        >
          Continue{c.preview ? ` to ${name}` : ' to my account'}
        </Button>
      </>
    );
  if (c.step === 'password' || (c.mode === 'password' && c.step !== 'join'))
    return (
      <>
        <h1>
          {shared ? 'Create your password' : 'Create your Kami Split account'}
        </h1>
        <p>
          Your email has been verified. Now choose a password for your account.
        </p>
        <InvitationCard state={c} />
        <PasswordSetup key={c.session?.user.id} state={c} />
      </>
    );
  if (c.step === 'check-email')
    return (
      <>
        <h1>Check your email</h1>
        <p>
          If this address is eligible, you’ll receive an email with the next
          step. Open it in this browser to continue.
        </p>
        <InvitationCard state={c} />
        <Button disabled={c.busy} onClick={() => void c.run(c.provision)}>
          Resend email
        </Button>
        <Button
          tone="secondary"
          disabled={c.busy}
          onClick={() => c.setStep('email')}
        >
          Use a different email
        </Button>
      </>
    );
  if (c.step === 'email')
    return (
      <>
        <h1>Create your Kami Split account</h1>
        <p>First, verify your email address.</p>
        <InvitationCard state={c} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void c.run(c.provision);
          }}
        >
          <Field
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={c.email}
            disabled={c.busy}
            onChange={(e) => c.setEmail(e.target.value)}
          />
          <Button type="submit" disabled={c.busy}>
            Continue
          </Button>
        </form>
      </>
    );
  if (c.step === 'sign-in' || c.step === 'recovery')
    return (
      <>
        <h1>
          {c.step === 'recovery' ? 'Reset your password' : 'Welcome back'}
        </h1>
        <InvitationCard state={c} />
        <SignIn state={c} recovery={c.step === 'recovery'} />
      </>
    );
  if (c.session && (shared || c.step === 'join' || !c.preview?.kind))
    return (
      <>
        <h1>Ready to join {name}?</h1>
        <p>
          You’ll become an ordinary member and can see the group’s full expense
          history.
        </p>
        <InvitationCard state={c} />
        <Button
          disabled={c.busy || !!c.attempt}
          onClick={() => void c.run(c.accept)}
        >
          Join {name}
        </Button>
        <Link className="ui-button ui-button--secondary" href="/account">
          Not now
        </Link>
      </>
    );
  return (
    <>
      <h1>
        {shared
          ? `Join ${name}`
          : `${c.preview?.inviterDisplayName} invited you to ${name}`}
      </h1>
      <p>
        {shared
          ? 'Share expenses, track balances, and settle up together.'
          : 'This invitation was sent directly to you. Continue securely without another verification email.'}
      </p>
      <InvitationCard state={c} />
      <Button
        disabled={c.busy || !c.client}
        onClick={() => (shared ? c.setStep('sign-in') : void c.run(c.targeted))}
      >
        {shared ? 'Sign in' : 'Continue with invitation'}
      </Button>
      {!shared && !c.session && (
        <Button
          tone="secondary"
          disabled={c.busy}
          onClick={() => c.setStep('sign-in')}
        >
          Sign in instead
        </Button>
      )}
      {shared && (
        <Button
          tone="secondary"
          disabled={c.busy}
          onClick={() => c.setStep('email')}
        >
          Create an account
        </Button>
      )}
      <Link href="/sign-in">
        {shared ? 'Already have an account?' : 'This invitation isn’t for me'}
      </Link>
    </>
  );
}
