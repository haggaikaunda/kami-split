import { createRequire } from 'node:module';
import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

const axePath = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
).resolve('axe-core/axe.min.js');

for (const workspace of [
  { name: 'Group', path: '/groups/F', privateName: 'Friends' },
  {
    name: 'Trip',
    path: '/trips/T',
    privateName: 'Maui 2026 with a very long friendly space name',
  },
]) {
  for (const width of [320, 390]) {
    test(`${workspace.name} enlarged header geometry at ${width}px stays stable during a protected read`, async ({
      page,
      app,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await app.authenticate();
      await page.goto(`${workspace.path}?tab=overview`);
      await expect(
        page.getByRole('heading', { name: 'Recent expenses', exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const tabs = page.locator('[data-ui~="workspace-tabs"]');
      const balances = tabs.getByRole('link', {
        name: 'Balances',
        exact: true,
      });
      await balances.scrollIntoViewIfNeeded();
      const geometry = () =>
        page.evaluate(() => {
          const box = (selector) => {
            const element = [...document.querySelectorAll(selector)].find(
              (element) => element.getClientRects().length > 0,
            );
            if (!element) return null;
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, top: y + scrollY, width, height };
          };
          return {
            header: box('[data-ui~="workspace-header"]'),
            tabs: box('[data-ui~="workspace-tabs"]'),
            font: getComputedStyle(document.documentElement).fontSize,
            scrollY,
          };
        });
      const ready = await geometry();
      const reads = () =>
        app.requests.filter(
          (request) => request.operation === 'journeyWorkspaceQuery',
        ).length;
      const initialReads = reads();
      await page.screenshot({
        path: testInfo.outputPath('ready-200pct.png'),
        fullPage: true,
      });
      const response = app.hold('journeyWorkspaceQuery', undefined, {
        status: 503,
      });
      await balances.click();
      await response.started;
      await expect(
        page.getByText('Loading balances…', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(workspace.privateName, { exact: true }),
      ).toHaveCount(0);
      const pending = await geometry();
      await page.screenshot({
        path: testInfo.outputPath('pending-200pct.png'),
        fullPage: true,
      });
      expect(ready.font).toBe('32px');
      expect(pending.font).toBe('32px');
      expect
        .soft(pending.header.height, 'Pending header preserves ready height')
        .toBeCloseTo(ready.header.height, 0);
      expect
        .soft(pending.tabs.top, 'Pending tabs preserve document position')
        .toBeCloseTo(ready.tabs.top, 0);
      await response.release();
      const retryButton = page.getByRole('button', {
        name: 'Try again',
        exact: true,
      });
      await expect(retryButton).toBeVisible();
      const failure = await geometry();
      expect
        .soft(failure.tabs.top, 'Error keeps tabs at their ready position')
        .toBeCloseTo(ready.tabs.top, 0);
      await expect(
        page.getByText(workspace.privateName, { exact: true }),
      ).toHaveCount(0);
      const retry = app.hold('journeyWorkspaceQuery');
      await retryButton.click();
      await retry.started;
      await expect(
        page.getByText('Loading balances…', { exact: true }),
      ).toBeVisible();
      const retryPending = await geometry();
      expect
        .soft(retryPending.header.height, 'Retry preserves ready header height')
        .toBeCloseTo(ready.header.height, 0);
      expect
        .soft(retryPending.tabs.top, 'Retry keeps tabs at their ready position')
        .toBeCloseTo(ready.tabs.top, 0);
      await expect(
        page.getByText(workspace.privateName, { exact: true }),
      ).toHaveCount(0);
      expect(reads()).toBe(initialReads + 2);
      await retry.release();
      await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
      const completed = await geometry();
      expect
        .soft(
          completed.tabs.top,
          'Ready content restores the same tab position',
        )
        .toBeCloseTo(ready.tabs.top, 0);
      expect(reads()).toBe(initialReads + 2);
      await testInfo.attach('header-geometry', {
        body: JSON.stringify(
          {
            workspace: workspace.name,
            width,
            ready,
            pending,
            failure,
            retryPending,
            completed,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    });
  }
}

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
    await tabs.getByRole('button', { name: 'More', exact: true }).click();
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
      if (section !== 'Members') {
        await page.keyboard.press('Tab');
        if (section === 'Balances') {
          await expect(
            tabs.getByRole('button', { name: 'More', exact: true }),
          ).toBeFocused();
          await page.keyboard.press('Tab');
        }
      }
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
        hasText: 'Loading balances…',
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
  await tabs.getByRole('button', { name: /^More/ }).click();
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
  await tabs.getByRole('button', { name: /^More/ }).click();
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

test('loading handoff: route cue, one slow content status, failure and one explicit retry preserve navigation and focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const routeStarted = Promise.withResolvers();
  const routeReleased = Promise.withResolvers();
  let heldRoute = false;
  await page.route('**/groups/F?*', async (route) => {
    if (
      !heldRoute &&
      new URL(route.request().url()).searchParams.get('tab') === 'balances' &&
      route.request().headers().rsc === '1'
    ) {
      heldRoute = true;
      routeStarted.resolve();
      await routeReleased.promise;
    }
    await route.fallback();
  });
  try {
    await page.goto('/groups/F?tab=overview');
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    const tabs = page.locator('[data-ui~="workspace-tabs"]');
    const balances = tabs.getByRole('link', { name: 'Balances', exact: true });
    const before = await balances.boundingBox();
    const reads = () =>
      app.requests.filter((r) => r.operation === 'journeyWorkspaceQuery')
        .length;
    const baseline = reads();
    const pending = app.hold('journeyWorkspaceQuery', undefined, {
      status: 503,
    });
    await balances.focus();
    await page.keyboard.press('Enter');
    await routeStarted.promise;
    const cue = balances.locator('[data-ui="workspace-navigation-pending"]');
    await expect(cue).toHaveAttribute('data-pending', 'true');
    await expect(cue.locator('span')).not.toHaveCount(0);
    await expect(
      tabs.getByRole('link', { name: 'Overview', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-ui="screen-loading"]')).toHaveCount(0);
    expect(await balances.boundingBox()).toEqual(before);
    routeReleased.resolve();
    await pending.started;
    const loading = page.locator('[data-ui="content-loading"]:visible');
    await expect(loading).toHaveAttribute('data-layout', 'balances');
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading balances…' }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(1);
    await expect(
      page.locator('[data-ui="workspace-navigation-pending"][data-pending]'),
    ).toHaveCount(0);
    await expect(loading.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(
      loading.locator('[aria-busy="true"] [role="status"]'),
    ).toHaveCount(0);
    await expect(balances).toBeFocused();
    await expect(balances).toHaveAttribute('aria-current', 'page');
    expect(await balances.boundingBox()).toEqual(before);
    await expect(page.locator('[data-ui~="group-balances"]')).toHaveCount(0);
    await expect(
      page.getByText('Still loading balances…', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    expect(reads()).toBe(baseline + 1);
    await pending.release();
    await expect(loading).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Try again', exact: true }),
    ).toBeVisible();
    const retry = app.hold('journeyWorkspaceQuery');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await retry.started;
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading balances…' }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(1);
    expect(reads()).toBe(baseline + 2);
    await expect(
      page.getByText('Still loading balances…', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    expect(reads()).toBe(baseline + 2);
    await retry.release();
    await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
    await expect(loading).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(reads()).toBe(baseline + 2);
  } finally {
    routeReleased.resolve();
  }
});

test('rapid destinations: the latest balance view survives an older expense reply and navigation away', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=overview');
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  const tabs = page.locator('[data-ui~="workspace-tabs"]');
  const readyTabBounds = await tabs.boundingBox();
  const expenses = app.hold('journeyWorkspaceQuery');
  await tabs.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expenses.started;
  await expect(
    page.locator('[data-ui="content-loading"]:visible'),
  ).toHaveAttribute('data-layout', 'expenses');
  expect(await tabs.boundingBox()).toEqual(readyTabBounds);
  const balances = app.hold('journeyWorkspaceQuery');
  await tabs.getByRole('link', { name: 'Balances', exact: true }).click();
  await balances.started;
  await expect(
    page.locator('[data-ui="content-loading"]:visible'),
  ).toHaveAttribute('data-layout', 'balances');
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading balances…' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(
    page.locator('[data-ui="workspace-navigation-pending"][data-pending]'),
  ).toHaveCount(0);
  await balances.release();
  await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
  await expenses.release();
  await expect(page).toHaveURL('/trips/T?tab=balances');
  await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
  await expect(page.locator('[data-ui="content-loading"]:visible')).toHaveCount(
    0,
  );
  const abandoned = app.hold('expensesHouseholdInitialQuery');
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  await page
    .locator('[data-ui~="workspace-tabs"]')
    .getByRole('link', { name: 'Expenses', exact: true })
    .click();
  await abandoned.started;
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await abandoned.release();
  await expect(page).toHaveURL(/\/account(?:\?|$)/);
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(page.locator('[data-ui="content-loading"]:visible')).toHaveCount(
    0,
  );
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
});

test('loading layout: reduced motion, both themes, narrow screens and doubled text keep content below reachable tabs', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  const pending = app.hold('expensesHouseholdInitialQuery');
  await page.goto('/household/expenses');
  await pending.started;
  const loading = page.locator('[data-ui="content-loading"]:visible');
  await expect(
    page.getByText('Loading expenses…', { exact: true }),
  ).toBeVisible();
  await expect(loading).toHaveAttribute('data-layout', 'expenses');
  await page.addScriptTag({ path: axePath });
  expect(
    await loading.evaluate(async (element) =>
      (await globalThis.axe.run(element)).violations.map(
        ({ id, description, nodes }) => ({
          id,
          description,
          targets: nodes.map(({ target }) => target),
        }),
      ),
    ),
  ).toEqual([]);
  for (const width of [320, 390, 1280]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.fontSize = '200%';
      }, theme);
      await page.waitForTimeout(100);
      const geometry = await loading.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const tabs = document
          .querySelector('[data-ui~="workspace-tabs"]')
          .getBoundingClientRect();
        const shapes = [
          ...element.querySelectorAll(
            '[aria-hidden="true"], [aria-hidden="true"] *',
          ),
        ];
        return {
          top: rect.top,
          bottomOfTabs: tabs.bottom,
          left: rect.left,
          right: rect.right,
          viewport: innerWidth,
          rootText: getComputedStyle(document.documentElement).fontSize,
          overflow: document.documentElement.scrollWidth - innerWidth,
          animations: shapes.map(
            (shape) => getComputedStyle(shape).animationName,
          ),
        };
      });
      expect(geometry.rootText).toBe('32px');
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.bottomOfTabs);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.animations.every((name) => name === 'none')).toBe(true);
      await expect(page.getByRole('status')).toHaveCount(1);
      await expect(page.locator('[data-ui="screen-loading"]')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`loading-${width}-${theme}-200pct.png`),
        fullPage: true,
      });
    }
  }
  await pending.release();
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test('fresh navigation: warm destination reads display without visible loading feedback', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/groups/F?tab=overview');
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  const tabs = page.locator('[data-ui~="workspace-tabs"]');
  const overview = tabs.getByRole('link', { name: 'Overview', exact: true });
  const balances = tabs.getByRole('link', { name: 'Balances', exact: true });
  await balances.click();
  await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
  const before = app.requests.length;
  await page.evaluate(() => {
    globalThis.loadingFrames = [];
    globalThis.watchLoading = true;
    const frame = () => {
      for (const surface of document.querySelectorAll(
        '[data-ui="content-loading"], [data-ui="workspace-navigation-pending"]',
      )) {
        if (
          !surface.getBoundingClientRect().height ||
          !surface.getBoundingClientRect().width
        )
          continue;
        if (
          surface.textContent.trim() ||
          [...surface.querySelectorAll('[data-ui="skeleton"], span')].some(
            (shape) => shape.getBoundingClientRect().height > 0,
          )
        )
          globalThis.loadingFrames.push(surface.textContent);
      }
      if (globalThis.watchLoading) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await overview.click();
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  await balances.click();
  await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
  await page.waitForTimeout(200);
  const flashes = await page.evaluate(() => {
    globalThis.watchLoading = false;
    return globalThis.loadingFrames;
  });
  expect(flashes).toEqual([]);
  expect(app.requests).toHaveLength(before);
});

test('rapid route destinations: abandoned link feedback clears before its late route response', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const started = Promise.withResolvers();
  const released = Promise.withResolvers();
  let held = false;
  await page.route('**/groups/F?*', async (route) => {
    if (
      !held &&
      new URL(route.request().url()).searchParams.get('tab') === 'expenses' &&
      route.request().headers().rsc === '1'
    ) {
      held = true;
      started.resolve();
      await released.promise;
    }
    await route.fallback();
  });
  try {
    await page.goto('/groups/F?tab=overview');
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    const tabs = page.locator('[data-ui~="workspace-tabs"]');
    const expenseLink = tabs.getByRole('link', {
      name: 'Expenses',
      exact: true,
    });
    const balanceLink = tabs.getByRole('link', {
      name: 'Balances',
      exact: true,
    });
    await expenseLink.click();
    await started.promise;
    await expect(
      expenseLink.locator('[data-ui="workspace-navigation-pending"]'),
    ).toHaveAttribute('data-pending', 'true');
    const balances = app.hold('journeyWorkspaceQuery');
    await balanceLink.click();
    await balances.started;
    await expect(
      page.getByText('Loading balances…', { exact: true }),
    ).toBeVisible();
    await expect(
      expenseLink.locator('[data-ui="workspace-navigation-pending"]'),
    ).not.toHaveAttribute('data-pending', 'true');
    await expect(balanceLink).toHaveAttribute('aria-current', 'page');
    released.resolve();
    await balances.release();
    await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page).toHaveURL('/groups/F?tab=balances');
    expect(
      app.requests.filter(
        (request) =>
          request.operation === 'journeyWorkspaceQuery' &&
          request.variables.ledger,
      ),
    ).toEqual([]);
    await expect(
      page.locator('[data-ui="workspace-navigation-pending"][data-pending]'),
    ).toHaveCount(0);
  } finally {
    released.resolve();
  }
});

test('account resolution: the slow opening screen stays public and accessible at enlarged mobile and desktop sizes', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  const started = Promise.withResolvers();
  const released = Promise.withResolvers();
  await page.route('**/auth/v1/user', async (route) => {
    started.resolve();
    await released.promise;
    await route.fallback();
  });
  try {
    await page.goto('/account');
    await started.promise;
    const screen = page.locator('[data-ui="screen-loading"]');
    await expect(
      page.getByRole('heading', { name: 'Getting things ready', exact: true }),
    ).toBeVisible();
    await expect(page.locator(forbidden)).toHaveCount(0);
    await expect(page.getByText('Private synthetic person')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Account content' }),
    ).toHaveAttribute('aria-busy', 'true');
    await page.addScriptTag({ path: axePath });
    expect(
      await screen.evaluate(async (element) =>
        (await globalThis.axe.run(element)).violations.map(({ id }) => id),
      ),
    ).toEqual([]);
    for (const width of [320, 390, 1280]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.fontSize = '200%';
        }, theme);
        const layout = await screen.evaluate((element) => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          animation: [
            ...element.querySelectorAll('[aria-hidden="true"] span'),
          ].map((dot) => getComputedStyle(dot).animationName),
        }));
        expect(layout.overflow).toBeLessThanOrEqual(1);
        expect(layout.animation.every((name) => name === 'none')).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`opening-${width}-${theme}-200pct.png`),
          fullPage: true,
        });
      }
    }
    await expect(
      page.getByRole('heading', {
        name: 'Still getting things ready',
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(forbidden)).toHaveCount(0);
    released.resolve();
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
      'Private synthetic person',
    );
    await expect(screen).toHaveCount(0);
  } finally {
    released.resolve();
  }
});

