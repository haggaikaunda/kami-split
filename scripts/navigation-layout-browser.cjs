/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in CommonJS browser regression runner. */
const assert = require('node:assert/strict');
const path = require('node:path');

// Called with the authenticated synthetic fixture from navigation-browser.cjs.
module.exports = async function verifyLayout({
  page,
  origin,
  workspace,
  width,
  scale,
  output,
  results,
}) {
  const overview =
    workspace === 'group' ? '/trips/T?tab=overview' : '/household';
  const expenses =
    workspace === 'group' ? '/trips/T?tab=expenses' : '/household/expenses';
  await page.goto(origin + overview);
  await page
    .getByRole('heading', { name: 'Recent expenses', exact: true })
    .waitFor();
  if (scale === 2)
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  const bannerHeight = (
    await page.locator('.ui-workspace-header').boundingBox()
  ).height;
  await page
    .locator('.ui-workspace-tabs')
    .getByRole('link', { name: 'Expenses', exact: true })
    .click();
  await page.locator('#ledger-expense-e40').waitFor();
  assert.equal(
    new URL(page.url()).pathname + new URL(page.url()).search,
    expenses,
  );
  const compactHeight = (
    await page.locator('.ui-workspace-header').boundingBox()
  ).height;
  assert(
    compactHeight < bannerHeight,
    `Working heading must be shorter than overview banner: ${compactHeight} vs ${bannerHeight}`,
  );

  async function geometry(label) {
    const metrics = await page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      return {
        header: box('.workspace-navigation-brand'),
        nav: box('.workspace-navigation-links'),
        last: box('#ledger-expense-e40'),
        content: box('.workspace-content'),
        width: innerWidth,
        height: innerHeight,
        scrollY,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(!metrics.overflow, `${label}: horizontal page overflow`);
    assert(
      metrics.header.y >= -1 && metrics.header.bottom < metrics.height,
      `${label}: header unavailable`,
    );
    assert(
      metrics.nav.y >= -1 && metrics.nav.bottom <= metrics.height + 1,
      `${label}: navigation unavailable`,
    );
    if (width > 600) {
      assert(
        metrics.content.width <= 72 * 16 * scale + 1,
        'Desktop content is constrained',
      );
      const leftGap = metrics.content.x - metrics.nav.right;
      const rightGap = metrics.width - metrics.content.right;
      assert(
        Math.abs(leftGap - rightGap) < 2,
        'Desktop content is centered beside the rail',
      );
    }
    results.push({ workspace, width, scale, label, ...metrics });
    await page.screenshot({
      path: path.join(output, `${workspace}-${label}.png`),
    });
    return metrics;
  }
  await page.evaluate(() => scrollTo(0, 0));
  await geometry('top');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  let metrics = await geometry('bottom');
  assert(metrics.last.y >= metrics.header.bottom, 'Final row below header');
  assert(
    metrics.last.bottom <= (width <= 600 ? metrics.nav.y : metrics.height),
    'Final row above navigation',
  );
  await page.locator('#ledger-expense-e40').focus();
  await page.keyboard.press('Shift+Tab');
  const focus = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    const header = document
      .querySelector('.workspace-navigation-brand')
      .getBoundingClientRect();
    const nav = document
      .querySelector('.workspace-navigation-links')
      .getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      headerBottom: header.bottom,
      navTop: nav.top,
    };
  });
  assert(
    focus.top >= focus.headerBottom - 1,
    'Keyboard focus is not behind header',
  );
  if (width <= 600)
    assert(
      focus.bottom <= focus.navTop + 1,
      'Keyboard focus is not behind bottom navigation',
    );

  await page.setViewportSize({ width, height: scale === 2 ? 600 : 420 });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  metrics = await geometry('short-viewport');
  assert(
    metrics.last.bottom <= (width <= 600 ? metrics.nav.y : metrics.height),
    'Short viewport final row unobscured',
  );
  await page.setViewportSize({ width, height: 900 });
  await page
    .locator('.workspace-navigation')
    .getByRole('link', { name: 'Account', exact: true })
    .click();
  await page.locator('.account-heading').waitFor();
  assert.equal(
    await page
      .locator('.workspace-navigation a[aria-current="page"]')
      .getAttribute('href'),
    '/account',
  );
  const account = await page.locator('.account-content').boundingBox();
  assert(account.width <= 46.25 * 16 * scale + 1, 'Settings width is narrower');
  await page.goBack();
  await page.locator('#ledger-expense-e40').waitFor();
  assert.equal(
    await page
      .locator('.workspace-navigation a[aria-current="page"]')
      .getAttribute('href'),
    workspace === 'group' ? '/trips' : '/household',
  );
  results.push({
    workspace,
    bannerHeight,
    compactHeight,
    accountWidth: account.width,
    keyboardFocus: true,
    routeBack: true,
  });
};
