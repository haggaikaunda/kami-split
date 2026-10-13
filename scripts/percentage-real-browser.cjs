/* eslint-disable @typescript-eslint/no-require-imports -- Optional integration runner loads externally installed Playwright. */
// Invoked only by the disposable expense integration fixture. No hosted credentials.
const { chromium } = require(process.env.PERCENTAGE_PLAYWRIGHT_MODULE);
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const assert = require('node:assert/strict');
const origin = process.env.PERCENTAGE_BROWSER_ORIGIN;
const user = {
  id: process.env.PERCENTAGE_BROWSER_SUBJECT,
  email: 'percentage-browser@example.invalid',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-05T00:00:00Z',
};
const session = {
  access_token: process.env.PERCENTAGE_BROWSER_TOKEN,
  refresh_token: 'unused-fixture',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user,
};
withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  for (const [context, group, entry] of [
    ['Household', process.env.PERCENTAGE_BROWSER_GROUP, '/household/expenses'],
    [
      'Group',
      process.env.PERCENTAGE_BROWSER_GROUP,
      '/groups/' +
        encodeURIComponent(process.env.PERCENTAGE_BROWSER_GROUP) +
        '?tab=expenses',
    ],
    [
      'Trip',
      process.env.PERCENTAGE_BROWSER_TRIP,
      '/trips/' +
        encodeURIComponent(process.env.PERCENTAGE_BROWSER_TRIP) +
        '?tab=expenses',
    ],
  ]) {
    const description = 'Real API browser percentage ' + context;
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    const errors = [];
    let committed;
    page.on('pageerror', (error) => errors.push(error.message));
    await seedSession(page.context(), origin, session);
    await page.route('**/api/onboarding-config', (r) =>
      r.fulfill({
        json: { url: authOrigin, key: 'synthetic-public' },
      }),
    );
    await page.route(authOrigin + '/auth/v1/**', (r) =>
      r.fulfill({ json: r.request().url().includes('/user') ? user : session }),
    );
    await page.route('**/api/graphql', async (r) => {
      const response = await r.fetch({
        url: process.env.PERCENTAGE_BROWSER_ENDPOINT + '/graphql',
      });
      const result = await response.json();
      if (
        r
          .request()
          .postDataJSON()
          .query.includes('mutation journeyCreateMutation')
      )
        committed = result.data?.createExpense;
      await r.fulfill({ response, json: result });
    });

    await page.goto(origin + entry);
    await page
      .getByRole('link', { name: 'Add expense', exact: true })
      .waitFor();
    await page.getByRole('link', { name: 'Add expense', exact: true }).click();
    if (context === 'Household') {
      await page
        .getByRole('combobox', { name: /Source space/ })
        .selectOption(group);
      assert.equal(
        await page.getByRole('combobox', { name: /Source space/ }).inputValue(),
        group,
      );
    }
    await page.locator('#expense-description').waitFor();
    assert.equal(await page.locator('#expense-split').inputValue(), 'EQUAL');
    await page.locator('#expense-description').fill(description);
    await page.locator('#expense-amount').fill('10.01');
    for (const name of ['Actor 3', 'Actor 4']) {
      const extra = page.getByRole('checkbox', { name, exact: true });
      if (await extra.count()) await extra.uncheck();
    }
    await page.locator('#expense-split').selectOption('PERCENTAGE');
    const inputs = page.locator('.percentage-input input');
    await inputs.first().fill('60');
    assert.equal(await inputs.nth(1).inputValue(), '40');
    await page.locator('.financial-form-card button[type="submit"]').click();
    await page.waitForFunction(
      () => !document.querySelector('#expense-description'),
    );
    assert.equal(committed.__typename, 'ExpenseCommitted');
    assert.equal(committed.record.split, 'PERCENTAGE');
    assert.equal(committed.record.groupId, group);
    assert.deepEqual(
      committed.record.allocations.map((a) => [
        a.amountMinor,
        a.percentageHundredths,
      ]),
      [
        ['601', 6000],
        ['400', 4000],
      ],
    );
    await page.goto(
      origin +
        entry +
        (entry.includes('?') ? '&' : '?') +
        'expense=' +
        encodeURIComponent(committed.record.expenseId) +
        '&expenseGroup=' +
        encodeURIComponent(group),
    );
    await page.getByRole('heading', { name: description }).waitFor();
    assert.deepEqual(
      await page.locator('.percentage-saved').allTextContents(),
      ['60%', '40%'],
    );
    assert(
      (await page.locator('.expense-allocation-list').innerText()).includes(
        '$6.01',
      ),
    );
    await page.reload();
    await page.getByRole('heading', { name: description }).waitFor();
    assert.deepEqual(
      await page.locator('.percentage-saved').allTextContents(),
      ['60%', '40%'],
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      context +
        ': real GraphQL create, source ownership, persisted detail and reload passed',
    );
  }
  await browser.close();
  console.log(
    'Real verified-actor GraphQL create, persisted detail and reload: passed',
  );
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
