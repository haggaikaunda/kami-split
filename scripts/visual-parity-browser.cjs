/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser evidence runner. */
// Run against visual-parity-fixture.cjs, never against production or real accounts.
// WIDTHS=1280,390 THEMES=light,dark SURFACES=household-overview OUTPUT_DIR=/tmp/kami-parity node scripts/visual-parity-browser.cjs
// REFERENCE_ONLY=1 REFERENCE_DIR=/path/to/extracted/reference REFERENCE_LUCIDE_PATH=/path/to/reference-lucide.js captures original source fragments.
// COMPARE_ONLY=1 APP_EVIDENCE_DIR=/tmp/app REFERENCE_EVIDENCE_DIR=/tmp/reference SHARP_MODULE=/path/to/sharp writes aligned overlay/difference evidence.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = process.env.BROWSER_ORIGIN || 'http://localhost:3228';
const output = process.env.OUTPUT_DIR || '/tmp/kami-visual-parity';
const widths = (process.env.WIDTHS || '1280,390').split(',').map(Number);
const themes = (process.env.THEMES || 'light,dark').split(',');
const selected = process.env.SURFACES?.split(',');
const surfaces = [
  ['household-overview', '/household'],
  ['group-overview', '/groups/F?tab=overview'],
  ['trip-overview', '/trips/T?tab=overview'],
  ['household-expenses', '/household/expenses'],
  ['group-expenses', '/groups/F?tab=expenses'],
  ['trip-expenses', '/trips/T?tab=expenses'],
  ['household-breakdown', '/household/expenses?view=breakdown'],
  ['group-breakdown', '/groups/F?tab=expenses&view=breakdown'],
  ['trip-breakdown', '/trips/T?tab=expenses&view=breakdown'],
  ['household-balances', '/household?tab=balances'],
  ['group-balances', '/groups/F?tab=balances'],
  ['trip-balances', '/trips/T?tab=balances'],
  ['household-activity', '/household/activity'],
  ['group-activity', '/groups/F?tab=activity'],
  ['trip-activity', '/trips/T?tab=activity'],
  ['household-members', '/household?tab=members'],
  ['group-members', '/groups/F?tab=members'],
  ['trip-members', '/trips/T?tab=members'],
  ['group-discovery', '/groups'],
  ['trip-discovery', '/trips'],
  ['account', '/account'],
  ['filters', '/household/expenses', 'filters'],
  ['expense-detail', '/household/expenses?expense=expense-0&expenseGroup=F'],
  [
    'expense-edit',
    '/household/expenses?expense=expense-0&expenseGroup=F',
    'edit',
  ],
  ['expense-create', '/groups/F?tab=expenses&create=F'],
  ['filtered', '/household/expenses?category=GROCERIES'],
  ['empty', '/household/expenses?fixtureState=empty'],
  ['error', '/household/expenses?fixtureState=error'],
  ['loading', '/household/expenses?fixtureState=loading'],
].filter(([name]) => !selected || selected.includes(name));
fs.mkdirSync(output, { recursive: true });

