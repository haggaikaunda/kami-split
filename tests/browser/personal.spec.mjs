import { test, expect } from './fixtures.mjs';

const privateName =
  'A very long privately authorized joint household checking account at Example Community Credit Union';
function inventory({ accounts = true, status = {}, code = 'READY' } = {}) {
  return {
    bankingConnections: {
      __typename: 'BankingConnectionsResult',
      code,
      endCursor: null,
      hasNextPage: false,
      connections: accounts
        ? [
            {
              __typename: 'BankingConnection',
              id: 'connection-private',
              state: 'active',
              health: 'healthy',
              cleanup: 'not_requested',
              purge: 'not_requested',
              accounts: [
                {
                  __typename: 'BankingAccount',
                  id: 'account-private',
                  streamId: 'stream-private',
                  name: privateName,
                  kind: 'checking',
                  currency: 'USD',
                  selected: true,
                  requestedHistoryDays: 365,
                  importStatus: {
                    operation: 'QUEUED',
                    importState: 'LOADING',
                    usable: false,
                    recovery: 'WAIT',
                    collection: 'COLLECTING',
                    reportingState: 'CURRENT',
                    freshness: 'UNKNOWN',
                    coverage: 'UNKNOWN',
                    historyAvailability: 'UNKNOWN',
                    historicalUpdate: 'PENDING',
                    lastLocalCommit: null,
                    providerSuccessAt: null,
                    discrepancyCount: '0',
                    ...status,
                  },
                },
              ],
            },
          ]
        : [],
    },
  };
}
async function bankingServer(
  page,
  { connected = false, loseFinish = false, startCode = 'PREPARED' } = {},
) {
  const calls = [];
  let complete = connected;
  let cancelled = false;
  await page.route('**/api/graphql', async (route) => {
    const { query, variables = {} } = route.request().postDataJSON();
    const operation = query.match(/(?:query|mutation) (\w+)/)?.[1];
    if (
      ![
        'personalInventoryQuery',
        'enrollmentStartMutation',
        'enrollmentFinishMutation',
        'enrollmentCancelMutation',
        'enrollmentRecoveryQuery',
      ].includes(operation)
    )
      return route.fallback();
    calls.push({ operation, variables });
    const result = {
      __typename: 'BankingEnrollmentResult',
      code: startCode,
      state: 'prepared',
      attemptId: variables.input?.attemptId ?? variables.attemptId,
      connectionId: null,
    };
    let data;
    if (operation === 'personalInventoryQuery')
      data = inventory({ accounts: complete });
    if (operation === 'enrollmentStartMutation')
      data = {
        startBankingEnrollment: {
          ...result,
          linkToken: 'link-synthetic-private',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };
    if (operation === 'enrollmentFinishMutation') {
      complete = true;
      if (loseFinish) {
        loseFinish = false;
        return route.abort('failed');
      }
      data = {
        finishBankingEnrollment: {
          ...result,
          code: 'AWAITING_INITIAL_IMPORT',
          state: 'ready',
          connectionId: 'connection-private',
        },
      };
    }
    if (operation === 'enrollmentCancelMutation') {
      cancelled = true;
      data = {
        cancelBankingEnrollment: {
          ...result,
          code: 'CLEANUP_PENDING',
          state: 'cancelled',
        },
      };
    }
    if (operation === 'enrollmentRecoveryQuery')
      data = {
        bankingEnrollment: {
          ...result,
          code: complete
            ? 'AWAITING_INITIAL_IMPORT'
            : cancelled
              ? 'RETRY_ALLOWED'
              : 'PREPARED',
          state: complete ? 'ready' : 'prepared',
          connectionId: complete ? 'connection-private' : null,
        },
      };
    return route.fulfill({ json: { data } });
  });
  await page.addInitScript(() => {
    window.__link = { opened: 0, destroyed: 0 };
    window.Plaid = {
      create(options) {
        window.__link.options = options;
        return {
          open() {
            window.__link.nativeModalAtOpen = Boolean(
              document.querySelector('dialog:modal'),
            );
            window.__link.opened++;
            const portal = document.createElement('button');
            portal.id = 'synthetic-plaid-handoff';
            portal.textContent = 'Synthetic Plaid handoff';
            portal.style.cssText =
              'position:fixed;inset:20px auto auto 20px;z-index:2147483647';
            document.body.append(portal);
          },
          destroy() {
            window.__link.destroyed++;
            document.querySelector('#synthetic-plaid-handoff')?.remove();
          },
        };
      },
    };
  });
  return calls;
}
async function chooseAccount(page) {
  await page
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__link.opened)).toBe(0);
  await page
    .getByRole('button', { name: 'Continue with Plaid', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__link.opened)).toBe(1);
  expect(await page.evaluate(() => window.__link.nativeModalAtOpen)).toBe(
    false,
  );
  await page
    .getByRole('button', { name: 'Synthetic Plaid handoff', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Synthetic Plaid handoff', exact: true }),
  ).toBeFocused();
  await page.evaluate(() => {
    document.querySelector('#synthetic-plaid-handoff')?.remove();
    const metadata = {
      accounts: [
        {
          id: 'chosen-checking',
          name: 'Private checking',
          mask: '1234',
          type: 'depository',
          subtype: 'checking',
        },
        {
          id: 'omitted-savings',
          name: 'Private savings',
          mask: '4321',
          type: 'depository',
          subtype: 'savings',
        },
        {
          id: 'unsupported-loan',
          name: 'Unsupported loan',
          type: 'loan',
          subtype: 'student',
        },
      ],
    };
    window.__link.options.onSuccess('public-synthetic-private', metadata);
    window.__link.options.onSuccess('public-duplicate-private', metadata);
  });
  await expect(
    page.getByRole('dialog', { name: 'Connect your accounts', exact: true }),
  ).toBeVisible();
  expect(await page.locator('dialog:modal').count()).toBe(1);
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(page.getByRole('checkbox').last()).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Include selected accounts' }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /Private checking/ }).check();
}

