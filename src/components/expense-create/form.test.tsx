// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import type { Envelope, Entity, Outcome } from '../../lib/data/port';
import { AppDataProvider, type AppDataSource } from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { ExpenseCreationProvider } from './controller';
import { AddExpense } from './form';
const nav = vi.hoisted(() => ({
  path: '/drafts/new-expense',
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
async function mount(show = true) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <ExpenseCreationProvider>
            {show && <AddExpense />}
          </ExpenseCreationProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function input(key: string, value: string) {
  const element = document.getElementById(
    `create-${encodeURIComponent(key)}`,
  )! as HTMLInputElement;
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
async function valid() {
  await input('amount', '10.01');
  await input('description', 'Independent lunch');
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/drafts/new-expense';
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

describe('add expense form and session-owned command lifecycle', () => {
  it('focuses amount, defaults members and saves exact values once with a detail link', async () => {
    const execute = vi.spyOn(source.port, 'execute');
    await mount();
    expect(document.activeElement?.id).toBe('create-amount');
    expect(
      container.querySelectorAll('input[type=checkbox]:checked'),
    ).toHaveLength(2);
    await valid();
    expect(container.textContent).toContain('5.01 USD');
    await click('Save expense');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].command).toMatchObject({
      kind: 'create-expense',
      value: { amount: 1001, description: 'Independent lunch' },
    });
    expect(
      container.querySelector('.expense-save-notice')!.textContent,
    ).toContain('Expense saved');
    expect(nav.router.replace).toHaveBeenCalledWith('/history');
  });
  it('focuses an invalid description and retains exact amounts across membership and confirmed mode changes', async () => {
    await mount();
    await input('amount', '10.01');
    await click('Save expense');
    expect(document.activeElement?.id).toBe('create-description');
    const exact = [
      ...container.querySelectorAll('input[type=radio]'),
    ][1] as HTMLInputElement;
    await act(async () => exact.click());
    await input('allocation-member-k', '10.01');
    await input('allocation-member-m', '0');
    const second = container.querySelectorAll(
      'input[type=checkbox]',
    )[1] as HTMLInputElement;
    await act(async () => second.click());
    await act(async () => second.click());
    expect(
      (
        document.getElementById(
          'create-allocation-member-m',
        ) as HTMLInputElement
      ).value,
    ).toBe('0');
    await act(async () =>
      (
        container.querySelector('input[type=radio]') as HTMLInputElement
      ).click(),
    );
    expect(container.textContent).toContain('Use an equal split?');
    await click('Use equal split');
    await act(async () =>
      (
        container.querySelectorAll('input[type=radio]')[1] as HTMLInputElement
      ).click(),
    );
    expect(
      (
        document.getElementById(
          'create-allocation-member-k',
        ) as HTMLInputElement
      ).value,
    ).toBe('10.01');
  });
  it('deduplicates a pending submission and completes without navigating after the form unmounts', async () => {
    const original = source.port.execute;
    let release!: () => Promise<void>;
    const execute = vi.spyOn(source.port, 'execute').mockImplementation(
      (envelope) =>
        new Promise<Outcome<Entity>>((resolve) => {
          release = async () => resolve(await original(envelope));
        }),
    );
    await mount();
    await valid();
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (document.getElementById('create-amount') as HTMLInputElement).disabled ||
        (document.getElementById('create-amount') as HTMLInputElement).closest(
          'fieldset',
        )!.disabled,
    ).toBe(true);
    nav.path = '/history';
    window.history.replaceState({}, '', nav.path);
    await mount(false);
    await act(async () => release());
    expect(container.textContent).toContain('Expense saved');
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(nav.router.back).not.toHaveBeenCalled();
  });
  it('resolves unknown completion through operation lookup without a second write', async () => {
    const execute = vi.spyOn(source.port, 'execute');
    const operation = vi.spyOn(source.port, 'operation');
    await mount();
    await valid();
    source.demo!.scenario('timeout-after-commit');
    await click('Save expense');
    expect(container.textContent).toContain('save may have completed');
    expect(container.querySelector('.expense-save-notice')).toBeNull();
    await click('Check save status and retry safely');
    expect(operation).toHaveBeenCalledWith(
      'household-demo',
      execute.mock.calls[0][0].operationId,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Expense saved');
  });
  it('retries a known precommit failure with the same operation and original draft', async () => {
    const original = source.port.execute;
    const requests: Envelope[] = [];
    vi.spyOn(source.port, 'execute').mockImplementation(async (envelope) => {
      requests.push(envelope);
      return requests.length === 1 ? { status: 'offline' } : original(envelope);
    });
    await mount();
    await valid();
    await click('Save expense');
    expect(container.textContent).toContain('No expense was saved');
    expect(
      (document.getElementById('create-description') as HTMLInputElement).value,
    ).toBe('Independent lunch');
    await click('Save expense');
    expect(requests).toHaveLength(2);
    expect(requests[1].operationId).toBe(requests[0].operationId);
    expect(requests[1].command).toEqual(requests[0].command);
  });
});
