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
  const empty = structuredClone(
    responseFor('expensesHouseholdInitialQuery', {}),
  );
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

async function expectAlignedIdentity(page, title, helpLabel) {
  const header = page.locator('[data-ui~="workspace-navigation-brand"]');
  const brand = header.getByText('Kami Grow', { exact: true });
  const leaf = header.locator('[data-ui~="workspace-brand"] [data-ui~="icon"]');
  const destination = header.getByText(title, { exact: true });
  const avatar = header.getByRole('link', { name: 'Profile', exact: true });
  const [brandBox, leafBox, destinationBox, avatarBox] = await Promise.all(
    [brand, leaf, destination, avatar].map((item) => item.boundingBox()),
  );
  expect(Math.abs(brandBox.x - destinationBox.x)).toBeLessThanOrEqual(1);
  expect(leafBox.x + leafBox.width).toBeLessThan(brandBox.x);
  expect(destinationBox.x + destinationBox.width).toBeLessThan(avatarBox.x);
  if (helpLabel) {
    const helpBox = await header
      .getByRole('button', { name: helpLabel, exact: true })
      .boundingBox();
    expect(Math.abs(brandBox.x - helpBox.x)).toBeLessThanOrEqual(1);
  }
}

test('shared header aligns Household help and every destination with unavailable artwork', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.route('**/art/*.png', (route) => route.abort());
  for (const destination of [
    { path: '/household', title: 'Household', help: 'What’s included' },
    { path: '/groups/F?tab=overview', title: 'Friends' },
    { path: '/groups', title: 'Groups' },
    { path: '/account', title: 'Profile' },
  ]) {
    await page.goto(destination.path);
    const header = page.locator('[data-ui~="workspace-navigation-brand"]');
    await expect(
      header.getByText(destination.title, { exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 440, 1440]) {
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        await expectAlignedIdentity(page, destination.title, destination.help);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(1);
        if (scale === 1)
          expect((await header.boundingBox()).height).toBeLessThan(110);
      }
    }
    if (destination.help) {
      const help = header.getByRole('button', {
        name: destination.help,
        exact: true,
      });
      await help.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(help).toBeFocused();
    }
  }
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
        await expectAlignedIdentity(
          page,
          'Maui 2026 with a very long friendly space name',
        );
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
  const filter = app.requests.find(
    (request) =>
      request.operation === 'journeyWorkspaceQuery' && request.variables.ledger,
  ).variables.filter;
  const fresh = app.holdMatching(
    'expensesGroupQuery',
    (variables) =>
      variables.groupId === 'T' &&
      variables.after == null &&
      JSON.stringify(variables.filter) === JSON.stringify(filter),
    updated,
  );
  const returnRequests = app.requests.length;
  await page.keyboard.press('Escape');
  await fresh.started;
  // Every replacement first page stays pending; canceled generations need not
  // apply, but completed restoration cannot use the previous server anchor.
  await page.waitForTimeout(300);
  const prematureFocus = await page.evaluate(
    () => document.activeElement?.id === 'ledger-expense-e8',
  );
  const prematureContinuation = app.requests
    .slice(returnRequests)
    .some(
      (request) =>
        request.operation === 'expensesGroupQuery' && request.variables.after,
    );
  await fresh.release();
  await expect(page.locator('#ledger-expense-e1')).toContainText(
    'Fresh expense after detail return',
  );
  expect(prematureFocus, 'Restored focus waits for the fresh traversal').toBe(
    false,
  );
  expect(
    prematureContinuation,
    'Replay waits for the fresh first-page anchor',
  ).toBe(false);
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

test('expense Escape cannot restore private rows when the current first page is denied', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips/T?tab=expenses');
  await expect(page.locator('#ledger-expense-e1')).toBeVisible();
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
  await page.locator('#ledger-expense-e8').click();
  await expect(
    page.getByText('Private fixture note', { exact: true }),
  ).toBeVisible();
  const filter = app.requests.find(
    (request) =>
      request.operation === 'journeyWorkspaceQuery' && request.variables.ledger,
  ).variables.filter;
  const denied = app.holdMatching(
    'expensesGroupQuery',
    (variables) =>
      variables.groupId === 'T' &&
      variables.after == null &&
      JSON.stringify(variables.filter) === JSON.stringify(filter),
    { groupExpenses: { __typename: 'Problem', code: 'FORBIDDEN' } },
  );
  const returnRequests = app.requests.length;
  await page.keyboard.press('Escape');
  await denied.started;
  await page.waitForTimeout(300);
  const prematureContinuation = app.requests
    .slice(returnRequests)
    .some(
      (request) =>
        request.operation === 'expensesGroupQuery' && request.variables.after,
    );
  denied.release();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Account verification is unavailable.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'retry account access', exact: true }),
  ).toHaveAttribute('href', '/trips/T?tab=expenses');
  await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
  await expect(
    page.getByText('Private fixture note', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      name: 'Maui 2026 with a very long friendly space name',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    prematureContinuation,
    'A denied first page cannot authorize replay',
  ).toBe(false);
});

