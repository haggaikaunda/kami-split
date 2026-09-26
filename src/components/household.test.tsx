// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMockData } from '../lib/data/mock';
import { AppDataProvider, useAppData, type AppData } from './data-provider';
import {
  NavigationProvider,
  useExpenseNavigation,
} from './navigation/provider';
import { HouseholdCommandsProvider } from './household-controller';
import { Household } from './household';
import { HouseholdSetup } from './household-setup';
import { EntryPreview } from './entry-preview';
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => router,
}));
vi.mock('next/link', () => ({ default: 'a' }));
let root: Root;
let api: AppData;
let nav: ReturnType<typeof useExpenseNavigation>;
let source: ReturnType<typeof createMockData>;
function Probe() {
  const data = useAppData();
  const navigation = useExpenseNavigation();
  useEffect(() => {
    api = data;
    nav = navigation;
  }, [data, navigation]);
  return null;
}
async function render(screen: 'entry' | 'setup' | 'household' = 'household') {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <HouseholdCommandsProvider>
            <Probe />
            {screen === 'entry' ? (
              <EntryPreview />
            ) : screen === 'setup' ? (
              <HouseholdSetup />
            ) : (
              <Household />
            )}
          </HouseholdCommandsProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (row) => row.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function field(label: string) {
  const el = [...document.querySelectorAll('label')].find(
    (row) => row.textContent === label,
  )!;
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}
async function input(label: string, value: string) {
  await act(async () => {
    const el = field(label);
    const prototype =
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/household');
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = createMockData();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('completes the sign-in-to-empty-household flow and clears old drafts only after successful setup', async () => {
  await render('entry');
  await act(async () =>
    nav.updateDraft('new-expense', { description: 'Old sample draft' }),
  );
  await input('Entry scenario', 'first-household');
  await input('Email address', 'new@example.test');
  await click('Preview sign-in link');
  await click('Open preview link');
  expect(router.push).toHaveBeenCalledWith('/household/setup');
  const epoch = api.sessionEpoch;
  await render('setup');
  await click('Create preview household');
  expect(document.body.textContent).toContain('Enter a household name');
  expect(api.sessionEpoch).toBe(epoch);
  expect(nav.drafts['new-expense']).toBeTruthy();
  await input('Household name', 'Our new home');
  await click('Create preview household');
  expect(router.replace).toHaveBeenCalledWith('/household');
  expect(api.sessionEpoch).toBe(epoch + 1);
  expect(nav.drafts).toEqual({});
  expect(api.snapshot?.household.name).toBe('Our new home');
  expect(api.snapshot?.household.id).not.toBe('household-demo');
  expect(api.snapshot?.expenses).toEqual([]);
  expect(api.snapshot?.members).toHaveLength(1);
  await render();
  expect(document.querySelector('h1')?.textContent).toBe('Our new home');
  await act(async () => api.demo!.reset());
  expect(api.snapshot?.household.id).toBe('household-demo');
  expect(api.snapshot!.expenses.length).toBeGreaterThan(0);
});
it('owner invitation/resend/revoke controls update deterministic status; members see no owner controls', async () => {
  await render();
  await input('Preview member name', 'Sam');
  await click('Create preview invitation');
  expect(document.body.textContent).toContain(
    'member · pending · 1 preview invitation',
  );
  await click('Resend invitation for Sam');
  expect(document.body.textContent).toContain('2 preview invitations');
  await click('Revoke invitation for Sam');
  expect(document.body.textContent).toContain('Access inactive');
  await act(async () => api.demo!.actor('member-m'));
  expect(
    [...document.querySelectorAll('button')].some(
      (row) => row.textContent === 'Create preview invitation',
    ),
  ).toBe(false);
  expect(document.body.textContent).toContain('Only an owner');
});
it('removal confirmations preserve members on cancel and explain balance and last-owner failures', async () => {
  await render();
  await click('Remove Mizenin');
  expect(document.activeElement?.textContent).toBe('Keep editing');
  await click('Keep editing');
  expect(
    api.snapshot!.members.find((row) => row.id === 'member-m')?.status,
  ).toBe('active');
  await click('Remove Mizenin');
  await click('Remove access');
  expect(document.body.textContent).toContain('outstanding balance');
  await click('Leave household');
  await click('Remove access');
  expect(document.body.textContent).toContain('last owner cannot leave');
});
it('uncertain membership changes hold reset lock and recover exactly one invitation after route unmount', async () => {
  await render();
  await input('Preview member name', 'River');
  await act(async () => api.demo!.scenario('timeout-after-commit'));
  await click('Create preview invitation');
  expect(api.pendingOperations).toBe(1);
  const epoch = api.sessionEpoch;
  await act(async () => api.demo!.reset());
  expect(api.sessionEpoch).toBe(epoch);
  await render('entry');
  await render();
  await click('Check household change');
  expect(api.pendingOperations).toBe(0);
  expect(
    api.snapshot!.members.filter((row) => row.name === 'River'),
  ).toHaveLength(1);
});
it('unknown self-removal recovers only its own nonfinancial receipt without reinstating household access', async () => {
  source = createMockData({ fixture: 'empty' });
  await render();
  await click('Make Mizenin an owner');
  await act(async () => api.demo!.scenario('timeout-after-commit'));
  await click('Leave household');
  await click('Remove access');
  expect(api.status).toBe('denied');
  expect(api.pendingOperations).toBe(1);
  await click('Check household change');
  expect(api.pendingOperations).toBe(0);
  expect(api.status).toBe('denied');
  expect(document.body.textContent).toContain('Household unavailable');
});
it('setup blocks pending operations and preserves original setup identity after a lost response', async () => {
  await source.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'first-household',
  });
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'new@example.test',
  });
  await source.port.entry.dispatch({ kind: 'follow' });
  await render('setup');
  let release!: () => void;
  await act(async () => {
    release = api.acquirePendingOperation('prior');
  });
  const initialEpoch = api.sessionEpoch;
  await act(async () => {
    expect((await api.setupHousehold('Blocked')).status).toBe('validation');
  });
  expect(api.sessionEpoch).toBe(initialEpoch);
  await act(async () => release());
  const dispatch = source.port.entry.dispatch.bind(source.port.entry);
  let once = true;
  vi.spyOn(source.port.entry, 'dispatch').mockImplementation(async (action) => {
    const result = await dispatch(action);
    if (action.kind === 'complete-setup' && once) {
      once = false;
      throw new Error('lost response');
    }
    return result;
  });
  await input('Household name', 'Confirmed new home');
  await click('Create preview household');
  expect(api.pendingOperations).toBe(1);
  expect(api.sessionEpoch).toBe(initialEpoch);
  await render('entry');
  await render('setup');
  await click('Check original household setup');
  expect(api.pendingOperations).toBe(0);
  expect(api.snapshot?.household.name).toBe('Confirmed new home');
  expect(api.sessionEpoch).toBe(initialEpoch + 1);
});
it.each(['dispatch', 'read'] as const)(
  'ignores stale setup %s completion after source replacement',
  async (stage) => {
    await source.port.entry.dispatch({
      kind: 'scenario',
      scenario: 'first-household',
    });
    await source.port.entry.dispatch({
      kind: 'request',
      email: 'new@example.test',
    });
    await source.port.entry.dispatch({ kind: 'follow' });
    await render('setup');
    await act(async () => nav.updateDraft('old', { note: 'retained' }));
    const epoch = api.sessionEpoch;
    let complete!: () => void;
    if (stage === 'dispatch') {
      const dispatch = source.port.entry.dispatch.bind(source.port.entry);
      vi.spyOn(source.port.entry, 'dispatch').mockImplementation(
        async (action) => {
          const value = await dispatch(action);
          return new Promise((resolve) => {
            complete = () => resolve(value);
          });
        },
      );
    } else {
      const read = source.port.read.bind(source.port);
      vi.spyOn(source.port, 'read').mockImplementation(async (id) => {
        const value = await read(id);
        return id.startsWith('household-setup-')
          ? new Promise((resolve) => {
              complete = () => resolve(value);
            })
          : value;
      });
    }
    await input('Household name', 'Old source');
    await click('Create preview household');
    source = createMockData({ fixture: 'three-members' });
    await render('setup');
    await act(async () => complete());
    expect(api.snapshot?.household.id).toBe('household-demo');
    expect(api.snapshot?.members).toHaveLength(3);
    expect(api.sessionEpoch).toBe(epoch);
    expect(nav.drafts.old).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  },
);
it('finishes setup without redirecting a user who left the setup route during the request', async () => {
  await source.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'first-household',
  });
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'new@example.test',
  });
  await source.port.entry.dispatch({ kind: 'follow' });
  await render('setup');
  const dispatch = source.port.entry.dispatch.bind(source.port.entry);
  let complete!: () => void;
  vi.spyOn(source.port.entry, 'dispatch').mockImplementation(async (action) => {
    const value = await dispatch(action);
    return new Promise((resolve) => {
      complete = () => resolve(value);
    });
  });
  await input('Household name', 'Preserved destination');
  await click('Create preview household');
  await render('entry');
  await act(async () => complete());
  expect(api.snapshot?.household.name).toBe('Preserved destination');
  expect(router.replace).not.toHaveBeenCalled();
});
