// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceEditor } from './appearance';
import type { OnboardingController } from './controller';
const apply = vi.hoisted(() => vi.fn());
vi.mock('@/components/appearance', () => ({ useApplyAppearance: () => apply }));
let host: HTMLDivElement, root: Root;
const profile = (appearance: string, mutation = false) => ({
  data: {
    [mutation ? 'updateMyAppearance' : 'currentProfile']: {
      __typename: 'Profile',
      appearance,
    },
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  apply.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(call: ReturnType<typeof vi.fn>, actor = 'alice') {
  const state = {
    call,
    session: { user: { id: actor } },
  } as unknown as OnboardingController;
  await act(async () =>
    root.render(<AppearanceEditor key={actor} state={state} />),
  );
}
async function click(label: string) {
  const element = [...host.querySelectorAll('button, label')].find(
    (e) => e.textContent === label,
  )!;
  await act(async () => (element as HTMLElement).click());
}
it('applies selections immediately, serializes writes and coalesces rapid choices', async () => {
  let finish!: (value: unknown) => void;
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(profile('SYSTEM', true));
  await render(call);
  expect(host.textContent).not.toContain('Save appearance');
  await click('Dark');
  expect(apply).toHaveBeenLastCalledWith('alice', 'DARK', false);
  expect(host.querySelector('fieldset')!.disabled).toBe(false);
  await click('Light');
  await click('System');
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[1][1].variables).toEqual({
    appearance: 'DARK',
    expectedAppearance: 'LIGHT',
  });
  apply.mockClear();
  await act(async () => finish(profile('DARK', true)));
  expect(call.mock.calls[2][1].variables).toEqual({
    appearance: 'SYSTEM',
    expectedAppearance: 'DARK',
  });
  expect(apply.mock.calls).toEqual([['alice', 'SYSTEM', true]]);
  expect(host.textContent).toContain('Appearance saved for your account.');
});
it.each(['conflict', 'network'])(
  'preserves intent after %s and requires a checked baseline before explicit retry',
  async (failure) => {
    const call = vi.fn().mockResolvedValueOnce(profile('LIGHT'));
    if (failure === 'conflict')
      call.mockResolvedValueOnce({
        data: {
          updateMyAppearance: {
            __typename: 'ProfileProblem',
            code: 'CONFLICT',
          },
        },
      });
    else call.mockRejectedValueOnce(new Error('network'));
    call
      .mockResolvedValueOnce(profile('SYSTEM'))
      .mockResolvedValueOnce(profile('DARK', true));
    await render(call);
    await click('Dark');
    expect(apply).toHaveBeenLastCalledWith('alice', 'DARK', false);
    expect(host.querySelector('fieldset')!.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Save could not be confirmed',
    );
    expect(host.textContent).not.toContain(
      'Appearance saved for your account.',
    );
    await click('Check saved appearance');
    expect(
      (host.querySelector('input[value="DARK"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
    await click('Apply selected theme');
    expect(call.mock.calls[3][1].variables).toEqual({
      appearance: 'DARK',
      expectedAppearance: 'SYSTEM',
    });
    expect(apply).toHaveBeenLastCalledWith('alice', 'DARK', true);
  },
);
it('recovers response loss that committed without a second write', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce(profile('DARK'));
  await render(call);
  await click('Dark');
  await click('Check saved appearance');
  expect(call).toHaveBeenCalledTimes(3);
  expect(host.textContent).toContain('Appearance saved for your account.');
  expect(host.textContent).not.toContain('Apply selected theme');
  expect(apply).toHaveBeenLastCalledWith('alice', 'DARK', true);
});
it('keeps queued intent through an uncertain earlier write and a failed recovery read', async () => {
  let reject!: (reason: Error) => void;
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(profile('DARK'))
    .mockResolvedValueOnce(profile('SYSTEM', true));
  await render(call);
  await click('Dark');
  await click('System');
  await act(async () => reject(new Error('lost')));
  await click('Check saved appearance');
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  await click('Check saved appearance');
  expect(
    (host.querySelector('input[value="SYSTEM"]') as HTMLInputElement).checked,
  ).toBe(true);
  expect(call).toHaveBeenCalledTimes(4);
  await click('Apply selected theme');
  expect(call.mock.calls[4][1].variables).toEqual({
    appearance: 'SYSTEM',
    expectedAppearance: 'DARK',
  });
});
it('recovers an initial read failure without exposing an editable unconfirmed default', async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(profile('DARK'));
  await render(call);
  expect(host.querySelector('input')).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  await click('Retry appearance');
  expect(
    (host.querySelector('input[value="DARK"]') as HTMLInputElement).checked,
  ).toBe(true);
});
it('does not accept a late save belonging to a replaced account', async () => {
  let finish!: (value: unknown) => void;
  const old = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await render(old);
  await click('Dark');
  await render(vi.fn().mockResolvedValue(profile('SYSTEM')), 'bob');
  apply.mockClear();
  await act(async () => finish(profile('DARK', true)));
  expect(apply).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Appearance saved');
  expect(
    (host.querySelector('input[value="SYSTEM"]') as HTMLInputElement).checked,
  ).toBe(true);
});
it('persists a return to the original theme after an earlier write confirms', async () => {
  let finish!: (value: unknown) => void;
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(profile('LIGHT', true));
  await render(call);
  await click('Dark');
  await click('Light');
  expect(call).toHaveBeenCalledTimes(2);
  await act(async () => finish(profile('DARK', true)));
  expect(call.mock.calls[2][1].variables).toEqual({
    appearance: 'LIGHT',
    expectedAppearance: 'DARK',
  });
  expect(apply).toHaveBeenLastCalledWith('alice', 'LIGHT', true);
});
it('stops queued writes at a concurrent server conflict and preserves latest intent', async () => {
  let finish!: (value: unknown) => void;
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({
      data: {
        updateMyAppearance: {
          __typename: 'ProfileProblem',
          code: 'CONFLICT',
        },
      },
    })
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockResolvedValueOnce(profile('SYSTEM', true));
  await render(call);
  await click('Dark');
  await click('System');
  await act(async () => finish(profile('DARK', true)));
  expect(call.mock.calls[2][1].variables).toEqual({
    appearance: 'SYSTEM',
    expectedAppearance: 'DARK',
  });
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  expect(host.textContent).not.toContain('Appearance saved for your account.');
  expect(
    (host.querySelector('input[value="SYSTEM"]') as HTMLInputElement).checked,
  ).toBe(true);
  await click('Check saved appearance');
  expect(call).toHaveBeenCalledTimes(4);
  await click('Apply selected theme');
  expect(call.mock.calls[4][1].variables).toEqual({
    appearance: 'SYSTEM',
    expectedAppearance: 'LIGHT',
  });
});
it('does not drain queued prior-account intent after an access boundary unmount', async () => {
  let finish!: (value: unknown) => void;
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await render(call);
  await click('Dark');
  await click('System');
  await act(async () => root.render(<div>Access unavailable</div>));
  apply.mockClear();
  await act(async () => finish(profile('DARK', true)));
  expect(call).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
  expect(host.textContent).toBe('Access unavailable');
});
it('does not report success when a Profile response fails to confirm the attempted value', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(profile('LIGHT'))
    .mockResolvedValueOnce(profile('SYSTEM', true));
  await render(call);
  await click('Dark');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Save could not be confirmed',
  );
  expect(host.textContent).not.toContain('Appearance saved for your account.');
  expect(apply).toHaveBeenLastCalledWith('alice', 'DARK', false);
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
});
