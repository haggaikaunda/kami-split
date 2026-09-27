// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import { AppDataProvider, type AppDataSource } from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { RecordRepayment } from './form';
const nav = vi.hoisted(() => ({
  path: '/repayments/new',
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
          <SessionCommandProvider>
            {show && <RecordRepayment />}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function input(key: string, value: string) {
  const element = document.getElementById(
    `repayment-${key}`,
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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/repayments/new';
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

describe('repayment form and session command lifecycle', () => {
  it('records the default exact debt only once, without an expense or contribution change', async () => {
    const execute = vi.spyOn(source.port, 'execute');
    await mount();
    expect(container.textContent).toContain('Kaunda owes Mizenin 42.18 USD.');
    expect(container.textContent).toContain('Settled between these members.');
    await click('Record repayment');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].command).toMatchObject({
      kind: 'record-repayment',
      value: { amount: 4218, senderId: 'member-k', recipientId: 'member-m' },
    });
    expect(container.textContent).toContain('Repayment recorded.');
  });
  it('requires acknowledgment for overpayment and clears it when the amount changes', async () => {
    await mount();
    await input('amount', '50.00');
    await click('Record repayment');
    expect(container.textContent).toContain(
      'Acknowledge the balance in the opposite direction.',
    );
    const checkbox = document.getElementById(
      'repayment-acknowledged',
    ) as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    await input('amount', '50.01');
    expect(checkbox.checked).toBe(false);
    expect(container.textContent).toContain('Mizenin owes Kaunda 7.83 USD.');
  });
  it('retains a frozen unknown operation across route unmount and resolves without a second write', async () => {
    source.demo!.scenario('timeout-after-commit');
    const execute = vi.spyOn(source.port, 'execute');
    await mount();
    await input('amount', '10.01');
    await click('Record repayment');
    expect(container.textContent).toContain('save may have completed');
    expect(
      (container.querySelector('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(true);
    await mount(false);
    await mount();
    expect(
      (document.getElementById('repayment-amount') as HTMLInputElement).value,
    ).toBe('10.01');
    await click('Check repayment status and retry safely');
    expect(execute).toHaveBeenCalledTimes(1);
    const read = await source.port.read('household-demo');
    expect(
      read.status === 'ok' &&
        read.value.repayments.filter((row) => row.amount === 1001),
    ).toHaveLength(1);
  });
});
