// @vitest-environment jsdom
import { act, StrictMode } from 'react';
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
  vi.useFakeTimers();
  localStorage.clear();
  document.documentElement.removeAttribute('data-appearance');
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
  vi.useRealTimers();
});
async function render(current?: FinancialScope, loading = false) {
  await act(async () =>
    root.render(
      <AppearanceProvider scope={current} loading={loading}>
        <Probe />
      </AppearanceProvider>,
    ),
  );
  act(() => vi.runOnlyPendingTimers());
}
it('defaults to System on a dark OS, follows live System changes, and explicit modes ignore OS', async () => {
  await render(scope('alice'));
  expect(document.documentElement.dataset.theme).toBe('dark');
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
  act(() => vi.runOnlyPendingTimers());
  requests.at(-1)!.next(result('LIGHT'));
  dark = true;
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('ignores late account responses and clears the theme on logout', async () => {
  await render(scope('alice'));
  requests[0].next(result('DARK'));
  await render(scope('bob'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  requests[0].next(result('LIGHT'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  requests[1].next(result('SYSTEM'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  await render();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem(appearanceCacheKey)).toBeNull();
  expect(listeners.size).toBe(1);
});
it('a saved edit wins over an older refresh, then a fresh remote preference is adopted', async () => {
  await render(scope('alice'));
  act(() => host.querySelector('button')!.click());
  requests[0].next(result('LIGHT'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.dispatchEvent(new Event('focus'));
  act(() => vi.runOnlyPendingTimers());
  requests[1].next(result('SYSTEM'));
  expect(JSON.parse(localStorage.getItem(appearanceCacheKey)!)).toEqual({
    actor: 'alice',
    value: 'SYSTEM',
  });
});
function cookie(actor?: string) {
  document.cookie =
    'kami-auth=' +
    (actor ? encodeURIComponent(JSON.stringify({ user: { id: actor } })) : '') +
    '; path=/';
}
it.each(['LIGHT', 'DARK', 'SYSTEM'] as const)(
  'boot and runtime resolve %s consistently on each OS with a cookie-only session',
  (value) => {
    cookie('alice');
    localStorage.setItem(
      appearanceCacheKey,
      JSON.stringify({ actor: 'alice', value }),
    );
    for (const os of [true, false]) {
      dark = os;
      window.eval(appearanceBootstrap);
      expect(document.documentElement.dataset.theme).toBe(
        value === 'DARK' || (value === 'SYSTEM' && os) ? 'dark' : 'light',
      );
    }
  },
);
it('bootstrap rejects absent, mismatched, malformed and inaccessible cache and never borrows legacy identity', () => {
  cookie('alice');
  for (const raw of [
    '{',
    'null',
    '[]',
    JSON.stringify({ actor: 'bob', value: 'LIGHT' }),
    JSON.stringify({ actor: 'alice', value: 'INVALID' }),
  ]) {
    localStorage.setItem(appearanceCacheKey, raw);
    window.eval(appearanceBootstrap);
    expect(document.documentElement.dataset.theme).toBe('dark');
  }
  cookie();
  localStorage.setItem('kami-auth', JSON.stringify({ user: { id: 'alice' } }));
  localStorage.setItem(
    appearanceCacheKey,
    JSON.stringify({ actor: 'alice', value: 'LIGHT' }),
  );
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('dark');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => window.eval(appearanceBootstrap)).not.toThrow();
  expect(document.documentElement.dataset.theme).toBe('dark');
  vi.restoreAllMocks();
});
it.each(['LIGHT', 'DARK', 'SYSTEM'] as const)(
  'retains known %s through revalidation, profile failures and cleanup',
  async (value) => {
    const current = scope('alice');
    await render(current);
    requests[0].next(result(value));
    const observed: string[] = [];
    const observer = new MutationObserver(() =>
      observed.push(document.documentElement.dataset.theme!),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    await render(current, true);
    requests[0].error();
    expect(document.documentElement.dataset.theme).toBe(
      value === 'LIGHT' ? 'light' : 'dark',
    );
    await render(current, false);
    expect(
      observed.every(
        (theme) => theme === (value === 'LIGHT' ? 'light' : 'dark'),
      ),
    ).toBe(true);
    observer.disconnect();
  },
);
it('System rechecks the OS on foreground without requiring a media change event', async () => {
  const current = scope('alice');
  await render(current);
  requests[0].next(result('SYSTEM'));
  await render(current, true);
  dark = false;
  window.dispatchEvent(new Event('pageshow'));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(requests).toHaveLength(1);
});
it('Strict Mode cleanup and remount do not reset saved Dark', async () => {
  localStorage.setItem(
    appearanceCacheKey,
    JSON.stringify({ actor: 'alice', value: 'DARK' }),
  );
  dark = false;
  await act(async () =>
    root.render(
      <StrictMode>
        <AppearanceProvider scope={scope('alice')} loading={false}>
          <Probe />
        </AppearanceProvider>
      </StrictMode>,
    ),
  );
  expect(document.documentElement.dataset.theme).toBe('dark');
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
  act(() => vi.runOnlyPendingTimers());
  expect(requests).toHaveLength(1);
  dark = false;
  listeners.forEach((fn) => fn());
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => host.querySelector('button')!.click());
  window.dispatchEvent(new Event('focus'));
  act(() => vi.runOnlyPendingTimers());
  expect(requests).toHaveLength(2);
});

it('bootstrap accepts supported base64 chunked cookies and rejects unknown cache schema', () => {
  cookie();
  const encoded = 'base64-' + btoa(JSON.stringify({ user: { id: 'alice' } }));
  document.cookie = 'kami-auth.0=' + encoded.slice(0, 20) + '; path=/';
  document.cookie = 'kami-auth.1=' + encoded.slice(20) + '; path=/';
  vi.stubGlobal(
    'TextDecoder',
    class {
      decode(bytes: Uint8Array) {
        return String.fromCharCode(...bytes);
      }
    },
  );
  localStorage.setItem(
    appearanceCacheKey,
    JSON.stringify({ actor: 'alice', value: 'LIGHT' }),
  );
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('light');
  localStorage.setItem(
    appearanceCacheKey,
    JSON.stringify([{ actor: 'alice', value: 'LIGHT' }]),
  );
  window.eval(appearanceBootstrap);
  expect(document.documentElement.dataset.theme).toBe('dark');
  document.cookie = 'kami-auth.0=; max-age=0; path=/';
  document.cookie = 'kami-auth.1=; max-age=0; path=/';
});
