// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialScope } from '@/lib/relay/environment';
import { ExpenseEntryProvider, useExpenseEntry } from './entry';
let root: Root, host: HTMLDivElement, scope: FinancialScope, live: boolean;
let handoff: ReturnType<typeof useExpenseEntry>;
const receive = vi.fn();
const prevented = vi.fn();
function Ledger({ visible = true }: { visible?: boolean }) {
  const entry = useExpenseEntry();
  useEffect(() => {
    handoff = entry;
  }, [entry]);
  useEffect(
    () => (visible ? entry?.register({}, receive) : undefined),
    [entry, visible],
  );
  return null;
}
function Banner() {
  const entry = useExpenseEntry();
  return (
    <a
      id="workspace-add"
      href="/household/expenses?create=home"
      onClick={(event) => {
        entry?.activate(event, 'home');
        prevented(event.defaultPrevented);
        event.preventDefault();
      }}
    >
      Add expense
    </a>
  );
}
async function render(visit = 'first', ledger = true, currentScope = scope) {
  await act(async () =>
    root.render(
      <ExpenseEntryProvider scope={currentScope} visit={visit}>
        <Banner />
        <Ledger visible={ledger} />
      </ExpenseEntryProvider>,
    ),
  );
}
async function click(options: MouseEventInit = {}) {
  await act(async () =>
    host.querySelector('a')!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...options,
      }),
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  receive.mockClear();
  prevented.mockClear();
  live = true;
  scope = { id: 'account', isLive: () => live } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('hands authorized source and focus to the mounted ledger without consuming native navigation', async () => {
  await render();
  await click();
  expect(receive).toHaveBeenCalledExactlyOnceWith({
    source: 'home',
    focus: 'workspace-add',
  });
  expect(prevented).toHaveBeenCalledExactlyOnceWith(false);
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    '/household/expenses?create=home',
  );
});
it('ignores modified, prevented, alternate-target and non-primary activation', async () => {
  await render();
  for (const options of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])
    await click(options);
  host.querySelector('a')!.target = '_blank';
  await click();
  host.querySelector('a')!.target = '';
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  event.preventDefault();
  await act(async () => host.querySelector('a')!.dispatchEvent(event));
  expect(receive).not.toHaveBeenCalled();
});
it('drops the old receiver on visit/account change and ledger removal', async () => {
  await render();
  const first = handoff;
  await render('next', false);
  expect(handoff).not.toBe(first);
  await click();
  expect(receive).not.toHaveBeenCalled();
  await render('next');
  await click();
  expect(receive).toHaveBeenCalledTimes(1);
  await render('next', false, { ...scope, id: 'another-account' });
  await click();
  expect(receive).toHaveBeenCalledTimes(1);
  await render('next');
  live = false;
  await click();
  expect(receive).toHaveBeenCalledTimes(1);
});
it('does not let delayed cleanup remove a newer ledger registration', async () => {
  await render('first', false);
  const oldReceiver = vi.fn(),
    newReceiver = vi.fn();
  const cleanup = handoff!.register({}, oldReceiver);
  const cleanupNew = handoff!.register({}, newReceiver);
  cleanup();
  await click();
  expect(oldReceiver).not.toHaveBeenCalled();
  expect(newReceiver).toHaveBeenCalledExactlyOnceWith({
    source: 'home',
    focus: 'workspace-add',
  });
  cleanupNew();
  await click();
  expect(newReceiver).toHaveBeenCalledTimes(1);
});