function sourceDashboard() {
  const dashboard = structuredClone(
    responseFor('householdWorkspaceQuery', {}).householdDashboard,
  );
  const home = dashboard.spaces[0];
  const trip = structuredClone(
    responseFor('journeyWorkspaceQuery', { id: 'T' }).group,
  );
  const [viewer, other, third] = trip.members;
  dashboard.totals.viewerNetMinor = '0';
  dashboard.totals.openBalanceCount = '2';
  dashboard.totals.activeSpaceCount = '14';
  dashboard.spaces.push({
    ...home,
    ...trip,
    groupId: 'T',
    viewerNetMinor: '-8420',
    balances: {
      __typename: 'GroupBalances',
      settled: false,
      obligations: [{ from: viewer, to: other, amountMinor: '8420' }],
    },
  });
  dashboard.spaces.push(
    ...Array.from({ length: 12 }, (_, i) => ({
      ...home,
      groupId: `source-${i}`,
      name: `Shared source ${i} with a long readable name`,
      isHousehold: false,
      viewerNetMinor: '0',
      balances: {
        __typename: 'GroupBalances',
        settled: false,
        obligations: [
          { from: other, to: third, amountMinor: '9007199254740993' },
        ],
      },
    })),
  );
  // HouseholdDashboardSpace has no Node id. Extra Group fixture IDs would alias
  // separate sources in Relay, unlike a real response to this wire operation.
  for (const space of dashboard.spaces) {
    delete space.id;
    delete space.__typename;
  }
  return { householdDashboard: dashboard };
}

test('Household balances: independent compact sources, both repayment directions and exact return focus', async ({
  page,
  app,
}) => {
  const fixture = sourceDashboard();
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    fixture,
  );
  response.release();
  await app.authenticate();
  await page.goto('/household?tab=balances');
  const sources = page.locator(
    '[data-ui~="household-balances"] > li > details',
  );
  await expect(sources).toHaveCount(14);
  await expect(sources.locator(':scope[open]')).toHaveCount(0);
  await expect(page.locator('[data-ui~="signed-balance"]')).toContainText(
    'Payments still to settle',
  );
  const last = sources.last().locator('summary').first();
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-expanded', 'true');
  await expect(last).toContainText('Other members still owe each other');
  await expect(sources.first()).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-expanded', 'false');

  for (const direction of [
    {
      source: 'H',
      sender: 'M1',
      recipient: 'M0',
      path: /\/household\/ledger/,
      name: 'Home',
    },
    {
      source: 'T',
      sender: 'M0',
      recipient: 'M1',
      path: /\/trips\/T\/repayments\/new/,
      name: 'Maui 2026',
    },
  ]) {
    const summary = page.locator(
      `#balance-section-household-${direction.source}`,
    );
    await summary.focus();
    await page.keyboard.press('Enter');
    const id = `repay-${direction.source}-${direction.sender}-${direction.recipient}`;
    const row = page.locator(`#${id}`);
    await expect(row).toBeVisible();
    await expect(row.locator('a, button, [tabindex="0"]')).toHaveCount(0);
    await row.focus();
    const beforeScroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(direction.path);
    await expect(
      page.getByRole('heading', { name: /Record repayment/ }),
    ).toBeVisible();
    await expect(page.getByLabel('Sender', { exact: true })).toHaveValue(
      direction.sender,
    );
    await expect(page.getByLabel('Recipient', { exact: true })).toHaveValue(
      direction.recipient,
    );
    await expect(page.getByLabel('Amount (USD)', { exact: true })).toHaveValue(
      '84.20',
    );
    await expect(page.getByLabel('Transfer to record')).toContainText(
      direction.name,
    );
    await page
      .getByRole('link', { name: 'Back to source', exact: true })
      .click();
    await expect(page).toHaveURL(/\/household\?tab=balances&restore=/);
    await expect(page.locator(`#${id}`)).toBeFocused();
    await expect(
      page.locator(`#balance-section-household-${direction.source}`),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      Math.abs((await page.evaluate(() => scrollY)) - beforeScroll),
    ).toBeLessThan(4);
  }
  await expect(
    sources.filter({ has: page.locator('summary[aria-expanded="true"]') }),
  ).toHaveCount(2);
});

