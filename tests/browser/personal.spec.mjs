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
              attemptId: variables.input.attemptId,
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
    await expect(zone).toHaveValue('Europe/London');
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
