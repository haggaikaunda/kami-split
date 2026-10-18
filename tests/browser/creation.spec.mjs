import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

async function creator(app) {
  await app.authenticate();
  const data = responseFor('journeyViewerQuery', {});
  data.viewer.canCreateGroups = true;
  app.holdMatching('journeyViewerQuery', () => true, data).release();
}

test('fresh creation submits once without recovery acknowledgement and freshly opens its result', async ({
  page,
  app,
}) => {
  await creator(app);
  await page.goto('/groups/new');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Create group');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByLabel('Currency', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic new group');
  const completion = {
    createGroup: {
      __typename: 'GroupCreationCompleted',
      groupId: 'F',
      creatorMembershipId: 'M',
      createdAt: '2026-10-05T00:00:00Z',
      operationKey: '',
    },
  };
  const result = app.hold('journeyGroupCreationMutation', completion);
  await dialog
    .getByRole('button', { name: 'Create group', exact: true })
    .dblclick();
  await result.started;
  const writes = app.requests.filter(
    (r) => r.operation === 'journeyGroupCreationMutation',
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].variables.input).toMatchObject({
    name: 'Synthetic new group',
    kind: 'ORDINARY',
    trip: null,
  });
  completion.createGroup.operationKey = writes[0].variables.input.operationKey;
  await result.release();
  await expect(page).toHaveURL('/groups/F');
  expect(
    app.requests.some(
      (r) => r.operation === 'journeyGroupQuery' && r.variables.id === 'F',
    ),
  ).toBe(true);
});

test('cancel and reload preserve the Trip draft; uncertain creation stays frozen with its original key', async ({
  page,
  app,
}) => {
  await creator(app);
  await page.goto('/groups?kind=trips&filter=past');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('link', { name: 'Create trip', exact: true }).click();
  await expect(
    page
      .locator('[data-ui~=discovery-filters]')
      .first()
      .getByRole('link', { name: 'Trips', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ui~=journey-page-heading]')).toContainText(
    'Groups',
  );
  await page.getByLabel('Name', { exact: true }).fill('Synthetic journey');
  await page
    .getByLabel('Destination (optional)', { exact: true })
    .fill('Kyoto');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/kind=trips&filter=past&restore=/);
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('link', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Create trip');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Synthetic journey',
  );
  app
    .holdMatching('journeyGroupCreationMutation', () => true, {
      createGroup: { __typename: 'Problem', code: 'UNAVAILABLE' },
    })
    .release();
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry original creation' }),
  ).toBeEnabled();
  const original = app.requests.find(
    (r) => r.operation === 'journeyGroupCreationMutation',
  ).variables.input;
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry original creation' }).click();
  await expect
    .poll(
      () =>
        app.requests.filter(
          (r) => r.operation === 'journeyGroupCreationMutation',
        ).length,
    )
    .toBe(2);
  expect(
    app.requests
      .filter((r) => r.operation === 'journeyGroupCreationMutation')
      .map((r) => r.variables.input),
  ).toEqual([original, original]);
});

test('known corrupt storage blocks until explicit acknowledged recovery', async ({
  page,
  app,
}) => {
  await creator(app);
  await page.goto('/groups');
  await page.evaluate(() =>
    sessionStorage.setItem('kami-group-creation-v1', 'corrupt'),
  );
  await page.goto('/groups/new');
  await expect(
    page.getByRole('button', { name: 'Create group', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Start new draft after storage loss' }),
  ).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Start new draft after storage loss' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Create group', exact: true }),
  ).toBeEnabled();
  expect(
    app.requests.filter((r) => r.operation === 'journeyGroupCreationMutation'),
  ).toHaveLength(0);
});

for (const width of [320, 390, 440, 1280]) {
  test(`creation sheet and drawer keep actions reachable at ${width}px`, async ({
    page,
    app,
  }, testInfo) => {
    await creator(app);
    await page.setViewportSize({ width, height: 844 });
    for (const appearance of ['LIGHT', 'DARK', 'SYSTEM']) {
      app.setAppearance(appearance);
      await page.emulateMedia({
        colorScheme: appearance === 'SYSTEM' ? 'dark' : 'light',
      });
      await page.goto('/groups');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.screenshot({
        path: testInfo.outputPath(`choices-${appearance}.png`),
      });
      await page
        .getByRole('link', { name: 'Create trip', exact: true })
        .click();
      await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(
        '2026-10-05',
      );
      for (const text of [100, 200]) {
        await page.evaluate((text) => {
          document.documentElement.style.fontSize = `${text}%`;
        }, text);
        const geometry = await page.getByRole('dialog').evaluate((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return {
            x,
            y,
            width,
            height,
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            locked: document.body.style.overflow,
          };
        });
        expect(geometry.documentWidth).toBeLessThanOrEqual(width);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(
          geometry.clientWidth + 1,
        );
        expect(geometry.locked).toBe('hidden');
        if (width === 1280 && text === 100) expect(geometry.width).toBe(352);
        if (width <= 440) expect(geometry.width).toBe(width);
        const submit = page.getByRole('button', {
          name: 'Create trip',
          exact: true,
        });
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeInViewport();
        await page.getByLabel('Name', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`trip-${appearance}-${text}.png`),
        });
        await testInfo.attach(`${appearance}-${text}-geometry`, {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        });
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '100%';
      });
      await page.setViewportSize({ width, height: 360 });
      await page
        .getByRole('button', { name: 'Create trip', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole('button', { name: 'Create trip', exact: true }),
      ).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Create', exact: true }),
      ).toBeFocused();
      await page.setViewportSize({ width, height: 844 });
    }
  });
}
