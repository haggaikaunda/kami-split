import { expect, it, vi } from 'vitest';
import Page from './page';
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(href);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: navigation.redirect }));
vi.mock('@/components/groups/household-workspace', () => ({
  HouseholdWorkspace: () => null,
}));
it('canonicalizes the legacy Expenses tab while preserving filters and stable detail source identity', async () => {
  await expect(
    Page({
      searchParams: Promise.resolve({
        tab: 'expenses',
        groupId: 'home',
        category: 'DINING',
        memberId: 'payer',
        from: '2026-09-01',
        to: '2026-09-30',
        expense: 'record 1',
        expenseGroup: 'trip 1',
      }),
    }),
  ).rejects.toThrow();
  const href = navigation.redirect.mock.calls.at(-1)![0];
  const url = new URL(href, 'https://example.test');
  expect(url.pathname).toBe('/household/expenses');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    groupId: 'home',
    category: 'DINING',
    memberId: 'payer',
    from: '2026-09-01',
    to: '2026-09-30',
    expense: 'record 1',
    expenseGroup: 'trip 1',
  });
});
it('preserves the real create-flow origin while canonicalizing Expenses', async () => {
  await expect(
    Page({
      searchParams: Promise.resolve({ tab: 'expenses', create: 'home' }),
    }),
  ).rejects.toThrow('/household/expenses?create=home');
});
it('keeps the ordinary Household workspace route for overview, balances and members', async () => {
  for (const tab of ['overview', 'balances', 'members']) {
    navigation.redirect.mockClear();
    await Page({ searchParams: Promise.resolve({ tab }) });
    expect(navigation.redirect).not.toHaveBeenCalled();
  }
});
