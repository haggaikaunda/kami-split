// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseLedger, type LedgerSpace } from './ledger';
import type { FinancialScope } from '@/lib/relay/environment';

const navigation = vi.hoisted(() => ({
  params: '',
  path: '/household/expenses',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.params),
  usePathname: () => navigation.path,
  useRouter: () => navigation,
}));
vi.mock('relay-runtime', () => ({
  readInlineData: (_: unknown, value: unknown) => value,
  fetchQuery: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }),
}));
const spaces: LedgerSpace[] = ['Household', 'Maui'].map((name, index) => ({
  name,
  groupId: `space-${index}`,
  viewerMembership: { id: `member-${index}-0` },
  members: [
    {
      id: `member-${index}-0`,
      displayName: 'Alex with a very long duplicate display name',
      canParticipate: true,
    },
    {
      id: `member-${index}-1`,
      displayName: index ? 'Jordan' : 'Sam',
      canParticipate: false,
    },
  ],
}));
let root: Root, host: HTMLDivElement;
const scope = {
  id: 'filter-actor',
  environment: {},
  isLive: () => true,
} as FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  navigation.params = '';
  navigation.path = '/household/expenses';
  scope.expensePositions = new Map();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function mount(groupId = '') {
  await act(async () =>
    root.render(
      <ExpenseLedger
        scope={scope}
        groupId={groupId}
        spaces={groupId ? spaces.filter((s) => s.groupId === groupId) : spaces}
        today="2024-03-01"
        onDenied={vi.fn()}
      />,
    ),
  );
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-ui~="ledger-filter-button"]',
  )!;
  trigger.focus();
  await act(async () => trigger.click());
  return trigger;
}
function field<T extends HTMLInputElement | HTMLSelectElement>(name: string) {
  return host.querySelector<T>(`[name="${name}"]`)!;
}
function checkbox(name: string, value: string) {
  return host.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${value}"]`,
  )!;
}
function disclosure(name: string) {
  return [...host.querySelectorAll('details')].find((element) =>
    element.querySelector('summary')?.textContent?.startsWith(name),
  )!;
}
async function clickButton(name: string) {
  const button = [
    ...host.querySelectorAll<HTMLButtonElement>('dialog button'),
  ].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent) === name,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function setValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
function applied() {
  expect(navigation.push).toHaveBeenCalledTimes(1);
  return new URL(navigation.push.mock.calls[0][0], 'https://example.test')
    .searchParams;
}

it('submits combined repeated and legacy selections even after their sections close', async () => {
  navigation.params =
    'view=breakdown&basis=share&groupId=space-1&category=DINING&categories=GROCERIES&memberId=member-0-0&memberIds=member-1-0&paidByIds=member-0-1&paidByIds=member-1-1&from=2023-12-31&to=2024-03-01&sort=AMOUNT_ASC';
  await mount();
  for (const name of ['Categories', 'Paid by', 'Involving', 'Dates']) {
    expect(disclosure(name)).toBeTruthy();
    expect(disclosure(name).open).toBe(false);
  }
  expect(checkbox('categories', 'DINING').checked).toBe(true);
  expect(checkbox('categories', 'GROCERIES').checked).toBe(true);
  expect(
    disclosure('Categories').querySelector('summary')?.textContent,
  ).toContain('2 selected');
  expect(disclosure('Paid by').querySelector('summary')?.textContent).toContain(
    '2 selected',
  );
  expect(
    disclosure('Involving').querySelector('summary')?.textContent,
  ).toContain('2 selected');
  const categories = disclosure('Categories');
  await act(async () => {
    categories.open = true;
  });
  await act(async () => checkbox('categories', 'HOME').click());
  await act(async () => {
    categories.open = false;
  });
  expect(checkbox('categories', 'HOME').checked).toBe(true);
  expect(categories.querySelector('summary')?.textContent).toContain(
    '3 selected',
  );
  expect(navigation.push).not.toHaveBeenCalled();
  await clickButton('Apply filters');
  const params = applied();
  expect(params.getAll('categories').sort()).toEqual([
    'DINING',
    'GROCERIES',
    'HOME',
  ]);
  expect(params.getAll('memberIds').sort()).toEqual([
    'member-0-0',
    'member-1-0',
  ]);
  expect(params.getAll('paidByIds').sort()).toEqual([
    'member-0-1',
    'member-1-1',
  ]);
  expect(Object.fromEntries(params)).toMatchObject({
    groupId: 'space-1',
    from: '2023-12-31',
    to: '2024-03-01',
    sort: 'AMOUNT_ASC',
    view: 'breakdown',
    basis: 'share',
  });
  expect(params.has('category')).toBe(false);
  expect(params.has('memberId')).toBe(false);
  expect(host.querySelector('dialog')).toBeNull();
});

