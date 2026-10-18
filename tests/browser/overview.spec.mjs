import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

// Complete totals deliberately exceed the one visible recent expense.
function overviewFixture(id) {
  const group = structuredClone(
    responseFor('journeyWorkspaceQuery', { id }).group,
  );
  group.name = id === 'T' ? 'Maui' : id === 'F' ? 'Friends' : 'Home';
  const [viewer, first, second] = group.members;
  group.balances.totalExpenseMinor = '25200';
  group.balances.positions.forEach((position, index) => {
    position.netMinor = index === 0 ? '-8420' : '4210';
    position.owedMinor = index === 0 ? '12600' : '6300';
    position.paidMinor = index === 0 ? '4180' : '10510';
  });
  group.balances.obligations = [first, second].map((to) => ({
    from: viewer,
    to,
    amountMinor: '4210',
  }));
  const recent = structuredClone(
    responseFor('householdWorkspaceQuery', { recent: true }).householdExpenses,
  );
  recent.edges[0].source = { ...recent.edges[0].source, name: 'Maui' };
  group.expenses.edges = recent.edges;
  const household = structuredClone(
    responseFor('householdWorkspaceQuery', { recent: true }),
  );
  household.householdExpenses = recent;
  const home = household.householdDashboard.spaces[0];
  home.balances.obligations = [
    { from: first, to: viewer, amountMinor: '8420' },
  ];
  const trip = {
    ...home,
    groupId: 'T',
    name: 'Maui',
    isHousehold: false,
    kind: 'TRIP',
    viewerNetMinor: '-8420',
    balances: {
      ...home.balances,
      obligations: [{ from: viewer, to: first, amountMinor: '8420' }],
    },
  };
  delete trip.id;
  household.householdDashboard.spaces.push(trip);
  household.householdDashboard.totals.viewerNetMinor = '0';
  household.householdDashboard.totals.totalSharedExpenseMinor = '50400';
  household.householdDashboard.totals.totalSharedExpenseCount = '20';
  return id === 'H'
    ? household
    : { viewer: { __typename: 'Viewer', today: '2026-10-05' }, group };
}
const sources = [
  { id: 'H', path: '/household', operation: 'householdWorkspaceQuery' },
  {
    id: 'F',
    path: '/groups/F?tab=overview',
    operation: 'journeyWorkspaceQuery',
  },
  {
    id: 'T',
    path: '/trips/T?tab=overview',
    operation: 'journeyWorkspaceQuery',
  },
];
for (const source of sources) {
  test(`Overview ${source.id} compact vertical composition, complete money and accessible reflow`, async ({
    page,
    app,
  }, testInfo) => {
    const fixture = overviewFixture(source.id);
    const response = app.holdMatching(source.operation, () => true, fixture);
    response.release();
    await app.authenticate();
    for (const width of [320, 390, 440, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(source.path);
      const summary = page.locator('[data-ui~="balance-summary"]');
      await expect(summary).toBeVisible();
      await expect(summary).toContainText(
        source.id === 'H' ? 'Net $0.00' : 'You owe$84.20',
      );
      if (source.id === 'H') {
        await expect(summary).toContainText('You’re owed$84.20');
        await expect(
          page.getByRole('heading', { name: 'Your money, at a glance' }),
        ).toBeVisible();
      } else
        await expect(page.locator('[data-ui~="overview-spend"]')).toContainText(
          '$252.00',
        );
      const preview = page.getByRole('region', {
        name: 'Your balances',
        exact: true,
      });
      await expect(preview.locator('[data-ui~="repayment-row"]')).toHaveCount(
        2,
      );
      const expenses = page.locator('[data-ui~="group-expense-list"]');
      await expect(expenses).toContainText('Fixture lunch');
      await expect(expenses).toContainText('Your share $3.00');
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const b = document.querySelector(selector).getBoundingClientRect();
          return {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            bottom: b.bottom,
          };
        };
        return {
          canvas: box('[data-ui~="workspace-content"]'),
          summary: box('[data-ui~="balance-summary"]'),
          preview: box('[data-ui~="obligation-preview"]'),
          first: box('[data-ui~="repayment-row"]'),
          recent: box('[data-ui~="group-section-heading"]'),
          expense: box('[data-ui~="group-expense-list"] a'),
          footer: document
            .querySelector('[data-ui~="workspace-navigation"]')
            ?.getBoundingClientRect().top,
          width: innerWidth,
          height: innerHeight,
        };
      });
      expect(geometry.preview.width).toBeCloseTo(geometry.recent.width, 0);
      expect(geometry.preview.y).toBeGreaterThan(geometry.summary.bottom);
      expect(geometry.recent.y).toBeGreaterThan(geometry.preview.bottom);
      if (width === 390) {
        expect(geometry.first.y).toBeLessThan(844);
        expect(geometry.expense.y).toBeLessThan(760);
      }
      await writeFile(
        testInfo.outputPath(`overview-${source.id}-${width}.json`),
        JSON.stringify(geometry, null, 2),
      );
      await page.screenshot({
        path: testInfo.outputPath(`overview-${source.id}-${width}.png`),
        fullPage: true,
      });
      await page.locator('[data-ui~="overview-totals"] summary').click();
      const totals = page.locator('[data-ui~="overview-totals"]');
      await expect(totals).toContainText('Your share');
      await expect(totals).toContainText('You paid');
      if (source.id === 'H') await expect(totals).toContainText('$504.00');
      await page.locator('[data-ui~="overview-totals"] summary').click();
      for (const theme of ['light', 'dark', 'system']) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme =
            theme === 'system' ? 'dark' : theme;
        }, theme);
        await page.addStyleTag({ content: 'html{font-size:200% !important}' });
        await expect(preview).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            `overview-${source.id}-${width}-${theme}-200.png`,
          ),
          fullPage: true,
        });
      }
    }
  });
}

