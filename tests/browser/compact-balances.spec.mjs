import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';
import { writeFile } from 'node:fs/promises';

function manySources() {
  const fixture = structuredClone(responseFor('householdWorkspaceQuery', {}));
  const dashboard = fixture.householdDashboard;
  const home = dashboard.spaces[0];
  dashboard.spaces = Array.from({ length: 6 }, (_, index) => ({
    ...home,
    groupId: index === 0 ? 'H' : `compact-${index}`,
    name: ['Home', 'Maui', 'Friends', 'Cabin', 'London', 'Weekend'][index],
    isHousehold: index === 0,
    kind: index % 2 ? 'TRIP' : 'ORDINARY',
    viewerNetMinor: index === 0 ? '8420' : index === 1 ? '-8420' : '0',
    balances: {
      ...home.balances,
      settled: index > 1,
      obligations: index === 0 ? home.balances.obligations : [],
    },
  }));
  for (const space of dashboard.spaces) {
    delete space.id;
    delete space.__typename;
  }
  dashboard.totals.viewerNetMinor = '0';
  dashboard.totals.activeSpaceCount = '6';
  return fixture;
}

test('compact balance hierarchy, independent card controls and normal-content geometry', async ({
  page,
  app,
}, testInfo) => {
  const fixture = manySources();
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    fixture,
  );
  response.release();
  await app.authenticate();
  const width = page.viewportSize().width;
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/household?tab=balances');
  const sources = page.locator(
    '[data-ui~="household-balances"] > li > details',
  );
  await expect(sources).toHaveCount(6);
  const summary = page.locator('[data-ui~="balance-summary"]');
  await expect(summary).toContainText('You owe$84.20');
  await expect(summary).toContainText('You’re owed$84.20');
  await expect(summary).toContainText('Net $0.00');
  const geometry = await page.evaluate(() => {
    const box = (selector) => {
      const { x, y, width, height } = document
        .querySelector(selector)
        .getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      typography: Object.fromEntries(
        [
          ['heading', '[data-ui~="household-balance-view"] h2'],
          ['amount', '[data-ui~="balance-summary"] [data-ui~="money-value"]'],
          ['source', '[data-ui~="balance-source-copy"] strong'],
        ].map(([name, selector]) => {
          const style = getComputedStyle(document.querySelector(selector));
          return [
            name,
            {
              size: style.fontSize,
              weight: style.fontWeight,
              family: style.fontFamily,
            },
          ];
        }),
      ),
      viewport: { width: innerWidth, height: innerHeight },
      canvas: box('[data-ui~="workspace-content"]'),
      content: box('[data-ui~="household-balance-view"]'),
      heading: box('[data-ui~="household-balance-view"] h2'),
      metrics: box('[data-ui~="balance-summary"]'),
      sources: [
        ...document.querySelectorAll(
          '[data-ui~="household-balances"] > li > details',
        ),
      ].map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }),
      bottom: box('[data-ui~="workspace-navigation-links"]'),
    };
  });
  expect(geometry.typography.heading.size).toBe('18px');
  expect(geometry.typography.heading.weight).toBe('500');
  expect(geometry.typography.amount.size).toBe('28px');
  expect(geometry.typography.amount.weight).toBe('500');
  expect(geometry.typography.source.size).toBe('14px');
  expect(geometry.typography.source.weight).toBe('500');
  if (width === 390) {
    expect(geometry.sources[0].y).toBeLessThanOrEqual(450);
    expect(geometry.sources[0].height).toBeGreaterThanOrEqual(76);
    expect(geometry.sources[0].height).toBeLessThanOrEqual(88);
    expect(geometry.sources[2].y + geometry.sources[2].height).toBeLessThan(
      geometry.bottom.y,
    );
  }
  await writeFile(
    testInfo.outputPath('compact-geometry.json'),
    JSON.stringify(geometry, null, 2),
  );
  await page.screenshot({
    path: testInfo.outputPath('household-collapsed.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(sources.locator(':scope[open]')).toHaveCount(6);
  await sources.nth(1).locator('summary').first().click();
  await expect(sources.locator(':scope[open]')).toHaveCount(5);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(sources.locator(':scope[open]')).toHaveCount(0);
  const help = page.getByRole('button', { name: 'How balances work' });
  await help.click();
  await expect(
    page.getByRole('dialog', { name: 'How balances work' }),
  ).toContainText('What you owe in one group');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
});

test('contextual repayment dismisses with draft, source expansion, scroll and focus intact', async ({
  page,
  app,
}, testInfo) => {
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    manySources(),
  );
  response.release();
  await app.authenticate();
  await page.goto('/household?tab=balances');
  await page.locator('#balance-section-household-H').click();
  const trigger = page.locator('#repay-H-M1-M0');
  await trigger.focus();
  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  const dialog = page.locator('[data-ui~="repayment-presentation"]');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Settle with Brian' }),
  ).toBeFocused();
  await expect(page.locator('form')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('repayment-initial.png') });
  await expect(dialog.getByLabel('Transfer date')).toBeVisible();
  const box = await dialog.boundingBox();
  if (page.viewportSize().width === 390) {
    expect(box.width).toBe(390);
    expect(box.y).toBeGreaterThanOrEqual(15);
  } else {
    expect(box.x + box.width).toBe(1280);
    expect(box.width).toBeLessThan(500);
  }
  await dialog.getByLabel('Amount (USD)').fill('40.01');
  await dialog.getByLabel('Optional note').fill('Retained actual transfer');
  await page.screenshot({ path: testInfo.outputPath('repayment.png') });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(
    4,
  );
  await expect(page.locator('#balance-section-household-H')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await trigger.click();
  await expect(dialog.getByLabel('Amount (USD)')).toHaveValue('40.01');
  await expect(dialog.getByLabel('Optional note')).toHaveValue(
    'Retained actual transfer',
  );
  await dialog.getByRole('button', { name: 'Close repayment' }).click();
  expect(
    app.requests.some(
      (request) => request.operation === 'journeyRepaymentMutation',
    ),
  ).toBe(false);
  await page.goto(
    '/household/ledger?tab=balances&repayment=1&sender=M1&recipient=M0&amount=8420',
  );
  await expect(page.locator('[data-ui~="repayment-presentation"]')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('heading', { name: 'Record repayment · Home' }),
  ).toBeVisible();
});

