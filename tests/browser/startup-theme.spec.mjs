import { test, expect } from './fixtures.mjs';
import { user } from '../../scripts/browser/session.mjs';

const profile = (appearance) => ({
  currentProfile: {
    __typename: 'Profile',
    id: 'profile-v',
    displayName: 'Synthetic',
    appearance,
  },
});

// Observe every animation frame, including intermediate loading, rather than
// inferring absence of a flash from the final screenshot.
async function observe(page, value) {
  await page.addInitScript(
    ({ actor, value }) => {
      if (value)
        localStorage.setItem(
          'kami-appearance',
          JSON.stringify({ actor, value }),
        );
      window.themeFrames = [];
      const frame = () => {
        const root = document.documentElement;
        if (root && document.body)
          window.themeFrames.push({
            theme: root.dataset.theme,
            canvas: getComputedStyle(root).backgroundColor,
            body: getComputedStyle(document.body).backgroundColor,
            loading: !!document.querySelector('[data-ui="screen-loading"]'),
          });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { actor: user.id, value },
  );
}

for (const [value, os, expected] of [
  ['DARK', 'light', 'dark'],
  ['LIGHT', 'dark', 'light'],
  ['SYSTEM', 'dark', 'dark'],
  [null, 'dark', 'dark'],
]) {
  test(`startup theme frames: ${value ?? 'no cache'} on ${os} OS`, async ({
    page,
    app,
  }, info) => {
    await app.authenticate();
    await page.emulateMedia({ colorScheme: os });
    await observe(page, value);
    const pending = app.holdMatching(
      'appearanceQuery',
      () => true,
      profile(value ?? 'LIGHT'),
    );
    await page.goto('/groups');
    await pending.started;
    await page.waitForTimeout(350);
    await page.screenshot({ path: info.outputPath('before-profile.png') });
    const before = await page.evaluate(() => window.themeFrames);
    await info.attach('before-profile-frames', {
      body: JSON.stringify(before),
      contentType: 'application/json',
    });
    pending.release();
    expect(before.length).toBeGreaterThan(0);
    expect([...new Set(before.map((frame) => frame.theme))]).toEqual([
      expected,
    ]);
    expect(
      before.every(
        (frame) =>
          frame.canvas ===
          (expected === 'dark' ? 'rgb(11, 18, 32)' : 'rgb(242, 245, 247)'),
      ),
    ).toBe(true);
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      value ? expected : 'light',
    );
    await page.screenshot({ path: info.outputPath('after-profile.png') });
  });
}

test('saved Dark survives repeated background, delayed verification, history and profile failure', async ({
  page,
  context,
  app,
}, info) => {
  await app.authenticate();
  await page.emulateMedia({ colorScheme: 'light' });
  await observe(page, 'DARK');
  const profileRead = app.holdMatching(
    'appearanceQuery',
    () => true,
    profile('DARK'),
  );
  await page.goto('/groups');
  profileRead.release();
  await expect(
    page.getByRole('heading', { name: 'Groups', exact: true }),
  ).toBeVisible();
  for (let turn = 0; turn < 2; turn++) {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let authReads = 0;
    await context.route('**/auth/v1/user', async (route) => {
      authReads++;
      await held;
      await route.fulfill({ json: user });
    });
    await page.evaluate(() => {
      window.themeFrames = [];
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });
    await expect(page.locator('[data-ui="screen-loading"]')).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(350);
    const observedAuthReads = authReads;
    await page.screenshot({ path: info.outputPath(`resume-${turn}.png`) });
    const frames = await page.evaluate(() => window.themeFrames);
    release();
    await info.attach(`resume-${turn}-frames`, {
      body: JSON.stringify(frames),
      contentType: 'application/json',
    });
    expect([...new Set(frames.map((frame) => frame.theme))]).toEqual(['dark']);
    expect(
      frames.every(
        (frame) =>
          frame.canvas === 'rgb(11, 18, 32)' && frame.body === frame.canvas,
      ),
    ).toBe(true);
    await expect(
      page.getByText('Still getting things ready', { exact: true }),
    ).toHaveCount(0);
    expect(observedAuthReads).toBe(1);
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true }),
    ).toBeVisible();
    await context.unroute('**/auth/v1/user');
  }
});

for (const failure of ['corrupt', 'unavailable']) {
  test(`startup paint tolerates ${failure} presentation storage`, async ({
    page,
    app,
  }) => {
    await app.authenticate();
    await page.emulateMedia({ colorScheme: 'dark' });
    await observe(page, null);
    await page.addInitScript((failure) => {
      if (failure === 'corrupt') localStorage.setItem('kami-appearance', '{');
      else {
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === 'kami-appearance')
            throw new DOMException('Unavailable', 'SecurityError');
          return get.call(this, key);
        };
      }
    }, failure);
    const pending = app.holdMatching(
      'appearanceQuery',
      () => true,
      profile('LIGHT'),
    );
    await page.goto('/groups');
    await pending.started;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const frames = await page.evaluate(() => window.themeFrames);
    pending.release();
    expect([...new Set(frames.map((frame) => frame.theme))]).toEqual(['dark']);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
}

test('profile failure preserves cached Dark and logout discards its binding', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.emulateMedia({ colorScheme: 'light' });
  await observe(page, 'DARK');
  const pending = app.holdMatching('appearanceQuery', () => true, {
    currentProfile: {
      __typename: 'ProfileProblem',
      code: 'UNAVAILABLE',
      message: 'Synthetic unavailable',
    },
  });
  await page.goto('/account');
  await pending.started;
  pending.release();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(() => localStorage.getItem('kami-appearance')),
  ).toBeNull();
  await expect(
    page.getByText('Private synthetic person', { exact: true }),
  ).toHaveCount(0);
});