test('Overview states never infer settlement or retain stale private rows during refresh denial', async ({
  page,
  app,
}, testInfo) => {
  // Repeated reloads may cancel shell reads; own their replacement responses.
  for (const operation of [
    'appearanceQuery',
    'profileQuery',
    'journeyViewerQuery',
  ]) {
    app
      .holdMatching(
        operation,
        () => true,
        structuredClone(responseFor(operation, {})),
      )
      .release();
  }

  const fixture = overviewFixture('H');
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    fixture,
  );
  response.release();
  await app.authenticate();
  await page.goto('/household');
  await expect(page.locator('[data-ui~="repayment-row"]')).toHaveCount(2);
  const dashboard = fixture.householdDashboard;
  for (const state of [
    'empty',
    'settled',
    'no-edge',
    'incomplete',
    'unavailable',
    'denied',
  ]) {
    dashboard.state =
      state === 'incomplete'
        ? 'INCOMPLETE'
        : state === 'unavailable'
          ? 'UNAVAILABLE'
          : 'COMPLETE';
    dashboard.spaces.forEach((space) => {
      space.viewerNetMinor = state === 'no-edge' ? '-100' : '0';
      space.balances = {
        __typename: 'GroupBalances',
        settled: state === 'settled',
        obligations: [],
      };
    });
    fixture.householdExpenses.edges = [];
    if (state === 'denied') dashboard.spaces = [];
    await page.reload();
    await expect(page.locator('[data-ui~="repayment-row"]')).toHaveCount(0);
    if (['incomplete', 'unavailable', 'denied'].includes(state)) {
      await expect(page.locator('[data-ui~="balance-summary"]')).toHaveCount(0);
      await expect(
        page.getByText('Fixture lunch', { exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        page.locator('[data-ui~="obligation-preview"]'),
      ).toContainText(
        state === 'no-edge'
          ? 'Open Balances for current repayment choices'
          : 'Nothing for you to pay or collect',
      );
      await expect(
        page.getByText('No shared expenses yet.', { exact: true }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`overview-state-${state}.png`),
      fullPage: true,
    });
  }
});

for (const source of sources) {
  test(`Overview ${source.id} expense detail and edit return retain the original source`, async ({
    page,
    app,
  }) => {
    const fixture = overviewFixture(source.id);
    const response = app.holdMatching(source.operation, () => true, fixture);
    response.release();
    const id = source.id === 'H' ? 'T' : source.id;
    const detail = structuredClone(
      responseFor('journeyExpenseQuery', { id: 'e1' }),
    );
    detail.node.groupId = id;
    const read = app.holdMatching('journeyExpenseQuery', () => true, detail);
    read.release();
    await app.authenticate();
    await page.goto(source.path);
    const trigger = page.locator('#expense-e1');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Paid by Alex');
    await trigger.click();
    const dialog = page.locator('[data-ui~="expense-presentation"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Original source:');
    await dialog
      .getByRole('button', { name: 'Edit expense', exact: true })
      .click();
    await expect(
      dialog.getByLabel('Description', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Cancel editing', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Edit expense', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Close expense', exact: true })
      .click();
    await expect(trigger).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(
      new URL(source.path, 'https://fixture.invalid').pathname,
    );
    expect(
      app.requests
        .filter((request) => request.operation === 'journeyExpenseQuery')
        .every((request) => request.variables.id === 'e1'),
    ).toBe(true);
    expect(
      app.requests.some((request) => /Mutation$/.test(request.operation)),
    ).toBe(false);
  });
}

test('Overview refresh hides private content while pending and retains truthful failure recovery', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  await page.goto('/household');
  await expect(page.locator('[data-ui~="balance-summary"]')).toBeVisible();
  const pending = app.hold('householdWorkspaceQuery', undefined, {
    status: 503,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pending.started;
  await expect(page.locator('[data-ui~="balance-summary"]')).toHaveCount(0);
  await expect(page.locator('[data-ui~="repayment-row"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('overview-refresh-pending.png'),
  });
  await pending.release();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Household data is unavailable' }),
  ).toBeVisible();
  await expect(page.locator('[data-ui~="group-expense-list"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('overview-refresh-failed.png'),
  });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-ui~="balance-summary"]')).toBeVisible();
});

test('Overview exact long amounts and labels reflow without hiding the preview or secondary totals', async ({
  page,
  app,
}, testInfo) => {
  const fixture = overviewFixture('H');
  const amount = '9007199254740993';
  const spaces = fixture.householdDashboard.spaces;
  spaces[0].viewerNetMinor = amount;
  spaces[1].viewerNetMinor = `-${amount}`;
  for (const space of spaces) {
    space.name =
      'A very long source name with readable words and ExactLongSourceIdentity';
    const edge = space.balances.obligations[0];
    edge.amountMinor = amount;
    edge.from.displayName = 'A very long counterparty name with ordinary words';
    edge.to.displayName = 'A very long recipient name with ordinary words';
  }
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    fixture,
  );
  response.release();
  await page.setViewportSize({ width: 320, height: 568 });
  await app.authenticate();
  await page.goto('/household');
  await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  await expect(page.locator('[data-ui~="balance-summary"]')).toContainText(
    'You owe$90,071,992,547,409.93',
  );
  await expect(page.locator('[data-ui~="repayment-row"]')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.locator('[data-ui~="overview-totals"] summary').click();
  await expect(page.locator('[data-ui~="overview-totals"]')).toContainText(
    'Your share',
  );
  await page.screenshot({
    path: testInfo.outputPath('overview-long-320-200.png'),
    fullPage: true,
  });
});
