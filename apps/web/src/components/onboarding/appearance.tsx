'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Status } from '@/components/primitives';
import { useApplyAppearance } from '@/components/appearance';
import { appearance, type Appearance } from '@/lib/appearance';
import query from '@/lib/relay/__generated__/appearanceQuery.graphql';
import mutation from '@/lib/relay/__generated__/appearanceMutation.graphql';
import type { OnboardingController } from './controller';
/** Keyed by actor at the account boundary, with epoch-checked requests. */
export function AppearanceEditor({
  state: c,
}: {
  state: OnboardingController;
}) {
  const apply = useApplyAppearance();
  const [saved, setSaved] = useState<Appearance>();
  const [selected, setSelected] = useState<Appearance>('LIGHT');
  const [working, setWorking] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const active = useRef(true),
    lock = useRef(false);
  const accept = (raw: unknown) => {
    const next = appearance(raw);
    setSaved(next);
    setSelected(next);
    setUncertain(false);
    if (c.session) apply(c.session.user.id, next);
  };
  const read = async () => {
    const result = await c.call('/api/graphql', { query: query.params.text });
    if (!active.current) return;
    const profile = result.data?.currentProfile;
    if (profile?.__typename !== 'Profile') throw new Error('UNAVAILABLE');
    accept(profile.appearance);
  };
  const run = async (save: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setMessage('');
    setFailed(false);
    try {
      if (!save) await read();
      else {
        const result = await c.call('/api/graphql', {
          query: mutation.params.text,
          variables: { appearance: selected, expectedAppearance: saved },
        });
        if (!active.current) return;
        const profile = result.data?.updateMyAppearance;
        if (profile?.__typename !== 'Profile')
          throw new Error('SAVE_UNCONFIRMED');
        accept(profile.appearance);
        setMessage('Appearance saved for your account.');
      }
    } catch {
      if (active.current) {
        setFailed(true);
        if (save) setUncertain(true);
        setMessage(
          save
            ? 'Save could not be confirmed or the preference changed elsewhere. Check saved appearance before trying again.'
            : 'Appearance could not be loaded. Try again.',
        );
      }
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void read()
      .catch(() => {
        if (active.current) {
          setFailed(true);
          setMessage('Appearance could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (active.current) setWorking(false);
      });
    return () => {
      active.current = false;
    };
    // The parent keys by authenticated actor; c.call rejects stale epochs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="profile-card" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <p>
        Choose how Kami Grow looks on your devices. System follows your device’s
        appearance.
      </p>
      {working && <Status kind="pending">Loading or saving appearance…</Status>}
      {message && <Status kind={failed ? 'error' : 'info'}>{message}</Status>}
      {saved ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(true);
          }}
        >
          <fieldset
            className="appearance-options"
            disabled={working || uncertain}
          >
            <legend>Theme</legend>
            {(['LIGHT', 'SYSTEM', 'DARK'] as const).map((value) => (
              <label className="onboarding-check" key={value}>
                <input
                  type="radio"
                  name="appearance"
                  value={value}
                  checked={selected === value}
                  onChange={() => setSelected(value)}
                />
                {value[0] + value.slice(1).toLowerCase()}
              </label>
            ))}
          </fieldset>
          <Button
            type="submit"
            disabled={working || uncertain || selected === saved}
          >
            Save appearance
          </Button>
        </form>
      ) : null}
      {(!saved || uncertain) && (
        <Button
          tone="secondary"
          disabled={working}
          onClick={() => void run(false)}
        >
          {uncertain ? 'Check saved appearance' : 'Retry appearance'}
        </Button>
      )}
    </section>
  );
}
