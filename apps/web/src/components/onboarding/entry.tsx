'use client';
import { Brand, WorkspaceNavigation } from '@/components/workspace-identity';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, Status } from '@/components/primitives';
import { useOnboarding, type Mode } from './controller';
import { HouseIllustration, InvitationScreens, SignIn } from './screens';
import { ProfileEditor } from './profile';
import { LegacyInvitations } from './legacy-invitations';
import '../groups/journey.css';
import { ActionRecovery } from './recovery';
import './onboarding.css';
export function OnboardingEntry({ mode }: { mode: Mode }) {
  if (mode === 'invitations') return <LegacyInvitations />;
  return <OnboardingRoute key={mode} mode={mode} />;
}
function OnboardingRoute({ mode }: { mode: Mode }) {
  const [visit, setVisit] = useState<{ generation: number; fragment?: string }>(
    { generation: 0 },
  );
  useEffect(() => {
    if (mode !== 'join' && mode !== 'confirm') return;
    const changed = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      // A fragment-only navigation does not remount a Next route. Capture only
      // in memory and scrub synchronously before replacing the private controller.
      window.history.replaceState(null, '', window.location.pathname);
      setVisit((previous) => ({
        generation: previous.generation + 1,
        fragment,
      }));
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [mode]);
  return (
    <OnboardingVisit
      key={`${mode}:${visit.generation}`}
      mode={mode}
      fragment={visit.fragment}
    />
  );
}
function OnboardingVisit({
  mode,
  fragment,
}: {
  mode: Mode;
  fragment?: string;
}) {
  const c = useOnboarding(mode, fragment);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (c.notice) statusRef.current?.focus();
  }, [c.notice]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = panel.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [c.step, c.loading, c.wrongAccount]);
  const account = mode === 'account' || mode === 'invitations';
  return (
    <main
      className={
        account
          ? 'financial-journey group-workspace account-workspace'
          : 'onboarding'
      }
      id="page-content"
    >
      {account && <WorkspaceNavigation />}
      <div
        className={account ? 'account-content' : 'onboarding-panel'}
        ref={panel}
      >
        {!account && (
          <header>
            <Link href="/account" className="onboarding-brand">
              <Brand />
            </Link>
          </header>
        )}
        {!account && <HouseIllustration />}
        {c.loading ? (
          <Status kind="pending">Loading secure account access…</Status>
        ) : (
          <>
            <div ref={statusRef} tabIndex={-1}>
              {(c.notice || c.busy) && (
                <Status kind={c.failed ? 'error' : c.busy ? 'pending' : 'info'}>
                  {c.busy ? 'Working…' : c.notice}
                </Status>
              )}
            </div>
            {!c.client ? (
              <>
                <h1>Account access is unavailable</h1>
                <p>
                  Account services cannot be reached. Please try again later.
                </p>
              </>
            ) : account ? (
              <>
                <h1>
                  {mode === 'account' ? 'Your account' : 'Manage invitations'}
                </h1>
                {c.session ? (
                  <>
                    <p>Signed in as {c.session.user.email}</p>
                    <ProfileEditor key={c.session.user.id} state={c} />
                    <Button
                      tone="secondary"
                      disabled={c.busy}
                      onClick={() => void c.run(() => c.signOut())}
                    >
                      Sign out of this session
                    </Button>
                    <p>
                      Other devices may remain signed in. Existing access tokens
                      can remain valid for up to 15 minutes.
                    </p>
                  </>
                ) : (
                  <Link href="/sign-in">Sign in to your account</Link>
                )}
              </>
            ) : mode === 'confirm' ? (
              <>
                <h1>Verify your email</h1>
                {c.callback && !c.session && (
                  <>
                    <p>
                      Continue to verify your email and set your password.
                      You’ll choose whether to join the group afterwards.
                    </p>
                    <Button
                      disabled={c.busy}
                      onClick={() => void c.run(() => c.auth('verify'))}
                    >
                      Continue with email link
                    </Button>
                  </>
                )}
                {c.session && (
                  <p>
                    Sign out before opening a verification or recovery email for
                    another account. Then request a new email.
                  </p>
                )}
              </>
            ) : mode === 'sign-in' ? (
              <>
                <h1>
                  {c.step === 'recovery'
                    ? 'Reset your password'
                    : 'Welcome back'}
                </h1>
                {c.session ? (
                  <Link href="/account">Continue to my account</Link>
                ) : (
                  <SignIn state={c} recovery={c.step === 'recovery'} />
                )}
              </>
            ) : c.preview || (mode === 'password' && c.session) ? (
              <InvitationScreens state={c} />
            ) : (
              <>
                <h1>Invitation unavailable</h1>
                <p>
                  Reopen your invitation link or ask the group owner for a new
                  invitation.
                </p>
                <Link href="/sign-in">Sign in</Link>
              </>
            )}
            {!account && <ActionRecovery state={c} />}
          </>
        )}
      </div>
      {!account && <footer>Shared expenses. A little more together.</footer>}
    </main>
  );
}
