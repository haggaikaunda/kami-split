'use client';

import { cx } from '../ui/classnames';
import { useFinancialSession } from '../groups/session';
import { RestoreSource } from '../groups/navigation';

import {
  AppIcon,
  Brand,
  WorkspaceNavigation,
} from '@/components/workspace-identity';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, Status } from '../ui/primitives';
import { useOnboarding, type Mode } from './controller';
import { HouseIllustration, InvitationScreens, SignIn } from './screens';
import { AppearanceEditor } from './appearance';
import { ProfileEditor } from './profile';
import { ProfileReturn } from './profile-return';
import { LegacyInvitations } from './legacy-invitations';
import { ActionRecovery } from './recovery';

import onboardingStyles from './onboarding.module.css';
import accountStyles from './account.module.css';
import shellStyles from '../workspace/shell.module.css';
import formLayoutStyles from '../ui/form-layout.module.css';

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
      window.history.replaceState(
        null,
        '',
        window.location.pathname === '/sign-in'
          ? `/sign-in?flow=${mode}`
          : window.location.pathname,
      );
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
  const { scope } = useFinancialSession();
  return (
    <main
      data-ui={account ? 'form-scope account-workspace' : 'onboarding'}
      className={
        account
          ? cx(formLayoutStyles['form-scope'], shellStyles.shell)
          : onboardingStyles['onboarding']
      }
      id="page-content"
    >
      {account && <WorkspaceNavigation />}
      <div
        data-content={account ? 'account' : undefined}
        data-ui={
          account ? 'workspace-content account-content' : 'onboarding-panel'
        }
        className={
          account
            ? cx(
                shellStyles['workspace-content'],
                accountStyles['account-content'],
              )
            : onboardingStyles['onboarding-panel']
        }
        ref={panel}
      >
        {!account && (
          <header data-ui="form-region">
            <Link
              href="/sign-in"
              data-ui="onboarding-brand"
              className={onboardingStyles['onboarding-brand']}
            >
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
                <Button onClick={() => window.location.reload()}>
                  Retry account access
                </Button>
              </>
            ) : account ? (
              <>
                <div
                  data-ui="profile-return"
                  className={accountStyles['profile-return']}
                >
                  {scope && scope.actor === c.session?.user.id && (
                    <ProfileReturn scope={scope} />
                  )}
                </div>
                <header
                  data-ui="account-heading form-region"
                  className={accountStyles['account-heading']}
                >
                  <h1>
                    {mode === 'account' ? 'Profile' : 'Manage invitations'}
                  </h1>
                </header>
                {c.session ? (
                  <>
                    {scope?.actor === c.session.user.id && (
                      <RestoreSource scope={scope} allowed={[]} />
                    )}
                    <ProfileEditor key={c.session.user.id} state={c} />
                    <AppearanceEditor
                      key={`appearance:${c.session.user.id}`}
                      state={c}
                    />
                    <section
                      data-ui="account-session form-region"
                      className={accountStyles['account-session']}
                      aria-labelledby="session-heading"
                    >
                      <div
                        data-ui="account-session-row"
                        className={accountStyles['account-session-row']}
                      >
                        <div>
                          <h2 id="session-heading">Session</h2>
                          <p
                            data-ui="account-secondary"
                            className={accountStyles['account-secondary']}
                          >
                            Signed in on this device
                          </p>
                        </div>
                        <Button
                          tone="secondary"
                          disabled={c.busy}
                          onClick={() => void c.run(() => c.signOut())}
                        >
                          <AppIcon name="signout" />
                          Sign out
                          <span
                            data-ui="account-control-context"
                            className={accountStyles['account-control-context']}
                          >
                            {' '}
                            of this session
                          </span>
                        </Button>
                      </div>
                      <p
                        data-ui="account-footnote account-session-notice"
                        className={cx(
                          accountStyles['account-footnote'],
                          accountStyles['account-session-notice'],
                        )}
                      >
                        Other devices may remain signed in. Existing access
                        tokens can remain valid for up to 15 minutes.
                      </p>
                    </section>
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
                  <>
                    <Link href="/account">Continue to my account</Link>
                    <Button
                      tone="secondary"
                      disabled={c.busy}
                      onClick={() => void c.run(() => c.signOut())}
                    >
                      Sign out of this session
                    </Button>
                  </>
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
