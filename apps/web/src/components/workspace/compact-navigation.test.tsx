// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceTabs } from './patterns';

vi.mock('next/link', () => ({
  default: 'a',
  useLinkStatus: () => ({ pending: false }),
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (current: 'Overview' | 'Activity' | 'Members') =>
  act(() =>
    root.render(
      <WorkspaceTabs
        current={current}
        hrefFor={(section) => `/trips/T?tab=${section.toLowerCase()}`}
      />,
    ),
  );
it('exposes native Activity and Members routes through keyboard More, with Escape and outside dismissal', () => {
  render('Overview');
  expect(
    [...host.querySelectorAll('a')].map((link) => link.textContent),
  ).toEqual(['Overview', 'Expenses', 'Balances']);
  const trigger = host.querySelector('button')!;
  act(() => trigger.click());
  const links = [...host.querySelectorAll('a')];
  expect(links.slice(-2).map((link) => link.getAttribute('href'))).toEqual([
    '/trips/T?tab=activity',
    '/trips/T?tab=members',
  ]);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  act(() => links[3].focus());
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  act(() => trigger.click());
  act(() =>
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
  );
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('reflects overflow selection and closes abandoned menus on a committed destination', () => {
  render('Activity');
  expect(host.querySelector('button')?.textContent).toContain(
    'More · Activity',
  );
  act(() => host.querySelector('button')!.click());
  expect(
    host.querySelector('a[aria-current="page"]')?.getAttribute('href'),
  ).toBe('/trips/T?tab=activity');
  render('Members');
  expect(host.querySelector('button')?.textContent).toContain('More · Members');
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe(
    'false',
  );
  act(() => host.querySelector('button')!.click());
  expect(
    host.querySelector('a[aria-current="page"]')?.getAttribute('href'),
  ).toBe('/trips/T?tab=members');
});
