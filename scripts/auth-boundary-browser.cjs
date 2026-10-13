/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser acceptance harness. */
// Synthetic services prove the real browser/Next auth boundary, not provider or DB permissions.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const origin = `http://localhost:${process.env.PORT || '3195'}`;
const authOrigin = `http://localhost:${process.env.AUTH_PORT || '3196'}`;
const output = process.env.OUTPUT_DIR || '/tmp/kami-auth-boundary-browser';
fs.mkdirSync(output, { recursive: true });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.test',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T00:00:00Z',
};
const token = (expiry = 3600) =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + expiry,
        aud: 'authenticated',
      }),
    ).toString('base64url'),
    Buffer.from('synthetic').toString('base64url'),
  ].join('.');
const session = () => ({
  user,
  access_token: token(),
  refresh_token: 'synthetic-refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
});
let authState = 'valid';
let invitationKind = 'SHARED';
let wrongAccount = false;
const authRequests = [];
const authServer = http.createServer(async (req, res) => {
  authRequests.push({
    method: req.method,
    path: req.url,
    requestedHeaders: req.headers['access-control-request-headers'],
  });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  authRequests.push({ method: req.method, path: req.url });
  res.setHeader('Content-Type', 'application/json');
  if (req.url.includes('/logout')) {
    res.writeHead(204);
    res.end();
    return;
  }
  if (authState !== 'valid') {
    res.writeHead(authState === 'error' ? 503 : 401);
    res.end(
      JSON.stringify({ message: 'Synthetic unavailable', code: 'bad_jwt' }),
    );
    return;
  }
  res.end(JSON.stringify(req.url.includes('/user') ? user : session()));
});
const protectedRoutes = [
  '/',
  '/household',
  '/household/expenses',
  '/household/ledger',
  '/groups',
  '/groups/G',
  '/groups/new',
  '/groups/G/expenses/E/edit',
  '/trips',
  '/trips/T',
  '/account',
  '/invitations',
  '/future-private-route/nested',
];
const forbidden =
  '[data-ui~="workspace-navigation"],.workspace-nav,[data-ui~="workspace-header"],[data-ui~="workspace-tabs"],.account-heading,.financial-navigation';
