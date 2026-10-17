import { test, expect } from './fixtures.mjs';

for (const workspace of [
  {
    name: 'Household',
    path: '/household',
    operation: 'householdWorkspaceQuery',
  },
  { name: 'Group', path: '/groups/F', operation: 'journeyWorkspaceQuery' },
  { name: 'Trip', path: '/trips/T', operation: 'journeyWorkspaceQuery' },
]) {
  test(`${workspace.name} has compact empty refresh spacing and usable refresh feedback`, async ({
    page,
    app,
  }, testInfo) => {
    await app.authenticate();
    await page.goto(workspace.path);
    const recent = page.getByRole('heading', {
      name: 'Recent expenses',
      exact: true,
    });
    await expect(recent).toBeVisible();
    const refresh = page.locator('[data-ui~="workspace-refresh"]');
    const geometry = () =>
      page.evaluate(() => {
        const refresh = document.querySelector(
          '[data-ui~="workspace-refresh"]',
        );
        const tabs = document
          .querySelector('[data-ui~="workspace-tabs"]')
          .getBoundingClientRect();
        let content = refresh.nextElementSibling;
        while (content && !content.getClientRects().length)
          content = content.nextElementSibling;
        if (!content) throw new Error('Visible workspace content is missing');
        return {
          refreshHeight: refresh.getBoundingClientRect().height,
          gap: content.getBoundingClientRect().top - tabs.bottom,
        };
      });
    const idle = await geometry();
    await page.screenshot({
      path: testInfo.outputPath('idle.png'),
      fullPage: true,
    });
    expect.soft(idle.refreshHeight, 'Idle refresh adds no blank row').toBe(0);
    expect
      .soft(idle.gap, 'Content follows the intended compact tab margin')
      .toBeLessThanOrEqual(32);
    expect(idle.gap, 'Content does not overlap tabs').toBeGreaterThanOrEqual(0);

    const failed = app.hold(workspace.operation, undefined, { status: 503 });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await failed.started;
    await expect(
      page.getByText('Loading overview…', { exact: true }),
    ).toBeVisible();
    await expect(refresh.getByRole('status')).toHaveCount(0);
    const pending = await geometry();
    expect
      .soft(pending.refreshHeight, 'Content-owned loading adds no blank row')
      .toBe(0);
    expect(
      pending.gap,
      'Visible loader follows the compact tab margin',
    ).toBeLessThanOrEqual(32);
    expect(
      pending.gap,
      'Visible loader does not overlap tabs',
    ).toBeGreaterThanOrEqual(0);
    await failed.release();
    const retry = refresh.getByRole('button', {
      name: 'Try again',
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(refresh.getByRole('status')).toHaveText(
      'Couldn’t refresh. Try again.',
    );
    await retry.focus();
    await expect(retry).toBeFocused();
    const recovery = app.hold(workspace.operation);
    await page.keyboard.press('Enter');
    await recovery.started;
    await expect(
      page.getByText('Loading overview…', { exact: true }),
    ).toBeVisible();
    await expect(retry).toHaveCount(0);
    await recovery.release();
    await expect(recent).toBeVisible();
    await expect(refresh.getByRole('status')).toHaveText('Up to date');
    expect(
      (await refresh.boundingBox()).height,
      'Visible feedback retains its row',
    ).toBeGreaterThan(0);
    await testInfo.attach('refresh-spacing', {
      body: JSON.stringify({ workspace: workspace.name, idle, pending }),
      contentType: 'application/json',
    });
  });
}