const directory = (page) => page.locator('[data-ui="discovery-cards"]');
const typeFilter = (page) =>
  page.getByRole('navigation', { name: 'Group type' });

test('unified directory retains legacy trip filters and canonical source return with keyboard focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips?filter=past');
  await expect(page).toHaveURL('/groups?filter=past&kind=trips');
  await expect(page.getByText('No trips match this filter.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Trip date filter' })
    .getByRole('link', { name: 'All', exact: true })
    .click();
  const trip = directory(page).getByRole('link');
  await expect(trip).toContainText('3 active members');
  await expect(trip).toContainText('Total spend · USD$3.00');
  await expect(trip).toContainText('Your balance · USD$84.20');
  await trip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/trips\/T\?source=/);
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-ui~="summary-row"]').first()).toContainText(
    'Total spend$3.00',
  );
  if (page.viewportSize().width <= 600) await page.goBack();
  else
    await page
      .getByRole('link', { name: 'Back to source', exact: true })
      .click();
  await expect(trip).toBeFocused();
  await expect(
    typeFilter(page).getByRole('link', { name: 'Trips', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await typeFilter(page)
    .getByRole('link', { name: 'All', exact: true })
    .click();
  await expect(directory(page).getByRole('link')).toHaveCount(2);
  await typeFilter(page)
    .getByRole('link', { name: 'Groups', exact: true })
    .click();
  await expect(directory(page).getByRole('link')).toHaveCount(1);
  await page.goBack();
  await expect(directory(page).getByRole('link')).toHaveCount(2);
  await page.goForward();
  await expect(directory(page).getByRole('link')).toHaveCount(1);
});

test('directory unavailable aggregates remain unavailable and foreground denial removes cards', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'Problem',
    code: 'UNAVAILABLE',
  };
  data.groupDirectory.entries[1].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '0',
    viewerNetMinor: '0',
  };
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups');
  await expect(directory(page).getByRole('link').first()).toContainText(
    'Unavailable',
  );
  await expect(directory(page).getByRole('link').last()).toContainText(
    'Nothing for you to pay or collect',
  );
  const denied = app.hold('journeyViewerQuery', {
    ...data,
    groupDirectory: { __typename: 'Problem', code: 'NOT_FOUND' },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await denied.started;
  await expect(directory(page)).toHaveCount(0);
  await denied.release();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Financial access is unavailable' }),
  ).toBeVisible();
  await expect(directory(page)).toHaveCount(0);
});

