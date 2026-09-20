// @vitest-environment jsdom
import { act, useEffect, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationProvider, useExpenseNavigation } from './provider';
import { NavigationFixture } from './fixture';
import { NavigationShell } from './shell';
import { ExpenseDestination } from './expense';
import { fixture } from '../../lib/data/fixtures';
vi.mock('../data-provider', () => ({
  useAppData: () => ({
    snapshot: fixture('sample', '2026-09-20'),
    status: 'ready',
    readyVersion: 0,
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const route = vi.hoisted(() => ({
  pathname: '/',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => route.router,
  usePathname: () => route.pathname,
  useSearchParams: () => route.params,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useExpenseNavigation>;
let background = '/';
let direct = false;
function Probe() {
  const value = useExpenseNavigation();
  useEffect(() => {
    api = value;
  }, [value]);
  return null;
}
function App() {
  const expense = route.pathname.startsWith('/expenses/');
  return (
    <NavigationProvider>
      <Probe />
      <NavigationShell
        detail={
          expense && !direct ? (
            <ExpenseDestination expenseId="102" intercepted />
          ) : null
        }
      >
        {expense && direct ? (
          <ExpenseDestination expenseId="102" />
        ) : (
          <NavigationFixture title="Source" route={background} />
        )}
      </NavigationShell>
    </NavigationProvider>
  );
}
function navigate(href: string, state: object = {}) {
  const url = new URL(href, window.location.origin);
  window.history.replaceState(state, '', url);
  route.pathname = url.pathname;
  route.params = url.searchParams;
  act(() => root.render(<App />));
}
function clickText(text: string) {
  const target = [...container.querySelectorAll('a,button')].find(
    (node) => node.textContent === text,
  ) as HTMLElement;
  expect(target).toBeTruthy();
  act(() => target.click());
}
function latestPush() {
  return route.router.push.mock.calls.at(-1)![0] as string;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  background = '/';
  direct = false;
  Object.values(route.router).forEach((mock) => mock.mockReset());
  Object.defineProperty(window, 'innerWidth', {
    value: 1280,
    configurable: true,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

describe('navigation shell and contextual route integration', () => {
  it('keeps independent visit descriptors for repeated expense IDs and retained source queries', () => {
    navigate('/?mode=daily&scope=mine&period=2026-09');
    clickText('Open expense 102');
    const first = latestPush();
    const firstVisit = new URL(first, window.location.origin).searchParams.get(
      'visit',
    );
    const firstSource = api.getSource(firstVisit)!;
    navigate(first);
    expect(container.textContent).toContain('daily, mine, 2026-09');
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]')!.open,
    ).toBe(true);
    clickText('Back to previous view');
    expect(route.router.back).toHaveBeenCalledOnce();
    navigate(firstSource.href, { kamiEntry: firstSource.entryId });
    expect(document.activeElement?.id).toBe('list-expense-102');
    expect(api.refreshVersion).toBe(1);
    expect(route.router.refresh).not.toHaveBeenCalled();
    navigate(firstSource.href, { kamiEntry: firstSource.entryId });
    expect(document.activeElement?.id).toBe('list-expense-102');
    expect(api.refreshVersion).toBe(1);
    expect(route.router.refresh).not.toHaveBeenCalled();
    background = '/trips/maui';
    navigate('/trips/maui?tab=expenses&search=Poke');
    clickText('Open expense 102');
    const second = latestPush();
    const secondVisit = new URL(
      second,
      window.location.origin,
    ).searchParams.get('visit');
    expect(secondVisit).not.toBe(firstVisit);
    expect(api.getSource(firstVisit)?.href).toBe(
      '/?mode=daily&scope=mine&period=2026-09',
    );
    expect(api.getSource(secondVisit)?.href).toBe(
      '/trips/maui?tab=expenses&search=Poke',
    );
    navigate(second);
    expect(container.textContent).toContain('expenses · Search: Poke');
  });

  it('replaces full-page presentation and changes viewport without a history write', () => {
    navigate('/history?search=Poke');
    background = '/history';
    clickText('Open expense 102');
    const detail = latestPush();
    navigate(detail);
    clickText('Open full page');
    const full = route.router.replace.mock.calls.at(-1)![0] as string;
    expect(full).toContain('view=full');
    expect(full).toContain('visit=');
    navigate(full);
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]'),
    ).toBeNull();
    const pushes = route.router.push.mock.calls.length;
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 390,
        configurable: true,
      });
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.querySelector('.expense-page')).toBeTruthy();
    expect(container.querySelector('.skip-link')?.getAttribute('href')).toBe(
      '#expense-heading',
    );
    expect(
      container.querySelector('#expense-heading')?.getAttribute('tabindex'),
    ).toBe('-1');
    expect(route.router.push).toHaveBeenCalledTimes(pushes);
    expect(route.router.replace).toHaveBeenCalledOnce();
  });

  it('uses a full page at exactly760px and direct links always have safe history fallback', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 760,
      configurable: true,
    });
    navigate('/');
    clickText('Open expense 102');
    navigate(latestPush());
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]'),
    ).toBeNull();
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 761,
        configurable: true,
      });
      window.dispatchEvent(new Event('resize'));
    });
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]')!.open,
    ).toBe(true);
    direct = true;
    navigate('/expenses/102');
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]'),
    ).toBeNull();
    expect(container.querySelector('a[href="/history"]')?.textContent).toBe(
      'History',
    );
    expect(
      [...container.querySelectorAll('a')]
        .find((link) => link.textContent === 'Back to history')
        ?.getAttribute('href'),
    ).toBe('/history');
  });

  it('preserves modified-click canonical links and accessible destination state', () => {
    background = '/history';
    navigate('/history');
    const nav = container.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Main navigation');
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
      'History',
    );
    const link =
      container.querySelector<HTMLAnchorElement>('#list-expense-102')!;
    expect(link.getAttribute('href')).toBe('/expenses/102');
    link.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    });
    act(() =>
      link.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    expect(route.router.push).not.toHaveBeenCalled();
  });

  it('guards real page loss only while a session draft exists', () => {
    navigate('/');
    act(() => api.updateDraft('new', { note: 'Keep this private' }));
    expect(container.textContent).toContain(
      'Unsaved draft preserved for this session.',
    );
    expect(window.location.href).not.toContain('Keep');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    act(() => api.discardDraft('new'));
    const cleanExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);
  });

  it('suspends the source bucket modal for phone detail and restores the same bucket', () => {
    navigate('/?mode=daily&scope=mine');
    clickText('Inspect September 20 bucket');
    const bucketHref = latestPush();
    navigate(bucketHref);
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]')!.open,
    ).toBe(true);
    clickText('Open expense 102');
    const detailHref = latestPush();
    const source = api.getSource(
      new URL(detailHref, window.location.origin).searchParams.get('visit'),
    )!;
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
    });
    navigate(detailHref);
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]'),
    ).toBeNull();
    navigate(source.href, { kamiEntry: source.entryId });
    expect(
      container.querySelector<HTMLDialogElement>('dialog[open]')!.open,
    ).toBe(true);
    expect(document.activeElement?.id).toBe('bucket-expense-102');
  });
});