test('Personal first visit keeps connect only in Connections and preserves Account and expense-source return', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await bankingServer(page);
  await page.goto(
    '/personal?tab=transactions&period=last-month&category=custom',
  );
  await expect(
    page.getByText('Only you can see these bank accounts and their activity.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Financial navigation' });
  await expect(
    nav.getByRole('link', { name: 'Personal', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Applied period', { exact: true })).toBeVisible();
  await expect(page.getByText(/^This month:/)).toHaveCount(0);
  await nav.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Account', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: /^Back to Personal/ }).click();
  await expect(page).toHaveURL(
    /tab=transactions.*period=last-month.*category=custom/,
  );
  await expect(
    page.getByRole('link', { name: 'Account', exact: true }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'Add expense', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Source space', exact: true }),
  ).toHaveValue('');
  await expect(page.locator('#expense-description')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Close expense', exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/personal\?tab=transactions.*period=last-month.*category=custom/,
  );
  await page
    .getByRole('link', { name: 'Go to Connections', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toBeVisible();
});

test('Personal Link requires explicit eligible account selection and ignores duplicate callbacks', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const calls = await bankingServer(page);
  await page.goto('/personal?tab=connections');
  await page
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Connect your accounts', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toBeFocused();
  expect(
    calls.filter((call) => call.operation === 'enrollmentStartMutation'),
  ).toHaveLength(0);
  await chooseAccount(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Resume connection', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Resume connection', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Private checking/ }),
  ).toBeChecked();
  expect(
    calls.filter((call) => call.operation === 'enrollmentStartMutation'),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Include selected accounts' }).click();
  await expect(
    page.getByRole('heading', { name: privateName, exact: true }),
  ).toBeVisible();
  const finishes = calls.filter(
    (call) => call.operation === 'enrollmentFinishMutation',
  );
  expect(finishes).toHaveLength(1);
  expect(finishes[0].variables.input.accountIds).toEqual(['chosen-checking']);
  expect(finishes[0].variables.input.publicToken).toBe(
    'public-synthetic-private',
  );
  await expect(page.getByText(/Initial history is importing/)).toBeVisible();
  await expect(
    page.getByText(/Actual history coverage is unknown/),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...sessionStorage, ...localStorage }),
    ),
  ).not.toMatch(/public-synthetic|link-synthetic|Private checking/);
});

test('Personal uncertain exchange recovers the original attempt without a second enrollment', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const calls = await bankingServer(page, { loseFinish: true });
  await page.goto('/personal?tab=connections');
  await chooseAccount(page);
  await page.getByRole('button', { name: 'Include selected accounts' }).click();
  await expect(page.getByText(/outcome could not be confirmed/i)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Check connection status' }).click();
  await expect(page.getByRole('heading', { name: privateName })).toBeVisible();
  const started = calls.find(
    (call) => call.operation === 'enrollmentStartMutation',
  ).variables.input.attemptId;
  expect(
    calls.filter((call) => call.operation === 'enrollmentFinishMutation'),
  ).toHaveLength(1);
  expect(
    calls.filter((call) => call.operation === 'enrollmentStartMutation'),
  ).toHaveLength(1);
  expect(
    calls.find((call) => call.operation === 'enrollmentRecoveryQuery').variables
      .attemptId,
  ).toBe(started);
});

test('Personal Link cancellation and expired handoff preserve enrollment boundaries', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const calls = await bankingServer(page);
  await page.goto('/personal?tab=connections');
  await page
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__link.opened)).toBe(0);
  await page
    .getByRole('button', { name: 'Continue with Plaid', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__link.opened)).toBe(1);
  await page.evaluate(() => {
    document.querySelector('#synthetic-plaid-handoff')?.remove();
    window.__link.options.onExit({ error_code: 'INVALID_LINK_TOKEN' });
  });
  await expect(page.getByText(/session expired/i)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Cancel connection', exact: true })
    .click();
  await expect(
    page.getByText(
      'Connection canceled locally. Provider cleanup is still pending.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Check connection status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toBeVisible();
  expect(
    calls.filter((call) => call.operation === 'enrollmentFinishMutation'),
  ).toHaveLength(0);
  await expect(
    page.getByRole('heading', { name: 'No connected accounts yet' }),
  ).toBeVisible();
});

test('Personal fresh-session discovery and foreground access loss never retain protected account names', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const ready = app.holdMatching(
    'personalInventoryQuery',
    () => true,
    inventory(),
  );
  ready.release();
  await page.goto('/personal?tab=connections');
  await expect(page.getByRole('heading', { name: privateName })).toBeVisible();
  const denial = page.route('**/api/graphql', (route) => {
    if (route.request().postDataJSON().query.includes('personalInventoryQuery'))
      return route.fulfill({
        json: { data: inventory({ accounts: false, code: 'FORBIDDEN' }) },
      });
    return route.fallback();
  });
  await denial;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(privateName, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Connect account', exact: true }),
  ).toHaveCount(0);
});

