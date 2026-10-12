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
  await page.goto(
    origin +
      (workspace === 'group' ? '/trips/T?tab=expenses' : '/household/expenses'),
  );
  await page.locator('#ledger-expense-e1').waitFor();
  if (scale === 2)
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  const header = page.locator('.ledger-month > header').first();
  assert.match(await header.innerText(), /October 2026/);
  assert.match(await header.innerText(), /\$24.00\s+USD\s+· 8 expenses/);
  assert.equal(await page.locator('.ledger-month details').count(), 0);
  assert.equal(await page.locator('.ledger-month li').count(), 6);
  assert.match(
    await page.locator('.ledger-payer').first().innerText(),
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
      payer: box('.ledger-payer'),
      amount: box('.ledger-money'),
      columns: getComputedStyle(document.querySelector('.ledger-columns'))
        .display,
    };
  });
  assert(!metrics.overflow, 'Long labels must not overflow the page');
  assert(
    metrics.amount.right <= metrics.row.right,
    'Amount must fit inside the row',
  );
  if (width === 1440 && scale === 1) assert.equal(metrics.columns, 'grid');
  if (width <= 390) assert.equal(metrics.columns, 'none');
  await page.locator('#ledger-expense-e1').focus();
  await page.keyboard.press('Enter');
  await page.locator('.expense-presentation').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-e1',
  );
  await page
    .getByRole('button', { name: 'Load more expenses', exact: true })
    .click();
  await page.locator('#ledger-expense-e9').waitFor();
  assert.equal(await page.locator('.ledger-month li').count(), 9);
  assert.match(await header.innerText(), /\$24.00\s+USD\s+· 8 expenses/);
  assert.match(
    await page.locator('.ledger-month > header').nth(1).innerText(),
    /September 2026.*\$3.00\s+USD\s+· 1 expense/s,
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
    await page.locator('.ledger-month li').count(),
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
      .locator('.ledger-filter-button')
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
  });
};
