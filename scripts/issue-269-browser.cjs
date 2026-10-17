/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in synthetic frontend acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function verifyIssue269({
  page,
  origin,
  workspace,
  width,
  scale,
  output,
  results,
}) {
  const route = (tab) =>
    workspace === 'household'
      ? tab === 'expenses'
        ? '/household/expenses'
        : tab === 'activity'
          ? '/household/activity'
          : `/household?tab=${tab}`
      : `${workspace === 'ordinary' ? '/groups/F' : '/trips/T'}?tab=${tab}`;
  for (const tab of [
    'overview',
    'expenses',
    'balances',
    'activity',
    'members',
  ]) {
    await page.goto(origin + route(tab));
    const header = page.locator('[data-ui~="workspace-navigation-brand"]');
    const add = page.getByRole('link', { name: 'Add expense', exact: true });
    await add.waitFor();
    await page
      .locator('[data-ui="content-loading"]:visible')
      .waitFor({ state: 'hidden' });
    if (scale === 2)
      await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    assert.equal(await add.count(), 1);
    assert.equal(await page.locator('[data-ui~="banner-action"]').count(), 0);
    assert.equal(
      await page.locator('[data-ui~="workspace-refresh"] button').count(),
      0,
    );
    assert.equal(
      await page.getByRole('button', { name: /^Refresh/ }).count(),
      0,
    );
    const geometry = await page.evaluate(() => {
      const header = document.querySelector(
        '[data-ui~="workspace-navigation-brand"]',
      );
      return {
        image: getComputedStyle(header).backgroundImage,
        bottom: header.getBoundingClientRect().bottom,
        tabsTop: document
          .querySelector('[data-ui~="workspace-tabs"]')
          .getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.match(
      geometry.image,
      workspace !== 'group' ? /art\/household.png/ : /art\/trip.png/,
    );
    assert(geometry.bottom <= geometry.tabsTop, 'Banner precedes tabs');
    await page.screenshot({
      path: path.join(
        output,
        `initial-${workspace}-${tab}-${width}-${scale}.png`,
      ),
      fullPage: true,
    });
    assert(!geometry.overflow, `${workspace} ${tab} must fit viewport`);
    if (workspace === 'household') {
      assert.equal(await header.getByRole('heading').innerText(), 'Household');
      assert(
        !/Shared spending, at home and away/.test(await header.innerText()),
      );
      const trigger = header.getByRole('button', { name: 'What’s included' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const help = page.getByRole('dialog', { name: 'What’s included' });
      await help.waitFor();
      assert.match(
        await help.innerText(),
        /Your Household expenses, plus groups and trips/,
      );
      const box = await help.boundingBox(),
        anchor = await trigger.boundingBox();
      assert(
        box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= 901,
        'Help fits viewport',
      );
      assert(
        box.y >= anchor.y + anchor.height || box.y + box.height <= anchor.y,
        'Help does not cover trigger',
      );
      await page.keyboard.press('Tab');
      assert(
        await help
          .getByRole('button', { name: 'Got it' })
          .evaluate((el) => document.activeElement === el),
      );
      await page.screenshot({
        path: path.join(output, `scope-${tab}-${width}-${scale}.png`),
      });
      await page.keyboard.press('Tab');
      assert.equal(await help.count(), 0);
      assert(
        await header
          .getByRole('link', { name: 'Profile', exact: true })
          .evaluate((el) => document.activeElement === el),
        'Forward Tab resumes next control after help trigger',
      );
      await trigger.click();
      await help.waitFor();
      await page.keyboard.press('Escape');
      assert(await trigger.evaluate((el) => document.activeElement === el));
    }
    if (tab === 'overview' || tab === 'balances') {
      const balance = page
        .getByRole('button', { name: 'Your balance', exact: true })
        .first();
      await balance.click();
      const help = page.getByRole('dialog', { name: 'Your balance' });
      await help.waitFor();
      assert.match(
        await help.innerText(),
        /Other members may still owe each other/,
      );
      if (workspace === 'household')
        assert.match(
          await page.locator('[data-ui~="signed-balance"]').first().innerText(),
          /Payments still to settle/,
        );
      await help.getByRole('button', { name: 'Got it' }).click();
      assert(await balance.evaluate((el) => document.activeElement === el));
      if (tab === 'overview') {
        const share = page.getByRole('button', {
          name: 'Your share',
          exact: true,
        });
        await share.click();
        assert.match(
          await page.getByRole('dialog', { name: 'Your share' }).innerText(),
          /Repayments do not change your share/,
        );
        await balance.click();
        assert.equal(
          await page.locator('[data-ui~="rich-help-panel"]').count(),
          1,
        );
        await page.keyboard.press('Escape');
      } else {
        assert.equal(
          await page
            .locator('[data-ui~="balance-explanations"] details[open]')
            .count(),
          0,
        );
        await page.getByText('How your balance works', { exact: true }).click();
        await page.getByText('See an example', { exact: true }).click();
        assert(await page.getByText(/Paying \$60.00/).isVisible());
      }
    }
    await page.screenshot({
      path: path.join(
        output,
        `workspace-${workspace}-${tab}-${width}-${scale}.png`,
      ),
      fullPage: true,
    });
  }
  if (workspace === 'ordinary') {
    results.push({
      issue269: true,
      workspace,
      width,
      scale,
      allTabsBannerArt: true,
    });
    return;
  }
  // Check shared creation against a paginated list, then return to fresh pages and chrome focus.
  await page.goto(origin + route('expenses'));
  await page.locator('#ledger-expense-e1').waitFor();
  await page.locator('[data-ui~="ledger-pagination"]').scrollIntoViewIfNeeded();
  const retry = page.getByRole('button', { name: 'Retry loading expenses' });
  if (await retry.count()) await retry.click();
  await page.locator('#ledger-expense-e9').waitFor();
  const add = page.getByRole('link', { name: 'Add expense', exact: true });
  await add.click();
  if (workspace === 'household') {
    const source = page.getByRole('combobox', {
      name: 'Source space',
      exact: true,
    });
    assert.equal(
      await source.inputValue(),
      '',
      'Global creation requires an explicit source',
    );
    await source.selectOption('H');
  }
  await page.getByLabel('Description', { exact: true }).waitFor();
  const freshResponse = page.waitForResponse((r) => {
    if (!r.request().url().endsWith('/api/graphql')) return false;
    const body = r.request().postDataJSON();
    return (
      /expenses(?:Group|Household)Query/.test(body?.query || '') &&
      !body.variables.after
    );
  });
  await page.keyboard.press('Escape');
  await freshResponse;
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-ui~="ledger-month"] li').length === 9 &&
      document.activeElement?.id === 'workspace-add',
  );
  assert(
    await add.evaluate((el) => document.activeElement === el),
    'Creation returns focus to shared chrome trigger',
  );
  assert.equal(
    await page.locator('[data-ui~="ledger-month"] li').count(),
    9,
    'Creation return replays loaded pages',
  );
  results.push({
    issue269: true,
    workspace,
    width,
    scale,
    allTabsBannerArt: true,
    richHelpViewportDismissalFocus: true,
    creationReturn: true,
  });
  if (workspace === 'group')
    await verifyIssue269({
      page,
      origin,
      workspace: 'ordinary',
      width,
      scale,
      output,
      results,
    });
};