it('discards Reset and subsequent edits on Escape and restores applied selections and trigger focus', async () => {
  navigation.params =
    'categories=DINING&memberIds=member-1-0&from=2024-02-01&sort=DATE_ASC';
  const trigger = await mount();
  await clickButton('Reset filters');
  expect(checkbox('categories', 'DINING').checked).toBe(false);
  expect(field<HTMLInputElement>('from').value).toBe('');
  expect(
    disclosure('Categories').querySelector('summary')?.textContent,
  ).toContain('All categories');
  expect(disclosure('Dates').querySelector('summary')?.textContent).toContain(
    'All dates',
  );
  await act(async () => checkbox('categories', 'HOME').click());
  await act(async () =>
    host
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(navigation.push).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  expect(checkbox('categories', 'DINING').checked).toBe(true);
  expect(checkbox('categories', 'HOME').checked).toBe(false);
  expect(checkbox('memberIds', 'member-1-0').checked).toBe(true);
  expect(field<HTMLInputElement>('from').value).toBe('2024-02-01');
  expect(field<HTMLSelectElement>('sort').value).toBe('DATE_ASC');
});

it('applies Reset only on submission while preserving view and fixed group scope', async () => {
  navigation.path = '/groups/space-0';
  navigation.params =
    'tab=expenses&view=breakdown&groupId=space-1&categories=DINING&paidByIds=member-0-0&memberIds=member-0-1&from=2024-02-01&to=2024-02-29&sort=AMOUNT_DESC';
  await mount('space-0');
  expect(field('groupId')).toBeNull();
  await clickButton('Reset filters');
  expect(host.querySelectorAll('input:checked')).toHaveLength(0);
  expect(field<HTMLInputElement>('from').value).toBe('');
  expect(field<HTMLInputElement>('to').value).toBe('');
  expect(field<HTMLSelectElement>('sort').value).toBe('DATE_DESC');
  expect(navigation.push).not.toHaveBeenCalled();
  await clickButton('Apply filters');
  expect([...applied().entries()]).toEqual([
    ['tab', 'expenses'],
    ['view', 'breakdown'],
  ]);
});

it.each([
  ['today', '2024-03-01', '2024-03-01'],
  ['last7', '2024-02-24', '2024-03-01'],
  ['month', '2024-03-01', '2024-03-01'],
  ['previousMonth', '2024-02-01', '2024-02-29'],
  ['all', '', ''],
])(
  'uses the server calendar for %s and submits the visible inclusive bounds',
  async (preset, from, to) => {
    navigation.params = 'from=2020-01-01&to=2020-12-31';
    await mount();
    const select = [...host.querySelectorAll('select')].find((element) =>
      element.querySelector('option[value="last7"]'),
    )!;
    await setValue(select, preset);
    expect(field<HTMLInputElement>('from').value).toBe(from);
    expect(field<HTMLInputElement>('to').value).toBe(to);
    expect(navigation.push).not.toHaveBeenCalled();
    await clickButton('Apply filters');
    expect(applied().get('from')).toBe(from || null);
    expect(applied().get('to')).toBe(to || null);
  },
);

it.each(['DATE_DESC', 'DATE_ASC', 'AMOUNT_DESC', 'AMOUNT_ASC'])(
  'preserves %s ordering together with a custom one-sided date',
  async (sort) => {
    await mount();
    await setValue(field<HTMLSelectElement>('sort'), sort);
    await setValue(field<HTMLInputElement>('from'), '2024-02-29');
    await clickButton('Apply filters');
    expect(applied().get('sort')).toBe(sort === 'DATE_DESC' ? null : sort);
    expect(applied().get('from')).toBe('2024-02-29');
    expect(applied().get('to')).toBeNull();
  },
);

it('distinguishes identical member names using labeled source groups without repeating the source in each label', async () => {
  await mount();
  for (const key of ['paidByIds', 'memberIds']) {
    for (const space of spaces) {
      const member = space.members[0];
      const input = checkbox(key, member.id);
      expect(input.labels?.[0].textContent).toBe(member.displayName);
      expect(
        input.closest('fieldset')?.querySelector('legend')?.textContent,
      ).toBe(space.name);
      await act(async () => input.click());
    }
  }
  const involvingGroup = checkbox('memberIds', 'member-0-0').closest(
    'fieldset',
  )!;
  const description = document.getElementById(
    involvingGroup.getAttribute('aria-describedby')!,
  );
  expect(description?.textContent).toContain(
    'Payer or participant, including zero shares.',
  );
  await clickButton('Apply filters');
  expect(applied().getAll('paidByIds').sort()).toEqual([
    'member-0-0',
    'member-1-0',
  ]);
  expect(applied().getAll('memberIds').sort()).toEqual([
    'member-0-0',
    'member-1-0',
  ]);
});

it('switches a preset back to custom when editing dates and preserves the other endpoint', async () => {
  await mount();
  const select = [...host.querySelectorAll('select')].find((element) =>
    element.querySelector('option[value="last7"]'),
  )!;
  await setValue(select, 'previousMonth');
  await setValue(field<HTMLInputElement>('to'), '2024-02-20');
  expect(select.value).toBe('custom');
  expect(field<HTMLInputElement>('from').value).toBe('2024-02-01');
  await clickButton('Apply filters');
  expect(applied().get('from')).toBe('2024-02-01');
  expect(applied().get('to')).toBe('2024-02-20');
});