test('authorized create choices preserve directory selection and return focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.viewer.canCreateGroups = true;
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups?kind=trips');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Create a shared space');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  void app.hold('journeyViewerQuery', data).release();
  await dialog.getByRole('link', { name: 'Create trip', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create trip', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Destination (optional)', { exact: true }),
  ).toBeVisible();
  void app.hold('journeyViewerQuery', data).release();
  await page
    .getByRole('link', { name: 'Inspect your trips', exact: true })
    .click();
  await expect(
    typeFilter(page).getByRole('link', { name: 'Trips', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeFocused();
});

test('directory cards contain long exact amounts across responsive themes and enlarged text', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '9223372036854775807',
    viewerNetMinor: '-9007199254740993',
  };
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups');
  await expect(directory(page)).toBeVisible();
  for (const width of [320, 390, 440, 1280])
    for (const theme of ['light', 'dark', 'system'])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({
          colorScheme: theme === 'system' ? 'dark' : theme,
          reducedMotion: 'reduce',
        });
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme =
              theme === 'system'
                ? matchMedia('(prefers-color-scheme: dark)').matches
                  ? 'dark'
                  : 'light'
                : theme;
            document.documentElement.style.fontSize = `${scale * 100}%`;
          },
          { theme, scale },
        );
        const geometry = await directory(page).evaluate((element) => ({
          doc: document.documentElement.scrollWidth,
          viewport: innerWidth,
          cards: [...element.querySelectorAll('a')].map((card) => {
            const name = card.querySelector('strong');
            const metadata = name.parentElement.lastElementChild;
            const splitWords = [];
            for (const text of [name, metadata]) {
              const nodes = document.createTreeWalker(
                text,
                NodeFilter.SHOW_TEXT,
              );
              let node;
              while ((node = nodes.nextNode())) {
                for (const word of node.textContent.matchAll(/[A-Za-z0-9]+/g)) {
                  const range = document.createRange();
                  range.setStart(node, word.index);
                  range.setEnd(node, word.index + word[0].length);
                  if (range.getClientRects().length > 1)
                    splitWords.push(word[0]);
                }
              }
            }
            return {
              width: card.clientWidth,
              scroll: card.scrollWidth,
              name: name.textContent,
              nameLines: Math.round(
                name.getBoundingClientRect().height /
                  Number.parseFloat(getComputedStyle(name).lineHeight),
              ),
              splitWords,
            };
          }),
        }));
        expect(geometry.doc).toBeLessThanOrEqual(width + 1);
        expect(
          geometry.cards.every((card) => card.scroll <= card.width + 1),
        ).toBe(true);
        expect(
          geometry.cards.flatMap((card) => card.splitWords),
          'Natural-language names and active-member labels keep their words intact',
        ).toEqual([]);
        expect(
          geometry.cards.find((card) => card.name === 'Friends').nameLines,
        ).toBe(1);
        expect(geometry.cards[0].nameLines).toBeLessThanOrEqual(8);
        await expect(directory(page).getByRole('link').first()).toContainText(
          '$92,233,720,368,547,758.07',
        );
        if (scale === 2 && theme === 'dark')
          await page.screenshot({
            path: testInfo.outputPath(`directory-${width}-dark-200pct.png`),
            fullPage: true,
          });
      }
});