test('Group balances: another recorder, overpayment, duplicate activation and fresh authorized history', async ({
  page,
  app,
}) => {
  const fixture = structuredClone(
    responseFor('journeyWorkspaceQuery', { id: 'T' }),
  );
  const group = fixture.group;
  const [viewer, other, third] = group.members;
  group.balances.obligations = [
    { from: other, to: third, amountMinor: '8420' },
  ];
  const reads = app.holdMatching('journeyWorkspaceQuery', () => true, fixture);
  reads.release();
  let submissions = 0;
  await page.route('**/api/graphql', async (route) => {
    const { query, variables } = route.request().postDataJSON();
    if (!query.includes('mutation journeyRepaymentMutation'))
      return route.fallback();
    submissions++;
    const input = variables.input;
    expect(input).toMatchObject({
      groupId: 'T',
      senderId: other.id,
      recipientId: third.id,
      amountMinor: '10000',
      note: 'Actual transfer receipt',
    });
    expect(input.senderId).not.toBe(viewer.id);
    group.balances.obligations = [
      { from: third, to: other, amountMinor: '1580' },
    ];
    group.repayments.edges = [
      {
        node: {
          id: 'repayment-test',
          groupId: 'T',
          amountMinor: '10000',
          effectiveDate: input.effectiveDate,
          note: input.note,
          sender: other,
          recipient: third,
        },
      },
    ];
    await route.fulfill({
      json: {
        data: {
          recordRepayment: {
            __typename: 'RepaymentCommitted',
            key: input.key,
            record: {
              repaymentId: 'repayment-test',
              groupId: 'T',
              senderMembershipId: input.senderId,
              recipientMembershipId: input.recipientId,
              amountMinor: input.amountMinor,
              currency: 'USD',
              effectiveDate: input.effectiveDate,
              note: input.note,
            },
          },
        },
      },
    });
  });
  await app.authenticate();
  await page.goto('/trips/T?tab=balances');
  await page.locator('#repay-T-M1-M2').click();
  await expect(page.getByLabel('Amount (USD)', { exact: true })).toHaveValue(
    '84.20',
  );
  await page.getByLabel('Amount (USD)', { exact: true }).fill('100.00');
  await page
    .getByLabel('Optional note', { exact: true })
    .fill('Actual transfer receipt');
  await expect(page.getByLabel('Transfer to record')).toContainText(
    'Brian paid Casey · $100.00 USD',
  );
  const readCount = app.requests.filter(
    (request) => request.operation === 'journeyWorkspaceQuery',
  ).length;
  await page
    .getByRole('button', { name: 'Record repayment', exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole('heading', {
      name: 'Recent recorded repayments',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Actual transfer receipt', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('#repay-T-M2-M1')).toContainText('$15.80');
  expect(submissions).toBe(1);
  expect(
    app.requests.filter(
      (request) => request.operation === 'journeyWorkspaceQuery',
    ).length,
  ).toBeGreaterThan(readCount);
  expect(group.balances.totalExpenseMinor).toBe('300');
  await page
    .getByRole('link', { name: 'Record an actual transfer', exact: true })
    .click();
  await expect(page.getByLabel('Sender', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Recipient', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Amount (USD)', { exact: true })).toHaveValue(
    '',
  );
});

test('Balance layout: long names and amounts, keyboard details, ineligible parties and unavailable sources', async ({
  page,
  app,
}, testInfo) => {
  const fixture = sourceDashboard();
  const retainedParty =
    fixture.householdDashboard.spaces[0].balances.obligations[0].from;
  // Membership IDs belong to one source. Do not let another source's current
  // member record overwrite the retained party's eligibility in Relay.
  retainedParty.id = 'inactive-home-member';
  retainedParty.displayName = 'Former household member';
  retainedParty.canParticipate = false;
  fixture.householdDashboard.spaces[1].balances = {
    __typename: 'Problem',
    code: 'UNAVAILABLE',
  };
  fixture.householdDashboard.spaces[1].viewerNetMinor = null;
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    fixture,
  );
  response.release();
  await app.authenticate();
  for (const width of [320, 390, 440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/household?tab=balances');
    await expect(page.locator('[data-ui~="household-balances"]')).toBeVisible();
    for (const textScale of ['100%', '200%']) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = value;
      }, textScale);
      const summary = page.locator('#balance-section-household-source-11');
      await summary.focus();
      if ((await summary.getAttribute('aria-expanded')) !== 'true')
        await page.keyboard.press('Enter');
      const row = page.locator('#repay-source-11-M1-M2');
      await expect(row).toBeVisible();
      await row.focus();
      await expect(row).toBeFocused();
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        font: getComputedStyle(document.documentElement).fontSize,
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.font).toBe(textScale === '200%' ? '32px' : '16px');
      await page.screenshot({
        path: testInfo.outputPath(`balances-${width}-${textScale}.png`),
        fullPage: true,
      });
    }
  }
  const home = page.locator('#balance-section-household-H');
  await home.click();
  await expect(home.locator('..')).toContainText(
    'Recording requires two currently eligible members.',
  );
  await expect(page.locator('#repay-H-M1-M0')).toHaveCount(0);
  const unavailable = page.locator('#balance-section-household-T');
  await expect(unavailable).toContainText('Balance unavailable');
  await expect(unavailable).not.toContainText('$0.00');
  await unavailable.click();
  await expect(unavailable.locator('..')).toContainText(
    'This space cannot be shown as settled.',
  );
});