test('Personal connections reflow and five-slot navigation retain clear status in every appearance @owns-viewport', async ({
  page,
  app,
}, testInfo) => {
  test.setTimeout(120000);
  await app.authenticate();
  const response = app.holdMatching(
    'personalInventoryQuery',
    () => true,
    inventory({
      status: {
        usable: true,
        importState: 'USABLE',
        operation: 'COMMITTED',
        freshness: 'STALE',
        collection: 'RECONNECT_REQUIRED',
        coverage: 'KNOWN_GAP',
        lastLocalCommit: '2026-10-01T10:00:00Z',
      },
    }),
  );
  response.release();
  for (const appearance of ['LIGHT', 'DARK', 'SYSTEM']) {
    app.setAppearance(appearance);
    await page.emulateMedia({
      colorScheme: appearance === 'LIGHT' ? 'light' : 'dark',
    });
    await page.goto('/personal?tab=connections');
    await expect(
      page.getByRole('heading', { name: privateName }),
    ).toBeVisible();
    for (const width of [320, 390, 440, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (scale) => {
          document.documentElement.style.fontSize = scale + '%';
        },
        width === 1280 ? 200 : 100,
      );
      await expect(page.getByText(/Reconnect needed/)).toBeVisible();
      await expect(page.getByText(/Known collection gap/)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const nav = page.getByRole('navigation', {
        name: 'Financial navigation',
      });
      for (const name of [
        'Household',
        'Personal',
        'Add expense',
        'Groups',
        'Account',
      ])
        await expect(
          nav.getByRole('link', { name, exact: true }),
        ).toBeVisible();
      const add = nav.getByRole('link', { name: 'Add expense', exact: true });
      await expect(add).toContainText(width < 600 ? 'Expense' : 'Add expense');
      if (width === 320) {
        for (const name of ['Household', 'Add expense']) {
          const lineCount = await nav
            .getByRole('link', { name, exact: true })
            .evaluate((link) => {
              const walker = document.createTreeWalker(
                link,
                NodeFilter.SHOW_TEXT,
              );
              const tops = new Set();
              while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                for (const rect of range.getClientRects()) {
                  if (rect.width && rect.height) tops.add(Math.round(rect.top));
                }
              }
              return tops.size;
            });
          expect(lineCount, `${name} label stays on one line at 320px`).toBe(1);
        }
      }
      await expect(
        page.getByRole('heading', {
          name: 'Connect your accounts',
          exact: true,
        }),
      ).toHaveCount(0);
      if (width === 390) {
        const cardHeading = await page
          .getByRole('heading', { name: privateName, exact: true })
          .boundingBox();
        expect(cardHeading.y).toBeLessThan(600);
      }
      await page.screenshot({
        path: testInfo.outputPath(`personal-${width}-${appearance}.png`),
        fullPage: true,
      });
    }
  }
});