async function noPrivate(page) {
  assert.equal(await page.locator(forbidden).count(), 0, page.url());
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Financial navigation' })
      .count(),
    0,
  );
  assert(
    !/Sign in to see your Household/.test(
      await page.locator('body').innerText(),
    ),
  );
}
async function signIn(page) {
  await page.getByLabel('Email address', { exact: true }).fill(user.email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('SyntheticPassword123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function fixtures(page) {
  await page.route('**/api/graphql', (r) =>
    r.fulfill({
      json: {
        data: {
          currentProfile: {
            __typename: 'Profile',
            id: 'P',
            displayName: 'Private synthetic person',
          },
          viewer: {
            __typename: 'Viewer',
            id: 'V',
            displayName: 'Private synthetic person',
            today: '2026-10-12',
            canCreateGroups: false,
            groups: [],
          },
        },
      },
    }),
  );
  await page.route('**/api/onboarding/**', async (r) => {
    const action = new URL(r.request().url()).pathname.split('/').at(-1);
    const body = r.request().postDataJSON();
    onboardingCalls.push({ action, body });
    const responses = {
      preview: {
        kind: invitationKind,
        groupName: 'Synthetic household',
        inviterDisplayName: 'Synthetic inviter',
      },
      'callback-state': { tokenDigest: 'd'.repeat(64) },
      'targeted-continuation': {
        tokenHash: 'a'.repeat(64),
        type: 'invite',
        needsPassword: true,
      },
      accept: { code: 'ACCEPTED', groupID: 'G', hasAccess: true },
    };
    if (action === 'targeted-continuation' && wrongAccount)
      return r.fulfill({ status: 403, json: { code: 'WRONG_ACCOUNT' } });
    await r.fulfill({
      json: responses[action] || {
        code: action === 'clear' ? 'CLEARED' : 'STARTED',
      },
    });
  });
}
const onboardingCalls = [];
(async () => {
  await new Promise((resolve) =>
    authServer.listen(Number(new URL(authOrigin).port), resolve),
  );
  const web = spawn(
    process.execPath,
    [
      'apps/web/node_modules/next/dist/bin/next',
      'start',
      'apps/web',
      '-p',
      new URL(origin).port,
    ],
    {
      env: {
        ...process.env,
        ONBOARDING_PUBLIC_SUPABASE_URL: authOrigin,
        ONBOARDING_PUBLIC_SUPABASE_KEY: 'synthetic-public',
        ONBOARDING_ORIGIN: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let webLog = '';
  web.stdout.on('data', (d) => {
    webLog += d;
  });
  web.stderr.on('data', (d) => {
    webLog += d;
  });
  let browser;
  const report = [];
  try {
    for (let i = 0; i < 100; i++) {
      if (web.exitCode !== null)
        throw new Error(`Next startup exited: ${webLog}`);
      try {
        await fetch(origin + '/sign-in');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    // Inspect actual direct HTML/RSC HTTP responses without cookies before browser execution.
    for (const route of protectedRoutes)
      for (const rsc of [false, true]) {
        const response = await fetch(origin + route, {
          redirect: 'manual',
          headers: rsc ? { RSC: '1' } : {},
        });
        assert(
          [303, 307, 308].includes(response.status),
          `Cold ${route} ${rsc ? 'RSC' : 'HTML'}: ${response.status}`,
        );
        const location = response.headers.get('location');
        assert.equal(new URL(location, origin).pathname, '/sign-in');
        const body = await response.text();
        assert(
          !/workspace-header|workspace-tabs|Private synthetic person/.test(
            body,
          ),
        );
      }
    report.push({ serverColdHtmlAndRsc: protectedRoutes.length * 2 });
    for (const next of [
      'https://evil.test/',
      '//evil.test/',
      '/sign-in',
      '/join#secret',
      '/account?token=secret',
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await fixtures(page);
      await page.goto(origin + '/sign-in?next=' + encodeURIComponent(next));
      await signIn(page);
      await page.waitForURL('**/groups').catch(async (error) => {
        console.error(
          'Unsafe next diagnostic',
          next,
          page.url(),
          await page.locator('body').innerText(),
          authRequests,
        );
        throw error;
      });
      assert.equal(new URL(page.url()).origin, origin);
      await context.close();
    }
    report.push({ unsafeNextFallbacks: 5 });
    for (const expired of [false, true]) {
      authState = 'revoked';
      const cookieSession = {
        ...session(),
        access_token: expired ? token(-60) : 'malformed',
        expires_at: expired
          ? Math.floor(Date.now() / 1000) - 60
          : Math.floor(Date.now() / 1000) + 3600,
      };
      const cookie =
        'base64-' +
        Buffer.from(JSON.stringify(cookieSession)).toString('base64url');
      const response = await fetch(origin + '/account', {
        redirect: 'manual',
        headers: { Cookie: 'kami-auth=' + cookie },
      });
      assert.equal(
        new URL(response.headers.get('location'), origin).pathname,
        '/sign-in',
      );
    }
    authState = 'valid';
    report.push({ invalidAndExpiredCookiesDenied: true });
    const refreshable = {
      ...session(),
      access_token: token(-60),
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    const refreshResponse = await fetch(origin + '/account', {
      redirect: 'manual',
      headers: {
        Cookie:
          'kami-auth=base64-' +
          Buffer.from(JSON.stringify(refreshable)).toString('base64url'),
      },
    });
    assert.equal(
      refreshResponse.status,
      200,
      'Valid provider refresh keeps authenticated routing',
    );
    assert(refreshResponse.headers.get('set-cookie')?.includes('kami-auth'));
    report.push({ expiredCookieSuccessfullyRefreshed: true });
    for (const width of [320, 390, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await fixtures(page);
      const errors = [];
      const networkUrls = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (request) => networkUrls.push(request.url()));
      // An observer records any shell mounted even briefly during cold navigation/hydration.
      await page.addInitScript((selector) => {
        window.__protectedFlashes = [];
        new MutationObserver(() => {
          if (
            location.pathname === '/sign-in' &&
            document.querySelector(selector)
          )
            window.__protectedFlashes.push(location.href);
        }).observe(document, { childList: true, subtree: true });
      }, forbidden);
      for (const route of protectedRoutes) {
        await page.goto(origin + route);
        await page.getByLabel('Email address', { exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, '/sign-in');
        await noPrivate(page);
        assert.deepEqual(
          await page.evaluate(() => window.__protectedFlashes),
          [],
        );
      }
      await page.screenshot({
        path: `${output}/cold-${width}.png`,
        fullPage: true,
      });
      await page.addStyleTag({ content: 'html {font-size: 200% !important}' });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        'Sign in must fit at doubled text',
      );
      await page.getByLabel('Email address', { exact: true }).focus();
      await page.keyboard.press('Tab');
      assert(
        await page
          .getByLabel('Password', { exact: true })
          .evaluate((el) => document.activeElement === el),
      );
      await page.screenshot({
        path: `${output}/cold-doubled-${width}.png`,
        fullPage: true,
      });
      // Actual password sign-in writes SSR cookies; authenticated cold requests reach profile.
      await page.goto(origin + '/account');
      await signIn(page);
      await page.waitForURL('**/account');
      await page.getByLabel('Display name', { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel('Display name', { exact: true }).inputValue(),
        'Private synthetic person',
      );
      assert(
        (await context.cookies()).some((c) => c.name.startsWith('kami-auth')),
        'SSR auth cookies must exist',
      );
      await page.reload();
      await page.getByLabel('Display name', { exact: true }).waitFor();
      await page.screenshot({
        path: `${output}/account-${width}.png`,
        fullPage: true,
      });
      const other = await context.newPage();
      await fixtures(other);
      await other.goto(origin + '/account');
      await other.getByLabel('Display name', { exact: true }).waitFor();
      await page.evaluate(() =>
        sessionStorage.setItem(
          'kami-financial-drafts-v1',
          'synthetic-private-draft',
        ),
      );
      await page
        .getByRole('button', { name: 'Sign out of this session' })
        .click();
      await page.waitForURL('**/sign-in*');
      await other.waitForURL('**/sign-in*');
      await noPrivate(page);
      await noPrivate(other);
      assert.equal(
        await page.evaluate(() =>
          sessionStorage.getItem('kami-financial-drafts-v1'),
        ),
        null,
      );
      await page.goBack();
      await noPrivate(page);
      await page.goForward();
      await noPrivate(page);
      await page.goto(origin + '/account');
      await page.getByLabel('Email address', { exact: true }).waitFor();
      await noPrivate(page);
      // Revocation and provider failure deny a cookie-bearing cold request, and foreground state.
      for (const state of ['revoked', 'error']) {
        authState = 'valid';
        await page.goto(origin + '/account');
        await signIn(page);
        await page.waitForURL('**/account');
        await page.getByLabel('Display name', { exact: true }).waitFor();
        authState = state;
        await page.reload();
        await page.waitForURL('**/sign-in*');
        await noPrivate(page);
        if (state === 'revoked')
          await page
            .getByLabel('Email address', { exact: true })
            .waitFor()
            .catch(async (error) => {
              console.error(
                'Revoked sign-in diagnostic',
                page.url(),
                await page.locator('body').innerText(),
              );
              await page.screenshot({
                path: `${output}/revoked-failure-${width}.png`,
                fullPage: true,
              });
              throw error;
            });
        else
          assert(
            await page
              .getByRole('link', { name: 'retry account access', exact: true })
              .isVisible(),
          );
        authState = 'valid';
        await context.clearCookies();
      }
      // Fragments survive redirect then scrub without entering URL query, referrer or history.
      const secret = 'synthetic-invitation-fragment';
      await page.goto(origin + '/join#' + secret);
      await page
        .getByRole('heading', { name: 'Join Synthetic household', exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).pathname, '/sign-in');
      assert.equal(new URL(page.url()).hash, '');
      assert(!page.url().includes(secret));
      await noPrivate(page);
      assert(
        onboardingCalls.some(
          (x) => x.action === 'start' && x.body.token === secret,
        ),
      );
      await page
        .getByRole('button', { name: 'Create an account', exact: true })
        .click();
      await page.getByLabel('Email address', { exact: true }).fill(user.email);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page
        .getByRole('heading', { name: 'Check your email', exact: true })
        .waitFor();
      const hash = 'a'.repeat(64);
      await page.goto(
        origin +
          `/auth/confirm#type=recovery&token_hash=${hash}&state=synthetic-state`,
      );
      await page
        .getByRole('button', { name: 'Continue with email link', exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).pathname, '/sign-in');
      assert.equal(new URL(page.url()).hash, '');
      await noPrivate(page);
      await page
        .getByRole('button', { name: 'Continue with email link', exact: true })
        .click();
      await page.getByLabel('Confirm password', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/sign-in');
      await noPrivate(page);
      await page
        .getByLabel('Password', { exact: true })
        .fill('SyntheticPassword123');
      await page
        .getByLabel('Confirm password', { exact: true })
        .fill('SyntheticPassword123');
      await page
        .getByRole('button', {
          name: /Save password|Create account/,
          exact: true,
        })
        .click();
      await page
        .getByRole('heading', { name: 'Your account is ready', exact: true })
        .waitFor();
      await page.screenshot({
        path: `${output}/onboarding-${width}.png`,
        fullPage: true,
      });
      await page.goto(
        origin +
          `/auth/confirm#type=invite&token_hash=${hash}&state=synthetic-other-state`,
      );
      await page
        .getByText(/Sign out before opening a verification or recovery email/)
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', {
            name: 'Continue with email link',
            exact: true,
          })
          .count(),
        0,
      );
      await noPrivate(page);
      // Already-signed-in invitation acceptance is still an explicit choice.
      await page.goto(origin + '/join#synthetic-second-link');
      await page
        .getByRole('heading', {
          name: 'Ready to join Synthetic household?',
          exact: true,
        })
        .waitFor();
      await noPrivate(page);
      await page
        .getByRole('button', { name: 'Join Synthetic household', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'You joined Synthetic household!',
          exact: true,
        })
        .waitFor();
      // Targeted invitations preserve context when switching the existing account.
      invitationKind = 'TARGETED';
      wrongAccount = true;
      await page.goto(origin + '/join#synthetic-targeted-link');
      await page
        .getByRole('button', { name: 'Continue with invitation', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'This invitation is for another account',
          exact: true,
        })
        .waitFor();
      await page
        .getByRole('button', { name: 'Switch account', exact: true })
        .click();
      wrongAccount = false;
      await page
        .getByRole('button', { name: 'Continue with invitation', exact: true })
        .click();
      await page.getByLabel('Confirm password', { exact: true }).waitFor();
      await noPrivate(page);
      invitationKind = 'SHARED';
      assert(
        !networkUrls.some((url) => url.includes(secret) || url.includes(hash)),
        'Fragment capabilities must never enter request URLs',
      );
      assert.deepEqual(errors, []);
      report.push({
        width,
        coldRoutes: protectedRoutes.length,
        passwordSignIn: true,
        realCookieReload: true,
        multiTabLogout: true,
        backForward: true,
        revokedAndError: true,
        invitationSignup: true,
        recoveryPassword: true,
      });
      authState = 'valid';
      await context.close();
    }
    fs.writeFileSync(
      `${output}/report.json`,
      JSON.stringify(
        {
          report,
          authRequests,
          onboardingCalls,
          testedCommit: process.env.TESTED_COMMIT,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    web.kill();
    await new Promise((r) => authServer.close(r));
    fs.writeFileSync(`${output}/next.log`, webLog);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
