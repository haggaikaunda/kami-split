import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

test.use({ hasTouch: true });

const snapshot = (locator) =>
  locator.evaluate((element) => ({
    tag: element.tagName,
    ui: element.dataset.ui,
    id: element.id,
    active: document.activeElement === element,
    visible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outline,
    style: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth,
  }));
const noRing = async (locator) =>
  expect.poll(async () => (await snapshot(locator)).style).toBe('none');
const ring = async (locator) => {
  await expect(locator).toBeFocused();
  await expect.poll(async () => (await snapshot(locator)).style).toBe('solid');
  await expect.poll(async () => (await snapshot(locator)).width).toBe('3px');
};

for (const workspace of [
  { name: 'Household', path: '/household/expenses', appearance: 'DARK' },
  { name: 'Group', path: '/groups/F?tab=expenses', appearance: 'LIGHT' },
  { name: 'Trip', path: '/trips/T?tab=expenses', appearance: 'SYSTEM' },
]) {
  test(`focus presentation: ${workspace.name} pointer, keyboard and unknown-origin activation`, async ({
    page,
    app,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    app.setAppearance(workspace.appearance);
    await app.authenticate();
    await page.goto(workspace.path);
    const activate = (locator) =>
      page.viewportSize().width < 600 ? locator.tap() : locator.click();
    const row = page.locator('#ledger-expense-e1');
    await expect(row).toBeVisible();
    const filters = page.getByRole('button', { name: 'Filters', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Expense filters' });
    const close = dialog.getByRole('button', { name: 'Back to expenses' });
    await activate(filters);
    await expect(close).toBeFocused();
    await noRing(close);
    const pointerEntry = await snapshot(close);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveCount(1);
    await ring(focused);
    await page.keyboard.press('Escape');
    await ring(filters);

    // A browser like Safari may leave focus on the section after a tap.
    // An explicit opener must beat that captured activeElement.
    await page.locator('[data-ui~="expense-ledger"]').focus();
    await activate(filters);
    await activate(close);
    await expect(filters).toBeFocused();
    await noRing(filters);

    // A click without its own pointer sequence cannot inherit old pointer intent.
    await filters.evaluate((element) => element.click());
    await expect(dialog).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-focus-input',
      'pointer',
    );
    await page.keyboard.press('Shift+Tab');
    await ring(dialog.getByRole('button', { name: 'Apply filters' }));
    await page.keyboard.press('Tab');
    await ring(close);
    await page.keyboard.press('Escape');
    await ring(filters);

    const pending = app.hold('journeyExpenseQuery');
    await activate(row);
    const heading = page.getByRole('heading', {
      name: 'Expense detail',
      exact: true,
    });
    await expect(heading).toBeFocused();
    await noRing(heading);
    await pending.started;
    const loadingDetail = await snapshot(heading);
    await pending.release();
    await expect(
      page.getByText('Private fixture note', { exact: true }),
    ).toBeVisible();
    await expect(heading).toBeFocused();
    await noRing(heading);
    await activate(
      page.getByRole('button', { name: 'Close expense', exact: true }),
    );
    await expect(row).toBeFocused();
    await noRing(row);
    const pointerReturn = await snapshot(row);

    await row.focus();
    await page.keyboard.press('Enter');
    await ring(heading);
    await page.keyboard.press('Escape');
    await ring(row);
    // Pointer selection removes the extra focus rectangle while retaining selection.
    await activate(filters);
    await dialog.locator('summary').filter({ hasText: 'Categories' }).click();
    await dialog.getByLabel('Groceries', { exact: true }).check();
    await activate(dialog.getByRole('button', { name: 'Apply filters' }));
    await expect(page).toHaveURL(/categories=GROCERIES/);
    const remountedFilters = page.locator('[data-ui~="ledger-filter-button"]');
    await expect(remountedFilters).toBeFocused();
    await noRing(remountedFilters);
    await expect(row).toBeVisible();

    const balances = page
      .locator('[data-ui~="workspace-tabs"]')
      .getByRole('link', { name: 'Balances', exact: true });
    await activate(balances);
    await expect(balances).toHaveAttribute('aria-current', 'page');
    await expect(
      page.locator(
        workspace.name === 'Household'
          ? '[data-ui~="household-balances"]'
          : '[data-ui~="group-balances"]',
      ),
    ).toBeVisible();
    await noRing(balances);
    await balances.focus();
    // Respect Safari's platform setting for which controls participate in Tab.
    await page.keyboard.press('ArrowRight');
    await ring(balances);
    await testInfo.attach('focus-observations', {
      body: JSON.stringify(
        { workspace, pointerEntry, loadingDetail, pointerReturn },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

test('focus restoration: empty fresh return uses Filters and newer intent beats a held reread', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  const row = page.locator('#ledger-expense-e1');
  await expect(row).toBeVisible();
  await row.tap();
  await expect(
    page.getByText('Private fixture note', { exact: true }),
  ).toBeVisible();
  const empty = responseFor('expensesGroupQuery', { after: null });
  empty.groupExpenses = {
    ...empty.groupExpenses,
    id: 'ExpenseView:empty-return',
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null },
    expenseCount: '0',
  };
  let emptyReturn = true;
  const pending = app.holdMatching(
    'expensesGroupQuery',
    (variables) => emptyReturn && variables.after == null,
    empty,
  );
  await page.getByRole('button', { name: 'Close expense', exact: true }).tap();
  await pending.started;
  await pending.release();
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await expect(filters).toBeFocused();
  await noRing(filters);
  await expect(
    page.getByText('No expenses yet.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-ui~="expense-ledger"]')).not.toBeFocused();
  emptyReturn = false;

  await page.goto('/trips/T?tab=expenses');
  await expect(row).toBeVisible();
  await row.tap();
  await expect(
    page.getByText('Private fixture note', { exact: true }),
  ).toBeVisible();
  const held = app.holdMatching(
    'expensesGroupQuery',
    (variables) => variables.after == null,
    responseFor('expensesGroupQuery', { after: null }),
  );
  await page.keyboard.press('Escape');
  await held.started;
  // Newer filter intent keeps its focus and scroll, even after the old read completes.
  await filters.tap();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  const close = dialog.getByRole('button', { name: 'Back to expenses' });
  await expect(close).toBeFocused();
  const scroll = await page.evaluate(() => scrollY);
  await held.release();
  await expect(row).toBeAttached();
  await expect(close).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await close.tap();
  await expect(filters).toBeFocused();
  await page.waitForTimeout(100);
  await expect(filters).toBeFocused();
});

test('focus presentation: enlarged short filters preserve text-entry and forced-color indicators @owns-viewport', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await filters.tap();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  await dialog.locator('summary').filter({ hasText: 'Dates' }).tap();
  const date = dialog.locator('input[type="date"]').first();
  await date.tap();
  await expect(date).toBeFocused();
  // Date controls retain the engine's native focus heuristic; text-entry
  // indicators are checked on the actual description input below.
  await page.keyboard.press('Escape');
  // Escape may first dismiss the browser's native date picker.
  if (await dialog.count()) await page.keyboard.press('Escape');
  await expect(filters).toBeFocused();
  await page.getByRole('link', { name: 'Add expense', exact: true }).tap();
  const description = page.locator('#expense-description');
  await expect(description).toBeVisible();
  await description.tap();
  await ring(description);
  await page.keyboard.press('Escape');
  await expect(description).toHaveCount(0);
  // Complete the fresh authorized return before the next overlay and teardown.
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.emulateMedia({ forcedColors: 'active' });
  await filters.tap();
  const close = dialog.getByRole('button', { name: 'Back to expenses' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await ring(page.locator(':focus'));
});
