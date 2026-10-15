/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser acceptance runner. */
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function verifyLedger({
  page,
  origin,
  workspace,
  width,
  scale,
  output,
  results,
}) {
  let failedPage = false;
  let pageRequests = 0;
  await page.route('**/api/graphql', async (route) => {
    const { variables } = route.request().postDataJSON();
    if (variables.after) {
      pageRequests++;
      if (!failedPage) {
        failedPage = true;
        await route.abort('failed');
        return;
      }
    }
    await route.fallback();
  });
  await page.goto(
    origin +
      (workspace === 'group' ? '/trips/T?tab=expenses' : '/household/expenses'),
  );
  await page.locator('#ledger-expense-e1').waitFor();
  const freshReturn = async (action) => {
    const response = page.waitForResponse((r) => {
      const request = r.request();
      if (!request.url().endsWith('/api/graphql')) return false;
      const body = request.postDataJSON();
      return (
        /expenses(?:Group|Household)Query/.test(body?.query || '') &&
        !body.variables.after
      );
    });
    await action();
    await response;
    await page
      .locator('#ledger-expense-e9')
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({
          path: path.join(output, 'fresh-return-failure.png'),
          fullPage: true,
        });
        throw error;
      });
  };
  if (scale === 2)
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  const header = page.locator('[data-ui~="ledger-month"] > header').first();
  assert.match(await header.innerText(), /October 2026/);
  assert.match(await header.innerText(), /8 expenses\s*\$24.00\s+USD/);
  assert.equal(
    await page.locator('[data-ui~="ledger-month"] details').count(),
    0,
  );
  assert.equal(
    await header.locator('[data-ui~="ledger-month-count"]').innerText(),
    '8 expenses',
  );
  assert(
    !/expenses/.test(
      await header.locator('[data-ui~="ledger-month-total"]').innerText(),
    ),
  );
  assert.equal(await page.locator('[data-ui~="ledger-month"] li').count(), 6);
  assert.match(
    await page.locator('[data-ui~="ledger-payer"]').first().innerText(),
    /Long payer name/,
  );
  const metrics = await page.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x, right: r.right, width: r.width };
    };
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      row: box('#ledger-expense-e1'),
      payer: box('[data-ui~="ledger-payer"]'),
      amount: box('[data-ui~="ledger-money"]'),
      columns: getComputedStyle(
        document.querySelector('[data-ui~="ledger-columns"]'),
      ).display,
    };
  });
  assert(!metrics.overflow, 'Long labels must not overflow the page');
  assert(
    metrics.amount.right <= metrics.row.right,
    'Amount must fit inside the row',
  );
  if (width === 1440 && scale === 1) assert.equal(metrics.columns, 'grid');
  if (width <= 390) assert.equal(metrics.columns, 'none');
  assert.equal(
    await page.getByText('Balance details', { exact: true }).count(),
    0,
  );
  if (width <= 440 && scale === 1) {
    const toggle = await page
      .locator('[data-ui~="ledger-view-switch"]')
      .boundingBox();
    const filter = await page
      .locator('[data-ui~="ledger-filter-button"]')
      .boundingBox();
    assert(
      Math.abs(toggle.y + toggle.height / 2 - filter.y - filter.height / 2) < 2,
      'Filters aligns with view toggle',
    );
    assert(
      filter.x > toggle.x + toggle.width,
      'Filters sits right of view toggle',
    );
    const compact = await page.locator('#ledger-expense-e2').evaluate((row) => {
      const box = (selector) =>
        row.querySelector(selector).getBoundingClientRect();
      const payer = box('[data-ui~="ledger-payer"]');
      const amount = box('[data-ui~="ledger-money"]');
      return {
        height: row.getBoundingClientRect().height,
        payerRight: payer.right,
        payerBottom: payer.bottom,
        amountLeft: amount.left,
        amountTop: amount.top,
        categoryDisplay: getComputedStyle(
          row.querySelector('[data-ui~="ledger-category-text"]'),
        ).display,
      };
    });
    await page.screenshot({
      path: path.join(output, `compact-${workspace}-${width}-${scale}.png`),
      fullPage: true,
    });
    assert(
      compact.height <= 130,
      `Ordinary phone rows stay compact: ${JSON.stringify(compact)}`,
    );
    assert(
      compact.amountLeft >= compact.payerRight,
      'Amount stays right of payer',
    );
    assert(
      compact.amountTop < compact.payerBottom,
      'Amount stays alongside left details',
    );
    assert.equal(compact.categoryDisplay, 'none');
    assert.match(
      await page
        .locator('#ledger-expense-e2 [data-ui~="ledger-payer"]')
        .innerText(),
      /Paid by Sasha/,
    );
    results.push({ workspace, width, scale, compact });
  }
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Retry loading expenses' }).waitFor();
  assert.equal(
    pageRequests,
    1,
    'Failed automatic page is not retried automatically',
  );
  assert.equal(
    await page.locator('[data-ui~="ledger-month"] li').count(),
    6,
    'Authorized loaded rows survive transport failure',
  );
  await page.getByRole('button', { name: 'Retry loading expenses' }).click();
  await page.locator('#ledger-expense-e9').waitFor();
  assert.equal(pageRequests, 2, 'Explicit retry dispatches exactly once');
  await page
    .getByRole('status')
    .filter({ hasText: 'All expenses loaded.' })
    .waitFor();
  await page.locator('#ledger-expense-e1').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-ui~="expense-presentation"]').waitFor();
  await freshReturn(() => page.keyboard.press('Escape'));
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-e1',
  );
  const returnRow = page.locator('#ledger-expense-e8');
  await returnRow.scrollIntoViewIfNeeded();
  await returnRow.focus();
  const beforeDetail = await returnRow.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  await page.keyboard.press('Enter');
  await page.locator('[data-ui~="expense-presentation"]').waitFor();
  await freshReturn(() => page.goBack());
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-e8',
  );
  assert.equal(
    await page.locator('[data-ui~="ledger-month"] li').count(),
    9,
    'Back replays enough freshly authorized pages',
  );
  assert(
    Math.abs(
      (await returnRow.evaluate((el) => el.getBoundingClientRect().top)) -
        beforeDetail,
    ) < 3,
    'Back restores row viewport position',
  );
  await page.goForward();
  await page.locator('[data-ui~="expense-presentation"]').waitFor();
  await freshReturn(() => page.keyboard.press('Escape'));
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-e8',
  );
  await returnRow.focus();
  const beforeEdit = await returnRow.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  await page.locator('#expense-description').fill('Edited late expense');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .locator('[data-ui~="expense-presentation"]')
    .getByText('Edited late expense', { exact: true })
    .waitFor();
  await freshReturn(() => page.keyboard.press('Escape'));
  await page
    .waitForFunction(() => document.activeElement?.id === 'ledger-expense-e8')
    .catch(async (error) => {
      await page.screenshot({
        path: path.join(output, 'edit-return-failure.png'),
        fullPage: true,
      });
      throw error;
    });
  assert.match(await returnRow.innerText(), /Edited late expense/);
  assert(
    Math.abs(
      (await returnRow.evaluate((el) => el.getBoundingClientRect().top)) -
        beforeEdit,
    ) < 3,
    'Saved edit remount restores the authorized late row offset',
  );
  assert.equal(await page.locator('[data-ui~="ledger-month"] li').count(), 9);
  assert.match(await header.innerText(), /8 expenses\s*\$24.00\s+USD/);
  assert.match(
    await page.locator('[data-ui~="ledger-month"] > header').nth(1).innerText(),
    /September 2026.*1 expense\s*\$3.00\s+USD/s,
  );
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  await dialog.getByLabel('Groceries', { exact: true }).check();
  await dialog.getByLabel('Dining', { exact: true }).check();
  await dialog.locator('input[name="paidByIds"]').first().check();
  await dialog.locator('input[name="memberIds"]').first().check();
  await dialog.getByLabel(/^Date preset/).selectOption('last7');
  assert.equal(
    await dialog.locator('input[name="from"]').inputValue(),
    '2026-09-29',
  );
  assert.equal(
    await dialog.locator('input[name="to"]').inputValue(),
    '2026-10-05',
  );
  await dialog.getByLabel(/^Sort/).selectOption('AMOUNT_DESC');
  await dialog.getByRole('button', { name: 'Apply filters' }).click();
  await page.waitForURL(
    (url) => url.searchParams.get('sort') === 'AMOUNT_DESC',
  );
  await page.locator('#ledger-expense-e1').waitFor();
  assert.deepEqual(
    new URL(page.url()).searchParams.getAll('categories').sort(),
    ['DINING', 'GROCERIES'],
  );
  assert.equal(
    await page.locator('[data-ui~="ledger-month"] li').count(),
    6,
    'Filter resets loaded traversal',
  );
  assert(
    await page
      .getByRole('region', { name: 'Monthly totals', exact: true })
      .isVisible(),
  );
  assert(
    await page
      .locator('[data-ui~="ledger-filter-button"]')
      .evaluate((el) => el === document.activeElement),
    'Apply restores filter trigger focus',
  );
  await page
    .getByRole('button', { name: 'Remove Dining', exact: true })
    .click();
  await page.waitForURL(
    (url) => url.searchParams.getAll('categories').length === 1,
  );
  assert(new URL(page.url()).searchParams.has('paidByIds'));
  await page.goBack();
  await page.waitForURL(
    (url) => url.searchParams.getAll('categories').length === 2,
  );
  await page.locator('#ledger-expense-e1').waitFor();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await dialog.waitFor();
  await page.keyboard.press('Tab');
  assert(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    'Keyboard remains in dialog',
  );
  assert(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    'Filter controls fit dialog',
  );
  await page.screenshot({
    path: path.join(output, `filters-${workspace}-${width}-${scale}.png`),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has('sort'));
  await page.locator('#ledger-expense-e1').waitFor();
  await page.screenshot({
    path: path.join(output, `ledger-${workspace}-${width}-${scale}.png`),
    fullPage: true,
  });
  results.push({
    workspace,
    width,
    scale,
    ...metrics,
    combinedMultiValueFilters: true,
    inclusiveCalendarPreset: true,
    amountOrderPresentation: true,
    individualChipAndBack: true,
    applyFocusRestoration: true,
    filterDialogKeyboardAndOverflow: true,
    completeMonthTotals: true,
    keyboardDetailFocus: true,
    multipleMonths: true,
    automaticNearEnd: true,
    explicitRetryWithoutLoop: true,
    loadedRowsAndPositionAfterBackForward: true,
    savedEditRemountRestoration: true,
  });
};
