/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in synthetic browser acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function verifyFilters({
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

  const trigger = page.getByRole('button', { name: 'Filters', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  const section = (title) =>
    dialog.locator('details').filter({
      has: page.locator('[data-ui~="ledger-filter-title"]', { hasText: title }),
    });
  const summary = (title) => section(title).locator('summary');
  const apply = dialog.getByRole('button', { name: 'Apply filters' });
  const reset = dialog.getByRole('button', { name: 'Reset filters' });
  assert.equal(await dialog.locator('details[open]').count(), 0);
  assert.equal(
    await dialog.getByRole('combobox', { name: 'Space', exact: true }).count(),
    workspace === 'household' ? 1 : 0,
  );
  assert(
    await dialog
      .getByRole('button', { name: 'Back to expenses' })
      .evaluate((el) => el === document.activeElement),
  );

  async function geometry(label) {
    const metrics = await dialog.evaluate((el) => {
      const rect = (node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      };
      const body = el.querySelector('[data-ui~="ledger-filter-scroll"]');
      return {
        dialog: rect(el),
        header: rect(el.querySelector('header')),
        body: rect(body),
        footer: rect(el.querySelector('[data-ui~="ledger-filter-actions"]')),
        buttons: [
          ...el.querySelectorAll('[data-ui~="ledger-filter-actions"] button'),
        ].map(rect),
        bodyOverflow: body.scrollWidth - body.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        height: innerHeight,
        width: innerWidth,
      };
    });
    assert(
      metrics.dialog.x >= -1 && metrics.dialog.right <= metrics.width + 1,
      'dialog horizontal bounds',
    );
    assert(
      metrics.dialog.y >= -1 && metrics.dialog.bottom <= metrics.height + 1,
      'dialog vertical bounds',
    );
    assert(
      metrics.bodyOverflow <= 1 && metrics.pageOverflow <= 1,
      'no horizontal overflow',
    );
    assert(
      metrics.header.bottom <= metrics.body.y + 1,
      'header outside scrolling body',
    );
    assert(
      metrics.footer.bottom <= metrics.dialog.bottom + 1,
      'footer inside dialog',
    );
    assert(metrics.body.bottom - metrics.body.y >= 80, 'usable scrolling body');
    assert(
      metrics.body.bottom <= metrics.footer.y + 1,
      'footer outside scrolling body',
    );
    for (const button of metrics.buttons) {
      assert(
        button.y >= metrics.footer.y && button.bottom <= metrics.dialog.bottom,
        'footer action reachable',
      );
      assert(
        button.x >= metrics.dialog.x && button.right <= metrics.dialog.right,
        'footer action fits',
      );
    }
    results.push({ workspace, width, scale, label, ...metrics });
  }
  await geometry('collapsed');
  await page.screenshot({
    path: path.join(
      output,
      `filters-${workspace}-${width}-${scale}-collapsed.png`,
    ),
  });

  // Native summaries and focus loop work without relying on pointer controls.
  await summary('Categories').focus();
  await page.keyboard.press('Enter');
  await section('Categories').getByLabel('Dining', { exact: true }).check();
  await section('Categories').getByLabel('Groceries', { exact: true }).check();
  assert.match(await summary('Categories').innerText(), /2 selected/);
  await summary('Categories').click();
  await summary('Paid by').click();
  await section('Paid by').getByRole('checkbox').first().check();
  await summary('Involving').click();
  await section('Involving').getByRole('checkbox').last().check();
  await summary('Dates').click();
  await dialog
    .getByRole('combobox', { name: 'Date range', exact: true })
    .selectOption('last7');
  const from = await dialog.getByLabel('From', { exact: true }).inputValue();
  const to = await dialog.getByLabel('To', { exact: true }).inputValue();
  assert.equal((Date.parse(to) - Date.parse(from)) / 86400000, 6);
  await dialog
    .getByRole('combobox', { name: 'Sort', exact: true })
    .selectOption('AMOUNT_ASC');
  await geometry('expanded-long-content');
  await page.screenshot({
    path: path.join(
      output,
      `filters-${workspace}-${width}-${scale}-expanded.png`,
    ),
  });
  await apply.focus();
  await page.keyboard.press('Tab');
  assert(
    await dialog
      .getByRole('button', { name: 'Back to expenses' })
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press('Shift+Tab');
  assert(await apply.evaluate((el) => el === document.activeElement));
  await apply.click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'AMOUNT_ASC');
  const applied = new URL(page.url());
  assert.deepEqual(applied.searchParams.getAll('categories').sort(), [
    'DINING',
    'GROCERIES',
  ]);
  assert(applied.searchParams.getAll('paidByIds').length);
  assert(applied.searchParams.getAll('memberIds').length);
  assert.equal(applied.searchParams.get('from'), from);
  assert.equal(applied.searchParams.get('to'), to);
  await page.locator('[data-ui~="ledger-filter-button"]').waitFor();
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-ui~="ledger-filter-button"]'),
  );

  await page.locator('[data-ui~="ledger-filter-button"]').click();
  await reset.click();
  assert.match(await summary('Categories').innerText(), /All categories/);
  assert.match(await summary('Dates').innerText(), /All dates/);
  assert.equal(page.url(), applied.href, 'Reset only changes draft');
  await page.keyboard.press('Escape');
  assert.equal(page.url(), applied.href, 'Escape discards reset');
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-ui~="ledger-filter-button"]'),
  );
  await page.locator('[data-ui~="ledger-filter-button"]').click();
  assert.match(await summary('Categories').innerText(), /2 selected/);
  await reset.click();
  await apply.click();
  await page.waitForURL(
    (url) =>
      !url.searchParams.has('categories') && !url.searchParams.has('sort'),
  );

  // A viewport change must not remount the draft or move actions off screen.
  await page.locator('[data-ui~="ledger-filter-button"]').click();
  await summary('Categories').click();
  await section('Categories').getByLabel('Dining', { exact: true }).check();
  await page.setViewportSize({ width: width < 600 ? 1280 : 320, height: 640 });
  await geometry('resized');
  await page.setViewportSize({ width: 320, height: 640 });
  await geometry('short-narrow-screen');
  await page.screenshot({
    path: path.join(output, `filters-${workspace}-${width}-${scale}-short.png`),
  });
  assert(
    await section('Categories')
      .getByLabel('Dining', { exact: true })
      .isChecked(),
  );
  await page.keyboard.press('Escape');
  results.push({
    workspace,
    width,
    scale,
    filters: 'passed',
    keyboard: 'passed',
    draftIsolation: 'passed',
  });
};