async function captureReferences(browser) {
  assert.ok(
    process.env.REFERENCE_DIR,
    'REFERENCE_DIR must identify the extracted approved package.',
  );
  assert.ok(
    process.env.REFERENCE_LUCIDE_PATH,
    'REFERENCE_LUCIDE_PATH must identify the exact reference Lucide build.',
  );
  const font = fs
    .readFileSync(path.join(__dirname, '../apps/web/src/app/fonts/Roboto.ttf'))
    .toString('base64');
  const lucide = fs.readFileSync(process.env.REFERENCE_LUCIDE_PATH, 'utf8');
  const results = [];
  fs.writeFileSync(
    path.join(output, 'capture.json'),
    JSON.stringify(
      {
        kind: 'approved-reference-capture',
        source: process.env.REFERENCE_DIR,
        lucide: process.env.REFERENCE_LUCIDE_PATH,
        widths,
        themes,
        note: 'Original interactive source; exported outer wrappers excluded. Local Roboto and original Lucide supply dependencies only. No visual reference styles are rewritten.',
      },
      null,
      2,
    ),
  );
  for (const width of widths)
    for (const theme of themes)
      for (const [name] of surfaces) {
        if (
          ['group-discovery', 'trip-discovery', 'error', 'loading'].includes(
            name,
          )
        )
          continue;
        const page = await browser.newPage({
          viewport: { width, height: width < 600 ? 844 : 1000 },
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const stem = `${name}-${width}-${theme}`;
        let failure;
        try {
          await page.addScriptTag({ content: lucide });
          const workspace =
            name.startsWith('group-') || name === 'expense-create'
              ? 'group'
              : name.startsWith('trip-')
                ? 'trip'
                : name === 'account'
                  ? 'account'
                  : 'household';
          const tab = name.endsWith('-overview')
            ? 'overview'
            : name.endsWith('-balances')
              ? 'balances'
              : name.endsWith('-activity')
                ? 'activity'
                : name.endsWith('-members')
                  ? 'members'
                  : 'expenses';
          const initial = {
            version: 3,
            page: workspace,
            tab,
            view: name.endsWith('-breakdown') ? 'chart' : 'list',
            appearance: theme === 'dark' ? 'Dark' : 'Light',
          };
          if (name === 'filtered' || name === 'empty')
            initial.filters = {
              household: {
                category: name === 'filtered' ? 'GROCERIES' : '',
                from: name === 'empty' ? '2027-01-01' : '',
              },
            };
          await page.evaluate((state) => {
            window.openai = {
              widgetState: { privateContent: state },
              setWidgetState: () => Promise.resolve(),
            };
          }, initial);
          const source = fs
            .readFileSync(
              path.join(
                process.env.REFERENCE_DIR,
                'source',
                `${width < 600 ? 'mobile' : 'desktop'}-fragment.html`,
              ),
              'utf8',
            )
            .replace(/<link rel="stylesheet"[^>]+>/, '');
          await page.setContent(
            `<style>html,body{margin:0;padding:0}@font-face{font-family:Roboto;src:url(data:font/ttf;base64,${font});font-weight:100 900;font-style:normal}</style>${source}`,
          );
          await page.evaluate(() => document.fonts.ready);
          if (name === 'filters')
            await page.locator('[data-filters-open]').click();
          if (name === 'expense-detail' || name === 'expense-edit') {
            await page.locator('[data-expense-id="expense-0"]').click();
            if (name === 'expense-edit')
              await page.locator('[data-edit-expense]').click();
          }
          if (name === 'expense-create')
            await page.locator('[data-add]').click();
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          const metrics = await page.evaluate(() => {
            const app = document.querySelector('.kg-app'),
              appRect = app.getBoundingClientRect();
            const selectors = [
              '.kg-app',
              '.kg-top',
              '.kg-brand',
              '.kg-layout',
              '.kg-rail',
              '.kg-nav',
              '.kg-main',
              '.kg-heading',
              '.kg-heading-title',
              'h1',
              '.kg-subtitle',
              '[data-add]',
              '.kg-tabs',
              '.kg-tab',
              '.kg-metrics',
              '.kg-metric',
              '.kg-metric-label',
              '.kg-number',
              '.kg-metric-note',
              '.kg-ledger-toolbar',
              '.kg-segment',
              '.kg-segment button',
              '[data-filters-open]',
              '.kg-filter-summary',
              '.kg-filter-chip',
              '.kg-columns',
              '.kg-expenses',
              '.kg-section-head',
              '.kg-expense-row',
              '.kg-expense-title',
              '.kg-expense-price',
              '.kg-expense-price small',
              '.kg-balances',
              '.kg-spending',
              '.kg-chart-layout',
              '.kg-chart-figure',
              '.kg-donut',
              '.kg-donut-center',
              '.kg-legend-row',
              '.kg-chart-footer',
              '.kg-overlay:not([hidden])',
              '.kg-overlay:not([hidden]) .kg-dialog',
              '.kg-detail-layer:not([hidden])',
              '.kg-detail-panel',
              '.kg-detail-bar',
              '.kg-detail-content',
              '.kg-detail-heading',
              '.kg-detail-total',
              '.kg-detail-meta',
              '.kg-detail-edit',
              '.kg-field',
              '.kg-field input',
              '.kg-field select',
              '.kg-field textarea',
              '.kg-dialog-actions',
              '.kg-detail-actions',
              '.kg-account',
              '.kg-profile-heading',
              '.kg-settings-section',
              '.kg-account-fields',
              '.kg-theme-options',
              '.kg-theme-options button',
              '.kg-signout-row',
              '.kg-filled',
              '.kg-tonal',
              '.kg-outlined',
              '.kg-textbutton',
            ];
            const metric = (element) => {
              const r = element.getBoundingClientRect(),
                s = getComputedStyle(element);
              return {
                text: element.textContent.trim().slice(0, 200),
                x: r.x - appRect.x,
                y: r.y - appRect.y,
                width: r.width,
                height: r.height,
                font: s.fontFamily,
                fontSize: s.fontSize,
                fontWeight: s.fontWeight,
                lineHeight: s.lineHeight,
                letterSpacing: s.letterSpacing,
                color: s.color,
                background: s.backgroundColor,
                radius: s.borderRadius,
                border: s.border,
                padding: s.padding,
                margin: s.margin,
                gap: s.gap,
                display: s.display,
                position: s.position,
                gridTemplateColumns: s.gridTemplateColumns,
              };
            };
            return {
              theme: getComputedStyle(app).colorScheme,
              originExcluded: { x: appRect.x, y: appRect.y },
              viewport: { width: innerWidth, height: innerHeight },
              capture: { width: appRect.width, height: appRect.height },
              fonts: [...document.fonts].map((item) => ({
                family: item.family,
                status: item.status,
              })),
              elements: Object.fromEntries(
                selectors.map((selector) => [
                  selector,
                  [...document.querySelectorAll(selector)]
                    .filter(
                      (element) =>
                        element.getClientRects().length &&
                        getComputedStyle(element).visibility !== 'hidden',
                    )
                    .slice(0, 8)
                    .map(metric),
                ]),
              ),
              visibleText: app.innerText,
            };
          });
          await page
            .locator('.kg-app')
            .screenshot({ path: path.join(output, `${stem}.png`) });
          await page.screenshot({
            path: path.join(output, `${stem}-viewport.png`),
            fullPage: true,
            clip: {
              x: metrics.originExcluded.x,
              y: metrics.originExcluded.y,
              width: metrics.capture.width,
              height: Math.min(metrics.capture.height, metrics.viewport.height),
            },
          });
          fs.writeFileSync(
            path.join(output, `${stem}.json`),
            JSON.stringify(
              { reference: true, initial, metrics, errors },
              null,
              2,
            ),
          );
          assert.deepEqual(errors, [], `${stem} reference threw`);
          assert.ok(
            metrics.fonts.some(
              (item) => item.family === 'Roboto' && item.status === 'loaded',
            ),
          );
        } catch (error) {
          failure = error.message;
        }
        results.push({
          surface: name,
          width,
          theme,
          passed: !failure,
          ...(failure ? { failure } : {}),
        });
        console.log(
          `${failure ? 'FAIL' : 'REFERENCE'} ${stem}${failure ? ': ' + failure : ''}`,
        );
        await page.close();
      }
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

async function compareEvidence() {
  const sharp = require(process.env.SHARP_MODULE || 'sharp');
  const appDir = process.env.APP_EVIDENCE_DIR,
    referenceDir = process.env.REFERENCE_EVIDENCE_DIR;
  assert.ok(appDir && referenceDir, 'Both evidence directories are required.');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(appDir, 'capture.json'))).kind,
    'synthetic-app-capture',
    'Only guarded synthetic app captures may be compared.',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(referenceDir, 'capture.json'))).kind,
    'approved-reference-capture',
  );
  const results = [];
  for (const width of widths)
    for (const theme of themes)
      for (const [name] of surfaces) {
        const stem = `${name}-${width}-${theme}`,
          appPath = path.join(appDir, `${stem}.png`),
          referencePath = path.join(referenceDir, `${stem}.png`);
        if (!fs.existsSync(appPath) || !fs.existsSync(referencePath)) continue;
        const appMeta = await sharp(appPath).metadata(),
          referenceMeta = await sharp(referencePath).metadata();
        const common = {
          left: 0,
          top: 0,
          width: Math.min(appMeta.width, referenceMeta.width),
          height: Math.min(appMeta.height, referenceMeta.height),
        };
        const app = await sharp(appPath)
            .extract(common)
            .removeAlpha()
            .raw()
            .toBuffer(),
          reference = await sharp(referencePath)
            .extract(common)
            .removeAlpha()
            .raw()
            .toBuffer();
        const overlay = Buffer.alloc(app.length),
          difference = Buffer.alloc(app.length);
        let totalDifference = 0,
          changedPixels = 0;
        for (let index = 0; index < app.length; index += 3) {
          let changed = false;
          for (let channel = 0; channel < 3; channel++) {
            const at = index + channel,
              delta = Math.abs(app[at] - reference[at]);
            overlay[at] = Math.round((app[at] + reference[at]) / 2);
            difference[at] = delta;
            totalDifference += delta;
            if (delta > 16) changed = true;
          }
          if (changed) changedPixels++;
        }
        const raw = { width: common.width, height: common.height, channels: 3 };
        await sharp(overlay, { raw })
          .png()
          .toFile(path.join(output, `${stem}-overlay.png`));
        await sharp(difference, { raw })
          .png()
          .toFile(path.join(output, `${stem}-difference.png`));
        results.push({
          surface: name,
          width,
          theme,
          appDimensions: { width: appMeta.width, height: appMeta.height },
          referenceDimensions: {
            width: referenceMeta.width,
            height: referenceMeta.height,
          },
          comparedDimensions: raw,
          meanAbsoluteChannelDifference: totalDifference / app.length,
          changedPixelFractionAt16:
            changedPixels / (common.width * common.height),
          note: 'Top-left alignment at exact scale; shared rectangle only, no stretching. Difference is descriptive evidence, not an independent pass/fail gate. Different copy or preserved product controls can legitimately differ.',
        });
      }
  fs.writeFileSync(
    path.join(output, 'comparison.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`Wrote ${results.length} aligned comparisons to ${output}`);
}
(async () => {
  if (process.env.COMPARE_ONLY === '1') return compareEvidence();
  const referenceOnly = process.env.REFERENCE_ONLY === '1';
  if (!referenceOnly) {
    const health = await fetch(origin + '/__fixture/health').then((r) =>
      r.json(),
    );
    assert.equal(
      health.synthetic,
      true,
      'Evidence requires the synthetic fixture server.',
    );
    fs.writeFileSync(
      path.join(output, 'capture.json'),
      JSON.stringify(
        {
          kind: 'synthetic-app-capture',
          origin,
          upstream: health.upstream,
          widths,
          themes,
        },
        null,
        2,
      ),
    );
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const results = [];
  try {
    if (referenceOnly) return await captureReferences(browser);
    for (const width of widths)
      for (const theme of themes)
        for (const [name, route, action] of surfaces) {
          const page = await browser.newPage({
            viewport: { width, height: width < 600 ? 844 : 1000 },
            reducedMotion: 'reduce',
            colorScheme: theme,
          });
          const errors = [],
            consoleProblems = [],
            failedResponses = [];
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
          const url = new URL(route, origin);
          url.searchParams.set('fixtureTheme', theme);
          if (!url.searchParams.has('fixtureState'))
            url.searchParams.set('fixtureState', 'complete');
          const stem = `${name}-${width}-${theme}`;
          let failure;
          try {
            await page.goto(url.href, { waitUntil: 'domcontentloaded' });
            if (name !== 'loading') await page.waitForLoadState('networkidle');
            await page.waitForFunction(
              (expected) => document.documentElement.dataset.theme === expected,
              theme,
            );
            await page.evaluate(() => document.fonts.ready);
            if (name.endsWith('-overview'))
              await page.locator('.ui-summary-row').waitFor();
            if (action === 'filters')
              await page.getByRole('button', { name: /Filters/ }).click();
            if (action === 'edit')
              await page
                .getByRole('button', { name: 'Edit expense', exact: true })
                .click();
            if (action) await page.waitForTimeout(150);
            const metrics = await page.evaluate(() => {
              const selectors = [
                '.workspace-shell',
                '.workspace-header',
                '.ui-workspace-header',
                '.workspace-title',
                '.app-shell',
                '.app-topbar',
                '.workspace-navigation',
                'main',
                'h1',
                '.ui-workspace-tabs',
                '.ui-summary-row',
                '.ui-summary-metric',
                '.ui-metric-value',
                '.workspace-overview-grid',
                '.household-overview-grid',
                '.workspace-overview-balances',
                '.expense-row',
                '.ui-expense-row',
                '.ledger-expense-row',
                '.ledger-dialog',
                '.workspace-banner',
                '.account-content',
                '.account-card',
                '.account-identity',
                '.account-avatar',
                '.account-profile-fields',
                '.account-section-title',
                '.account-actions',
                '.appearance-options',
                '.appearance-choice',
                '.appearance-footer',
                '.account-session',
              ];
              const metric = (element) => {
                const r = element.getBoundingClientRect(),
                  s = getComputedStyle(element);
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  font: s.fontFamily,
                  fontSize: s.fontSize,
                  fontWeight: s.fontWeight,
                  lineHeight: s.lineHeight,
                  color: s.color,
                  background: s.backgroundColor,
                  radius: s.borderRadius,
                  padding: s.padding,
                  gap: s.gap,
                  display: s.display,
                };
              };
              return {
                theme: document.documentElement.dataset.theme,
                fonts: [...document.fonts].map((font) => ({
                  family: font.family,
                  status: font.status,
                })),
                horizontalOverflow:
                  document.documentElement.scrollWidth > innerWidth,
                componentOverflow: [
                  ...document.querySelectorAll(
                    '.ui-summary-row,.ui-summary-metric,.ui-workspace-tabs',
                  ),
                ]
                  .filter(
                    (element) => element.scrollWidth > element.clientWidth + 1,
                  )
                  .map((element) => element.className),
                bodyFontLoaded: document.fonts.check('14px bodyFont'),
                viewport: { width: innerWidth, height: innerHeight },
                elements: Object.fromEntries(
                  selectors.map((selector) => [
                    selector,
                    [...document.querySelectorAll(selector)]
                      .slice(0, 5)
                      .map(metric),
                  ]),
                ),
                headings: [...document.querySelectorAll('h1,h2,h3')].map(
                  (h) => h.textContent,
                ),
                dialogs: [...document.querySelectorAll('dialog')].map((d) => ({
                  name: d.getAttribute('aria-label'),
                  open: d.open,
                  scrollHeight: d.scrollHeight,
                  clientHeight: d.clientHeight,
                  scrollTop: d.scrollTop,
                })),
                visibleText: document.body.innerText,
              };
            });
            const overlay = metrics.dialogs.some((dialog) => dialog.open);
            await page.screenshot({
              path: path.join(output, `${stem}.png`),
              fullPage: !overlay,
            });
            await page.screenshot({
              path: path.join(output, `${stem}-viewport.png`),
              fullPage: false,
            });
            if (overlay) {
              const dialog = page.locator('dialog[open]').last();
              const scroll = await dialog.evaluate((element) => ({
                height: element.scrollHeight,
                client: element.clientHeight,
                top: element.scrollTop,
              }));
              if (scroll.height > scroll.client + 1) {
                await dialog.evaluate((element) => {
                  element.scrollTop = element.scrollHeight;
                });
                await page.screenshot({
                  path: path.join(output, `${stem}-dialog-bottom.png`),
                  fullPage: false,
                });
                await dialog.evaluate((element, top) => {
                  element.scrollTop = top;
                }, scroll.top);
              }
            }
            fs.writeFileSync(
              path.join(output, `${stem}.json`),
              JSON.stringify(
                {
                  url: page.url(),
                  metrics,
                  errors,
                  consoleProblems,
                  failedResponses,
                },
                null,
                2,
              ),
            );
            assert.equal(
              metrics.horizontalOverflow,
              false,
              `${stem} overflows horizontally`,
            );
            assert.deepEqual(errors, [], `${stem} has uncaught browser errors`);
            assert.deepEqual(
              consoleProblems,
              [],
              `${stem} has browser console errors or warnings`,
            );
            assert.deepEqual(
              failedResponses,
              [],
              `${stem} has failed HTTP responses`,
            );
            assert.deepEqual(
              metrics.componentOverflow,
              [],
              `${stem} summary or tabs overflow`,
            );
            assert.equal(
              metrics.bodyFontLoaded,
              true,
              `${stem} app font did not load`,
            );
          } catch (error) {
            failure = error.message;
            await page
              .screenshot({
                path: path.join(output, `${stem}-failure.png`),
                fullPage: true,
              })
              .catch(() => {});
          }
          results.push({
            surface: name,
            width,
            theme,
            passed: !failure,
            consoleProblems,
            failedResponses,
            ...(failure ? { failure } : {}),
          });
          console.log(
            `${failure ? 'FAIL' : 'CAPTURED'} ${stem}${failure ? ': ' + failure : ''}`,
          );
          await page.close();
        }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  if (results.some((result) => !result.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