test('fresh directory reads reflect expense corrections and repayment-only balance changes', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/groups?kind=groups');
  const group = directory(page).getByRole('link');
  await expect(group).toContainText('Total spend · USD$3.00');
  const corrected = responseFor('journeyViewerQuery', {});
  corrected.groupDirectory.entries[1].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '975',
    viewerNetMinor: '-450',
  };
  const expense = app.hold('journeyViewerQuery', corrected);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expense.started;
  await expense.release();
  await expect(group).toContainText('Total spend · USD$9.75');
  await expect(group).toContainText('Your balance · USD-$4.50');
  const repaid = structuredClone(corrected);
  repaid.groupDirectory.entries[1].financialSummary.viewerNetMinor = '0';
  const repayment = app.hold('journeyViewerQuery', repaid);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await repayment.started;
  await repayment.release();
  await expect(group).toContainText('Total spend · USD$9.75');
  await expect(group).toContainText('Nothing for you to pay or collect');
});

const tabsFor = (page) => page.locator('[data-ui~="workspace-tabs"]');
const profileFor = (page) =>
  page.getByRole('link', { name: 'Profile', exact: true });

test('compact shell keeps native More destinations and keyboard dismissal without financial intent reads', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=overview');
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  const tabs = tabsFor(page);
  const more = tabs.getByRole('button', { name: /^More/ });
  await expect(
    page.locator('[data-ui~="workspace-navigation"] a[href="/groups"]'),
  ).toHaveAttribute('aria-current', 'page');
  const before = app.requests.length;
  await more.focus();
  await page.keyboard.press('ArrowDown');
  const activity = tabs.getByRole('link', { name: 'Activity', exact: true });
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute('href', '/trips/T?tab=activity');
  await activity.hover();
  await page.waitForTimeout(200);
  expect(app.requests).toHaveLength(before);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await page.locator('[data-ui~="workspace-brand"]').click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await tabs.getByRole('link', { name: 'Members', exact: true }).click();
  await expect(page).toHaveURL('/trips/T?tab=members');
  await expect(more).toHaveText(/More · Members/);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(
    tabs.getByRole('link', { name: 'Members', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
});

test('Profile returns a filtered late-page ledger with its loaded extent, scroll and avatar focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto(
    '/trips/T?tab=expenses&categories=GROCERIES&sort=AMOUNT_DESC',
  );
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
  await expect(page.locator('#ledger-expense-e8')).toBeVisible();
  const source = page.url();
  const profile = profileFor(page);
  await profile.focus();
  const scroll = await page.evaluate(() => scrollY);
  const firstReads = app.requests.filter(
    (r) => r.operation === 'journeyWorkspaceQuery',
  ).length;
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(profileFor(page)).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('[data-ui~="workspace-navigation-links"] [aria-current]'),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Email address', { exact: true }),
  ).toHaveAttribute('readonly', '');
  expect(
    app.requests.filter((r) => r.operation === 'journeyWorkspaceQuery'),
  ).toHaveLength(firstReads);
  await page.getByRole('link', { name: 'Back to source', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp('categories=GROCERIES.*sort=AMOUNT_DESC'),
  );
  await expect(page.locator('#ledger-expense-e8')).toBeAttached();
  await expect(profileFor(page)).toBeFocused();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => scrollY)) - scroll))
    .toBeLessThan(4);
  expect(new URL(page.url()).pathname).toBe(new URL(source).pathname);
  expect(
    app.requests.some(
      (r) => r.operation === 'expensesGroupQuery' && r.variables.after,
    ),
  ).toBe(true);
  await profileFor(page).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('#ledger-expense-e8')).toBeAttached();
  await expect(profileFor(page)).toBeFocused();
});

