'use client';
import { commitLocalUpdate } from 'relay-runtime';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, Status } from '@/components/primitives';
import { AppIcon } from '@/components/workspace-identity';
import { useFinancialSession } from '@/components/groups/session';
import query from '@/lib/relay/__generated__/profileQuery.graphql';
import mutation from '@/lib/relay/__generated__/profileMutation.graphql';
import { normalizedName } from '@/lib/relay/profile-name';
import type { OnboardingController } from './controller';
type Profile = { id: string; displayName: string };
/** A compare-and-set setter, not a durable financial operation. An uncertain
 * response must be reconciled by reading before another explicit save. */
export function ProfileEditor({ state: c }: { state: OnboardingController }) {
  const { scope } = useFinancialSession();
  const [profile, setProfile] = useState<Profile>();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(true),
    lock = useRef(false);
  const apply = (value: Profile, replaceDraft: boolean) => {
    setProfile(value);
    if (replaceDraft) setName(value.displayName);
    // Membership IDs differ from Viewer IDs. Invalidate all current projections;
    // subsequent workspace reads fetch current names without disposing drafts.
    if (scope && scope.actor === c.session?.user.id && scope.isLive())
      commitLocalUpdate(scope.environment, (store) => store.invalidateStore());
  };
  const read = async (preserveDraft = false) => {
    const result = await c.call('/api/graphql', {
      query: query.params.text,
    });
    if (!active.current) return;
    const value = result.data?.currentProfile;
    if (value?.__typename !== 'Profile') throw new Error('READ_FAILED');
    apply(value, !preserveDraft);
    setUncertain(false);
    setFailed(false);
    setMessage(
      preserveDraft
        ? `Current saved name: ${value.displayName}. Review your edits before saving again.`
        : '',
    );
  };
  useEffect(() => {
    active.current = true;
    void read()
      .catch(() => {
        if (active.current) {
          setMessage('Your profile could not be loaded. Try again.');
          setFailed(true);
        }
      })
      .finally(() => {
        if (active.current) setWorking(false);
      });
    return () => {
      active.current = false;
    };
    // The parent keys this editor by authenticated actor. c.call rejects stale epochs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    try {
      await work();
    } catch {
      if (active.current) {
        setMessage(
          'Your profile could not be checked. Keep your edits and try again.',
        );
        setFailed(true);
      }
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
    }
  };
  const save = async () => {
    if (!profile || uncertain) return;
    const value = normalizedName(name);
    if (
      [...value].length < 1 ||
      [...value].length > 120 ||
      value.includes('\0')
    ) {
      setMessage('Enter a display name of 1–120 characters.');
      setFailed(true);
      return;
    }
    setFailed(false);
    setMessage('');
    try {
      const result = await c.call('/api/graphql', {
        query: mutation.params.text,
        variables: {
          displayName: value,
          expectedDisplayName: profile.displayName,
        },
      });
      if (!active.current) return;
      const saved = result.data?.updateMyProfile;
      if (saved?.__typename === 'Profile') {
        apply(saved, true);
        setMessage('Changes saved.');
        return;
      }
      if (saved?.code === 'INVALID_INPUT') {
        setMessage('Enter a display name of 1–120 characters.');
        setFailed(true);
        return;
      }
      setUncertain(true);
      setFailed(true);
      setMessage(
        saved?.code === 'CONFLICT'
          ? 'Your name changed elsewhere. Check the current profile, then review your edits.'
          : 'Save could not be confirmed. Check the current profile before saving again.',
      );
    } catch {
      if (active.current) {
        setUncertain(true);
        setFailed(true);
        setMessage(
          'Save could not be confirmed. Your edits are preserved. Check the current profile before saving again.',
        );
      }
    }
  };
  const dirty = profile && name !== profile.displayName;
  return (
    <>
      {profile && (
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true">
            {Array.from(profile.displayName.trim())[0] || '?'}
          </span>
          <div>
            <h2>{profile.displayName}</h2>
            <p className="account-secondary">{c.session?.user.email}</p>
          </div>
        </div>
      )}
      <section className="account-card" aria-labelledby="profile-heading">
        <div className="account-section-title">
          <AppIcon name="account" />
          <div>
            <h2 id="profile-heading">Profile</h2>
            <p className="account-secondary">
              How you appear to people in your spaces.
            </p>
          </div>
        </div>
        {message && (
          <div id="profile-feedback">
            <Status kind={failed ? 'error' : 'info'}>{message}</Status>
          </div>
        )}
        {working && (
          <Status kind="pending">
            {profile
              ? 'Saving or checking your profile…'
              : 'Loading your profile…'}
          </Status>
        )}
        {profile ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(save);
            }}
          >
            <div className="account-profile-fields">
              <Field
                id="display-name"
                label="Display name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setMessage('');
                  setFailed(false);
                }}
                disabled={working}
                error={failed ? message : undefined}
                hint="Visible to people who share your spaces. Use 1–120 characters; surrounding whitespace is removed."
              />
              <Field
                id="account-email"
                label="Email address"
                type="email"
                value={c.session?.user.email ?? ''}
                readOnly
              />
            </div>
            <div className="account-actions">
              <Button type="submit" disabled={working || !dirty || uncertain}>
                Save changes
              </Button>
              <Button
                tone="text"
                disabled={working || !dirty}
                onClick={() => {
                  setName(profile.displayName);
                  setMessage('');
                  setFailed(false);
                }}
              >
                Discard<span className="account-control-context"> edits</span>
              </Button>
              {uncertain && (
                <Button
                  tone="secondary"
                  disabled={working}
                  onClick={() => void action(() => read(true))}
                >
                  Check current profile
                </Button>
              )}
            </div>
          </form>
        ) : (
          <Button
            tone="secondary"
            disabled={working}
            onClick={() => void action(() => read())}
          >
            Retry profile
          </Button>
        )}
      </section>
    </>
  );
}