for (const source of [
  { name: 'Trip', path: '/trips/T?tab=expenses' },
  { name: 'Household', path: '/household/expenses' },
]) {
  test(`${source.name} short enlarged viewport keeps expense controls reachable by pointer`, async ({
    page,
    app,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await app.authenticate();
    await page.goto(source.path);
    await page.locator('#ledger-expense-e1').waitFor();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const brand = page.locator('[data-ui~="workspace-navigation-brand"]');
    await expect(brand).toHaveCSS('position', 'relative');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--chrome-header'),
        ),
      )
      .toBe('0px');
    const filters = page.getByRole('button', { name: 'Filters', exact: true });
    // Real pointer activation must work after the browser scrolls the control;
    // keyboard activation alone cannot establish that fixed chrome clears it.
    await filters.click();
    const dialog = page.getByRole('dialog', { name: 'Expense filters' });
    await expect(dialog).toHaveCount(1);
    const close = dialog.getByRole('button', { name: 'Back to expenses' });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole('button', { name: 'Reset filters' }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole('button', { name: 'Apply filters' }),
    ).toBeInViewport({ ratio: 1 });
    await dialog.locator('summary').filter({ hasText: 'Categories' }).click();
    await dialog.getByLabel('Dining', { exact: true }).check();
    await dialog.getByLabel('Groceries', { exact: true }).check();
    await page.screenshot({
      path: testInfo.outputPath('short-enlarged-filters.png'),
    });
    await page.keyboard.press('Escape');
    await expect(filters).toBeFocused();
    await filters.click();
    await expect(
      dialog.locator('summary').filter({ hasText: 'Categories' }),
    ).toContainText('All categories');
    await close.click();
    const breakdown = page.getByRole('button', {
      name: 'Breakdown',
      exact: true,
    });
    await breakdown.click();
    await expect(breakdown).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('region', { name: 'Spending by category' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'List', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(brand).toHaveCSS('position', 'sticky');
    await expect
      .poll(() =>
        page.evaluate(() =>
          parseFloat(
            document.documentElement.style.getPropertyValue('--chrome-header'),
          ),
        ),
      )
      .toBeGreaterThan(0);
    await page.setViewportSize({ width: 320, height: 480 });
    await expect(brand).toHaveCSS('position', 'relative');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--chrome-header'),
        ),
      )
      .toBe('0px');
    await filters.click();
    await expect(dialog).toHaveCount(1);
    await close.click();
    await expect(filters).toBeFocused();
  });
}