test('global Add expense requires an explicit eligible source and cancel restores Profile', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/account');
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Back to Groups', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Add expense', exact: true }).click();
  const source = page.getByRole('combobox', {
    name: 'Source space',
    exact: true,
  });
  await expect(source).toHaveValue('');
  await expect(page.locator('#expense-description')).toHaveCount(0);
  await source.selectOption('H');
  await expect(page.locator('#expense-description')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/account(?:\?|$)/);
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add expense', exact: true }),
  ).toBeFocused();
});

test('no eligible expense source and failed group discovery leave Profile usable', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const empty = responseFor('expensesHouseholdInitialQuery', {});
  empty.householdDashboard.spaces = [];
  empty.householdDashboard.totals.activeSpaceCount = '0';
  empty.householdExpenses.edges = [];
  const request = app.hold('expensesHouseholdInitialQuery', empty);
  await page.goto('/household/expenses?create=choose');
  await request.started;
  await request.release();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No eligible source spaces' }),
  ).toBeVisible();
  await expect(page.locator('#expense-description')).toHaveCount(0);
  const afterClose = app.hold('expensesHouseholdQuery', {
    householdExpenses: empty.householdExpenses,
  });
  await page
    .getByRole('button', { name: 'Close expense', exact: true })
    .click();
  await afterClose.started;
  await afterClose.release();
  const failure = app.hold('journeyViewerQuery', undefined, { status: 503 });
  await page.getByRole('link', { name: 'Groups', exact: true }).click();
  await failure.started;
  await failure.release();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await profileFor(page).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Household', exact: true }),
  ).toBeVisible();
});

