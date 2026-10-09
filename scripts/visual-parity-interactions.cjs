/* eslint-disable @typescript-eslint/no-require-imports -- Standalone guarded synthetic browser checks. */
// Development support evidence, not an independent acceptance verdict.
// Run only with visual-parity-fixture.cjs. SCENARIOS may select comma-separated cases.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.BROWSER_ORIGIN || 'http://localhost:3228';
const output = process.env.OUTPUT_DIR || '/tmp/kami-visual-interactions';
const selected = process.env.SCENARIOS?.split(',');
fs.mkdirSync(output, { recursive: true });
const cases = [];
const test = (name, work) => {
  if (
    !selected ||
    selected.includes(name) ||
    selected.some(
      (prefix) => prefix.endsWith('*') && name.startsWith(prefix.slice(0, -1)),
    )
  )
    cases.push({ name, work });
};
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
async function ready(page, route, state = 'complete', theme = 'light') {
  await page.request.get(origin + '/__fixture/reset');
  await page.request.get(
    `${origin}/__fixture/health?fixtureState=${state}&fixtureTheme=${theme}`,
  );
  await page.goto(origin + route, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    theme,
  );
  await page.evaluate(() => document.fonts.ready);
}
async function filters(page) {
  await page.getByRole('button', { name: /^Filters/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  await dialog.waitFor();
  return dialog;
}
async function closedDetail(page) {
  await page.waitForURL((url) => !url.searchParams.has('expense'));
  await page.locator('.expense-presentation').waitFor({ state: 'detached' });
}
async function snapshot(page, name) {
  const overlay = await page.locator('dialog[open]').count();
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: !overlay,
  });
  await page.screenshot({
    path: path.join(output, `${name}-viewport.png`),
    fullPage: false,
  });
  return page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    bodyFont: getComputedStyle(document.body).fontSize,
    rootFont: getComputedStyle(document.documentElement).fontSize,
    focus: {
      id: document.activeElement?.id,
      text: document.activeElement?.textContent?.slice(0, 100),
    },
    headings: [...document.querySelectorAll('h1,h2,h3')]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.textContent),
    alerts: [...document.querySelectorAll('[role=alert]')]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.textContent),
    outsideViewport: [...document.querySelectorAll('body *')]
      .filter((e) => e.getClientRects().length)
      .map((e) => ({ element: e, bounds: e.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.left < -1 || bounds.right > innerWidth + 1)
      .map(({ element, bounds }) => ({
        selector:
          element.tagName.toLowerCase() +
          (element.className
            ? '.' + String(element.className).trim().replaceAll(' ', '.')
            : ''),
        text: element.textContent.slice(0, 100),
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
      }))
      .slice(0, 30),
    summaryGeometry: [
      ...document.querySelectorAll(
        '.ui-summary-row,.ui-summary-metric,.ui-signed-balance,.ui-metric-value,.ui-workspace-header,.workspace-heading,.workspace-title,.banner-action',
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .map((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          selector: e.className,
          width: r.width,
          scrollWidth: e.scrollWidth,
          font: s.fontSize,
          display: s.display,
          flex: s.flex,
          flexWrap: s.flexWrap,
          grid: s.gridTemplateColumns,
          minWidth: s.minWidth,
        };
      }),
  }));
}
async function longMoneyMetrics(page) {
  return page.locator('.ui-money--long').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const value = element.querySelector('.ui-money-value'),
          r = value.getBoundingClientRect();
        const owner =
            element.closest(
              '.ui-summary-metric,.overview-expense-price,.ledger-money,.expense-detail-total',
            ) || element.parentElement,
          bounds = owner.getBoundingClientRect(),
          style = getComputedStyle(owner),
          ownStyle = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(value);
        const text = range.getBoundingClientRect();
        const legalPan =
          ['auto', 'scroll'].includes(ownStyle.overflowX) &&
          element.tabIndex >= 0 &&
          !!element.getAttribute('aria-label');
        const availableLeft = bounds.left + parseFloat(style.paddingLeft),
          availableRight = bounds.right - parseFloat(style.paddingRight);
        return {
          text: value.textContent,
          textWidth: text.width,
          valueWidth: r.width,
          ownerWidth: bounds.width,
          availableWidth: availableRight - availableLeft,
          safe:
            legalPan ||
            (text.left >= availableLeft - 1 &&
              text.right <= availableRight + 1),
          ellipsis: [ownStyle, getComputedStyle(value), style].some(
            (s) => s.textOverflow === 'ellipsis',
          ),
          legalPan,
          owner: owner.className,
        };
      }),
  );
}
test('six-row-pagination', async (page) => {
  await ready(page, '/household/expenses');
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 6,
  );
  await page
    .getByRole('button', { name: /Load more expenses|Show more/ })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 12,
  );
  await page
    .getByRole('button', { name: /Load more expenses|Show more/ })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 16,
  );
  const ids = await page
    .locator('.ledger-month li a')
    .evaluateAll((elements) => elements.map((element) => element.id));
  assert.equal(new Set(ids).size, 16);
  return snapshot(page, 'six-row-pagination');
});
test('five-and-filters-and-chart', async (page) => {
  await ready(page, '/household/expenses');
  let dialog = await filters(page);
  const expected = {
    groupId: 'F',
    category: 'HOME',
    memberId: 'M0',
    from: '2026-10-02',
    to: '2026-10-07',
  };
  for (const key of ['groupId', 'category', 'memberId'])
    await dialog.locator(`[name=${key}]`).selectOption(expected[key]);
  for (const key of ['from', 'to'])
    await dialog.locator(`[name=${key}]`).fill(expected[key]);
  await dialog.getByRole('button', { name: 'Apply filters' }).click();
  await page.waitForURL((url) =>
    Object.entries(expected).every(
      ([key, value]) => url.searchParams.get(key) === value,
    ),
  );
  await page.locator('.ledger-description strong').first().waitFor();
  assert.deepEqual(
    await page.locator('.ledger-description strong').allTextContents(),
    ['Internet', 'Household supplies', 'Electricity'],
  );
  dialog = await filters(page);
  await dialog.locator('[name=category]').selectOption('DINING');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(
    params(page).category,
    'HOME',
    'Cancel preserves applied filters.',
  );
  dialog = await filters(page);
  await dialog
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  for (const key of Object.keys(expected))
    assert.equal(await dialog.locator(`[name=${key}]`).inputValue(), '');
  assert.equal(params(page).category, 'HOME', 'Reset is staged until Apply.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Breakdown', exact: true }).click();
  await page.locator('.expense-breakdown').waitFor();
  for (const [key, value] of Object.entries(expected))
    assert.equal(params(page)[key], value);
  await page
    .getByRole('combobox', { name: 'Chart amount' })
    .selectOption('share');
  await page.waitForURL((url) => url.searchParams.get('basis') === 'share');
  assert.match(await page.locator('.breakdown-center').innerText(), /67\.52/);
  const home = page
    .locator('.breakdown-legend button')
    .filter({ hasText: 'Home' });
  await home.click();
  assert.equal(await home.getAttribute('aria-pressed'), 'true');
  await page
    .getByRole('button', { name: 'View expenses', exact: true })
    .click();
  await page.waitForURL((url) => !url.searchParams.has('view'));
  for (const [key, value] of Object.entries(expected))
    assert.equal(params(page)[key], value);
  assert.equal(params(page).basis, 'share');
  dialog = await filters(page);
  await dialog
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await page.waitForURL((url) =>
    Object.keys(expected).every((key) => !url.searchParams.has(key)),
  );
  await page.getByRole('button', { name: 'Breakdown', exact: true }).click();
  const accommodation = page
    .locator('.breakdown-legend button')
    .filter({ hasText: 'Accommodation' });
  await accommodation.click();
  await page
    .getByRole('button', { name: 'View expenses', exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get('category') === 'ACCOMMODATION' &&
      !url.searchParams.has('view'),
  );
  assert.equal(params(page).basis, 'share');
  return snapshot(page, 'five-and-filters-and-chart');
});
test('detail-dismissal-history-focus-and-draft-resize', async (page) => {
  await ready(page, '/household/expenses');
  const row = page.locator('#ledger-expense-expense-0');
  await row.focus();
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('.expense-presentation').getAttribute('role'),
    'dialog',
  );
  await page.mouse.click(12, 400);
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  await page.goBack();
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await page.goForward();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  const description = page.getByRole('textbox', {
    name: 'Description',
    exact: true,
  });
  await description.fill('Draft retained across screen sizes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector('.expense-presentation')?.getAttribute('role') ===
      'region',
  );
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await snapshot(page, 'draft-resize-phone');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () =>
      document.querySelector('.expense-presentation')?.getAttribute('role') ===
      'dialog',
  );
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await page.keyboard.press('Escape');
  await closedDetail(page);
  await row.click();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Back to expenses', exact: true })
    .click();
  await closedDetail(page);
  return snapshot(page, 'detail-dismissal-history-focus-and-draft-resize');
});
test('system-theme-and-isolated-signout', async (page) => {
  await ready(page, '/account');
  const system = page.getByRole('radio', { name: 'System', exact: true });
  await system.focus();
  await page.keyboard.press('Space');
  assert.equal(await system.isChecked(), true);
  await page
    .getByRole('button', { name: 'Save appearance', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('kami-appearance') || '{}').value ===
      'SYSTEM',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark',
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.getByRole('radio', { name: 'System', exact: true }).isChecked(),
    true,
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light',
  );
  await snapshot(page, 'system-theme-account');
  await page
    .getByRole('button', { name: 'Sign out of this session', exact: true })
    .click();
  await page.waitForURL('**/sign-in');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kami-auth')),
    null,
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kami-auth')),
    null,
    'Fixture must not reauthenticate after sign-out.',
  );
  assert.equal(
    (
      await page.request.post(origin + '/api/graphql', {
        data: { query: 'query profileQuery { currentProfile { __typename } }' },
      })
    ).status(),
    401,
  );
  return snapshot(page, 'system-theme-and-isolated-signout');
});
for (const state of ['conflict', 'recovery'])
  test(`edit-${state}`, async (page) => {
    await ready(
      page,
      '/household/expenses?expense=expense-0&expenseGroup=F',
      state,
    );
    await page
      .getByRole('button', { name: 'Edit expense', exact: true })
      .click();
    const description = page.getByRole('textbox', {
      name: 'Description',
      exact: true,
    });
    await description.fill(`Synthetic ${state} edit`);
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    if (state === 'conflict') {
      await page
        .getByRole('button', { name: 'Reload latest expense', exact: true })
        .click();
      await page
        .getByText('Weekly groceries updated by Alex', { exact: true })
        .waitFor();
      assert.equal(await description.inputValue(), 'Synthetic conflict edit');
      await snapshot(page, 'edit-conflict-before-reapply');
      await page
        .getByRole('button', {
          name: 'Reapply my draft to this version',
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .click();
    } else {
      await page
        .getByRole('button', { name: 'Recover original edit', exact: true })
        .waitFor();
      await snapshot(page, 'edit-recovery-before-recover');
      await page
        .getByRole('button', { name: 'Recover original edit', exact: true })
        .click();
    }
    await page
      .getByRole('heading', { name: `Synthetic ${state} edit`, exact: true })
      .waitFor();
    const invariant = await (
      await page.request.get(origin + '/__fixture/invariants')
    ).json();
    assert.equal(invariant.valid, true);
    assert.equal(invariant.expenseCount, '16');
    assert.equal(invariant.totalMinor, '181600');
    return { ...(await snapshot(page, `edit-${state}`)), invariant };
  });
for (const state of ['long-names', 'huge', 'denied'])
  for (const theme of ['light', 'dark'])
    test(`${state}-${theme}`, async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await ready(
        page,
        state === 'long-names' ? '/groups/F?tab=overview' : '/household',
        state,
        theme,
      );
      if (state === 'denied') {
        await page
          .getByText(/unavailable/i)
          .first()
          .waitFor();
        assert.equal(
          await page.getByText('Weekly groceries', { exact: true }).count(),
          0,
        );
      } else {
        await page.locator('.ui-summary-row').waitFor();
        if (state === 'huge') {
          const exact = '1,816,000,000,005,448.00';
          assert.ok(
            (await page.locator('.ui-summary-row').innerText()).includes(exact),
          );
        }
      }
      const result = await snapshot(page, `${state}-${theme}`);
      if (state === 'huge') {
        result.money = await longMoneyMetrics(page);
        assert.ok(
          result.money.every((item) => item.safe && !item.ellipsis),
          'Every huge exact amount must fit its owning element or expose keyboard-accessible horizontal panning, without ellipsis. ' +
            JSON.stringify(
              result.money.filter((item) => !item.safe || item.ellipsis),
            ),
        );
      }
      assert.ok(
        result.scrollWidth <= result.width,
        `${state}/${theme} horizontally overflows ${result.scrollWidth} > ${result.width}`,
      );
      const invariant = await (
        await page.request.get(origin + '/__fixture/invariants')
      ).json();
      assert.equal(invariant.valid, true);
      assert.ok(invariant.groups.every((group) => group.netMinor === '0'));
      return { ...result, invariant };
    });
async function enlargedText(page, width, theme, model, surface = 'overview') {
  await page.setViewportSize({ width, height: 844 });
  await ready(
    page,
    surface === 'activity' ? '/household/activity' : '/household',
    'complete',
    theme,
  );
  await page
    .locator(
      surface === 'activity' ? '.activity-feed-panel' : '.ui-summary-row',
    )
    .waitFor();
  const normalBodyFont = await page.evaluate(
    () => getComputedStyle(document.body).fontSize,
  );
  assert.equal(
    normalBodyFont,
    '14px',
    'Stress starts with the actual normal 14px body.',
  );
  // Explicit text-enlargement stress, not browser/pinch zoom. Snapshot original
  // computed values before applying changes so inherited styles never compound.
  if (model === 'root')
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
  else
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('body *')].filter(
        (element) =>
          element.getClientRects().length &&
          [...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          ),
      );
      const sizes = nodes.map((element) => {
        const style = getComputedStyle(element);
        return {
          element,
          font: parseFloat(style.fontSize),
          line: parseFloat(style.lineHeight),
        };
      });
      for (const { element, font, line } of sizes) {
        element.style.fontSize = font * 2 + 'px';
        if (Number.isFinite(line)) element.style.lineHeight = line * 2 + 'px';
      }
    });
  const result = await snapshot(
    page,
    `${surface === 'activity' ? 'activity-' : ''}${model}-200-${width}-${theme}`,
  );
  if (model === 'root')
    assert.equal(
      result.bodyFont,
      '28px',
      'Root 200% must really enlarge body font from 14px to 28px.',
    );
  assert.ok(
    result.scrollWidth <= result.width,
    `200% text creates horizontal document overflow: ${result.scrollWidth} > ${result.width}`,
  );
  return {
    ...result,
    normalBodyFont,
    model:
      model === 'root'
        ? 'html font-size:200%, verified actual body14px→28px; not browser/pinch zoom.'
        : 'Each rendered text node font and line-height enlarged200% from original computed values; not browser/pinch zoom.',
  };
}
for (const width of [320, 390, 768])
  for (const theme of ['light', 'dark'])
    for (const model of ['text', 'root'])
      test(`${model}-200-${width}-${theme}`, (page) =>
        enlargedText(page, width, theme, model));
