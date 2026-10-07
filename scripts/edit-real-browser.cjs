/* eslint-disable @typescript-eslint/no-require-imports -- Optional integration runner loads externally installed Playwright. */
// Invoked only by a disposable real API/database fixture. Auth transport is fixture-local.
const { chromium } = require(process.env.EDIT_PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const origin = process.env.EDIT_BROWSER_ORIGIN;
  const user = {
    id: process.env.EDIT_BROWSER_SUBJECT,
    email: 'edit-browser@example.invalid',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-06T00:00:00Z',
  };
  const session = {
    access_token: process.env.EDIT_BROWSER_TOKEN,
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
  const evidence =
    process.env.EDIT_BROWSER_EVIDENCE || '/private/tmp/kami-edit-browser';
  fs.mkdirSync(evidence, { recursive: true });
  for (const [context, group, entry, activity] of [
    [
      'Aggregate',
      process.env.EDIT_BROWSER_GROUP,
      '/household/expenses',
      '/household/activity',
    ],
    [
      'Group',
      process.env.EDIT_BROWSER_GROUP,
      `/groups/${encodeURIComponent(process.env.EDIT_BROWSER_GROUP)}?tab=expenses`,
      `/groups/${encodeURIComponent(process.env.EDIT_BROWSER_GROUP)}?tab=activity`,
    ],
    [
      'Trip',
      process.env.EDIT_BROWSER_TRIP,
      `/trips/${encodeURIComponent(process.env.EDIT_BROWSER_TRIP)}?tab=expenses`,
      `/trips/${encodeURIComponent(process.env.EDIT_BROWSER_TRIP)}?tab=activity`,
    ],
    [
      'Household',
      process.env.EDIT_BROWSER_HOUSEHOLD,
      '/household/ledger?tab=expenses',
      '/household/ledger?tab=activity',
    ],
  ]) {
    assert(group, `Missing fixture ${context} source`);
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    const errors = [];
    let created, edited;
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
        url: process.env.EDIT_BROWSER_ENDPOINT + '/graphql',
      });
      const result = await response.json();
      const query = r.request().postDataJSON().query;
      if (query.includes('mutation journeyCreateMutation'))
        created = result.data?.createExpense;
      if (query.includes('mutation expenseEditMutation'))
        edited = result.data?.updateExpense;
      await r.fulfill({ response, json: result });
    });
    const description = `Real expense edit ${context} — shared dinner and supplies for our weekend with friends`;
    await page.goto(origin + entry);
    await page.locator('#ledger-add').click();
    if (context === 'Aggregate')
      await page
        .getByRole('combobox', { name: /Source space/ })
        .selectOption(group);
    await page.locator('#expense-description').fill(description);
    await page.locator('#expense-amount').fill('120.00');
    await page.locator('#expense-note').fill(' Original note ');
    await page
      .getByRole('button', { name: 'Save expense', exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('#expense-description'),
    );
    assert.equal(created?.__typename, 'ExpenseCommitted');
    assert.equal(created.record.groupId, group);
    const detail =
      origin +
      entry +
      (entry.includes('?') ? '&' : '?') +
      'expense=' +
      encodeURIComponent(created.record.expenseId) +
      '&expenseGroup=' +
      encodeURIComponent(group);
    await page.goto(detail);
    await page
      .getByRole('button', { name: 'Edit expense', exact: true })
      .click();
    assert.equal(await page.locator('#expense-amount').inputValue(), '120.00');
    assert.equal(
      await page.locator('#expense-note').inputValue(),
      ' Original note ',
    );
    assert(
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .isDisabled(),
    );
    await page.locator('#expense-amount').fill('100.00');
    await page
      .locator('#expense-note')
      .fill(
        'Corrected final bill. Includes the shared dinner and the additional supplies collected on the way home; actual repayments remain recorded separately.',
      );
    await page.screenshot({
      path: path.join(
        evidence,
        `${context.toLowerCase()}-edit-390-light-100.png`,
      ),
      fullPage: true,
    });
    await page.locator('#expense-category').selectOption('DINING');
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('#expense-description'),
    );
    assert.equal(edited?.__typename, 'ExpenseEditCommitted');
    assert.equal(edited.record.expenseId, created.record.expenseId);
    assert.equal(edited.record.totalMinor, '10000');
    assert.equal(edited.changed, true);
    await page.goto(detail);
    await page
      .getByRole('heading', { name: description, exact: true })
      .waitFor();
    assert(
      (await page.locator('.expense-detail-total').innerText()).includes(
        '$100.00',
      ),
    );
    await page.reload();
    await page
      .getByRole('heading', { name: description, exact: true })
      .waitFor();
    await page.goto(origin + activity);
    await page
      .getByRole('combobox', { name: 'Event type' })
      .selectOption('EXPENSE_UPDATED');
    const event = page
      .locator('.activity-events button')
      .filter({ hasText: description });
    await event.first().waitFor();
    assert(
      (await event.first().innerText()).includes(
        'Amount changed from $120.00 to $100.00.',
      ),
    );
    // Capture the chronological feed independently from its mobile detail state.
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: path.join(
          evidence,
          `${context.toLowerCase()}-feed-${width}-light-100.png`,
        ),
        fullPage: true,
      });
    }
    await event.first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.activity-fact-card').waitFor();
    assert(
      (await page.locator('.activity-detail').innerText()).includes('Previous'),
    );
    assert(
      (await page.locator('.activity-detail').innerText()).includes('$120.00'),
    );
    assert(
      (await page.locator('.activity-detail').innerText()).includes('$100.00'),
    );
    for (const width of [320, 390, 768, 1280])
      for (const theme of ['light', 'dark'])
        for (const scale of [100, 200]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: 'reduce',
          });
          await page.evaluate(
            (size) => (document.documentElement.style.fontSize = size + '%'),
            scale,
          );
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            `${context} overflow ${width}/${theme}/${scale}`,
          );
          assert.equal(
            await page.evaluate(
              () => getComputedStyle(document.documentElement).colorScheme,
            ),
            theme,
            'Actual application theme must follow the requested color scheme',
          );
          await page.screenshot({
            path: path.join(
              evidence,
              `${context.toLowerCase()}-activity-${width}-${theme}-${scale}.png`,
            ),
            fullPage: true,
          });
        }
    await page
      .getByRole('button', { name: 'Close detail', exact: true })
      .click();
    assert(await event.first().evaluate((e) => e === document.activeElement));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      context +
        ': real create/edit/reload + historical Activity, responsive themes/text, focus passed',
    );
  }
  await browser.close();
  console.log('Edit browser evidence: ' + evidence);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
