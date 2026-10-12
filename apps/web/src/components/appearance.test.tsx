// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AppearanceProvider, useApplyAppearance } from './appearance';
import { appearanceBootstrap, appearanceCacheKey } from '@/lib/appearance';
import type { FinancialScope } from '@/lib/relay/environment';
const requests = vi.hoisted(
  () => [] as { next(value: unknown): void; error(): void }[],
);
vi.mock('relay-runtime', () => ({
  fetchQuery: () => ({
    subscribe: (observer: (typeof requests)[number]) => {
      requests.push(observer);
      return { unsubscribe() {} };
    },
  }),
}));
let root: Root, host: HTMLDivElement, dark: boolean;
let listeners: Set<() => void>;
const scope = (actor: string) =>
  ({ actor, environment: {}, isLive: () => true }) as FinancialScope;
const result = (value: string) => ({
  currentProfile: { __typename: 'Profile', appearance: value },
});
function Probe() {
  const apply = useApplyAppearance();
  return (
    <>
      <button onClick={() => apply('alice', 'DARK')}>Accept saved Dark</button>
      <button onClick={() => apply('alice', 'SYSTEM', false)}>
        Preview System
      </button>
    </>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  requests.length = 0;
  dark = true;
  listeners = new Set();
  vi.stubGlobal('matchMedia', () => ({
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(current?: FinancialScope) {
  await act(async () =>
    root.render(
      <AppearanceProvider scope={current} loading={false}>
        <Probe />
      </AppearanceProvider>,
    ),
  );
}
it('defaults to Light on a dark OS, follows live System changes, and explicit modes ignore OS', async () => {
  await render(scope('alice'));
  expect(document.documentElement.dataset.theme).toBe('light');
  requests[0].next(result('SYSTEM'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  dark = false;
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => host.querySelector('button')!.click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.dispatchEvent(new Event('focus'));
  requests.at(-1)!.next(result('LIGHT'));
  dark = true;
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('ignores late account responses and clears the theme on logout', async () => {
  await render(scope('alice'));
  requests[0].next(result('DARK'));
  await render(scope('bob'));
  expect(document.documentElement.dataset.theme).toBe('light');
  requests[0].next(result('DARK'));
  expect(document.documentElement.dataset.theme).toBe('light');
  requests[1].next(result('SYSTEM'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  await render();
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(listeners.size).toBe(0);
});
it('a saved edit wins over an older refresh, then a fresh remote preference is adopted', async () => {
  await render(scope('alice'));
  act(() => host.querySelector('button')!.click());
  requests[0].next(result('LIGHT'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.dispatchEvent(new Event('focus'));
  requests[1].next(result('SYSTEM'));
  expect(JSON.parse(localStorage.getItem(appearanceCacheKey)!)).toEqual({
    actor: 'alice',
    value: 'SYSTEM',
  });
});
it('boot applies only the matching account cache before hydration and fails safely', () => {
  localStorage.setItem('kami-auth', JSON.stringify({ user: { id: 'alice' } }));
  localStorage.setItem(
    appearanceCacheKey,
    JSON.stringify({ actor: 'alice', value: 'DARK' }),
  );
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem('kami-auth', JSON.stringify({ user: { id: 'bob' } }));
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('light');
  localStorage.setItem('kami-auth', '{');
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('optimistic choices follow the OS without caching or being overwritten by focus reads', async () => {
  await render(scope('alice'));
  requests[0].next(result('LIGHT'));
  act(() => host.querySelectorAll('button')[1].click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(JSON.parse(localStorage.getItem(appearanceCacheKey)!).value).toBe(
    'LIGHT',
  );
  requests[0].next(result('DARK'));
  window.dispatchEvent(new Event('focus'));
  expect(requests).toHaveLength(1);
  dark = false;
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => host.querySelector('button')!.click());
  window.dispatchEvent(new Event('focus'));
  expect(requests).toHaveLength(2);
});
