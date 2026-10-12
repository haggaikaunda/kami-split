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
  await page.screenshot({
    path: path.join(output, `ledger-${workspace}-${width}-${scale}.png`),
    fullPage: true,
  });
  results.push({
    workspace,
    width,
    scale,
    ...metrics,
    completeMonthTotals: true,
    keyboardDetailFocus: true,
    multipleMonths: true,
  });
};
