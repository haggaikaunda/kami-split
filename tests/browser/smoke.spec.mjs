import { test, expect } from './fixtures.mjs';

const forbidden =
  '.workspace-navigation,.ui-workspace-header,.ui-workspace-tabs,.account-heading';
async function signedOut(page) {
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.locator(forbidden)).toHaveCount(0);
  await expect(page.getByText('Private fixture note')).toHaveCount(0);
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
}

test('auth boundary: cold denial, safe continuation and logout history', async ({
  page,
  request,
  app,
}) => {
  for (const headers of [{}, { RSC: '1' }]) {
    const response = await request.get('/account', {
      headers,
      maxRedirects: 0,
    });
    expect([303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toContain('/sign-in?');
    expect(await response.text()).not.toMatch(
      /ui-workspace-header|ui-workspace-tabs|Private synthetic person/,
    );
  }
  await page.goto('/account');
  await signedOut(page);
  await app.signIn(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Private synthetic person',
  );
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Private synthetic person',
  );
  // Add a protected history entry: sign-in/logout correctly replace their entries.
  await page.goto('/groups');
  await expect(
    page.getByText('Signed in as Private synthetic person'),
  ).toBeVisible();
  await page.goto('/account');
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out of this session' }).click();
  await signedOut(page);
  await page.goBack();
  await signedOut(page);
  await page.reload();
  await signedOut(page);
  await page.goto('/sign-in?next=https%3A%2F%2Fevil.test%2F');
  await app.signIn(page);
  await expect(page).toHaveURL(/\/groups$/);
  await expect(
    page.getByText('Signed in as Private synthetic person'),
  ).toBeVisible();
});

test('expense navigation: filtered multi-page detail and creation restore fresh rows and focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Expense filters' });
  await filters.locator('summary').filter({ hasText: 'Categories' }).click();
  await filters.getByLabel('Groceries', { exact: true }).check();
  await filters.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/categories=GROCERIES/);
  const source = page.url();
  await page.locator('.ledger-pagination').scrollIntoViewIfNeeded();
  const row = page.locator('#ledger-expense-e8');
  await expect(row).toBeVisible();
  expect(app.requests.some((r) => r.variables.after)).toBe(true);
  expect(
    app.requests.some((r) =>
      r.variables.filter?.categories?.includes('GROCERIES'),
    ),
  ).toBe(true);
  await row.focus();
  const top = await row.evaluate((el) => el.getBoundingClientRect().top);
  async function returnToRows(action) {
    const before = app.requests.filter(
      (r) => r.operation === 'expensesGroupQuery' && !r.variables.after,
    ).length;
    await action();
    await expect(page).toHaveURL(source);
    await expect(row).toBeVisible();
    await expect
      .poll(
        () =>
          app.requests.filter(
            (r) => r.operation === 'expensesGroupQuery' && !r.variables.after,
          ).length,
      )
      .toBeGreaterThan(before);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('Private fixture note')).toBeVisible();
  await returnToRows(() => page.goBack());
  await expect(row).toBeFocused();
  await expect
    .poll(async () =>
      Math.abs(
        (await row.evaluate((el) => el.getBoundingClientRect().top)) - top,
      ),
    )
    .toBeLessThan(3);
  await page.goForward();
  await expect(page.getByText('Private fixture note')).toBeVisible();
  await returnToRows(() => page.keyboard.press('Escape'));
  await expect(row).toBeFocused();
  const add = page.getByRole('link', { name: 'Add expense', exact: true });
  await add.click();
  await expect(page.locator('#expense-description')).toBeVisible();
  await returnToRows(() =>
    page.getByRole('button', { name: 'Cancel', exact: true }).click(),
  );
  await expect(add).toBeFocused();
});

test('account lifecycle: a held private response cannot restore rows after sign-out', async ({
  page,
  context,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  const account = await context.newPage();
  await account.goto('/account');
  await expect(account.getByLabel('Display name', { exact: true })).toHaveValue(
    'Private synthetic person',
  );
  const pending = app.hold('expensesGroupQuery');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Expense filters' });
  await filters.locator('summary').filter({ hasText: 'Categories' }).click();
  await filters.getByLabel('Groceries', { exact: true }).check();
  await filters.getByRole('button', { name: 'Apply filters' }).click();
  await pending.started;
  await account
    .getByRole('button', { name: 'Sign out of this session' })
    .click();
  await signedOut(account);
  await signedOut(page);
  await pending.release();
  await signedOut(page);
  await page.goBack();
  await page.reload();
  await signedOut(page);
});