for (const overlay of ['detail', 'create']) {
  test(`history ${overlay} above Filters releases document scrolling after dismissal and access disposal`, async ({
    page,
    app,
  }) => {
    const width = page.viewportSize().width;
    await page.setViewportSize({ width, height: 600 });
    await app.authenticate();
    await page.goto('/trips/T?tab=expenses');
    await page.locator('#ledger-expense-e1').waitFor();
    const originalOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );
    if (overlay === 'detail') {
      await page.locator('#ledger-expense-e1').click();
      await expect(
        page.getByText('Private fixture note', { exact: true }),
      ).toBeVisible();
    } else {
      await page
        .getByRole('link', { name: 'Add expense', exact: true })
        .click();
      await page
        .locator('#expense-description')
        .fill('Creation draft retained through history');
    }
    const overlayURL = page.url();
    await page.goBack();
    await page.locator('#ledger-expense-e1').waitFor();
    const filters = page.getByRole('dialog', { name: 'Expense filters' });
    const presentation = page.locator('[data-ui~="expense-presentation"]');
    const openDraft = async () => {
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await filters
        .locator('summary')
        .filter({ hasText: 'Categories' })
        .click();
      await filters.getByLabel('Dining', { exact: true }).check();
      await filters.getByLabel('Groceries', { exact: true }).check();
      await page.evaluate(() => {
        window.expenseModalPeak = 1;
        window.expenseModalObserver?.disconnect();
        window.expenseModalObserver = new MutationObserver(() => {
          window.expenseModalPeak = Math.max(
            window.expenseModalPeak,
            document.querySelectorAll('dialog[open]').length,
          );
        });
        window.expenseModalObserver.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['open'],
        });
      });
    };
    const forward = async () => {
      await page.goForward();
      await page.waitForURL(overlayURL);
      await expect(presentation).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.expenseModalPeak))
        .toBe(2);
      if (overlay === 'create')
        await expect(page.locator('#expense-description')).toHaveValue(
          'Creation draft retained through history',
        );
      await expect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .toBe('hidden');
    };
    await openDraft();
    await forward();
    await page.goBack();
    await expect(presentation).toHaveCount(0);
    await page.locator('#ledger-expense-e1').waitFor();
    // A protected history read may dispose and recreate the ledger. When the
    // original owner survives, its unapplied draft remains until dismissed.
    if (await filters.count()) {
      await expect(filters.getByLabel('Dining', { exact: true })).toBeChecked();
      await expect(
        filters.getByLabel('Groceries', { exact: true }),
      ).toBeChecked();
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(originalOverflow);
    // Exercise actual wheel input on the authorized long document after release.
    await page
      .locator('[data-ui~="ledger-pagination"]')
      .scrollIntoViewIfNeeded();
    await page.locator('#ledger-expense-e8').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(width / 2, 250);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    // History can mount the same two owners again; access loss disposes both.
    await openDraft();
    const denial = responseFor('journeyWorkspaceQuery', {
      id: 'T',
      ledger: true,
    });
    denial.group = {
      __typename: 'Problem',
      code: 'NOT_FOUND',
      message: 'Denied',
    };
    denial.groupExpenses = {
      __typename: 'Problem',
      code: 'NOT_FOUND',
      message: 'Denied',
    };
    // These normal background reads can be canceled when denial disposes their
    // owners. Keep them under the fixture's explicit replacement-read contract.
    const collateral = [
      app.holdMatching(
        'expensesGroupQuery',
        () => true,
        responseFor('expensesGroupQuery', { groupId: 'T' }),
      ),
      app.holdMatching(
        'journeyExpenseQuery',
        () => true,
        responseFor('journeyExpenseQuery', { id: 'e1' }),
      ),
      app.holdMatching(
        'appearanceQuery',
        () => true,
        responseFor('appearanceQuery', {}),
      ),
    ];
    for (const read of collateral) read.release();
    const denied = app.holdMatching(
      'journeyWorkspaceQuery',
      () => true,
      denial,
    );
    await page.goForward();
    await page.waitForURL(overlayURL);
    await expect
      .poll(() => page.evaluate(() => window.expenseModalPeak))
      .toBe(2);
    // Detail history may reuse fresh workspace data; foregrounding still checks
    // the current server permission. Hold every replacement read until denied.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await denied.started;
    await denied.release();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('[id^="ledger-expense-"]')).toHaveCount(0);
    await expect(
      page.getByText('Private fixture note', { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(originalOverflow);
    // Finish synthetic response callbacks before the fixture removes routes;
    // denied owner disposal deliberately cancels overlapping protected reads.
    await page.waitForLoadState('networkidle');
  });
}
