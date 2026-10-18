'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Status } from '../ui/primitives';
import { useApplyAppearance } from '@/components/appearance';
import { appearance, type Appearance } from '@/lib/appearance';
import query from '@/lib/relay/__generated__/appearanceQuery.graphql';
import mutation from '@/lib/relay/__generated__/appearanceMutation.graphql';
import type { OnboardingController } from './controller';
import accountStyles from './account.module.css';
/** Keyed by actor at the account boundary, with epoch-checked requests. */
export function AppearanceEditor({
  state: c,
}: {
  state: OnboardingController;
}) {
  const apply = useApplyAppearance();
  const [saved, setSaved] = useState<Appearance>();
  const [selected, setSelected] = useState<Appearance>('SYSTEM');
  const [working, setWorking] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const confirmed = useRef<Appearance>(undefined);
  const intent = useRef<Appearance>('SYSTEM');
  const paint = (value: Appearance, persisted: boolean) => {
    if (c.session) apply(c.session.user.id, value, persisted);
  };
  const read = async (recover: boolean) => {
    if (lock.current) return;
    lock.current = true;
    try {
      const result = await c.call('/api/graphql', { query: query.params.text });
      if (!active.current) return;
      const profile = result.data?.currentProfile;
      if (profile?.__typename !== 'Profile') throw new Error('UNAVAILABLE');
      const next = appearance(profile.appearance);
      confirmed.current = next;
      setSaved(next);
      setUncertain(false);
      if (!recover) {
        intent.current = next;
        setSelected(next);
      }
      paint(next, true);
      if (intent.current !== next) {
        paint(intent.current, false);
        setMessage(
          'Saved appearance checked. Apply your selected theme to try again.',
        );
      } else if (recover) setMessage('Appearance saved for your account.');
    } catch {
      if (active.current) {
        setFailed(true);
        setMessage('Appearance could not be loaded. Try again.');
      }
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
    }
  };
  const save = async () => {
    if (lock.current || !confirmed.current || uncertain) return;
    lock.current = true;
    setWorking(true);
    setFailed(false);
    setMessage('');
    try {
      // Serialize guarded writes and coalesce queued choices. A response may
      // advance the confirmed baseline, but must never repaint a newer intent.
      while (active.current && intent.current !== confirmed.current) {
        const desired: Appearance = intent.current;
        const result = await c.call('/api/graphql', {
          query: mutation.params.text,
          variables: {
            appearance: desired,
            expectedAppearance: confirmed.current,
          },
        });
        if (!active.current) return;
        const profile = result.data?.updateMyAppearance;
        if (profile?.__typename !== 'Profile' || profile.appearance !== desired)
          throw new Error('SAVE_UNCONFIRMED');
        confirmed.current = desired;
        setSaved(desired);
      }
      if (active.current) {
        paint(intent.current, true);
        setMessage('Appearance saved for your account.');
      }
    } catch {
      if (active.current) {
        setFailed(true);
        setUncertain(true);
        setMessage(
          'Save could not be confirmed or the preference changed elsewhere. Check saved appearance before trying again.',
        );
      }
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
    }
  };
  const choose = (value: Appearance) => {
    intent.current = value;
    setSelected(value);
    paint(value, false);
    void save();
  };
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) return read(false);
    });
    return () => {
      active.current = false;
      // Release the optimistic presentation when leaving this actor's editor.
      if (confirmed.current) paint(confirmed.current, true);
    };
    // The parent keys by authenticated actor; c.call rejects stale epochs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section
      data-ui="account-card form-region"
      className={accountStyles['account-card']}
      aria-labelledby="appearance-heading"
    >
      <div
        data-ui="account-section-title"
        className={accountStyles['account-section-title']}
      >
        <h2 id="appearance-heading">Preferences</h2>
      </div>
      {working && (
        <Status kind="pending">
          {uncertain
            ? 'Checking saved appearance…'
            : saved
              ? 'Saving appearance…'
              : 'Loading appearance…'}
        </Status>
      )}
      {message && <Status kind={failed ? 'error' : 'info'}>{message}</Status>}
      {saved ? (
        <div>
          <label
            className={accountStyles['appearance-label']}
            htmlFor="account-appearance"
          >
            Appearance
          </label>
          <select
            id="account-appearance"
            data-ui="appearance-control form-control"
            className={accountStyles['appearance-control']}
            disabled={uncertain}
            value={selected}
            onChange={(event) => choose(appearance(event.target.value))}
          >
            <option value="SYSTEM">Use device setting</option>
            <option value="LIGHT">Light</option>
            <option value="DARK">Dark</option>
          </select>
          <div
            data-ui="appearance-footer"
            className={accountStyles['appearance-footer']}
          >
            <p
              data-ui="account-footnote"
              className={accountStyles['account-footnote']}
            >
              System follows your device’s appearance.
            </p>
          </div>
        </div>
      ) : null}
      {saved && !uncertain && !working && selected !== saved && (
        <Button tone="secondary" onClick={() => void save()}>
          Apply selected theme
        </Button>
      )}
      {(!saved || uncertain) && (
        <Button
          tone="secondary"
          disabled={working}
          onClick={() => {
            setWorking(true);
            setFailed(false);
            setMessage('');
            void read(Boolean(saved));
          }}
        >
          {uncertain ? 'Check saved appearance' : 'Retry appearance'}
        </Button>
      )}
    </section>
  );
}
