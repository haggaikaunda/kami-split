import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

const actor = { id: 'activity-actor', displayName: 'Alex' };
const payer = { id: 'activity-payer', displayName: 'Brian' };
function event(id, kind = 'EXPENSE_CREATED', overrides = {}) {
  const snapshot = {
    description: overrides.description ?? 'Lunch',
    totalMinor: overrides.amountMinor ?? '1250',
    effectiveDate: '2026-09-01',
    category: 'DINING',
    payer,
    split: 'EQUAL',
    note: 'Historical note',
    allocations: [
      {
        participant: payer,
        amountMinor: overrides.amountMinor ?? '1250',
        percentageHundredths: null,
      },
    ],
  };
  return {
    __typename: 'ActivityEvent',
    id,
    recordId: `record-${id}`,
    kind,
    groupId: 'T',
    groupName: 'Maui',
    groupKind: 'TRIP',
    isHousehold: false,
    amountMinor: '1250',
    currency: 'USD',
    description: 'Lunch',
    note: '',
    effectiveDate: '2026-09-01',
    timestamp: '2026-10-02T23:30:00-07:00',
    creator: actor,
    payer: kind === 'REPAYMENT_RECORDED' ? null : payer,
    sender: kind === 'REPAYMENT_RECORDED' ? payer : null,
    recipient: kind === 'REPAYMENT_RECORDED' ? actor : null,
    before:
      kind === 'EXPENSE_UPDATED'
        ? {
            ...snapshot,
            description: 'Original lunch',
            totalMinor: '1000',
            allocations: [
              {
                participant: payer,
                amountMinor: '1000',
                percentageHundredths: null,
              },
            ],
          }
        : null,
    after: kind === 'REPAYMENT_RECORDED' ? null : snapshot,
    ...overrides,
  };
}
const events = [
  event('created'),
  event('updated', 'EXPENSE_UPDATED'),
  event('repayment', 'REPAYMENT_RECORDED', { description: '' }),
  ...Array.from({ length: 12 }, (_, i) => event(`older-${i}`)),
  event('long', 'EXPENSE_CREATED', {
    description:
      'An unusually long historical expense description with every meaningful word retained',
    creator: {
      id: 'long-actor',
      displayName: 'AlexandriaWithAnUnbrokenVeryLongHistoricalName',
    },
    groupName: 'A long source name with its complete historical context',
    amountMinor: '9007199254740991',
  }),
];
const older = event('last', 'EXPENSE_UPDATED', {
  description: 'Older expense',
});
function connection(rows, hasNextPage = false) {
  return {
    __typename: 'ActivityConnection',
    edges: rows.map((node) => ({ cursor: node.id, node })),
    pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next-events' : null },
  };
}
async function fixture(context, workspace = { name: 'Trip' }) {
  const scoped = (node) =>
    workspace.name === 'Group'
      ? { ...node, groupId: 'F', groupName: 'Friends', groupKind: 'ORDINARY' }
      : node;
  const state = { denied: false, unavailable: false, empty: false };
  await context.route('**/api/graphql', async (route) => {
    const { query, variables } = route.request().postDataJSON();
    const op = query.match(/(?:query|mutation) (\w+)/)?.[1];
    let data;
    const feed = () =>
      state.denied
        ? {
            __typename: 'Problem',
            code: 'FORBIDDEN',
            message: 'Access changed',
          }
        : connection(
            (state.empty ? [] : variables.after ? [older] : events)
              .filter(
                (node) =>
                  !variables.filter?.kind ||
                  node.kind === variables.filter.kind,
              )
              .map(scoped),
            !variables.after,
          );
    if (op === 'activityHouseholdQuery') data = { householdActivity: feed() };
    else if (op === 'activityGroupQuery') data = { groupActivity: feed() };
    else if (op === 'journeyWorkspaceQuery' && variables.activity)
      data = { ...responseFor(op, variables), groupActivity: feed() };
    else if (op === 'activityDetailQuery')
      data = {
        activityEvent: state.unavailable
          ? { __typename: 'Problem', code: 'NOT_FOUND', message: 'Unavailable' }
          : scoped(
              [...events, older].find((node) => node.id === variables.eventId),
            ),
      };
    else return route.fallback();
    await route.fulfill({ json: { data } });
  });
  return state;
}
const workspaces = [
  { name: 'Household', href: '/household/activity' },
  { name: 'Trip', href: '/trips/T?tab=activity' },
  { name: 'Group', href: '/groups/F?tab=activity' },
];
for (const workspace of workspaces) {
  test(`${workspace.name} activity keeps audit detail, filtering, paging and denied records private`, async ({
    page,
    app,
    context,
  }) => {
    const state = await fixture(context, workspace);
    await app.authenticate();
    await page.goto(workspace.href);
    const feed = page.locator('[data-ui~="activity-feed-panel"]');
    const rows = feed.locator('li > button');
    await expect(rows).toHaveCount(events.length);
    await expect(rows.nth(0)).toContainText('Alex added Lunch');
    await expect(rows.nth(1)).toContainText('Alex updated Lunch');
    await expect(rows.nth(2)).toContainText('Alex recorded a repayment');
    await expect(rows.nth(0).locator('time')).toHaveText(
      'Recorded Oct 3, 2026',
    );
    await rows.nth(1).focus();
    await page.keyboard.press('Enter');
    const detail = page.getByRole('region', {
      name: 'Historical event detail',
    });
    await expect(detail).toBeFocused();
    await expect(detail).toContainText('Original lunch');
    await expect(detail).toContainText('Historical note');
    await expect(detail).toContainText('Brian');
    await expect(detail).toContainText('Sep 1, 2026');
    await detail.getByText('Exact timestamp', { exact: true }).click();
    await expect(detail).toContainText('2026-10-02T23:30:00-07:00');
    await detail.getByRole('button', { name: 'Close detail' }).click();
    await expect(rows.nth(1)).toBeFocused();
    await rows.nth(2).click();
    await expect(detail).toContainText('Sender');
    await expect(detail).toContainText('Recipient');
    await expect(
      detail.getByRole('link', { name: 'View source balances' }),
    ).toHaveAttribute(
      'href',
      workspace.name === 'Group'
        ? '/groups/F?tab=balances'
        : '/trips/T?tab=balances',
    );
    await detail.getByRole('button', { name: 'Close detail' }).click();
    await page
      .getByRole('combobox', { name: 'Event type', exact: true })
      .selectOption('EXPENSE_UPDATED');
    await expect(rows).toHaveCount(1);
    const filteredURL = page.url();
    await page.getByRole('button', { name: 'Next activity page' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Older expense');
    await rows.first().focus();
    const scroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Enter');
    await expect(detail).toContainText('Older expense');
    await detail.getByRole('button', { name: 'Close detail' }).click();
    await expect(rows.first()).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    expect(page.url()).toBe(filteredURL);
    await page
      .getByRole('button', { name: 'Return to latest activity' })
      .click();
    await expect(rows.first()).toContainText('Alex updated Lunch');
    state.unavailable = true;
    await rows.first().click();
    await expect(detail).toHaveCount(0);
    await expect(rows).toHaveCount(0);
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Account verification is unavailable.' }),
    ).toBeVisible();
    await expect(page.getByText('Older expense')).toHaveCount(0);
    await expect(page.getByText('Historical note')).toHaveCount(0);
  });
  test(`${workspace.name} activity distinguishes empty filters and denies a fresh feed`, async ({
    page,
    app,
    context,
  }) => {
    const state = await fixture(context, workspace);
    state.empty = true;
    await app.authenticate();
    await page.goto(workspace.href);
    await expect(
      page.getByText('No activity yet.', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Event type', exact: true })
      .selectOption('REPAYMENT_RECORDED');
    await expect(
      page.getByText('No activity matches these filters.', { exact: true }),
    ).toBeVisible();
    state.denied = true;
    await page.reload();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Account verification is unavailable.' }),
    ).toBeVisible();
    await expect(page.locator('[data-ui~="activity-events"]')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Historical event detail' }),
    ).toHaveCount(0);
  });
}

for (const workspace of workspaces.slice(0, 2)) {
  test(`${workspace.name} holds only the active filter while replacement responses are pending`, async ({
    page,
    app,
    context,
  }) => {
    await fixture(context, workspace);
    await app.authenticate();
    await page.goto(workspace.href);
    const rows = page.locator('[data-ui~="activity-events"] > li > button');
    await expect(rows).toHaveCount(events.length);
    const gate = Promise.withResolvers(),
      started = Promise.withResolvers();
    await context.route('**/api/graphql', async (route) => {
      const { query, variables } = route.request().postDataJSON();
      if (
        !/query activity(Household|Group)Query/.test(query) ||
        variables.filter?.kind !== 'EXPENSE_UPDATED'
      )
        return route.fallback();
      started.resolve();
      await gate.promise;
      try {
        await route.fulfill({
          json: {
            data: {
              [workspace.name === 'Household'
                ? 'householdActivity'
                : 'groupActivity']: connection([
                event('late', 'EXPENSE_UPDATED', {
                  description: 'STALE PRIVATE OLD FILTER',
                }),
              ]),
            },
          },
        });
      } catch {
        /* Canceled superseded request. */
      }
    });
    try {
      const select = page.getByRole('combobox', {
        name: 'Event type',
        exact: true,
      });
      await select.selectOption('EXPENSE_UPDATED');
      await started.promise;
      await expect(rows).toHaveCount(0);
      await select.selectOption('REPAYMENT_RECORDED');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('recorded a repayment');
      gate.resolve();
      await expect(page.getByText('STALE PRIVATE OLD FILTER')).toHaveCount(0);
      await expect(rows).toHaveCount(1);
    } finally {
      gate.resolve();
    }
  });
  test(`${workspace.name} activates current expense and balances sources and hides a denied destination`, async ({
    page,
    app,
    context,
  }) => {
    await fixture(context, workspace);
    await app.authenticate();
    await page.goto(workspace.href);
    const rows = page.locator('[data-ui~="activity-events"] > li > button');
    await expect(rows).toHaveCount(events.length);
    await rows.first().click();
    await page
      .getByRole('link', { name: 'View current expense', exact: true })
      .click();
    await expect(
      page.getByText('Private fixture note', { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(rows).toHaveCount(events.length);
    await rows.nth(2).click();
    await page
      .getByRole('link', { name: 'View source balances', exact: true })
      .click();
    await expect(page.locator('[data-ui~="group-balances"]')).toBeVisible();
    await page.goto(workspace.href);
    await expect(rows).toHaveCount(events.length);
    await rows.first().click();
    await context.route('**/api/graphql', (route) => {
      const { query } = route.request().postDataJSON();
      if (query.includes('query journeyExpenseQuery'))
        return route.fulfill({
          json: {
            data: {
              node: {
                __typename: 'Problem',
                code: 'FORBIDDEN',
                message: 'Source denied',
              },
            },
          },
        });
      return route.fallback();
    });
    await page
      .getByRole('link', { name: 'View current expense', exact: true })
      .click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Account verification is unavailable.' }),
    ).toBeVisible();
    await expect(page.getByText('Historical note')).toHaveCount(0);
    await expect(page.getByText('Private fixture note')).toHaveCount(0);
    await expect(rows).toHaveCount(0);
  });
}

for (const width of [320, 390, 440, 1280, 1440]) {
  test(`activity row composition and enlarged text at ${width}px`, async ({
    page,
    app,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);
    await fixture(context);
    await app.authenticate();
    await page.setViewportSize({ width, height: 900 });
    for (const workspace of workspaces.slice(0, 2)) {
      for (const [appearance, colorScheme] of [
        ['LIGHT', 'light'],
        ['DARK', 'dark'],
        ['SYSTEM', 'dark'],
      ]) {
        app.setAppearance(appearance);
        await page.emulateMedia({ colorScheme });
        await page.goto(workspace.href);
        const rows = page.locator('[data-ui~="activity-events"] > li > button');
        await expect(rows).toHaveCount(events.length);
        await expect(page.locator('html')).toHaveAttribute(
          'data-appearance',
          appearance,
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          colorScheme,
        );
        for (const scale of [1, 2]) {
          await page.evaluate((value) => {
            document.documentElement.style.fontSize = `${value * 100}%`;
          }, scale);
          const geometry = await page.evaluate(() => {
            const box = (node) => {
              const r = node.getBoundingClientRect();
              return {
                x: r.x,
                y: r.y + scrollY,
                width: r.width,
                height: r.height,
                right: r.right,
              };
            };
            const panel = document.querySelector(
              '[data-ui~="activity-feed-panel"]',
            );
            const rows = [...panel.querySelectorAll('li > button')];
            return {
              width: innerWidth,
              appearance: document.documentElement.dataset.appearance,
              theme: document.documentElement.dataset.theme,
              overflow: document.documentElement.scrollWidth > innerWidth,
              panel: {
                ...box(panel),
                background: getComputedStyle(panel).backgroundColor,
                padding: getComputedStyle(panel).padding,
              },
              heading: box(panel.querySelector('h2')),
              control: box(panel.querySelector('select')),
              rows: rows.map((row) => ({
                ...box(row),
                padding: getComputedStyle(row).paddingBlock,
                font: getComputedStyle(row).fontSize,
                minimumWordWidth: (() => {
                  const text = row.querySelector('strong');
                  const context = document
                    .createElement('canvas')
                    .getContext('2d');
                  context.font = getComputedStyle(text).font;
                  return Math.max(
                    ...text.textContent
                      .trim()
                      .split(/\s+/)
                      .map((word) => context.measureText(word).width),
                  );
                })(),
                icon: box(row.querySelector('[data-ui~="activity-row-icon"]')),
                content: box(
                  row.querySelector('[data-ui~="activity-row-content"]'),
                ),
                amount: box(
                  row.querySelector('[data-ui~="activity-row-amount"]'),
                ),
                separator: getComputedStyle(row.parentElement)
                  .borderBottomWidth,
              })),
            };
          });
          const label = `${workspace.name}-${appearance}-${scale}`;
          await testInfo.attach(`${label}-geometry`, {
            body: JSON.stringify(geometry, null, 2),
            contentType: 'application/json',
          });
          expect(geometry.overflow).toBe(false);
          expect(geometry.panel.padding).toBe('0px');
          expect(geometry.panel.background).toBe('rgba(0, 0, 0, 0)');
          expect(geometry.heading.x).toBeCloseTo(geometry.panel.x, 0);
          expect(geometry.control.right).toBeLessThanOrEqual(
            geometry.panel.right + 1,
          );
          for (const row of geometry.rows) {
            expect(row.amount.x).toBeGreaterThanOrEqual(row.content.right - 1);
            expect(row.amount.right).toBeLessThanOrEqual(
              geometry.panel.right + 1,
            );
            expect(row.icon.width).toBe((width <= 380 ? 24 : 30) * scale);
          }
          if (scale === 2 && width <= 440) {
            for (const row of geometry.rows.slice(0, 3))
              expect(row.content.width).toBeGreaterThanOrEqual(
                row.minimumWordWidth,
              );
          }
          if (scale === 1) {
            expect(geometry.rows[0].height).toBeGreaterThanOrEqual(65);
            expect(geometry.rows[0].height).toBeLessThanOrEqual(95);
          }
          await page.screenshot({
            path: testInfo.outputPath(`${label}.png`),
            fullPage: true,
          });
          await rows.last().focus();
          await expect(rows.last()).toBeFocused();
          await expect(rows.last()).toContainText('$90,071,992,547,409.91');
          await expect(rows.last()).toHaveAccessibleName(
            /\$90,071,992,547,409\.91 USD/,
          );

          await page.setViewportSize({ width, height: 420 });
          await rows.last().scrollIntoViewIfNeeded();
          await page.evaluate(() =>
            scrollTo(0, document.documentElement.scrollHeight),
          );
          const clearance = await page.evaluate(() => ({
            rowBottom: document
              .querySelector('[data-ui~="activity-events"] > li:last-child')
              .getBoundingClientRect().bottom,
            navigationTop:
              innerWidth <= 600
                ? document
                    .querySelector('[data-ui~="workspace-navigation-links"]')
                    .getBoundingClientRect().top
                : innerHeight,
          }));
          expect(clearance.rowBottom).toBeLessThanOrEqual(
            clearance.navigationTop + 1,
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.setViewportSize({ width, height: 900 });
        }
      }
    }
  });
}