test('Account timezone saves independently and conflict recovery preserves the proposed choice', async ({
  page,
  app,
}) => {
  await app.authenticate();
  let version = '1',
    timezone = 'America/Los_Angeles',
    conflict = true;
  const writes = [];
  await page.route('**/api/graphql', (route) => {
    const { query, variables } = route.request().postDataJSON();
    const operation = query.match(/(?:query|mutation) (\w+)/)?.[1];
    const saved = () => ({
      __typename: 'ReportingTimezone',
      timezone,
      version,
    });
    if (operation === 'reportingTimezoneQuery')
      return route.fulfill({ json: { data: { reportingTimezone: saved() } } });
    if (operation === 'reportingTimezoneUpdateMutation') {
      writes.push(variables);
      if (conflict) {
        conflict = false;
        version = '2';
        return route.fulfill({
          json: {
            data: {
              updateReportingTimezone: {
                __typename: 'ReportingTimezoneProblem',
                code: 'CONFLICT',
              },
            },
          },
        });
      }
      timezone = variables.timezone;
      version = '3';
      return route.fulfill({
        json: { data: { updateReportingTimezone: saved() } },
      });
    }
    if (operation === 'reportingTimezoneRecoveryQuery')
      return route.fulfill({
        json: {
          data: {
            reportingTimezoneAttempt: {
              __typename: 'ReportingTimezoneProblem',
              code: 'CONFLICT',
            },
          },
        },
      });
    return route.fallback();
  });
  await page.goto('/account');
  await page
    .getByRole('textbox', { name: 'IANA timezone', exact: true })
    .fill('Europe/London');
  await page
    .getByRole('button', { name: 'Save timezone', exact: true })
    .click();
  await expect(page.getByText(/timezone changed elsewhere/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Check saved timezone', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'IANA timezone', exact: true }),
  ).toHaveValue('Europe/London');
  await page
    .getByRole('button', { name: 'Save timezone', exact: true })
    .click();
  await expect(
    page.getByText('Reporting timezone saved.', { exact: true }),
  ).toBeVisible();
  expect(writes.map((write) => write.expectedVersion)).toEqual(['1', '2']);
  expect(
    app.requests.some(
      (request) =>
        request.operation === 'profileMutation' ||
        request.operation === 'appearanceMutation',
    ),
  ).toBe(false);
});

test('Personal cold HTML and Flight deny access and sign-in restores the safe Personal destination', async ({
  page,
  app,
  request,
}) => {
  const destination = '/personal?tab=connections';
  const response = await request.get(destination, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain(
    '/sign-in?next=%2Fpersonal%3Ftab%3Dconnections',
  );
  const flight = await request.get(destination, {
    headers: { RSC: '1' },
    maxRedirects: 0,
  });
  expect(flight.status()).toBe(307);
  await page.goto(destination);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  expect(
    app.requests.some(
      (request) => request.operation === 'personalInventoryQuery',
    ),
  ).toBe(false);
  await app.signIn(page);
  await expect(page).toHaveURL('/personal?tab=connections');
  await expect(
    page.getByRole('heading', { name: 'No connected accounts yet' }),
  ).toBeVisible();
});

test('Personal absent cancellation preserves an uncertain start for same-attempt recovery', async ({
  page,
  app,
}) => {
  await app.authenticate();
  await bankingServer(page);
  const starts = [];
  let cancellations = 0;
  await page.route('**/api/graphql', (route) => {
    const { query, variables = {} } = route.request().postDataJSON();
    if (query.includes('mutation enrollmentStartMutation')) {
      starts.push(variables.input);
      if (starts.length === 1) return route.abort('failed');
    }
    if (query.includes('mutation enrollmentCancelMutation')) {
      cancellations++;
      return route.fulfill({
        json: {
          data: {
            cancelBankingEnrollment: {
              __typename: 'BankingEnrollmentResult',
              code: 'NOT_FOUND',
              attemptId: variables.attemptId,
            },
          },
        },
      });
    }
    if (query.includes('query enrollmentRecoveryQuery')) {
      return route.fulfill({
        json: {
          data: {
            bankingEnrollment: {
              __typename: 'BankingEnrollmentResult',
              code: 'NOT_FOUND',
              attemptId: variables.attemptId,
            },
          },
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/personal?tab=connections');
  await page
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Continue with Plaid', exact: true })
    .click();
  await expect(page.getByText(/outcome could not be confirmed/i)).toBeVisible();
  const attempt = starts[0].attemptId;
  await page
    .getByRole('button', { name: 'Cancel connection', exact: true })
    .click();
  await expect(
    page.getByText(/No saved outcome is available yet/),
  ).toBeVisible();
  expect(cancellations).toBe(1);
  const stored = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith('kami-personal-enrollment:'))
      .map((key) => sessionStorage.getItem(key)),
  );
  expect(stored).toEqual([attempt]);
  await expect(page.getByText(/Financial access is unavailable/)).toHaveCount(
    0,
  );
  await page
    .getByRole('button', { name: 'Check connection status', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Continue secure connection', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__link.opened)).toBe(1);
  expect(starts).toHaveLength(2);
  expect(starts[1]).toEqual(starts[0]);
  expect(starts[1].attemptId).toBe(attempt);
});

for (const unresolved of ['receipt', 'replay']) {
  test(`Account unavailable timezone ${unresolved} retains the frozen attempt until definitive recovery`, async ({
    page,
    app,
  }) => {
    await app.authenticate();
    const writes = [];
    let reads = 0,
      recoveries = 0,
      definitive = false;
    let timezone = 'America/Los_Angeles',
      version = '1';
    const saved = () => ({
      __typename: 'ReportingTimezone',
      timezone,
      version,
    });
    const problem = (code) => ({
      __typename: 'ReportingTimezoneProblem',
      code,
    });
    await page.route('**/api/graphql', (route) => {
      const { query, variables = {} } = route.request().postDataJSON();
      if (query.includes('query reportingTimezoneQuery')) {
        reads++;
        return route.fulfill({
          json: { data: { reportingTimezone: saved() } },
        });
      }
      if (query.includes('mutation reportingTimezoneUpdateMutation')) {
        writes.push(variables);
        if (writes.length === 1) return route.abort('failed');
        if (!definitive)
          return route.fulfill({
            json: { data: { updateReportingTimezone: problem('UNAVAILABLE') } },
          });
        timezone = variables.timezone;
        version = '3';
        return route.fulfill({
          json: { data: { updateReportingTimezone: saved() } },
        });
      }
      if (query.includes('query reportingTimezoneRecoveryQuery')) {
        recoveries++;
        if (definitive) {
          timezone = 'Europe/London';
          version = '2';
        }
        return route.fulfill({
          json: {
            data: {
              reportingTimezoneAttempt: definitive
                ? saved()
                : problem(
                    unresolved === 'receipt' ? 'UNAVAILABLE' : 'NOT_FOUND',
                  ),
            },
          },
        });
      }
      return route.fallback();
    });
    await page.goto('/account');
    const zone = page.getByRole('textbox', {
      name: 'IANA timezone',
      exact: true,
    });
    const save = page.getByRole('button', {
      name: 'Save timezone',
      exact: true,
    });
    const check = page.getByRole('button', {
      name: 'Check saved timezone',
      exact: true,
    });
    await zone.fill('Europe/London');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(check).toBeEnabled();
    await zone.fill('Asia/Tokyo');
    const initialReads = reads;
    await check.click();
    await expect.poll(() => recoveries).toBe(1);
    await expect(check).toBeEnabled();
    await expect(save).toBeDisabled();
    expect(reads).toBe(initialReads);
    expect(writes).toHaveLength(unresolved === 'receipt' ? 1 : 2);
    if (writes.length === 2) expect(writes[1]).toEqual(writes[0]);
    definitive = true;
    await check.click();
    await expect(save).toBeEnabled();
    await expect(zone).toHaveValue('Asia/Tokyo');
    expect(reads).toBe(initialReads + 1);
    await zone.fill('Asia/Tokyo');
    await save.click();
    await expect(
      page.getByText('Reporting timezone saved.', { exact: true }),
    ).toBeVisible();
    expect(writes.at(-1).expectedVersion).toBe('2');
    expect(writes.at(-1).attemptId).not.toBe(writes[0].attemptId);
  });
}

function transactionRow(sourceId = 'source-private', extra = {}) {
  return {
    __typename: 'BankingTransaction',
    id: `fact-${sourceId}`,
    sourceId,
    accountId: 'account-private',
    bindingId: 'binding-private',
    sourceRevision: '1',
    materialRevision: '1',
    annotationRevision: '0',
    categoryOverride: null,
    activityOverride: null,
    note: null,
    eligible: true,
    authorizationDate: '2026-10-16',
    providerPrimaryCategory: 'FOOD_AND_DRINK',
    providerCategory: 'FOOD_AND_DRINK_GROCERIES',
    providerConfidence: 'HIGH',
    providerCode: 'purchase',
    mappingVersion: 'pfc-v2',
    latestSourceRevision: '2',
    bankDate: '2026-10-17',
    amountMinor: '10000',
    currency: 'USD',
    merchantName: 'Long private grocery merchant with a full descriptive name',
    name: 'Bank fact',
    processingState: 'posted',
    activity: 'purchase',
    category: 'FOOD_AND_DRINK',
    excluded: false,
    reviewed: false,
    materialConflict: false,
    current: true,
    currentId: sourceId,
    discrepancy: 'none',
    archives: [
      {
        __typename: 'BankingArchiveReference',
        archiveId: 'archive-private',
        sourceRevision: '1',
        annotationRevision: '2',
        annotation: {
          __typename: 'BankingAnnotationSnapshot',
          revision: '2',
          materialRevision: '1',
          category: null,
          activity: null,
          note: 'Immutable captured private note',
          excluded: true,
          reviewed: false,
        },
      },
    ],
    ...extra,
  };
}
let reportSequence = 0;
function transactionReport(extra = {}) {
  return {
    bankingReport: {
      __typename: 'BankingReport',
      id: `report-${reportSequence++}`,
      code: 'READY',
      fieldErrors: [],
      start: '2026-10-01',
      end: '2026-10-17',
      asOfDate: '2026-10-17',
      timezone: 'America/Los_Angeles',
      revision: 'revision-private',
      totalCount: 125,
      spendingContext: 'SPENDING_FROM_ACCOUNTS',
      endCursor: 'signed-page',
      hasNextPage: true,
      activityChoices: [
        'purchase',
        'refund',
        'transfer',
        'income',
        'unresolved',
      ],
      categoryChoices: ['FOOD_AND_DRINK', 'UNCATEGORIZED'],
      counts: {
        __typename: 'BankingReportCounts',
        count: 125,
        postedCount: 121,
        pendingCount: 2,
        removedCount: 2,
        excludedCount: 1,
        unresolvedCount: 1,
        reviewedCount: 120,
        classificationComplete: false,
      },
      summary: {
        __typename: 'BankingReportSummary',
        netMinor: '-4000',
        purchaseMinor: '10000',
        refundMinor: '14000',
        classificationComplete: false,
      },
      accounts: [
        {
          __typename: 'BankingReportAccount',
          id: 'account-snapshot',
          accountId: 'account-private',
          kind: 'checking',
          selected: true,
          coverage: 'PARTIAL',
          planId: 'plan-private',
          transitionDate: '2026-09-30',
          archives: [
            {
              __typename: 'BankingReportArchive',
              id: 'archive-private',
              planId: 'old-plan',
              boundaryDate: '2026-09-30',
              count: 130,
            },
          ],
          intervals: [
            {
              __typename: 'BankingReportInterval',
              bindingId: 'binding-private',
              afterDate: null,
              throughDate: '2026-09-30',
              importState: 'usable',
              coverage: 'UNKNOWN',
              coverageAfter: null,
              coverageThrough: null,
              collectionState: 'retired/active/granted',
              collectionStopped: true,
              lastLocalCommit: null,
              providerSuccessAt: null,
              discrepancyCount: 1,
            },
          ],
        },
      ],
      rows: [
        transactionRow(),
        transactionRow('transfer', {
          merchantName: 'Transfer between accounts',
          activity: 'transfer',
        }),
        transactionRow('income', {
          merchantName: 'Income from employer',
          activity: 'income',
          amountMinor: '-200000',
        }),
        transactionRow('pending', {
          merchantName: 'Provisional pending activity',
          processingState: 'pending',
          bankDate: '2026-10-17',
        }),
      ],
      ...extra,
    },
  };
}
async function transactionServer(page, handler = () => undefined) {
  const calls = [];
  await page.route('**/api/graphql', async (route) => {
    const { query, variables = {} } = route.request().postDataJSON();
    const operation = query.match(/(?:query|mutation) (\w+)/)?.[1];
    if (operation === 'personalInventoryQuery')
      return route.fulfill({ json: { data: inventory() } });
    if (
      operation !== 'personalTransactionsQuery' &&
      operation !== 'personalTransactionSelectionQuery' &&
      operation !== 'personalTransactionAnnotationMutation' &&
      operation !== 'personalTransactionAnnotationRecoveryQuery'
    )
      return route.fallback();
    calls.push({ operation, variables });
    const custom = await handler(operation, variables, route);
    if (custom === false) return;
    const data =
      custom ??
      (operation === 'personalTransactionSelectionQuery'
        ? {
            bankingTransaction: {
              __typename: 'BankingTransactionDetail',
              id: 'selected-fact',
              code: 'READY',
              currentId: variables.source,
              transaction: transactionRow(variables.source),
            },
          }
        : transactionReport());
    return route.fulfill({ json: { data } });
  });
  return calls;
}

test('Personal transactions apply drafts, preserve shared dates, and restore row and archive origins', async ({
  page,
  app,
}) => {
  await app.authenticate();
  const calls = await transactionServer(page, (operation, variables) =>
    operation === 'personalTransactionsQuery'
      ? transactionReport({
          ...(variables.filter.archiveId
            ? { summary: null, spendingContext: 'RECOVERY_ARCHIVE' }
            : {}),
        })
      : undefined,
  );
  await page.goto('/personal?tab=transactions');
  await expect(
    page.getByText('125 transactions · complete matching count'),
  ).toBeVisible();
  await expect(page.getByText('−$40.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'This month', exact: true }).click();
  await page.getByRole('button', { name: 'Custom range', exact: true }).click();
  await page.getByLabel('Start date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('End date', { exact: true }).fill('2026-09-30');
  const reads = calls.length;
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'This month', exact: true }),
  ).toBeFocused();
  expect(calls).toHaveLength(reads);
  await page.getByRole('button', { name: 'This month', exact: true }).click();
  await page.getByRole('button', { name: 'Last month', exact: true }).click();
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(page).toHaveURL(/period=last-month/);
  await expect(
    page.getByRole('button', { name: 'Last month', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Personal workspace' })
    .getByRole('link', { name: 'Overview', exact: true })
    .click();
  await expect(page).toHaveURL(/period=last-month/);
  await page
    .getByRole('navigation', { name: 'Personal workspace' })
    .getByRole('link', { name: 'Transactions', exact: true })
    .click();
  await page
    .getByRole('link', {
      name: 'Long private grocery merchant with a full descriptive name',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Transaction detail', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Back to transactions', exact: true })
    .click();
  await expect(page.locator('#transaction-source-private')).toBeFocused();
  await page
    .getByText('Reporting history and recovery archives', { exact: true })
    .click();
  await page.getByRole('link', { name: /View recovery archive/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Recovery archive', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Immutable captured private note', { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'View current record', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Transaction detail', exact: true }),
  ).toBeVisible();
  expect(calls.at(-1)).toEqual({
    operation: 'personalTransactionSelectionQuery',
    variables: { source: 'source-private', archive: null, discrepancy: false },
  });
  await page
    .getByRole('button', { name: 'Back to recovery archive', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Recovery archive', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Back to current activity', exact: true })
    .click();
  await expect(page.locator('#archive-archive-private')).toBeFocused();
  await expect(
    page
      .getByText('Reporting history and recovery archives', { exact: true })
      .locator('..'),
  ).toHaveAttribute('open', '');
});

test('Personal transaction pagination restarts on changed snapshots and keeps filters through failure', async ({
  page,
  app,
}) => {
  await app.authenticate();
  let restart = true,
    fail = false;
  const calls = await transactionServer(
    page,
    async (operation, variables, route) => {
      if (operation !== 'personalTransactionsQuery') return;
      if (fail) {
        await route.abort('failed');
        return false;
      }
      if (variables.after && restart)
        return transactionReport({
          code: 'RESTART_REQUIRED',
          rows: [],
          summary: null,
          counts: null,
        });
      if (variables.after)
        return transactionReport({
          rows: [
            transactionRow('second-page', {
              merchantName: 'Second signed page',
            }),
          ],
          hasNextPage: false,
          endCursor: null,
        });
      return transactionReport();
    },
  );
  await page.goto('/personal?tab=transactions&activity=income');
  await page
    .getByRole('button', { name: 'Load more transactions', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restart activity', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-source-id]')).toHaveCount(0);
  restart = false;
  await page
    .getByRole('button', { name: 'Restart activity', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Load more transactions', exact: true })
    .click();
  await expect(
    page.getByText('Second signed page', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Second signed page', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Transaction detail', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Back to transactions', exact: true })
    .click();
  await expect(page.locator('#transaction-second-page')).toBeFocused();
  expect(
    calls
      .filter((call) => call.operation === 'personalTransactionsQuery')
      .every((call) => call.variables.filter.activities[0] === 'income'),
  ).toBe(true);
  fail = true;
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry activity', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-source-id]')).toHaveCount(0);
  fail = false;
  await page
    .getByRole('button', { name: 'Retry activity', exact: true })
    .click();
  await expect(
    page.getByText('125 transactions · complete matching count'),
  ).toBeVisible();
});

test('Personal archive returns replay fresh signed extent and discard changed or denied sources', async ({
  page,
  app,
}) => {
  await app.authenticate();
  let mode = 'ready',
    returning = false;
  const calls = await transactionServer(page, (operation, variables) => {
    if (operation !== 'personalTransactionsQuery') return;
    if (!variables.filter.archiveId)
      return transactionReport({ hasNextPage: false });
    const extra = { summary: null, spendingContext: 'RECOVERY_ARCHIVE' };
    if (variables.after)
      return transactionReport({
        ...extra,
        ...(returning && mode === 'denied' ? { code: 'FORBIDDEN' } : {}),
        rows: [
          transactionRow('archive-later', {
            merchantName: 'Later archived income',
            activity: 'income',
            bankDate: '2026-09-12',
            currentId: 'current-outside',
          }),
        ],
        hasNextPage: false,
        endCursor: null,
      });
    return transactionReport({
      ...extra,
      revision:
        returning && mode === 'revision'
          ? 'changed-revision'
          : 'revision-private',
      endCursor: returning ? 'fresh-signed-page' : 'signed-page',
      rows: [
        transactionRow('archive-first', {
          merchantName: 'First archived income',
          activity: 'income',
          bankDate: '2026-09-10',
        }),
      ],
    });
  });
  for (mode of ['ready', 'revision', 'denied']) {
    returning = false;
    await page.goto(
      '/personal?tab=transactions&period=custom&start=2026-09-01&end=2026-09-30&activity=income&archive=archive-private',
    );
    await page
      .getByRole('button', { name: 'Load more transactions', exact: true })
      .click();
    await page.locator('#current-archive-later').click();
    await expect(
      page.getByRole('heading', { name: 'Transaction detail', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-source-id="current-outside"]:visible'),
    ).toHaveCount(1);
    returning = true;
    const before = calls.length;
    await page
      .getByRole('button', { name: 'Back to recovery archive', exact: true })
      .click();
    if (mode === 'ready') {
      await expect(page.locator('#current-archive-later')).toBeFocused();
      await expect(
        page.getByRole('link', { name: 'Later archived income', exact: true }),
      ).toBeVisible();
      expect(
        calls
          .slice(before)
          .some((call) => call.variables.after === 'fresh-signed-page'),
      ).toBe(true);
      const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(new Set(ids).size).toBe(ids.length);
    } else {
      await expect(
        page.getByRole('button', { name: 'Restart activity', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-source-id]')).toHaveCount(0);
      returning = false;
      await page
        .getByRole('button', { name: 'Restart activity', exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'Load more transactions',
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(page).toHaveURL(/start=2026-09-01/);
    expect(calls.at(-1).variables.filter).toMatchObject({
      archiveId: 'archive-private',
      activities: ['income'],
    });
  }
});

test('Personal transaction context distinguishes pending, unavailable and fully covered empty results', async ({
  page,
  app,
}) => {
  await app.authenticate();
  let state = 'pending';
  await transactionServer(page, () =>
    state === 'pending'
      ? transactionReport({
          summary: null,
          spendingContext: 'ACTIVITY_CONTEXT',
        })
      : state === 'unavailable'
        ? transactionReport({
            code: 'DATA_UNAVAILABLE',
            summary: null,
            counts: null,
            rows: [],
          })
        : transactionReport({
            rows: [],
            totalCount: 0,
            hasNextPage: false,
            summary: {
              __typename: 'BankingReportSummary',
              netMinor: '0',
              purchaseMinor: '0',
              refundMinor: '0',
              classificationComplete: true,
            },
            accounts: [
              {
                ...transactionReport().bankingReport.accounts[0],
                coverage: 'COMPLETE',
              },
            ],
          }),
  );
  await page.goto('/personal?tab=transactions&state=pending');
  await expect(
    page.getByText(/Activity context; no spending total applies/),
  ).toBeVisible();
  await expect(
    page.getByText('Spending from your accounts:', { exact: false }),
  ).toHaveCount(0);
  state = 'unavailable';
  await page.reload();
  await expect(
    page.getByText(/Initial history is importing or unavailable/),
  ).toBeVisible();
  await expect(
    page.getByText('No matching transactions', { exact: true }),
  ).toHaveCount(0);
  state = 'empty';
  await page.goto('/personal?tab=transactions');
  await expect(
    page.getByRole('heading', {
      name: 'No matching transactions',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'No activity matches these dates and filters in the covered history.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('Personal transactions reflow long activity and controls in every appearance @owns-viewport', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  await transactionServer(page);
  for (const [width, scale, theme] of [
    [320, 1, 'LIGHT'],
    [390, 1, 'DARK'],
    [440, 2, 'SYSTEM'],
    [1280, 2, 'LIGHT'],
  ]) {
    app.setAppearance(theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/personal?tab=transactions');
    await expect(
      page.getByText('125 transactions · complete matching count'),
    ).toBeVisible();
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, scale);
    for (const label of ['Transfer', 'Income', 'Needs review'])
      await expect(
        page.getByText(label, { exact: false }).first(),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`transactions-${width}-${scale}-${theme}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'This month', exact: true }).click();
    const dates = page.getByRole('dialog', { name: 'Date range' });
    await expect(dates).toBeVisible();
    if (scale === 1 && width < 760) {
      const geometry = await dates.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        bottomGap:
          element.getBoundingClientRect().bottom -
          element.querySelector('form').getBoundingClientRect().bottom,
      }));
      expect(geometry.height).toBeLessThan(630);
      expect(geometry.bottomGap).toBeLessThan(64);
    }
    await dates
      .getByRole('button', { name: 'Apply dates', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dates.getByRole('button', { name: 'Apply dates', exact: true }),
    ).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'This month', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter transactions' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Apply filters', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('button', { name: 'Apply filters', exact: true }),
    ).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Filters', exact: true }),
    ).toBeFocused();
  }
});

test('Personal detail protects drafts, validates private values and recovers conflicts and uncertain saves', async ({
  page,
  app,
}) => {
  await app.authenticate();
  let fact = transactionRow('source-private', {
      amountMinor: '-10000',
      activity: 'unresolved',
      activityOverride: 'purchase',
      materialConflict: true,
      eligible: false,
    }),
    mode = 'ready',
    frozen;
  const receipts = new Map();
  await transactionServer(page, async (operation, variables, route) => {
    const detail = () => ({
      __typename: 'BankingTransactionDetail',
      id: `detail-${fact.annotationRevision}`,
      code: 'READY',
      currentId: fact.currentId,
      transaction: fact,
    });
    if (operation === 'personalTransactionSelectionQuery')
      return { bankingTransaction: detail() };
    if (operation === 'personalTransactionAnnotationRecoveryQuery')
      return {
        bankingAnnotationOperation: receipts.get(variables.attemptId) ?? {
          __typename: 'BankingAnnotationResult',
          id: 'missing',
          code: 'NOT_FOUND',
          sourceId: null,
          detail: null,
        },
      };
    if (operation === 'personalTransactionsQuery')
      return transactionReport({
        revision: `revision-${fact.annotationRevision}`,
        totalCount: 51,
        rows: variables.after
          ? [fact]
          : Array.from({ length: 50 }, (_, index) =>
              transactionRow(`first-${index}`, {
                merchantName: `Earlier purchase ${index}`,
              }),
            ),
        hasNextPage: !variables.after,
        endCursor: variables.after ? null : 'signed-page',
        counts: {
          count: 51,
          postedCount: 51,
          pendingCount: 0,
          removedCount: 0,
          excludedCount: 0,
          unresolvedCount: 1,
          reviewedCount: 0,
          classificationComplete: false,
        },
        summary: {
          netMinor: '500000',
          purchaseMinor: '500000',
          refundMinor: '0',
          classificationComplete: false,
        },
      });
    if (operation !== 'personalTransactionAnnotationMutation') return;
    const input = variables.input;
    frozen = input;
    if (mode === 'conflict') {
      mode = 'ready';
      fact = {
        ...fact,
        id: 'changed-bank-fact',
        sourceRevision: '2',
        materialRevision: '2',
        annotationRevision: '1',
        note: 'Concurrent saved note',
      };
      return {
        editBankingAnnotation: {
          __typename: 'BankingAnnotationResult',
          id: 'conflict',
          code: 'CONFLICT',
          sourceId: fact.sourceId,
          detail: detail(),
        },
      };
    }
    fact = {
      ...fact,
      id: `saved-${input.attemptId}`,
      annotationRevision: String(Number(fact.annotationRevision) + 1),
      ...(input.field === 'NOTE' ? { note: input.value } : {}),
      ...(input.field === 'EXCLUDED'
        ? { excluded: input.value === 'true', eligible: input.value !== 'true' }
        : {}),
    };
    const result = {
      __typename: 'BankingAnnotationResult',
      id: input.attemptId,
      code: 'READY',
      sourceId: fact.sourceId,
      detail: detail(),
    };
    receipts.set(input.attemptId, result);
    if (mode === 'lost') {
      mode = 'ready';
      await route.abort('failed');
      return false;
    }
    return { editBankingAnnotation: result };
  });
  await page.goto('/personal?tab=transactions&period=last-month&state=posted');
  await page
    .getByRole('button', { name: 'Load more transactions', exact: true })
    .click();
  await page.locator('#transaction-source-private').click();
  const dialog = page.getByRole('dialog', {
    name: 'Transaction detail',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('2026-10-16', { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByLabel('Private note', { exact: true })).toHaveCount(
    0,
  );
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog
    .getByLabel('Private note', { exact: true })
    .fill('Intended private draft');
  await page.evaluate(() => window.history.back());
  await expect(
    page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByLabel('Private note', { exact: true })).toHaveValue(
    'Intended private draft',
  );
  await dialog
    .getByLabel('Private note', { exact: true })
    .fill('😀'.repeat(2001));
  await expect(
    dialog.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/Private note must contain at most/),
  ).toBeVisible();
  await dialog
    .getByLabel('Private note', { exact: true })
    .fill('Intended private draft');
  mode = 'conflict';
  await dialog
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    dialog.getByText(/source or private annotation changed/),
  ).toBeVisible();
  await expect(dialog.getByLabel('Private note', { exact: true })).toHaveValue(
    'Intended private draft',
  );
  await dialog
    .getByRole('button', { name: 'Check current record', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Use current versions', exact: true })
    .click();
  mode = 'lost';
  await dialog
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Check original save', exact: true }),
  ).toBeVisible();
  const original = frozen;
  page.once('dialog', async (prompt) => {
    expect(prompt.type()).toBe('beforeunload');
    await prompt.accept();
  });
  await page.reload();
  await expect(page.getByLabel('Private note', { exact: true })).toHaveValue(
    'Intended private draft',
  );
  await page
    .getByRole('button', { name: 'Check original save', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
  expect(frozen).toEqual(original);
  await page
    .getByRole('button', { name: 'Back to transactions', exact: true })
    .click();
  await expect(page.locator('#transaction-source-private')).toBeFocused();
  await expect(page).toHaveURL(/period=last-month/);
  await expect(page).toHaveURL(/state=posted/);
});

test('Personal detail reflows private facts and editor across themes, narrow screens and enlarged text @owns-viewport', async ({
  page,
  app,
}, testInfo) => {
  await app.authenticate();
  let state = 'posted';
  await transactionServer(page, (operation, variables) =>
    operation === 'personalTransactionSelectionQuery'
      ? {
          bankingTransaction: {
            __typename: 'BankingTransactionDetail',
            id: `detail-${state}`,
            code: 'READY',
            currentId: variables.source,
            transaction: transactionRow(variables.source, {
              processingState: state,
              eligible: state === 'posted',
              amountMinor: '9007199254740991',
              name: 'A long original description '.repeat(12),
            }),
          },
        }
      : undefined,
  );
  for (const [width, theme, text, stateValue] of [
    [320, 'light', 1, 'pending'],
    [390, 'dark', 1, 'removed'],
    [440, 'system', 2, 'posted'],
    [1280, 'light', 2, 'posted'],
    [1280, 'system', 1, 'posted'],
  ]) {
    state = stateValue;
    app.setAppearance(theme.toUpperCase());
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: theme === 'light' ? 'light' : 'dark',
    });
    await page.goto('/personal?tab=transactions&transaction=source-private');
    await page.evaluate(
      ({ text }) => {
        document.documentElement.style.fontSize = `${text * 100}%`;
      },
      { theme, text },
    );
    const dialog = page.getByRole('dialog', {
      name: 'Transaction detail',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'light' ? 'light' : 'dark',
    );
    await page.screenshot({
      path: testInfo.outputPath(`detail-read-${width}-${theme}-${text}.png`),
      fullPage: true,
    });
    await expect(
      dialog.getByText('$90,071,992,547,409.91', { exact: true }),
    ).toBeVisible();
    if (state !== 'posted')
      await expect(
        dialog.getByText(/contributes nothing to spending/),
      ).toBeVisible();
    // Editing replaces read-only facts and owns focus immediately, without a
    // test-induced scroll/focus that could hide a broken transition.
    await dialog.getByText('Original bank details', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const editorHeading = dialog.getByRole('heading', {
      name: 'Edit private annotations',
      exact: true,
    });
    await expect(editorHeading).toBeFocused();
    const firstControl = dialog.getByLabel('Activity type', { exact: true });
    await page.keyboard.press('Tab');
    await expect(firstControl).toBeFocused();
    const transition = await dialog.evaluate((element) => {
      const heading = element.querySelector('form h3').getBoundingClientRect();
      const activity = element
        .querySelector('form select')
        .getBoundingClientRect();
      return {
        headingTop: heading.top,
        headingBottom: heading.bottom,
        activityTop: activity.top,
        activityBottom: activity.bottom,
        viewport: innerHeight,
      };
    });
    expect(transition.headingTop).toBeGreaterThanOrEqual(0);
    expect(transition.activityBottom).toBeLessThanOrEqual(transition.viewport);
    expect(transition.activityTop - transition.headingBottom).toBeLessThan(
      180 * text,
    );
    await page.screenshot({
      path: testInfo.outputPath(
        `detail-edit-top-${width}-${theme}-${text}.png`,
      ),
    });
    await dialog.getByLabel('Reviewed', { exact: true }).focus();
    await expect(dialog.getByLabel('Reviewed', { exact: true })).toBeFocused();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const geometry = await dialog.boundingBox();
    expect(geometry.width).toBeLessThanOrEqual(width);
    if (width >= 760) expect(geometry.x).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath(`detail-${width}-${theme}-${text}.png`),
      fullPage: true,
    });
    await dialog
      .getByRole('button', { name: 'Cancel editing', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: 'Close Transaction detail', exact: true })
      .click();
  }
});
