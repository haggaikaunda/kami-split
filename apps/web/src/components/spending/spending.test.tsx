// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '@/lib/data/mock';
import { AppDataProvider, useAppData } from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { HouseholdSpending } from './household';
import { TripSpending } from './trip';
const nav = vi.hoisted(() => ({
  path: '/',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() },
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
let root: Root,
  container: HTMLDivElement,
  source: ReturnType<typeof createMockData>,
  trip = false;
function Screen() {
  const { snapshot } = useAppData();
  return snapshot ? (
    trip ? (
      <TripSpending
        snapshot={snapshot}
        trip={snapshot.trips.find((row) => row.id === 'maui')!}
      />
    ) : (
      <HouseholdSpending snapshot={snapshot} />
    )
  ) : (
    <p>Loading</p>
  );
}
async function mount() {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <Screen />
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function sync() {
  nav.path = window.location.pathname;
  nav.params = new URLSearchParams(window.location.search);
  await mount();
}
async function navigate(href: string) {
  window.history.pushState({}, '', href);
  await sync();
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (row) => row.textContent === text,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
  await sync();
}
async function bar(namespace: string, id: string) {
  const button = document.getElementById(
    `${namespace}-bar-${encodeURIComponent(id)}`,
  )!;
  await act(async () => button.click());
  await navigate(nav.router.push.mock.calls.at(-1)![0]);
}
async function read() {
  const result = await source.port.read('household-demo');
  if (result.status !== 'ok') throw Error('No data');
  return result.value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/';
  nav.params = new URLSearchParams();
  window.history.replaceState({}, '', '/');
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
  trip = false;
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('spending chart and exact data interaction', () => {
  it('has truthful zero geometry, exact accessible names, and equivalent table inspection', async () => {
    await mount();
    const january = document.getElementById(
      'household-spending-bar-month%3A2026-01',
    )!;
    expect(january.getAttribute('aria-label')).toContain(
      '300.00 USD, 2 expenses',
    );
    const zero = document.getElementById(
      'household-spending-bar-month%3A2026-02',
    )!;
    expect(
      (zero.querySelector('.spending-bar-fill') as HTMLElement).style.height,
    ).toBe('0%');
    const largest = document.getElementById(
      'household-spending-bar-month%3A2026-09',
    )!;
    expect(
      (largest.querySelector('.spending-bar-fill') as HTMLElement).style.height,
    ).toBe('100%');
    await click('View exact data for household spending');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
    const exact = document.getElementById(
      'household-spending-table-month%3A2026-09',
    )!;
    await act(async () => exact.click());
    await navigate(nav.router.push.mock.calls.at(-1)![0]);
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      '1,914.56 USD',
    );
    expect(window.location.search).toContain('chartData=1');
    await click('Back to chart');
    expect(nav.router.back).toHaveBeenCalledTimes(1);
  });
  it('changes mode/period/scope through retained URL state with all zero dates visible', async () => {
    await mount();
    await click('Daily');
    expect(container.querySelectorAll('.spending-bar-button')).toHaveLength(30);
    await click('Next month');
    expect(window.location.search).toContain('period=2026-10');
    expect(container.querySelectorAll('.spending-bar-button')).toHaveLength(31);
    expect(container.textContent).toContain('0.00 USD');
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'share';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sync();
    expect(window.location.search).toContain('scope=share');
    expect(container.textContent).toContain('Your allocated share');
    await click('Yearly');
    expect(container.querySelectorAll('.spending-bar-button')).toHaveLength(5);
    await click('Next five years');
    expect(window.location.search).toContain('period=2031-10');
  });
  it('refreshes the same selected bucket after date mutation and preserves newly empty results', async () => {
    nav.params = new URLSearchParams('chartMode=daily');
    window.history.replaceState({}, '', '/?chartMode=daily');
    await mount();
    await bar('household-spending', 'day:2026-09-18');
    const href = window.location.pathname + window.location.search;
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      'Dinner at Juniper',
    );
    const record = (await read()).expenses.find((row) => row.id === '2')!;
    await act(async () => {
      await source.port.execute({
        householdId: 'household-demo',
        operationId: 'move-open-bucket',
        command: {
          kind: 'update-expense',
          id: '2',
          expectedVersion: record.version,
          value: { ...record, effectiveDate: '2026-10-01' },
        },
      });
    });
    expect(window.location.pathname + window.location.search).toBe(href);
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      'No expenses in this bucket',
    );
    expect(container.querySelector('dialog[open]')?.textContent).not.toContain(
      'Dinner at Juniper',
    );
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      '0.00 USD',
    );
  });
  it('preserves a suspended bucket and its context during an expense visit and return', async () => {
    await mount();
    await bar('household-spending', 'month:2026-09');
    const bucketHref = window.location.pathname + window.location.search;
    const row = document.getElementById(
      'spending-record-2',
    ) as HTMLAnchorElement;
    await act(async () => row.click());
    await navigate(nav.router.push.mock.calls.at(-1)![0]);
    expect(container.querySelector('dialog[open]')).toBeNull();
    await navigate(bucketHref);
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      '1,914.56 USD',
    );
  });
  it('covers trip zero days and category records, and denies financial disclosure', async () => {
    trip = true;
    nav.path = '/trips/maui';
    window.history.replaceState({}, '', nav.path);
    await mount();
    expect(container.querySelectorAll('[id^="trip-days-bar-"]')).toHaveLength(
      9,
    );
    expect(
      document
        .getElementById('trip-days-bar-day%3A2026-09-10')
        ?.getAttribute('aria-label'),
    ).toContain('0.00 USD, 0 expenses');
    await bar('trip-categories', 'category:Transport');
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      '735.90 USD',
    );
    await act(async () => source.demo.scenario('denied'));
    expect(container.textContent).not.toContain('Flights to Kahului');
    expect(container.querySelectorAll('.spending-bar-button')).toHaveLength(0);
  });
});
