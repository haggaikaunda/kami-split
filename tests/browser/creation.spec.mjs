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
  const dialog = page.locator('[data-ui~=creation-form]');
  await expect(dialog).toHaveAccessibleName('Create a shared space');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(
    dialog.getByRole('group', { name: 'Currency', exact: true }),
  ).toHaveText('CurrencyUSD · US Dollar');
  await expect(
    dialog
      .getByRole('group', { name: 'Currency', exact: true })
      .locator('input,select'),
  ).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await dialog
    .getByLabel('Group name', { exact: true })
    .fill('Synthetic new group');
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
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Trip', exact: true }).click();
  await page.getByLabel('Trip name', { exact: true }).fill('Synthetic journey');
  await page
    .getByLabel('Destination (optional)', { exact: true })
    .fill('Kyoto');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/kind=trips&filter=past&restore=/);
  await expect(
    page.getByRole('link', { name: 'Create', exact: true }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Trip', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Trip name', { exact: true })).toHaveValue(
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
  await expect(page.getByLabel('Trip name', { exact: true })).toBeDisabled();
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
  // Wait for the account scope to finish its authorized startup before injecting loss.
  await expect(
    page.getByRole('link', { name: 'Create', exact: true }),
  ).toBeVisible();
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
  test(`creation page keeps fields and actions reachable at ${width}px`, async ({
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
      await page.getByRole('link', { name: 'Create', exact: true }).click();
      await expect(
        page.getByRole('heading', {
          name: 'Create a shared space',
          exact: true,
        }),
      ).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page.getByText('Missing a previous creation?', { exact: true }),
      ).toHaveCount(0);
      for (const kind of ['Group', 'Trip']) {
        await page.getByRole('button', { name: kind, exact: true }).click();
        if (kind === 'Trip')
          await expect(
            page.getByLabel('Start date', { exact: true }),
          ).toHaveValue('2026-10-05');
        for (const text of [100, 200]) {
          await page.evaluate((text) => {
            document.documentElement.style.fontSize = `${text}%`;
          }, text);
          const geometry = await page
            .locator('[data-ui~=creation-form]')
            .evaluate((element) => {
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
                theme: document.documentElement.dataset.theme,
                canvas: getComputedStyle(document.documentElement)
                  .getPropertyValue('--color-canvas')
                  .trim(),
                surface: getComputedStyle(element.querySelector('input'))
                  .backgroundColor,
              };
            });
          const segments = await page
            .getByRole('group', { name: 'Space type', exact: true })
            .evaluate((element) => {
              const box = (node) => {
                const { x, y, right, bottom } = node.getBoundingClientRect();
                return { x, y, right, bottom };
              };
              return [...element.querySelectorAll('button')].map((button) => {
                const text = [...button.childNodes].find(
                  (node) =>
                    node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
                );
                const range = document.createRange();
                range.selectNodeContents(text);
                return {
                  button: box(button),
                  icon: box(button.querySelector('svg')),
                  text: box(range),
                };
              });
            });
          expect(segments[0].button.right).toBeLessThanOrEqual(
            segments[1].button.x,
          );
          for (const segment of segments) {
            for (const child of [segment.icon, segment.text]) {
              expect(child.x).toBeGreaterThanOrEqual(segment.button.x - 1);
              expect(child.right).toBeLessThanOrEqual(segment.button.right + 1);
              expect(child.y).toBeGreaterThanOrEqual(segment.button.y - 1);
              expect(child.bottom).toBeLessThanOrEqual(
                segment.button.bottom + 1,
              );
            }
          }
          expect(geometry.documentWidth).toBeLessThanOrEqual(width);
          expect(geometry.scrollWidth).toBeLessThanOrEqual(
            geometry.clientWidth + 1,
          );
          expect(geometry.theme).toBe(
            appearance === 'LIGHT' ? 'light' : 'dark',
          );
          expect(geometry.canvas).toBe(
            appearance === 'LIGHT' ? '#f2f5f7' : '#0b111b',
          );
          expect(geometry.surface).toBe(
            appearance === 'LIGHT' ? 'rgb(255, 255, 255)' : 'rgb(19, 29, 44)',
          );
          if (width === 1280 && text === 100) expect(geometry.width).toBe(560);
          const submit = page.getByRole('button', {
            name: `Create ${kind.toLowerCase()}`,
            exact: true,
          });
          await submit.scrollIntoViewIfNeeded();
          await expect(submit).toBeInViewport();
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: testInfo.outputPath(`${kind}-${appearance}-${text}.png`),
            fullPage: true,
          });
          await testInfo.attach(`${kind}-${appearance}-${text}-geometry`, {
            body: JSON.stringify({ ...geometry, segments }),
            contentType: 'application/json',
          });
        }
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '100%';
        });
      }
      await page.setViewportSize({ width, height: 360 });
      await page
        .getByRole('link', { name: 'Cancel', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole('link', { name: 'Cancel', exact: true }),
      ).toBeInViewport();
      await page.getByRole('link', { name: 'Cancel', exact: true }).click();
      await expect(
        page.getByRole('link', { name: 'Create', exact: true }),
      ).toBeFocused();
      await page.setViewportSize({ width, height: 844 });
    }
  });
}