test('Group compact source keeps member calculations and simple actionable rows inside one expanded card', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  await page.goto('/groups/F?tab=balances');
  const card = page.locator('#balance-section-group-F-source').locator('..');
  await expect(card).toHaveAttribute('open', '');
  await expect(card.locator('summary').first()).toContainText(
    "You're owed $84.20",
  );
  await expect(card.locator('[data-ui~="repayment-row"]')).toHaveCount(1);
  await expect(
    card.getByRole('link', { name: 'Record an actual transfer', exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('heading', { name: 'Recent recorded repayments' }),
  ).toBeVisible();
  const members = card
    .locator('summary')
    .filter({ hasText: 'Each member’s balance' });
  await members.click();
  await expect(card.getByLabel('Balance calculation for Alex')).toBeAttached();
  await page.screenshot({
    path: testInfo.outputPath('group-expanded.png'),
    fullPage: true,
  });
});

test('contextual uncertain repayment keeps the original operation across dismissal and explicit recovery', async ({
  page,
  app,
}) => {
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    manySources(),
  );
  response.release();
  let original;
  let submissions = 0;
  let recoveries = 0;
  await page.route('**/api/graphql', async (route) => {
    const { query, variables } = route.request().postDataJSON();
    if (query.includes('mutation journeyRepaymentMutation')) {
      submissions++;
      if (!original) original = structuredClone(variables.input);
      expect(variables.input).toEqual(original);
      return route.fulfill({
        json: {
          data: {
            recordRepayment: {
              __typename: 'OperationProgress',
              key: original.key,
              state: 'UNKNOWN',
            },
          },
        },
      });
    }
    if (query.includes('query journeyRepaymentRecoveryQuery')) {
      recoveries++;
      expect(variables).toEqual({ groupId: 'H', key: original.key });
      return route.fulfill({
        json: {
          data: {
            repaymentOperation: {
              __typename: 'OperationProgress',
              key: original.key,
              state: 'NOT_OBSERVED',
            },
          },
        },
      });
    }
    return route.fallback();
  });
  await app.authenticate();
  await page.goto('/household?tab=balances');
  await page.locator('#balance-section-household-H').click();
  const trigger = page.locator('#repay-H-M1-M0');
  await trigger.click();
  const dialog = page.locator('[data-ui~="repayment-presentation"]');
  await dialog.getByLabel('Amount (USD)').fill('40.01');
  await dialog
    .getByRole('button', { name: 'Record repayment', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'Unconfirmed original repayment' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close repayment' }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByLabel('Amount (USD)')).toHaveValue('40.01');
  await expect(dialog.getByLabel('Amount (USD)')).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Recover original repayment' })
    .click();
  await expect.poll(() => recoveries).toBe(1);
  expect(submissions).toBe(1);
  await dialog
    .getByRole('button', { name: 'Retry original repayment' })
    .click();
  await expect.poll(() => submissions).toBe(2);
  await expect(dialog.getByLabel('Amount (USD)')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('balance and repayment layout retains readable controls across appearance, enlarged text and short viewports', async ({
  page,
  app,
}, testInfo) => {
  const response = app.holdMatching(
    'householdWorkspaceQuery',
    () => true,
    manySources(),
  );
  response.release();
  await app.authenticate();
  for (const appearance of ['LIGHT', 'DARK', 'SYSTEM']) {
    app.setAppearance(appearance);
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const width of [320, 390, 440, 1280]) {
      await page.setViewportSize({ width, height: 480 });
      await page.goto('/household?tab=balances');
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        appearance === 'LIGHT' ? 'light' : 'dark',
      );
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.locator('#balance-section-household-H').click();
      await page.locator('#repay-H-M1-M0').click();
      const dialog = page.locator('[data-ui~="repayment-presentation"]');
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole('button', { name: 'Record repayment', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole('button', { name: 'Record repayment', exact: true }),
      ).toBeInViewport();
      const dimensions = await dialog.evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
        height: element.getBoundingClientRect().height,
        viewport: innerHeight,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
      expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewport);
      await page.screenshot({
        path: testInfo.outputPath(
          `repayment-${appearance}-${width}-200-short.png`,
        ),
      });
      await page.keyboard.press('Escape');
      await expect(page.locator('#repay-H-M1-M0')).toBeFocused();
    }
  }
});
