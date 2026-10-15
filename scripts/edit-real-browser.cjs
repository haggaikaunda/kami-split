/* eslint-disable @typescript-eslint/no-require-imports -- Optional integration runner loads externally installed Playwright. */
// Invoked only by a disposable real API/database fixture. Auth transport is fixture-local.
const { chromium } = require(process.env.EDIT_PLAYWRIGHT_MODULE);
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
withAuthFixture(origin, session, async () => {
  // Theme regression checks intentionally follow OS changes through the real
  // persisted System preference; the product default remains Light.
  const preference = await fetch(
    process.env.EDIT_BROWSER_ENDPOINT + '/graphql',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.EDIT_BROWSER_TOKEN,
      },
      body: JSON.stringify({
        query:
          'mutation BrowserAppearance { updateMyAppearance(appearance: SYSTEM, expectedAppearance: LIGHT) { __typename ... on Profile { appearance } } }',
      }),
    },
  );
  const preferenceResult = await preference.json();
  assert.equal(preferenceResult.data?.updateMyAppearance?.appearance, 'SYSTEM');
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
    await page.getByRole('link', { name: 'Add expense', exact: true }).click();
    if (context === 'Aggregate')
      await page
        .getByRole('combobox', { name: /Source space/ })
        .selectOption(group);
    await page.locator('#expense-description').fill(description);
    await page.locator('#expense-amount').fill('120.00');
    if (!(await page.locator('#expense-note').isVisible()))
      await page
        .getByRole('button', { name: 'Add optional note', exact: true })
        .click();
    await page.locator('#expense-note').fill(' Original note ');
    await page.locator('.financial-form-card button[type="submit"]').click();
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
    // Persist an actual-transfer record through the authorized API so the feed
    // comparison includes all three supported event types, without synthetic rows.
    const repaymentResponse = await page.request.post(
      process.env.EDIT_BROWSER_ENDPOINT + '/graphql',
      {
        headers: { Authorization: 'Bearer ' + process.env.EDIT_BROWSER_TOKEN },
        data: {
          query:
            'mutation($input:RecordRepaymentInput!){recordRepayment(input:$input){__typename}}',
          variables: {
            input: {
              groupId: group,
              key: require('node:crypto').randomUUID(),
              senderId: created.record.allocations[1].participantId,
              recipientId: created.record.allocations[0].participantId,
              amountMinor: '100',
              currency: 'USD',
              effectiveDate: '2026-10-06',
              note: 'Recorded transfer for shared dinner.',
            },
          },
        },
      },
    );
    assert.equal(
      (await repaymentResponse.json()).data?.recordRepayment.__typename,
      'RepaymentCommitted',
    );
    await page.goto(origin + activity);
    await page.getByRole('combobox', { name: 'Event type' }).selectOption('');
    const event = page
      .getByRole('button', { name: /updated an expense/ })
      .filter({ hasText: description });
    await event.first().waitFor();
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
    await page.locator('[data-ui~="activity-facts"]').waitFor();
    // The source-aligned feed shows the current amount; verify the complete
    // change description in its labeled historical Amount row instead.
    const amountChange = page
      .locator('[data-ui~="activity-facts"] > div')
      .filter({
        has: page.locator('dt', { hasText: /^Amount$/ }),
      });
    assert.equal(await amountChange.count(), 1);
    assert.equal(
      (await amountChange.locator('[data-ui~="activity-previous"]').innerText())
        .replace(/\s+/g, ' ')
        .trim(),
      'PREVIOUS $120.00 USD',
      'The historical amount must preserve the exact previous value',
    );
    assert.equal(
      (await amountChange.locator('[data-ui~="activity-new"]').innerText())
        .replace(/\s+/g, ' ')
        .trim(),
      'NEW $100.00 USD',
      'The historical amount must preserve the exact new value',
    );
    assert(
      (await page.locator('[data-ui~="activity-detail"]').innerText())
        .toLowerCase()
        .includes('previous'),
    );
    assert(
      (await page.locator('[data-ui~="activity-detail"]').innerText()).includes(
        '$120.00',
      ),
    );
    assert(
      (await page.locator('[data-ui~="activity-detail"]').innerText()).includes(
        '$100.00',
      ),
    );
    for (const width of [320, 390, 768, 1280])
      for (const theme of ['light', 'dark'])
        for (const scale of [100, 200]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: 'reduce',
          });
          await page.waitForFunction(
            (value) => document.documentElement.dataset.theme === value,
            theme,
          );
          await page.evaluate(
            (size) => (document.documentElement.style.fontSize = size + '%'),
            scale,
          );
          const overflow = await page.evaluate(() => ({
            width: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            elements: [...document.querySelectorAll('body *')]
              .filter(
                (element) =>
                  element.getClientRects().length &&
                  element.getBoundingClientRect().right > window.innerWidth + 1,
              )
              .map((element) => ({
                tag: element.tagName,
                className: String(element.className),
                left: element.getBoundingClientRect().left,
                right: element.getBoundingClientRect().right,
              })),
          }));
          if (overflow.scrollWidth > overflow.width + 1) {
            await page.screenshot({
              path: path.join(
                evidence,
                `${context.toLowerCase()}-overflow-${width}-${theme}-${scale}.png`,
              ),
              fullPage: true,
            });
          }
          assert(
            overflow.scrollWidth <= overflow.width + 1,
            `${context} overflow ${width}/${theme}/${scale}: ${JSON.stringify(overflow)}`,
          );
          assert.equal(
            await page.evaluate(
              () => getComputedStyle(document.documentElement).colorScheme,
            ),
            theme,
            'Actual application theme must follow the requested color scheme',
          );
          const contrast = await page
            .locator('[data-ui~="activity-row-content"] > span:nth-child(2)')
            .first()
            .evaluate((element) => {
              const rgb = (value) => value.match(/[\d.]+/g).map(Number);
              const luminance = (value) =>
                rgb(value)
                  .slice(0, 3)
                  .map((v) => {
                    const s = v / 255;
                    return s <= 0.04045
                      ? s / 12.92
                      : ((s + 0.055) / 1.055) ** 2.4;
                  })
                  .reduce(
                    (sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i],
                    0,
                  );
              let parent = element;
              while (
                parent.parentElement &&
                rgb(getComputedStyle(parent).backgroundColor)[3] === 0
              )
                parent = parent.parentElement;
              const a = luminance(getComputedStyle(element).color);
              const b = luminance(getComputedStyle(parent).backgroundColor);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            });
          assert(
            contrast >= 4.5,
            `${context} feed text contrast ${contrast} ${theme}`,
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
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(
      () => (document.documentElement.style.fontSize = '100%'),
    );
    await page
      .getByRole('button', { name: /added an expense/ })
      .filter({ hasText: description })
      .click();
    await page.locator('[data-ui~="activity-facts"]').waitFor();
    assert(
      (
        await page.locator('[data-ui~="activity-detail-amount"]').innerText()
      ).includes('$120.00'),
      'Creation detail remains the original snapshot',
    );
    await page.screenshot({
      path: path.join(evidence, `${context.toLowerCase()}-created-detail.png`),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Close detail', exact: true })
      .click();
    await page
      .getByRole('button', { name: /recorded a repayment/ })
      .first()
      .click();
    await page.locator('[data-ui~="activity-facts"]').waitFor();
    assert(
      (await page.locator('[data-ui~="activity-detail"]').innerText()).includes(
        'actual transfer',
      ),
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `${context.toLowerCase()}-repayment-detail.png`,
      ),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      context +
        ': real create/edit/reload + historical Activity, responsive themes/text, focus passed',
    );
  }
  await browser.close();
  console.log('Edit browser evidence: ' + evidence);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
