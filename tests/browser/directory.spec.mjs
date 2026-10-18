import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

for (const count of [0, 1, 3, 12]) {
  test(`compact directory keeps its hierarchy with ${count} cards`, async ({
    page,
    app,
  }, testInfo) => {
    await app.authenticate();
    await page.setViewportSize({
      width: testInfo.project.use.viewport.width,
      height: 844,
    });
    const data = responseFor('journeyViewerQuery', {});
    const ordinary = data.groupDirectory.entries[1];
    data.viewer.canCreateGroups = true;
    data.groupDirectory.entries = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(ordinary),
      group: {
        ...ordinary.group,
        id: `directory-${index}`,
        name: ['Friends', 'City break', 'Weekend away'][index % 3],
      },
    }));
    void app.hold('journeyViewerQuery', data).release();
    await page.goto('/groups');
    const toolbar = page.locator('[data-ui="directory-toolbar"]');
    await expect(toolbar).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText('Signed in as', { exact: false })).toHaveCount(
      0,
    );
    const create = toolbar.getByRole('button', { name: 'Create', exact: true });
    const filters = toolbar.getByRole('navigation', { name: 'Group type' });
    const createBox = await create.boundingBox();
    const filterBox = await filters.boundingBox();
    expect(Math.abs(createBox.y - filterBox.y)).toBeLessThanOrEqual(3);
    expect(createBox.x).toBeGreaterThan(filterBox.x + filterBox.width);
    const cards = page.locator('[data-ui="discovery-cards"] > li');
    await expect(cards).toHaveCount(count);
    if (!count) {
      await expect(
        page.getByText('You have no admitted groups or trips.', {
          exact: false,
        }),
      ).toBeVisible();
    } else {
      const bounds = await page.evaluate(() => {
        const box = (element) => {
          const { x, y, width, height, bottom } =
            element.getBoundingClientRect();
          return { x, y, width, height, bottom };
        };
        const content = document.querySelector(
          '[data-ui~="workspace-content"]',
        );
        const list = document.querySelector('[data-ui="discovery-cards"]');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          content: box(content),
          toolbar: box(document.querySelector('[data-ui="directory-toolbar"]')),
          list: box(list),
          cards: [...list.children].map(box),
          navigation: box(
            document.querySelector('[data-ui~="workspace-navigation"]'),
          ),
        };
      });
      await testInfo.attach('directory-bounds', {
        body: JSON.stringify(bounds, null, 2),
        contentType: 'application/json',
      });
      if (bounds.viewport.width === 390) {
        expect(bounds.cards[0].y).toBeLessThanOrEqual(200);
        expect(bounds.cards.every((card) => card.height <= 210)).toBe(true);
        if (count >= 3) {
          expect(bounds.cards[1].bottom).toBeLessThan(bounds.navigation.y);
          expect(bounds.cards[2].y).toBeLessThan(bounds.navigation.y);
        }
      } else {
        expect(bounds.cards[0].width).toBeCloseTo(
          (bounds.list.width - 15) / 2,
          0,
        );
        if (count >= 3) {
          expect(bounds.cards[1].y).toBe(bounds.cards[0].y);
          expect(bounds.cards[2].y).toBeGreaterThan(bounds.cards[0].bottom);
        }
      }
      await expect(cards.first().getByRole('link')).toContainText(
        'Total spend · USD$3.00Your balance · USDYou’re owed $84.20',
      );
      await cards.last().getByRole('link').scrollIntoViewIfNeeded();
      await cards.last().getByRole('link').focus();
      await expect(cards.last().getByRole('link')).toBeFocused();
      await page.evaluate(() => scrollTo(0, 0));
    }
    await page.screenshot({
      path: testInfo.outputPath(`directory-${count}.png`),
      fullPage: true,
    });
  });
}
