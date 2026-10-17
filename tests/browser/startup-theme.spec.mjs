import { test, expect } from './fixtures.mjs';
import { user, session } from '../../scripts/browser/session.mjs';
import { origin } from '../../scripts/browser/settings.mjs';

// Existing dark --color-canvas token is #0b111b; assert actual painted RGB.
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
          (expected === 'dark' ? 'rgb(11, 17, 27)' : 'rgb(242, 245, 247)'),
      ),
    ).toBe(true);
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      value ? expected : 'light',
    );
    await page.screenshot({ path: info.outputPath('after-profile.png') });
  });
}

test('saved Dark survives repeated background, delayed verification, history', async ({
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
          frame.canvas === 'rgb(11, 17, 27)' && frame.body === frame.canvas,
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
    page.getByRole('button', { name: 'Sign out of this session', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page
    .getByRole('button', { name: 'Sign out of this session', exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(() => localStorage.getItem('kami-appearance')),
  ).toBeNull();
  await expect(
    page.getByText('Private synthetic person', { exact: true }),
  ).toHaveCount(0);
});

for (const status of [503, 401]) {
  test(`verification ${status} suppresses private content with the correct retained or discarded paint`, async ({
    page,
    context,
    app,
  }) => {
    await app.authenticate();
    await page.emulateMedia({ colorScheme: 'light' });
    await observe(page, 'DARK');
    app.setAppearance('DARK');
    await page.goto('/groups');
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true }),
    ).toBeVisible();
    const verification = Promise.withResolvers();
    await context.route('**/auth/v1/user', async (route) => {
      await verification.promise;
      await route.fulfill({
        status,
        json: {
          message: 'Synthetic verification failure',
          code: 'unexpected_failure',
        },
      });
    });
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
    });
    try {
      await expect(page.locator('[data-ui="screen-loading"]')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Groups', exact: true }),
      ).toHaveCount(0);
    } finally {
      verification.resolve();
    }
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 20000 });
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      status === 503 ? 'dark' : 'light',
    );
    await expect(
      page.getByText('Private synthetic person', { exact: true }),
    ).toHaveCount(0);
    // Close the document before fixture route teardown: canceled protected reads
    // must settle instead of keeping unrouteAll(wait) alive after access loss.
    await page.close();
  });
}

test('a verified account switch replaces paint ownership and rejects an old profile reply', async ({
  page,
  context,
  app,
}) => {
  await app.authenticate();
  await page.emulateMedia({ colorScheme: 'light' });
  await observe(page, 'DARK');
  const initial = app.hold('appearanceQuery', profile('DARK'));
  await page.goto('/groups');
  await initial.started;
  await initial.release();
  await expect(
    page.getByRole('heading', { name: 'Groups', exact: true }),
  ).toBeVisible();
  const old = app.hold('appearanceQuery', profile('LIGHT'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await old.started;
  const next = app.holdMatching(
    'appearanceQuery',
    () => true,
    profile('SYSTEM'),
  );
  const other = {
    ...user,
    id: '22222222-2222-4222-8222-222222222222',
    email: 'other@example.test',
  };
  const nextSession = { ...session(), user: other };
  nextSession.access_token = [
    { alg: 'HS256', typ: 'JWT' },
    { sub: other.id, exp: nextSession.expires_at, aud: 'authenticated' },
    'synthetic',
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.');
  await context.addCookies([
    {
      name: 'kami-auth',
      value:
        'base64-' +
        Buffer.from(JSON.stringify(nextSession)).toString('base64url'),
      url: origin,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/auth/v1/user', (route) =>
    route.fulfill({ json: other }),
  );
  await page.evaluate((nextSession) => {
    const channel = new BroadcastChannel('kami-auth');
    channel.postMessage({ event: 'SIGNED_IN', session: nextSession });
    channel.close();
  }, nextSession);
  await next.started;
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  next.release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('kami-appearance') ?? 'null')?.actor,
      ),
    )
    .toBe(other.id);
  await old.release();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kami-appearance')),
    ),
  ).toEqual({ actor: other.id, value: 'SYSTEM' });
});

test('a save committing after the resumed read converges on a fresh read without replaying the mutation', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/account');
  await expect(
    page.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked();
  const save = app.hold('appearanceMutation', {
    updateMyAppearance: { __typename: 'Profile', appearance: 'DARK' },
  });
  await page.getByRole('radio', { name: 'Dark', exact: true }).focus();
  await page.keyboard.press('Space');
  await save.started;
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
  });
  await expect(
    page.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // An aborted response cannot prove the server canceled its commit. Model it
  // after the resumed read, then require a new authoritative read to converge.
  app.setAppearance('DARK');
  await save.release();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    app.requests.filter(({ operation }) => operation === 'appearanceMutation'),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole('radio', { name: 'Dark', exact: true }),
  ).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
