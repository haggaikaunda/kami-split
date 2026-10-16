// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthBoundary } from './auth-boundary';
const state = vi.hoisted(() => ({
  access: { loading: true, scope: undefined, error: undefined } as {
    loading: boolean;
    scope?: object;
    error?: string;
  },
  pathname: '/household',
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('./session', () => ({ useFinancialSession: () => state.access }));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.access = { loading: true };
  state.pathname = '/household';
  state.replace.mockReset();
  state.refresh.mockReset();
  window.history.replaceState(null, '', '/household?tab=balances');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <AuthBoundary>
        <nav>Private navigation</nav>
        <h1>Private hero</h1>
      </AuthBoundary>,
    ),
  );
}
it('renders neutral loading only until a verified scope exists', async () => {
  await render();
  expect(host.textContent).toBe('Kami Grow');
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.querySelector('nav')).toBeNull();
  state.access = { loading: false, scope: {} };
  await render();
  expect(host.querySelector('nav')).not.toBeNull();
});
it.each([undefined, 'Account verification failed.'])(
  'suppresses signed-out and failed-check content while navigating to sign in',
  async (error) => {
    state.access = { loading: false, error };
    await render();
    expect(host.querySelector('nav')).toBeNull();
    expect(host.textContent).not.toContain('Private');
    expect(state.replace).toHaveBeenCalledWith(
      '/sign-in?next=%2Fhousehold%3Ftab%3Dbalances' +
        (error ? '&auth=unavailable' : ''),
    );
  },
);
it('immediately removes a previously rendered shell on expiry, refresh resolution and logout', async () => {
  state.access = { loading: false, scope: {} };
  await render();
  state.access = { loading: true, scope: state.access.scope };
  await render();
  expect(host.querySelector('nav')).toBeNull();
  expect(host.textContent).not.toContain('Private');
  expect(host.querySelector('[data-ui="skeleton"]')).toBeNull();
  state.access = { loading: false };
  await render();
  expect(host.querySelector('h1')).toBeNull();
});
it('keeps public sign-in and onboarding accessible during session resolution and error', async () => {
  state.pathname = '/sign-in';
  await render();
  expect(host.querySelector('h1')).not.toBeNull();
  expect(state.replace).not.toHaveBeenCalled();
});
it('hides the document before a BFCache snapshot can retain private UI', async () => {
  state.access = { loading: false, scope: {} };
  await render();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(host.firstElementChild?.hasAttribute('hidden')).toBe(true);
});
