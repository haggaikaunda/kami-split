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
    await page.locator('[data-ui~="workspace-navigation-brand"]').boundingBox()
  ).height;
  await page
    .locator('[data-ui~="workspace-tabs"]')
    .getByRole('link', { name: 'Expenses', exact: true })
    .click();
  await page.locator('#ledger-expense-e40').waitFor();
  assert.equal(
    new URL(page.url()).pathname + new URL(page.url()).search,
    expenses,
  );
  const compactHeight = (
    await page.locator('[data-ui~="workspace-navigation-brand"]').boundingBox()
  ).height;
  assert(
    compactHeight <= bannerHeight + 1,
    `Compact working header must not grow beyond overview: ${compactHeight} vs ${bannerHeight}`,
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
        header: box('[data-ui~="workspace-navigation-brand"]'),
        nav: box('[data-ui~="workspace-navigation-links"]'),
        last: box('#ledger-expense-e40'),
        content: box('[data-ui~="workspace-content"]'),
        width: innerWidth,
        height: innerHeight,
        scrollY,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(!metrics.overflow, `${label}: horizontal page overflow`);
    assert(
      Math.abs(metrics.header.y) <= 1 && metrics.header.bottom < metrics.height,
      `${label}: header unavailable`,
    );
    assert(
      metrics.nav.y >= -1 && metrics.nav.bottom <= metrics.height + 1,
      `${label}: navigation unavailable`,
    );
    if (width <= 600) {
      assert(
        Math.abs(metrics.nav.bottom - metrics.height) <= 1,
        `${label}: mobile navigation must touch the bottom edge`,
      );
    }
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
  const initial = await geometry('top');
  assert(
    initial.content.y >= initial.header.bottom,
    'Initial content below header',
  );
  assert(
    initial.content.y - initial.header.bottom < 24 * scale,
    'In-flow header must not reserve its height twice',
  );
  for (const delta of [180, 240, -120]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(100);
    await geometry(`wheel-${delta}`);
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  let metrics = await geometry('bottom');
  // Enlarged household rows can be taller than the usable viewport: both
  // ends must be reachable, but need not fit simultaneously.
  await page
    .locator('#ledger-expense-e40')
    .evaluate((row) => row.scrollIntoView({ block: 'start' }));
  const lastTop = await page.locator('#ledger-expense-e40').boundingBox();
  assert(
    lastTop.y >= metrics.header.bottom - 1,
    'Final row top reachable below header',
  );
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  assert(
    metrics.last.bottom <= (width <= 600 ? metrics.nav.y : metrics.height),
    'Final row above navigation',
  );
  await page.locator('#ledger-expense-e40').focus();
  await page.keyboard.press('Shift+Tab');
  const focus = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    const header = document
      .querySelector('[data-ui~="workspace-navigation-brand"]')
      .getBoundingClientRect();
    const nav = document
      .querySelector('[data-ui~="workspace-navigation-links"]')
      .getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      headerBottom: header.bottom,
      navTop: innerWidth <= 600 ? nav.top : innerHeight,
    };
  });
  assert(
    focus.bottom > focus.headerBottom &&
      (focus.top >= focus.headerBottom - 1 ||
        focus.bottom - focus.top > focus.navTop - focus.headerBottom),
    'Keyboard focus is not behind header',
  );
  if (width <= 600)
    assert(
      focus.top < focus.navTop &&
        (focus.bottom <= focus.navTop + 1 ||
          focus.bottom - focus.top > focus.navTop - focus.headerBottom),
      'Keyboard focus is not behind bottom navigation',
    );

  await page.evaluate(() => document.activeElement?.blur());
  await page.setViewportSize({ width, height: scale === 2 ? 600 : 420 });
  await page.waitForTimeout(100);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  metrics = await geometry('short-viewport');
  assert(
    metrics.last.bottom <= (width <= 600 ? metrics.nav.y : metrics.height),
    'Short viewport final row unobscured',
  );
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  await dialog.waitFor();
  const dateBounds = await dialog.evaluate((el) => {
    const d = el.getBoundingClientRect();
    return [...el.querySelectorAll('input[type=date]')].map((i) => {
      const r = i.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        dialogLeft: d.left,
        dialogRight: d.right,
        width: r.width,
        scroll: i.scrollWidth,
        client: i.clientWidth,
      };
    });
  });
  results.push({ workspace, dateBounds });
  await page.screenshot({
    path: path.join(output, workspace + '-filters.png'),
  });
  for (const b of dateBounds)
    assert(
      b.left >= b.dialogLeft && b.right <= b.dialogRight,
      'Date controls within dialog bounds',
    );
  await page.keyboard.press('Escape');

  await page
    .locator('[data-ui~="workspace-navigation"]')
    .getByRole('link', { name: 'Profile', exact: true })
    .click();
  await page.locator('[data-ui~="account-heading"]').waitFor();
  assert.equal(
    await page
      .locator('[data-ui~="workspace-navigation"] a[aria-current="page"]')
      .getAttribute('href'),
    '/account',
  );
  await page.evaluate(() => scrollTo(0, 0));
  const shortPage = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    contentTop: document
      .querySelector('[data-ui~="account-content"]')
      .getBoundingClientRect().top,
    headerBottom: document
      .querySelector('[data-ui~="workspace-navigation-brand"]')
      .getBoundingClientRect().bottom,
  }));
  assert(!shortPage.overflow, 'Account no horizontal overflow');
  assert(
    shortPage.contentTop >= shortPage.headerBottom,
    'Account starts below header',
  );
  const account = await page
    .locator('[data-ui~="account-content"]')
    .boundingBox();
  assert(account.width <= 46.25 * 16 * scale + 1, 'Settings width is narrower');
  await page.goBack();
  await page.locator('#ledger-expense-e40').waitFor();
  assert.equal(
    await page
      .locator('[data-ui~="workspace-navigation"] a[aria-current="page"]')
      .getAttribute('href'),
    workspace === 'group' ? '/groups' : '/household',
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