test('compact identity and navigation remain readable across responsive themes and doubled text', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  // Select the real preference so foreground reads cannot reset a nominal Dark
  // capture to the fixture's default Light. System also exercises the provider.
  for (const theme of ['light', 'dark', 'system']) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/account');
    const choice = page.getByRole('radio', {
      name: theme[0].toUpperCase() + theme.slice(1),
      exact: true,
    });
    await expect(choice).toBeVisible();
    if (!(await choice.isChecked())) {
      await page
        .locator('[data-ui~="appearance-choice"]')
        .filter({ has: choice })
        .click();
      await expect(
        page.getByText('Appearance saved for your account.', { exact: true }),
      ).toBeVisible();
    }
    await page.goto('/trips/T?tab=overview');
    await expect(
      page.getByRole('heading', { name: 'Recent expenses', exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 440, 1440]) {
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        const resolvedTheme = theme === 'system' ? 'dark' : theme;
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          resolvedTheme,
        );
        expect(
          await page
            .locator('body')
            .evaluate((element) => getComputedStyle(element).colorScheme),
        ).toBe(resolvedTheme);
        const header = page.locator('[data-ui~="workspace-navigation-brand"]');
        const title = header.getByRole('heading', {
          name: 'Maui 2026 with a very long friendly space name',
          exact: true,
        });
        await expect(title).toBeVisible();
        const bounds = await header.boundingBox();
        expect(bounds.height).toBeLessThan(420);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        const add = page.getByRole('link', {
          name: 'Add expense',
          exact: true,
        });
        await expect(add).toBeInViewport();
        await tabsFor(page)
          .getByRole('link', { name: 'Balances', exact: true })
          .focus();
        await expect(
          tabsFor(page).getByRole('link', { name: 'Balances', exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`shell-${width}-${scale}-${theme}.png`),
        });
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          resolvedTheme,
        );
      }
    }
  }
});

