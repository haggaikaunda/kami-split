// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import { AppDataProvider, type AppDataSource } from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { TripDestination } from './destination';
import { AddExpense } from '../expense-create/form';
const nav = vi.hoisted(() => ({
  path: '/trips/maui',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
let root: Root, container: HTMLDivElement, source: AppDataSource;
async function mount(id = 'maui', form = false) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            {form ? <AddExpense /> : <TripDestination tripId={id} />}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function sync(id = 'maui') {
  nav.params = new URLSearchParams(window.location.search);
  await mount(id);
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (row) => row.textContent === text,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
  await sync();
}
async function input(id: string, value: string, syncQuery = true) {
  const element = document.getElementById(id)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
  if (syncQuery) await sync();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/trips/maui';
  nav.params = new URLSearchParams();
  window.history.replaceState({}, '', nav.path);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = createMockData();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
describe('trip detail journey', () => {
  it('shows exact metrics for every member and explicitly household-scoped repayment', async () => {
    await mount();
    expect(container.textContent).toContain('1,644.20 USD');
    expect(container.textContent).toContain('822.10 USD');
    expect(container.querySelectorAll('.trip-contributions > li')).toHaveLength(
      2,
    );
    expect(container.textContent).toContain(
      'A repayment affects the household balance',
    );
    await act(async () =>
      (
        container.querySelector('#trip-maui-repayment') as HTMLAnchorElement
      ).click(),
    );
    expect(nav.router.push.mock.calls.at(-1)?.[0]).toMatch(
      /^\/drafts\/new-repayment\?visit=/,
    );
    source = createMockData({ fixture: 'three-members' });
    await mount();
    expect(container.querySelectorAll('.trip-contributions > li')).toHaveLength(
      3,
    );
  });
  it('keeps tab/search/category in this entry without moving focus and captures the filtered expense source', async () => {
    await mount();
    await click('Expenses');
    const search = document.getElementById('trip-expense-search')!;
    search.focus();
    await input('trip-expense-search', 'Poke');
    expect(document.activeElement).toBe(search);
    expect(window.location.search).toContain('tab=expenses');
    expect(window.location.search).toContain('search=Poke');
    expect(container.querySelectorAll('.trip-expense-list li')).toHaveLength(1);
    const href =
      container.querySelector<HTMLAnchorElement>('#trip-expense-102')!;
    await act(async () => href.click());
    expect(nav.router.push.mock.calls.at(-1)?.[0]).toMatch(
      /^\/expenses\/102\?visit=/,
    );
    expect(container.textContent).toContain('1 of 7 expenses');
    await input('trip-expense-category', 'Transport');
    expect(container.textContent).toContain('No expenses match these filters');
    expect(window.location.search).toContain('search=Poke');
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Clear expense filters')!
      .focus();
    await click('Clear expense filters');
    expect(document.activeElement?.id).toBe('trip-expense-search');
    expect(window.location.search).toBe('?tab=expenses');
  });
  it('moves focus to the list when an overview inspection action changes views', async () => {
    await mount();
    const button = [...container.querySelectorAll('button')].find(
      (row) => row.textContent === 'View daily expenses',
    )!;
    button.focus();
    await click('View daily expenses');
    expect(document.activeElement?.id).toBe('trip-expenses-heading');
  });
  it('recomputes an empty filtered result after association removal without clearing its URL state', async () => {
    nav.params = new URLSearchParams('tab=expenses&search=Poke');
    window.history.replaceState({}, '', `${nav.path}?${nav.params}`);
    await mount();
    expect(container.querySelector('#trip-expense-102')).toBeTruthy();
    const before = await source.port.read('household-demo');
    if (before.status !== 'ok') throw new Error('No snapshot');
    const record = before.value.expenses.find((row) => row.id === '102')!;
    await act(async () =>
      source.port.execute({
        householdId: 'household-demo',
        operationId: 'remove-association',
        command: {
          kind: 'update-expense',
          id: record.id,
          expectedVersion: record.version,
          value: { ...record, tripId: null },
        },
      }),
    );
    expect(container.querySelector('#trip-expense-102')).toBeNull();
    expect(container.textContent).toContain('No expenses match these filters');
    expect(window.location.search).toBe('?tab=expenses&search=Poke');
  });
  it('prefills a trip expense and includes an editable pre-trip booking date in its total', async () => {
    await mount();
    await act(async () =>
      (
        container.querySelector('#trip-maui-add-expense') as HTMLAnchorElement
      ).click(),
    );
    const href = nav.router.push.mock.calls.at(-1)![0] as string;
    nav.path = '/drafts/new-expense';
    nav.params = new URL(href, 'https://kami.invalid').searchParams;
    window.history.pushState({}, '', href);
    await mount('maui', true);
    expect(
      (document.getElementById('create-tripId') as HTMLSelectElement).value,
    ).toBe('maui');
    expect(
      (document.getElementById('create-effectiveDate') as HTMLInputElement)
        .value,
    ).toBe('2026-09-13');
    await input('create-amount', '10.01', false);
    await input('create-description', 'Early flight booking', false);
    await input('create-effectiveDate', '2026-01-01', false);
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Save expense')!
        .click(),
    );
    const result = await source.port.read('household-demo');
    if (result.status !== 'ok') throw new Error('No data');
    expect(
      result.value.expenses.find(
        (row) => row.description === 'Early flight booking',
      ),
    ).toMatchObject({
      tripId: 'maui',
      effectiveDate: '2026-01-01',
      amount: 1001,
    });
    nav.path = '/trips/maui';
    nav.params = new URLSearchParams();
    window.history.replaceState({}, '', nav.path);
    await mount();
    expect(container.textContent).toContain('1,654.21 USD');
  });
  it('distinguishes empty, inaccessible, denied, and stale data without fake loading totals', async () => {
    nav.path = '/trips/porto';
    window.history.replaceState({}, '', nav.path);
    await mount('porto');
    expect(container.textContent).toContain('No expenses yet');
    expect(container.textContent).toContain('0.00 USD');
    await mount('missing');
    expect(container.textContent).toContain('Trip unavailable');
    expect(container.textContent).not.toContain('0.00 USD');
    nav.path = '/trips/maui';
    window.history.replaceState({}, '', nav.path);
    await mount();
    await act(async () => source.demo!.scenario('offline'));
    expect(container.textContent).toContain('last confirmed trip');
    expect(container.textContent).toContain('1,644.20 USD');
    await act(async () => source.demo!.scenario('denied'));
    expect(container.textContent).toContain('No financial details are shown');
    expect(container.textContent).not.toContain('1,644.20 USD');
    let release!: () => void;
    const slow = createMockData({
      delay: () =>
        new Promise<void>((done) => {
          release = done;
        }),
    });
    slow.demo.scenario('slow');
    source = slow;
    await mount();
    expect(container.textContent).toContain('Loading trip');
    expect(container.textContent).not.toContain('0.00 USD');
    await act(async () => release());
  });
});
