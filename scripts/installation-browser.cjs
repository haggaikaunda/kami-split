/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in CommonJS browser regression runner. */
const assert = require('node:assert/strict');

// Served metadata and synthetic navigation evidence, not an iOS installation test.
module.exports = async function verifyInstallation({
  page,
  origin,
  workspace,
  results,
}) {
  const entry = workspace === 'group' ? '/trips' : '/household';
  await page.goto(origin + entry);
  await page
    .getByRole('navigation', { name: 'Financial navigation' })
    .waitFor();

  const manifestURL = await page
    .locator('link[rel="manifest"]')
    .getAttribute('href');
  assert.equal(new URL(manifestURL, origin).origin, origin);
  // Check the server-rendered head, so installing before hydration works too.
  const routes = [
    '/groups',
    '/groups/new',
    '/groups/activity',
    '/groups/F',
    '/groups/F/activity',
    '/groups/F/expenses/e1',
    '/groups/F/repayments/new',
    '/trips',
    '/trips/new',
    '/trips/T',
    '/trips/T/expenses/e1',
    '/trips/T/repayments/new',
    '/household',
    '/household/expenses',
    '/household/activity',
    '/household/ledger',
    '/account',
    '/sign-in',
    '/join',
    '/invitations',
    '/auth/confirm',
    '/auth/password',
  ];
  let appleIcon;
  for (const route of routes) {
    const documentResponse = await page.request.get(origin + route);
    assert.equal(documentResponse.status(), 200, route);
    const flow = {
      '/join': 'join',
      '/auth/confirm': 'confirm',
      '/auth/password': 'password',
    }[route];
    // Authenticated layouts may stream the Trips redirect in the HTML. The
    // rendered keyboard journey below checks its canonical destination.
    const expectedURL = origin + (flow ? '/sign-in?flow=' + flow : route);
    assert.equal(
      documentResponse.url(),
      expectedURL,
      'Unexpected page redirect: ' + route,
    );
    const metadata = await page.evaluate(
      (html) => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        return {
          manifests: Array.from(
            document.querySelectorAll('link[rel="manifest"]'),
            (link) => link.getAttribute('href'),
          ),
          capable: document
            .querySelector('meta[name="apple-mobile-web-app-capable"]')
            ?.getAttribute('content'),
          title: document
            .querySelector('meta[name="apple-mobile-web-app-title"]')
            ?.getAttribute('content'),
          viewport: document
            .querySelector('meta[name="viewport"]')
            ?.getAttribute('content'),
          appleIcon: document
            .querySelector('link[rel="apple-touch-icon"]')
            ?.getAttribute('href'),
        };
      },
      await documentResponse.text(),
    );
    assert.deepEqual(metadata.manifests, [manifestURL], route);
    assert.equal(metadata.capable, 'yes', route);
    assert.equal(metadata.title, 'Kami Grow', route);
    assert.match(metadata.viewport, /viewport-fit=cover/, route);
    assert(metadata.appleIcon, route);
    appleIcon = metadata.appleIcon;
  }
  await verifyPublicAssets(page, origin, manifestURL, appleIcon);

  // Exercise the same links after entry from each reported installation page.
  for (const [label, route] of [
    ['Groups', '/groups'],
    ['Household', '/household'],
    ['Profile', '/account'],
  ]) {
    const link = page
      .getByRole('navigation', { name: 'Financial navigation' })
      .getByRole('link', { name: label, exact: true });
    assert.equal(await link.getAttribute('target'), null);
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === route);
    await page
      .getByRole('navigation', { name: 'Financial navigation' })
      .getByRole('link', { name: label, exact: true })
      .waitFor();
    assert.equal(
      await page.locator('link[rel="manifest"]').getAttribute('href'),
      manifestURL,
    );
    assert.equal(page.context().pages().length, 1);
  }
  // Trips remains a native keyboard destination inside the unified directory.
  await page
    .getByRole('navigation', { name: 'Financial navigation' })
    .getByRole('link', { name: 'Groups', exact: true })
    .click();
  const trips = page
    .getByRole('navigation', { name: 'Group type' })
    .getByRole('link', { name: 'Trips', exact: true });
  assert.equal(await trips.getAttribute('target'), null);
  await trips.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(origin + '/groups?kind=trips');
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Financial navigation' })
      .getByRole('link', { name: 'Groups', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  assert.equal(page.context().pages().length, 1);
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute('href'),
    manifestURL,
  );
  // Next can stream the page redirect after the authenticated layout starts.
  await page.goto(origin + '/');
  await page.waitForURL(origin + '/groups');
  const expensesURL = origin + '/trips/T?tab=expenses';
  await page.goto(expensesURL);
  await page.locator('#ledger-expense-e1').click();
  await page.waitForURL((url) => url.searchParams.get('expense') === 'e1');
  await page.getByText('Private fixture note').waitFor();
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute('href'),
    manifestURL,
  );
  await page.goBack();
  await page.waitForURL(expensesURL);
  results.push({
    entry,
    servedRoutes: routes.length,
    manifestURL,
    icons: 'anonymous GET/HEAD, PNG signatures and dimensions',
    keyboardNavigation: true,
    expenseBack: true,
    physicalIOS: 'not verified',
  });
};

async function verifyPublicAssets(page, origin, manifestURL, appleIcon) {
  const anonymous = await page.context().browser().newContext();
  try {
    const response = await anonymous.request.get(
      new URL(manifestURL, origin).href,
      { maxRedirects: 0 },
    );
    assert.equal(response.status(), 200);
    assert.match(
      response.headers()['content-type'],
      /application\/(manifest\+)?json/,
    );
    const manifest = await response.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.id, '/');
    assert.equal(manifest.name, 'Kami Grow');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.start_url, '/groups');

    for (const icon of [
      ...manifest.icons,
      { src: appleIcon, sizes: '180x180', type: 'image/png' },
    ]) {
      const iconURL = new URL(icon.src, origin);
      assert.equal(iconURL.origin, origin);
      const iconResponse = await anonymous.request.get(iconURL.href, {
        maxRedirects: 0,
      });
      assert.equal(iconResponse.status(), 200);
      const head = await anonymous.request.head(iconURL.href, {
        maxRedirects: 0,
      });
      assert.equal(head.status(), 200);
      assert.match(head.headers()['content-type'], /image\/png/);
      assert.match(iconResponse.headers()['content-type'], /image\/png/);
      const image = await iconResponse.body();
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(
        `${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`,
        icon.sizes,
      );
    }
    const manifestHead = await anonymous.request.head(
      new URL(manifestURL, origin).href,
      { maxRedirects: 0 },
    );
    assert.equal(manifestHead.status(), 200);
    assert.match(
      manifestHead.headers()['content-type'],
      /application\/(manifest\+)?json/,
    );
    const root = await anonymous.request.get(origin + '/', { maxRedirects: 0 });
    assert.equal(root.status(), 307);
    assert.equal(new URL(root.headers().location, origin).pathname, '/sign-in');
  } finally {
    await anonymous.close();
  }
}