for (const theme of ['light', 'dark'])
  for (const model of ['text', 'root'])
    test(`activity-${model}-200-320-${theme}`, (page) =>
      enlargedText(page, 320, theme, model, 'activity'));
(async () => {
  const health = await fetch(origin + '/__fixture/health').then((response) =>
    response.json(),
  );
  assert.equal(
    health.synthetic,
    true,
    'Interaction checks require the isolated synthetic fixture.',
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const results = [];
  try {
    for (const { name, work } of cases) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === new URL(origin).origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage(),
        errors = [],
        consoleProblems = [],
        failedResponses = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type()))
          consoleProblems.push({
            type: message.type(),
            text: message.text(),
            location: message.location(),
          });
      });
      page.on('response', (response) => {
        if (response.status() >= 400)
          failedResponses.push({
            url: response.url(),
            status: response.status(),
          });
      });
      let details, failure;
      try {
        details = await work(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(
          consoleProblems,
          [],
          'Browser console errors or warnings',
        );
        assert.deepEqual(failedResponses, [], 'Failed HTTP responses');
      } catch (error) {
        failure = error.message;
        details = await snapshot(page, `${name}-failure`).catch(() => ({}));
      }
      results.push({
        name,
        passed: !failure,
        ...(failure ? { failure } : {}),
        errors,
        consoleProblems,
        failedResponses,
        details,
      });
      console.log(
        `${failure ? 'FAIL' : 'PASS'} ${name}${failure ? ': ' + failure : ''}`,
      );
      fs.writeFileSync(
        path.join(output, 'results.json'),
        JSON.stringify(results, null, 2),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
