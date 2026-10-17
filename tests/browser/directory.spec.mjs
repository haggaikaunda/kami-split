import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

const directory = (page) => page.locator('[data-ui="discovery-cards"]');
const typeFilter = (page) =>
  page.getByRole('navigation', { name: 'Group type' });

test('unified directory retains legacy trip filters and canonical source return with keyboard focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/trips?filter=past');
  await expect(page).toHaveURL('/groups?filter=past&kind=trips');
  await expect(page.getByText('No trips match this filter.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Trip date filter' })
    .getByRole('link', { name: 'All', exact: true })
    .click();
  const trip = directory(page).getByRole('link');
  await expect(trip).toContainText('3 active members');
  await expect(trip).toContainText('Total spend · USD$3.00');
  await expect(trip).toContainText('Your balance · USD$84.20');
  await trip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/trips\/T\?source=/);
  await expect(
    page.getByRole('heading', { name: 'Recent expenses', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-ui~="summary-row"]').first()).toContainText(
    'Total spend$3.00',
  );
  if (page.viewportSize().width <= 600) await page.goBack();
  else
    await page
      .getByRole('link', { name: 'Back to source', exact: true })
      .click();
  await expect(trip).toBeFocused();
  await expect(
    typeFilter(page).getByRole('link', { name: 'Trips', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await typeFilter(page)
    .getByRole('link', { name: 'All', exact: true })
    .click();
  await expect(directory(page).getByRole('link')).toHaveCount(2);
  await typeFilter(page)
    .getByRole('link', { name: 'Groups', exact: true })
    .click();
  await expect(directory(page).getByRole('link')).toHaveCount(1);
  await page.goBack();
  await expect(directory(page).getByRole('link')).toHaveCount(2);
  await page.goForward();
  await expect(directory(page).getByRole('link')).toHaveCount(1);
});

test('directory unavailable aggregates remain unavailable and foreground denial removes cards', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'Problem',
    code: 'UNAVAILABLE',
  };
  data.groupDirectory.entries[1].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '0',
    viewerNetMinor: '0',
  };
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups');
  await expect(directory(page).getByRole('link').first()).toContainText(
    'Unavailable',
  );
  await expect(directory(page).getByRole('link').last()).toContainText(
    'Nothing for you to pay or collect',
  );
  const denied = app.hold('journeyViewerQuery', {
    ...data,
    groupDirectory: { __typename: 'Problem', code: 'NOT_FOUND' },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await denied.started;
  await expect(directory(page)).toHaveCount(0);
  await denied.release();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Financial access is unavailable' }),
  ).toBeVisible();
  await expect(directory(page)).toHaveCount(0);
});

test('authorized create choices preserve directory selection and return focus', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.viewer.canCreateGroups = true;
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups?kind=trips');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Create a shared space');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  void app.hold('journeyViewerQuery', data).release();
  await dialog.getByRole('link', { name: 'Create trip', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create trip', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Destination (optional)', { exact: true }),
  ).toBeVisible();
  void app.hold('journeyViewerQuery', data).release();
  await page
    .getByRole('link', { name: 'Inspect your trips', exact: true })
    .click();
  await expect(
    typeFilter(page).getByRole('link', { name: 'Trips', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeFocused();
});

test('directory cards contain long exact amounts across responsive themes and enlarged text', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '9223372036854775807',
    viewerNetMinor: '-9007199254740993',
  };
  void app.hold('journeyViewerQuery', data).release();
  await page.goto('/groups');
  await expect(directory(page)).toBeVisible();
  for (const width of [320, 390, 440, 1280])
    for (const theme of ['light', 'dark', 'system'])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({
          colorScheme: theme === 'system' ? 'dark' : theme,
          reducedMotion: 'reduce',
        });
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme =
              theme === 'system'
                ? matchMedia('(prefers-color-scheme: dark)').matches
                  ? 'dark'
                  : 'light'
                : theme;
            document.documentElement.style.fontSize = `${scale * 100}%`;
          },
          { theme, scale },
        );
        const geometry = await directory(page).evaluate((element) => ({
          doc: document.documentElement.scrollWidth,
          viewport: innerWidth,
          cards: [...element.querySelectorAll('a')].map((card) => ({
            width: card.clientWidth,
            scroll: card.scrollWidth,
          })),
        }));
        expect(geometry.doc).toBeLessThanOrEqual(width + 1);
        expect(
          geometry.cards.every((card) => card.scroll <= card.width + 1),
        ).toBe(true);
        await expect(directory(page).getByRole('link').first()).toContainText(
          '$92,233,720,368,547,758.07',
        );
        if (scale === 2 && theme === 'dark')
          await page.screenshot({
            path: testInfo.outputPath(`directory-${width}-dark-200pct.png`),
            fullPage: true,
          });
      }
});

test('fresh directory reads reflect expense corrections and repayment-only balance changes', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.goto('/groups?kind=groups');
  const group = directory(page).getByRole('link');
  await expect(group).toContainText('Total spend · USD$3.00');
  const corrected = responseFor('journeyViewerQuery', {});
  corrected.groupDirectory.entries[1].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '975',
    viewerNetMinor: '-450',
  };
  const expense = app.hold('journeyViewerQuery', corrected);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expense.started;
  await expense.release();
  await expect(group).toContainText('Total spend · USD$9.75');
  await expect(group).toContainText('Your balance · USD-$4.50');
  const repaid = structuredClone(corrected);
  repaid.groupDirectory.entries[1].financialSummary.viewerNetMinor = '0';
  const repayment = app.hold('journeyViewerQuery', repaid);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await repayment.started;
  await repayment.release();
  await expect(group).toContainText('Total spend · USD$9.75');
  await expect(group).toContainText('Nothing for you to pay or collect');
});
