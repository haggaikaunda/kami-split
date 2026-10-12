/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser acceptance using synthetic Auth/GraphQL. */
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function verifyRefresh({
  page,
  origin,
  workspace,
  width,
  scale,
  output,
  results,
  requests,
  documentCount,
  setOffline,
  setDenied,
}) {
  const url =
    workspace === 'group'
      ? '/trips/T?tab=expenses&category=GROCERIES'
      : '/household/expenses?category=GROCERIES';
  await page.goto(origin + url);
  await page.locator('#ledger-expense-e1').waitFor();
  await page.waitForFunction(
    (theme) => document.documentElement.dataset.theme === theme,
    process.env.THEME === 'system'
      ? process.env.COLOR_SCHEME || 'light'
      : process.env.THEME || 'light',
  );
  if (scale === 2)
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  const refresh = page.locator('.workspace-refresh button');
  assert.equal(await refresh.count(), 1, 'one refresh owner');
  assert.equal(
    await page
      .locator(
        '.workspace-navigation button, .ui-workspace-header .workspace-refresh',
      )
      .count(),
    0,
  );
  const beforeUrl = page.url();
  const docs = documentCount();
  const query =
    workspace === 'group'
      ? 'journeyWorkspaceQuery'
      : 'expensesHouseholdInitialQuery';
  const count = () => requests().filter((r) => r.op === query).length;
  const surface = page.locator('.workspace-loading-surface').first();
  const previousHeight = (await surface.boundingBox()).height;
  await refresh.focus();
  let before = count();
  await page.keyboard.press('Enter');
  await page.getByText('Updating…', { exact: true }).waitFor();
  const loadingHeight = (await surface.boundingBox()).height;
  assert(
    loadingHeight >= previousHeight,
    `loading preserves prior page geometry: ${loadingHeight} >= ${previousHeight}`,
  );
  await page.screenshot({
    path: path.join(output, `loading-${workspace}-${width}-${scale}.png`),
  });
  assert.equal(
    await page.locator('#ledger-expense-e1').count(),
    0,
    'no stale private rows',
  );
  await page.keyboard.press('Enter');
  await page.locator('#ledger-expense-e1').waitFor();
  await page.getByText('Up to date', { exact: true }).waitFor();
  assert.equal(count(), before + 1, 'repeat keyboard requests coalesce');
  assert.equal(
    await refresh.evaluate((b) => document.activeElement === b),
    true,
    'focus stays on refresh',
  );
  assert.equal(page.url(), beforeUrl);
  assert.equal(documentCount(), docs);
  await page.screenshot({
    path: path.join(output, `refresh-${workspace}-${width}-${scale}.png`),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'no horizontal overflow',
  );

  // CDP sends browser touch input through hit testing, not DOM-dispatched events.
  const cdp = await page.context().newCDPSession(page);
  let touchX = 12;
  async function drag(y, amount) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: touchX, y }],
    });
    for (let d = 10; d <= amount; d += 10) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: touchX, y: y + d }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  }
  await page.evaluate(() => scrollTo(0, 0));
  const point = await page.evaluate(() => {
    for (let y = 160; y < innerHeight - 240; y += 30) {
      for (const x of [12, innerWidth / 2, innerWidth - 12]) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest('main') &&
          !target.closest('nav, button, a, input, select, textarea, dialog')
        )
          return { x, y };
      }
    }
    throw new Error('No unobstructed page surface for top pull');
  });
  touchX = point.x;
  before = count();
  await drag(point.y, 120);
  await page.getByText('Updating…', { exact: true }).waitFor();
  await page.locator('#ledger-expense-e1').waitFor();
  assert.equal(count(), before + 1, 'top pull starts one app refresh');
  assert.equal(documentCount(), docs, 'custom pull does not reload document');
  await page.evaluate(() => scrollTo(0, 150));
  assert(await page.evaluate(() => scrollY > 0));
  before = count();
  await drag(400, 100);
  await page.waitForTimeout(400);
  assert.equal(count(), before, 'ordinary scroll does not refresh');

  await page.evaluate(() => scrollTo(0, 0));
  setOffline(true);
  await refresh.click();
  await page
    .getByText('Couldn’t refresh. Try again.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('#ledger-expense-e1').count(), 0);
  assert(await page.getByRole('alert').count());
  setOffline(false);
  await refresh.click();
  await page.locator('#ledger-expense-e1').waitFor();
  assert.equal(page.url(), beforeUrl);

  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const description = page.getByLabel('Description', { exact: true });
  await description.fill('Unsaved refresh draft');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await description.waitFor();

  assert.equal(await description.inputValue(), 'Unsaved refresh draft');
  // Close the form before testing access revocation of the owning page.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  setDenied(true);
  await page.locator('.workspace-refresh button').click();
  await page.getByRole('alert').first().waitFor();
  assert.equal(await page.locator('#ledger-expense-e1').count(), 0);
  assert.equal(
    await page.getByText('Fixture lunch', { exact: true }).count(),
    0,
  );
  setDenied(false);
  results.push({
    workspace,
    keyboardFocus: true,
    topTouchPull: true,
    belowTopScroll: true,
    coalesced: true,
    noDocumentReload: true,
    filterPreserved: true,
    offlineRetry: true,
    unsavedDraft: true,
    revocation: true,
    stableLoadingGeometry: true,
    width,
    scale,
  });
  await cdp.detach();
};
