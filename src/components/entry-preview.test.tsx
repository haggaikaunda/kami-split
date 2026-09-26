// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AppDataProvider } from './data-provider';
import { EntryPreview, SetupRequired } from './entry-preview';
import { createMockData } from '@/lib/data/mock';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => ({
    refreshVersion: 0,
    drafts: {},
    discardDraft: vi.fn(),
  }),
}));
vi.mock('next/link', () => ({ default: 'a' }));
let root: Root;
let source: ReturnType<typeof createMockData>;
async function click(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === name,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function input(value: string) {
  const el = document.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  push.mockReset();
  source = createMockData();
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () =>
    root.render(
      <AppDataProvider source={source}>
        <EntryPreview />
      </AppDataProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
it('focuses invalid email, clears transient email after request, and routes only after adapter entry', async () => {
  await click('Preview sign-in link');
  expect(document.activeElement).toBe(document.querySelector('input'));
  expect(document.body.textContent).toContain('Enter a valid email');
  await input('alex@example.test');
  await click('Preview sign-in link');
  expect(document.querySelector('input')).toBeNull();
  expect(push).not.toHaveBeenCalled();
  expect(await source.port.read('household-demo')).toEqual({
    status: 'denied',
  });
  await click('Open preview link');
  expect(push).toHaveBeenCalledWith('/household');
  expect((await source.port.read('household-demo')).status).toBe('ok');
});
it('hands first-time entry to a real setup-required destination with a safe return', async () => {
  await act(async () =>
    source.port.entry.dispatch({
      kind: 'scenario',
      scenario: 'first-household',
    }),
  );
  await input('new@example.test');
  await click('Preview sign-in link');
  await click('Open preview link');
  expect(push).toHaveBeenCalledWith('/household/setup');
  await act(async () => root.render(<SetupRequired />));
  expect(document.body.textContent).toContain('No household has been created');
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/sign-in');
});
it('explains wrong-account recovery before invitation acceptance', async () => {
  await act(async () =>
    source.port.entry.dispatch({ kind: 'scenario', scenario: 'wrong-account' }),
  );
  await input('wrong@example.test');
  await click('Preview sign-in link');
  await click('Open preview link');
  expect(document.body.textContent).toContain('different preview identity');
  expect(push).not.toHaveBeenCalled();
  await click('Switch to invited preview identity');
  await click('Accept invitation');
  expect(push).toHaveBeenCalledWith('/household');
  const read = await source.port.read('household-demo');
  expect(read.status === 'ok' && read.value.actorId).toBe('member-invited');
});
