// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { EditExpense } from './form';
const nav = vi.hoisted(() => ({
  path: '/drafts/edit-expense-102',
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
let root: Root, container: HTMLDivElement, source: AppDataSource, api: AppData;
function Probe() {
  const data = useAppData();
  useEffect(() => {
    api = data;
  }, [data]);
  return null;
}
async function mount(show = true) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            <Probe />
            {show && <EditExpense expenseId="102" />}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function input(key: string, value: string) {
  const element = document.getElementById(`create-${encodeURIComponent(key)}`)!;
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  )!;
}
async function click(text: string) {
  expect(button(text)).toBeTruthy();
  await act(async () => button(text).click());
}
async function snapshot() {
  const result = await source.port.read('household-demo');
  if (result.status !== 'ok') throw new Error('fixture');
  return result.value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/drafts/edit-expense-102';
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
it('independently requires a fresh comparison for a second concurrent revision before any overwrite', async () => {
  await mount();
  await input('note', 'My final correction');
  await act(async () => api.demo!.scenario('second-editor'));
  await click('Save changes');
  expect(
    (await snapshot()).expenses.find((row) => row.id === '102')!.version,
  ).toBe(2);
  await click('Reapply my draft to revision 2');
  await act(async () => api.demo!.scenario('second-editor'));
  await click('Save changes');
  expect(container.textContent).toContain('Original · revision 1');
  expect(container.textContent).toContain('Latest · revision 3');
  expect(button('Save changes').disabled).toBe(true);
  expect(
    (await snapshot()).expenses.find((row) => row.id === '102')!.note,
  ).not.toBe('My final correction');
  await click('Reapply my draft to revision 3');
  await click('Save changes');
  const read = await snapshot();
  expect(read.expenses.find((row) => row.id === '102')).toMatchObject({
    version: 4,
    note: 'My final correction',
    creatorId: 'member-k',
  });
  expect(read.revisions.filter((row) => row.expenseId === '102')).toHaveLength(
    4,
  );
});
it('independently hides a denied edit, preserves unsaved financial fields, and validates before restoring submission', async () => {
  const execute = vi.spyOn(source.port, 'execute');
  await mount();
  await input('amount', '9.999');
  await input('note', 'Unsubmitted note');
  await act(async () => api.demo!.scenario('denied'));
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).not.toContain('Unsubmitted note');
  expect(execute).not.toHaveBeenCalled();
  await act(async () => api.demo!.scenario('normal'));
  expect(
    (document.getElementById('create-amount') as HTMLInputElement).value,
  ).toBe('9.999');
  await click('Save changes');
  expect(execute).not.toHaveBeenCalled();
  expect(document.activeElement?.id).toBe('create-amount');
  await input('amount', '9.99');
  await click('Save changes');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    (await snapshot()).expenses.find((row) => row.id === '102'),
  ).toMatchObject({ amount: 999, note: 'Unsubmitted note', version: 2 });
});
