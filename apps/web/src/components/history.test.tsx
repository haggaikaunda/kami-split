// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMockData } from '../lib/data/mock';
import { AppDataProvider, type AppDataSource } from './data-provider';
import { NavigationProvider } from './navigation/provider';
import { History } from './history';
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => navigation,
}));
vi.mock('next/link', () => ({ default: 'a' }));
let source: AppDataSource;
let root: Root;
async function render() {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <History />
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
function field(label: string) {
  const element = [...document.querySelectorAll('label')].find(
    (row) => row.textContent === label,
  )!;
  return document.getElementById(element.htmlFor) as HTMLInputElement;
}
async function filter(label: string, value: string) {
  await act(async () => {
    const element = field(label);
    const prototype =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
  await render();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/history');
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
it('combines live URL filters and links the immutable revision with a unique event focus target', async () => {
  await render();
  await filter('Search history', 'Poke');
  await filter('Activity type', 'created');
  await filter('Filter by member', 'member-k');
  expect(window.location.search).toContain('search=Poke');
  expect(window.location.search).toContain('member=member-k');
  const links = document.querySelectorAll('.history-event a');
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('/expenses/102?revision=1');
  expect(links[0].id).toMatch(/^history-event-/);
  await act(async () => (links[0] as HTMLAnchorElement).click());
  expect(navigation.push.mock.calls[0][0]).toMatch(
    /^\/expenses\/102\?revision=1&visit=/,
  );
});
it('offers clear filters for filtered empty and first expense for an empty dataset', async () => {
  await render();
  await filter('Search history', 'No matching description');
  expect(document.body.textContent).toContain('No matching activity');
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Clear filters')!
      .click(),
  );
  await render();
  expect(window.location.search).toBe('');
  expect(document.querySelectorAll('.history-event').length).toBeGreaterThan(0);
  await act(async () => source.demo!.reset('empty'));
  expect(document.body.textContent).toContain('Start your shared history');
  expect(
    document.getElementById('history-first-expense')?.getAttribute('href'),
  ).toBe('/drafts/new-expense');
});
it('shows current deleted audit events and historical creation as separate records', async () => {
  await render();
  const before = await source.port.read('household-demo');
  if (before.status !== 'ok') throw new Error('fixture');
  const row = before.value.expenses.find((row) => row.id === '102')!;
  await act(async () => {
    await source.port.execute({
      householdId: 'household-demo',
      operationId: 'history-delete',
      command: {
        kind: 'delete-expense',
        id: row.id,
        expectedVersion: row.version,
        reason: 'Duplicate',
      },
    });
  });
  await filter('Search history', 'Poke');
  expect(document.querySelectorAll('.history-event')).toHaveLength(2);
  expect(document.querySelector('.history-event')?.textContent).toContain(
    'Expense deleted',
  );
  expect(document.querySelector('.history-event a')?.getAttribute('href')).toBe(
    '/expenses/102?revision=2',
  );
  expect(document.body.textContent).toContain('Removed from current balances');
  expect(document.body.textContent).toContain('Expense date: Sep 6, 2026');
});
it('keeps filters through denied/expired/offline without showing fake empty history', async () => {
  await render();
  await filter('Search history', 'Poke');
  await act(async () => source.demo!.scenario('offline'));
  expect(document.body.textContent).toContain('previously loaded history');
  await act(async () => source.demo!.scenario('denied'));
  expect(document.querySelectorAll('.history-event')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('No matching activity');
  expect(document.body.textContent).not.toContain('Poke bowls');
  expect(field('Search history').value).toBe('Poke');
  await act(async () => source.demo!.scenario('normal'));
  expect(document.querySelectorAll('.history-event')).toHaveLength(1);
});
it('repayment events open their read-only identity rather than expense detail', async () => {
  await render();
  await filter('Activity type', 'repayment');
  const link = document.querySelector('.history-event a') as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('/repayments/repayment-4');
  await act(async () => link.click());
  expect(navigation.push.mock.calls[0][0]).toMatch(
    /^\/repayments\/repayment-4\?visit=/,
  );
  expect(document.body.textContent).toContain('Repayment date:');
});
