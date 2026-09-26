// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import { AppDataProvider, type AppDataSource } from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { CreateTrip } from './form';
import { TripsList } from './list';
import { TripDestination } from './destination';
const nav = vi.hoisted(() => ({
  path: '/drafts/new-trip',
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
let root: Root, container: HTMLDivElement;
let source: AppDataSource;
async function mount(surface: 'form' | 'list' | string = 'form') {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            {surface === 'form' ? (
              <CreateTrip />
            ) : surface === 'list' ? (
              <TripsList />
            ) : (
              <TripDestination tripId={surface} />
            )}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function input(key: string, value: string) {
  const element = document.getElementById(`trip-${key}`)! as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/drafts/new-trip';
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('trip creation and cards', () => {
  it('creates once and opens a real empty destination with saved name and dates', async () => {
    const execute = vi.spyOn(source.port, 'execute');
    await mount();
    expect(document.activeElement?.id).toBe('trip-name');
    await input('name', 'Autumn escape');
    await input('destination', 'Kyoto');
    await input('start', '2027-10-01');
    await input('end', '2027-10-08');
    await click('Create trip');
    expect(execute).toHaveBeenCalledTimes(1);
    const result = await source.port.read('household-demo');
    if (result.status !== 'ok') throw new Error('No data');
    const trip = result.value.trips.find(
      (row) => row.name === 'Autumn escape',
    )!;
    expect(trip.cover).toBeNull();
    expect(nav.router.replace).toHaveBeenCalledWith(`/trips/${trip.id}`);
    nav.path = `/trips/${trip.id}`;
    window.history.replaceState({}, '', nav.path);
    await mount(trip.id);
    expect(container.textContent).toContain('Autumn escape');
    expect(container.textContent).toContain('Oct 1, 2027');
    expect(container.textContent).toContain('No expenses yet');
    expect(container.textContent).toContain('0.00 USD');
    expect(
      container.querySelector('a[href="/drafts/new-expense"]'),
    ).toBeTruthy();
  });
  it('retains invalid dates and denied command input without creating a trip', async () => {
    await mount();
    await input('name', 'Denied adventure');
    await input('start', '2027-05-15');
    await input('end', '2027-05-14');
    await click('Create trip');
    expect(container.textContent).toContain(
      'End date must be on or after the start.',
    );
    await input('end', '2027-05-15');
    const execute = vi
      .spyOn(source.port, 'execute')
      .mockResolvedValueOnce({ status: 'denied' });
    await click('Create trip');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (document.getElementById('trip-name') as HTMLInputElement).value,
    ).toBe('Denied adventure');
    expect(container.textContent).toContain('Access could not be confirmed');
    const result = await source.port.read('household-demo');
    expect(result.status === 'ok' && result.value.trips).toHaveLength(3);
  });
  it('resolves timeout without a duplicate trip and blocks repeat submits', async () => {
    source.demo!.scenario('timeout-after-commit');
    const execute = vi.spyOn(source.port, 'execute');
    await mount();
    await input('name', 'Only once');
    await click('Create trip');
    await click('Create trip');
    expect(
      (container.querySelector('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(true);
    await click('Check trip status and retry safely');
    expect(execute).toHaveBeenCalledTimes(1);
    const result = await source.port.read('household-demo');
    expect(
      result.status === 'ok' &&
        result.value.trips.filter((row) => row.name === 'Only once'),
    ).toHaveLength(1);
  });
  it('filters future trips, shows exact shared totals, and falls back when a photo fails', async () => {
    nav.path = '/trips';
    window.history.replaceState({}, '', nav.path);
    await mount('list');
    expect(container.textContent).toContain('1,644.20 USD');
    expect(container.textContent).toContain('840.00 USD');
    expect(container.querySelectorAll('article')).toHaveLength(3);
    const photo = container.querySelector('img')!;
    await act(async () => photo.dispatchEvent(new Event('error')));
    expect(
      container.querySelectorAll('[aria-label="Abstract trip cover"]'),
    ).toHaveLength(2);
    nav.params = new URLSearchParams('filter=upcoming');
    window.history.replaceState({}, '', '/trips?filter=upcoming');
    await mount('list');
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(container.textContent).toContain('May 12, 2027');
  });
  it('shows filtered-empty and true empty states without destroying filters', async () => {
    source = createMockData({ clock: () => '2028-01-01T12:00:00Z' });
    nav.path = '/trips';
    nav.params = new URLSearchParams('filter=upcoming');
    window.history.replaceState({}, '', '/trips?filter=upcoming');
    await mount('list');
    expect(container.textContent).toContain('No trips match this filter');
    expect(container.querySelector('a[href="/trips"]')).toBeTruthy();
    source = createMockData({ fixture: 'empty' });
    const empty = await source.port.read('household-demo');
    if (empty.status !== 'ok') throw new Error('No fixture');
    vi.spyOn(source.port, 'read').mockResolvedValue({
      ...empty,
      value: { ...empty.value, trips: [] },
    });
    await mount('list');
    expect(container.textContent).toContain('Your next adventure starts here');
  });
});
