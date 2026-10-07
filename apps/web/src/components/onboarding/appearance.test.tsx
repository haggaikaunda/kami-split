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
const save = () =>
  [...host.querySelectorAll('button')].find(
    (e) => e.textContent === 'Save appearance',
  )!;
it('applies only server-confirmed changes, submits the expected value and suppresses duplicate saves', async () => {
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
  expect(save().disabled).toBe(true);
  await click('Dark');
  expect(apply).toHaveBeenLastCalledWith('alice', 'LIGHT');
  await click('Save appearance');
  await click('Save appearance');
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[1][1].variables).toEqual({
    appearance: 'DARK',
    expectedAppearance: 'LIGHT',
  });
  expect(save().disabled).toBe(true);
  await act(async () => finish(profile('DARK', true)));
  expect(apply).toHaveBeenLastCalledWith('alice', 'DARK');
  expect(host.textContent).toContain('Appearance saved for your account.');
});
it.each(['conflict', 'network'])(
  'requires rereading after %s and preserves the last confirmed theme',
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
    await click('Save appearance');
    expect(apply).toHaveBeenLastCalledWith('alice', 'LIGHT');
    expect(save().disabled).toBe(true);
    expect(host.querySelector('fieldset')!.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Save could not be confirmed',
    );
    await click('Check saved appearance');
    expect(apply).toHaveBeenLastCalledWith('alice', 'SYSTEM');
    await click('Dark');
    await click('Save appearance');
    expect(call.mock.calls[3][1].variables).toEqual({
      appearance: 'DARK',
      expectedAppearance: 'SYSTEM',
    });
  },
);
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
  await click('Save appearance');
  await render(vi.fn().mockResolvedValue(profile('SYSTEM')), 'bob');
  apply.mockClear();
  await act(async () => finish(profile('DARK', true)));
  expect(apply).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Appearance saved');
  expect(
    (host.querySelector('input[value="SYSTEM"]') as HTMLInputElement).checked,
  ).toBe(true);
});