test('Profile return reauthorizes an expired source and cannot restore denied private rows', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const now = Date.now();
  await page.clock.setFixedTime(now);
  await page.goto(
    '/trips/T?tab=expenses&categories=GROCERIES&sort=AMOUNT_DESC',
  );
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await profileFor(page).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(now + 30_001);
  const denied = app.hold('journeyWorkspaceQuery', {
    viewer: { __typename: 'Viewer', today: '2026-10-05' },
    group: {
      __typename: 'Problem',
      code: 'FORBIDDEN',
      message: 'Access denied',
    },
  });
  await page.getByRole('link', { name: 'Back to source', exact: true }).click();
  await denied.started;
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      name: 'Maui 2026 with a very long friendly space name',
      exact: true,
    }),
  ).toHaveCount(0);
  await denied.release();
  await expect(
    page
      .getByText(
        'Financial access is unavailable. Reload to check current access.',
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
  await expect(page.getByText('Private lunch 1', { exact: true })).toHaveCount(
    0,
  );
});

test('expense Escape consumes a fresh first page before completing the restored traversal', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
  const origin = page.locator('#ledger-expense-e8');
  await expect(origin).toBeVisible();
  await origin.click();
  await expect(
    page.getByText('Private fixture note', { exact: true }),
  ).toBeVisible();
  const updated = responseFor('expensesGroupQuery', { after: null });
  updated.groupExpenses.id = 'ExpenseView:independent-post-detail';
  updated.groupExpenses.pageInfo.endCursor = 'fresh-e6';
  updated.groupExpenses.edges[0].node = {
    ...updated.groupExpenses.edges[0].node,
    id: 'ExpenseSnapshot:e1:2',
    version: '2',
    description: 'Fresh expense after detail return',
  };
  const fresh = app.hold('expensesGroupQuery', updated);
  const returnRequests = app.requests.length;
  await page.keyboard.press('Escape');
  await fresh.started;
  // Let an obsolete continuation expose premature restoration while the fresh
  // first page is held. Its changed data and cursor must still be consumed.
  await page.waitForTimeout(300);
  const prematureFocus = await page.evaluate(
    () => document.activeElement?.id === 'ledger-expense-e8',
  );
  await fresh.release();
  await expect(page.locator('#ledger-expense-e1')).toContainText(
    'Fresh expense after detail return',
  );
  expect(prematureFocus, 'Restored focus waits for the fresh traversal').toBe(
    false,
  );
  expect(
    app.requests
      .slice(returnRequests)
      .some(
        (request) =>
          request.operation === 'expensesGroupQuery' &&
          request.variables.after === 'fresh-e6',
      ),
    'Continuation uses the new first-page anchor',
  ).toBe(true);
  await expect(origin).toBeAttached();
  await expect(origin).toBeFocused();
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(9);
});
