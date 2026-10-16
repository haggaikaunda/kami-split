import { test, expect } from './fixtures.mjs';

const forbidden =
  '[data-ui~="workspace-navigation"],[data-ui~="workspace-header"],[data-ui~="workspace-tabs"],[data-ui~="account-heading"]';
async function signedOut(page) {
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.locator(forbidden)).toHaveCount(0);
  await expect(page.getByText('Private fixture note')).toHaveCount(0);
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
}

for (const workspace of [
  { name: 'Group', base: '/groups/F', operation: 'journeyWorkspaceQuery' },
  { name: 'Trip', base: '/trips/T', operation: 'journeyWorkspaceQuery' },
  {
    name: 'Household',
    base: '/household',
    operation: 'householdWorkspaceQuery',
  },
]) {
  test(`${workspace.name} tabs: intent is request-free, recent revisits reuse data, and expired reads enforce denial`, async ({
    page,
    app,
  }) => {
    await app.authenticate();
    const now = Date.now();
    await page.clock.setFixedTime(now);
    await page.goto(`${workspace.base}?tab=overview`);
    const tabs = page.locator('[data-ui~="workspace-tabs"]');
    const overview = tabs.getByRole('link', { name: 'Overview', exact: true });
    const balances = tabs.getByRole('link', { name: 'Balances', exact: true });
    const privateBalances = page.locator(
      workspace.name === 'Household'
        ? '[data-ui~="household-balances"]'
        : '[data-ui~="group-balances"]',
    );
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Add expense', exact: true }),
    ).toBeVisible();
    await expect(overview).toHaveAttribute('aria-current', 'page');
    const beforeIntent = app.requests.length;
    const sections = [
      'Overview',
      'Expenses',
      'Balances',
      'Activity',
      'Members',
    ];
    for (const section of sections) {
      const tab = tabs.getByRole('link', { name: section, exact: true });
      const href =
        workspace.name === 'Household' &&
        ['Expenses', 'Activity'].includes(section)
          ? `/household/${section.toLowerCase()}`
          : `${workspace.base}?tab=${section.toLowerCase()}`;
      await expect(tab).toHaveAttribute('href', href);
      await tab.hover();
    }
    // Observe long enough for an asynchronous intent request to reach transport.
    await page.waitForTimeout(250);
    expect(app.requests).toHaveLength(beforeIntent);
    await overview.focus();
    for (const section of sections) {
      await expect(
        tabs.getByRole('link', { name: section, exact: true }),
      ).toBeFocused();
      if (section !== 'Members') await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(250);
    expect(app.requests).toHaveLength(beforeIntent);

    const reads = () =>
      app.requests.filter(
        (request) => request.operation === workspace.operation,
      ).length;
    const beforeActivation = reads();
    const fresh = app.hold(workspace.operation);
    await balances.focus();
    await page.keyboard.press('Enter');
    await fresh.started;
    expect(reads()).toBe(beforeActivation + 1);
    await expect(privateBalances).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({
        hasText:
          workspace.name === 'Household'
            ? 'Loading Household…'
            : 'Loading workspace…',
      }),
    ).toBeVisible();
    await fresh.release();
    await expect(privateBalances).toBeVisible();
    await expect(balances).toHaveAttribute('aria-current', 'page');
    await expect(overview).not.toHaveAttribute('aria-current', 'page');

    const beforeRevisit = reads();
    await overview.click();
    await expect(page).toHaveURL(`${workspace.base}?tab=overview`);
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    await balances.click();
    await expect(page).toHaveURL(`${workspace.base}?tab=balances`);
    await expect(privateBalances).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${workspace.base}?tab=overview`);
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`${workspace.base}?tab=balances`);
    await expect(privateBalances).toBeVisible();
    await page.waitForTimeout(250);
    expect(reads()).toBe(beforeRevisit);

    await overview.click();
    await expect(page).toHaveURL(`${workspace.base}?tab=overview`);
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    // Advancing consumption time expires retained data without timers or polling.
    await page.clock.setFixedTime(now + 30_001);
    expect(reads()).toBe(beforeRevisit);
    const denied = app.hold(
      workspace.operation,
      workspace.name === 'Household'
        ? { householdDashboard: { __typename: 'Problem', code: 'FORBIDDEN' } }
        : {
            viewer: { __typename: 'Viewer', today: '2026-10-05' },
            group: {
              __typename: 'Problem',
              code: 'FORBIDDEN',
              message: 'Access denied',
            },
          },
    );
    await balances.click();
    await expect(page).toHaveURL(`${workspace.base}?tab=balances`);
    await denied.started;
    expect(reads()).toBe(beforeRevisit + 1);
    await expect(privateBalances).toHaveCount(0);
    await denied.release();
    await expect(
      page
        .getByText(
          'Financial access is unavailable. Reload to check current access.',
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(privateBalances).toHaveCount(0);
    await expect(page.getByText('Brian owes you', { exact: true })).toHaveCount(
      0,
    );
  });

  test(`${workspace.name} foreground refresh reads again within the freshness window`, async ({
    page,
    app,
  }) => {
    await app.authenticate();
    await page.clock.setFixedTime(Date.now());
    await page.goto(`${workspace.base}?tab=balances`);
    const privateBalances = page.locator(
      workspace.name === 'Household'
        ? '[data-ui~="household-balances"]'
        : '[data-ui~="group-balances"]',
    );
    await expect(privateBalances).toBeVisible();
    const reads = () =>
      app.requests.filter(
        (request) => request.operation === workspace.operation,
      ).length;
    const before = reads();
    const refreshed = app.hold(workspace.operation);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshed.started;
    expect(reads()).toBe(before + 1);
    await expect(privateBalances).toHaveCount(0);
    await refreshed.release();
    await expect(privateBalances).toBeVisible();
  });
}

test('workspace tab modified clicks keep the current route and open the real destination', async ({
  page,
  context,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=overview');
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  const balances = page
    .locator('[data-ui~="workspace-tabs"]')
    .getByRole('link', { name: 'Balances', exact: true });
  const opened = context.waitForEvent('page');
  await balances.click({ modifiers: ['ControlOrMeta'] });
  const destination = await opened;
  await expect(destination).toHaveURL(/\/trips\/T\?tab=balances$/);
  await expect(
    destination.locator('[data-ui~="group-balances"]'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/trips\/T\?tab=overview$/);
  await destination.close();
});

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
      /workspace-header|workspace-tabs|Private synthetic person/,
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
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
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

test('Household Expenses and Activity reuse initial reads through repeat and Back/Forward navigation', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.clock.setFixedTime(Date.now());
  await page.goto('/household/expenses');
  const row = page.locator('#ledger-expense-e1');
  const empty = page.getByText('No activity yet.', { exact: true });
  const tabs = page.locator('[data-ui~="workspace-tabs"]');
  await expect(row).toBeVisible();
  await tabs.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL('/household/activity');
  await expect(empty).toBeVisible();
  const operations = [
    'expensesHouseholdInitialQuery',
    'activityHouseholdQuery',
  ];
  const counts = () =>
    operations.map(
      (operation) =>
        app.requests.filter((request) => request.operation === operation)
          .length,
    );
  const firstVisits = counts();
  expect(firstVisits).toEqual([1, 1]);
  await tabs.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page).toHaveURL('/household/expenses');
  await expect(row).toBeVisible();
  await tabs.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL('/household/activity');
  await expect(empty).toBeVisible();
  await page.goBack();
  await expect(row).toBeVisible();
  await page.goForward();
  await expect(empty).toBeVisible();
  await page.waitForTimeout(250);
  expect(counts()).toEqual(firstVisits);
});
