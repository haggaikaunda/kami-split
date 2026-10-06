/* eslint-disable @typescript-eslint/no-require-imports -- Optional integration runner loads externally installed Playwright. */
// Invoked only by the disposable expense integration fixture. No hosted credentials.
const { chromium } = require(process.env.PERCENTAGE_PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
(async () => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  let committed;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    (s) => localStorage.setItem('kami-auth', JSON.stringify(s)),
    session,
  );
  await page.route('**/api/onboarding-config', (r) =>
    r.fulfill({
      json: { url: origin + '/fixture-auth', key: 'fixture-public' },
    }),
  );
  await page.route('**/fixture-auth/auth/v1/**', (r) =>
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
  const group = process.env.PERCENTAGE_BROWSER_GROUP;
  await page.goto(
    origin + '/groups/' + encodeURIComponent(group) + '?tab=expenses',
  );
  await page.locator('#ledger-add').waitFor();
  await page.locator('#ledger-add').click();
  await page.locator('#expense-description').waitFor();
  await page
    .locator('#expense-description')
    .fill('Real API browser percentage');
  await page.locator('#expense-amount').fill('10.01');
  await page.getByRole('checkbox', { name: 'Actor 3', exact: true }).uncheck();
  await page.locator('#expense-split').selectOption('PERCENTAGE');
  const inputs = page.locator('.percentage-input input');
  await inputs.first().fill('60');
  assert.equal(await inputs.nth(1).inputValue(), '40');
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('#expense-description'),
  );
  assert.equal(committed.__typename, 'ExpenseCommitted');
  assert.equal(committed.record.split, 'PERCENTAGE');
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
      '/groups/' +
      encodeURIComponent(group) +
      '?tab=expenses&expense=' +
      encodeURIComponent(committed.record.expenseId) +
      '&expenseGroup=' +
      encodeURIComponent(group),
  );
  await page
    .getByRole('heading', { name: 'Real API browser percentage' })
    .waitFor();
  assert.deepEqual(await page.locator('.percentage-saved').allTextContents(), [
    '60%',
    '40%',
  ]);
  assert(
    (await page.locator('.expense-allocation-list').innerText()).includes(
      '$6.01',
    ),
  );
  await page.reload();
  await page
    .getByRole('heading', { name: 'Real API browser percentage' })
    .waitFor();
  assert.deepEqual(await page.locator('.percentage-saved').allTextContents(), [
    '60%',
    '40%',
  ]);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'Real verified-actor GraphQL create, persisted detail and reload: passed',
  );
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
