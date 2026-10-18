/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser runner supports an external Playwright module. */
// Synthetic frontend acceptance only; never point this fixture at hosted services.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const assert = require('node:assert/strict');
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.test',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const jwt =
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  ) +
  '.' +
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: 'authenticated',
    }),
  ).toString('base64url') +
  '.' +
  Buffer.from('synthetic').toString('base64url');
const session = {
  access_token: jwt,
  refresh_token: 'synthetic-refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user,
};

const members = ['Alex', 'Brian', 'Casey'].map((displayName, i) => ({
  id: 'M' + i,
  displayName,
  status: 'ACTIVE',
  role: i ? 'MEMBER' : 'OWNER',
  canParticipate: true,
}));
const groups = [
  {
    id: 'H',
    name: 'Home',
    kind: 'ORDINARY',
    isHousehold: true,
    currency: 'USD',
    trip: null,
  },
  {
    id: 'T',
    name: 'Maui 2026 with a very long friendly space name',
    kind: 'TRIP',
    isHousehold: false,
    currency: 'USD',
    trip: {
      destination: 'Maui',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
    },
  },
  {
    id: 'F',
    name: 'Friends',
    kind: 'ORDINARY',
    isHousehold: false,
    currency: 'USD',
    trip: null,
  },
];
function dashboard(state) {
  return {
    __typename: 'HouseholdDashboard',
    state:
      state.mode === 'unavailable'
        ? 'UNAVAILABLE'
        : state.mode === 'incomplete'
          ? 'INCOMPLETE'
          : 'COMPLETE',
    totals:
      state.mode === 'unavailable'
        ? null
        : state.mode === 'incomplete'
          ? { __typename: 'Problem', code: 'AMOUNT_OVERFLOW' }
          : {
              __typename: 'HouseholdDashboardTotals',
              viewerNetMinor: state.net,
              viewerShareMinor: '4503599627370496',
              viewerPaidMinor: '4503599627370496',
              openBalanceCount: '2',
              activeSpaceCount: '3',
              totalSharedExpenseMinor: '9007199254740993',
              totalSharedExpenseCount: '9',
            },
    spaces: groups
      .slice(0, state.mode === 'unavailable' ? 1 : 3)
      .map((g, i) => ({
        ...g,
        groupId: g.id,
        viewerMembership: members[0],
        viewerNetMinor: i === 0 ? '8420' : i === 1 ? '-8420' : '0',
        sharedExpenseCount: '3',
        balances: {
          __typename: 'GroupBalances',
          settled: i === 2,
          obligations:
            i === 0
              ? [{ from: members[1], to: members[0], amountMinor: '8420' }]
              : i === 1
                ? [{ from: members[0], to: members[1], amountMinor: '8420' }]
                : [],
        },
      })),
  };
}
function group(id) {
  return {
    __typename: 'Group',
    ...groups.find((g) => g.id === id),
    viewerMembership: members[0],
    members,
    expenses: {
      id: `ExpenseConnection:${id}:1`,
      revision: '1',
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    },
    repayments: { edges: [], pageInfo: { hasNextPage: false } },
    balances: {
      __typename: 'GroupBalances',
      groupId: id,
      revision: '1',
      totalExpenseMinor: '300',
      settled: false,
      positions: members.map((member, i) => ({
        member,
        paidMinor: '0',
        owedMinor: '0',
        sentMinor: '0',
        receivedMinor: '0',
        netMinor: i === 0 ? '8420' : i === 1 ? '-8420' : '0',
      })),
      obligations: [{ from: members[1], to: members[0], amountMinor: '8420' }],
    },
  };
}

const fs = require('node:fs');
const path = require('node:path');
const output = process.env.OUTPUT_DIR || '/tmp/kami-appearance-browser';
fs.mkdirSync(output, { recursive: true });
const port = process.env.PORT || '3193';
const origin = process.env.BROWSER_ORIGIN || `http://localhost:${port}`;
const delay = Number(process.env.FIXTURE_DELAY_MS || 250);
const width = Number(process.env.WIDTH || 1280);
const expense = {
  __typename: 'Expense',
  id: 'e1',
  groupId: 'H',
  description: 'Fixture lunch',
  effectiveDate: '2026-10-01',
  totalMinor: '300',
  category: 'GROCERIES',
  note: null,
  payer: members[0],
  allocations: [{ participant: members[0], amountMinor: '300' }],
};
function expenseSnapshot({ id, ...value }) {
  return {
    ...value,
    __typename: 'ExpenseSnapshot',
    id: `ExpenseSnapshot:${id}:${value.version || '1'}`,
    expenseId: id,
    version: value.version || '1',
  };
}
const view = {
  id: 'ExpenseView:fixture-initial',
  contextVersion: 'fixture-context-v1',
  __typename: 'ExpenseView',
  __isExpenseViewResult: 'ExpenseView',
  totalExpenseMinor: '300',
  viewerShareMinor: '300',
  viewerPaidMinor: '300',
  categories: [
    {
      category: 'GROCERIES',
      totalExpenseMinor: '300',
      viewerShareMinor: '300',
      expenseCount: '1',
    },
  ],
  expenseCount: '1',
  months: [{ month: '2026-10', totalExpenseMinor: '300', expenseCount: '1' }],
  edges: [{ cursor: 'e1', node: expenseSnapshot(expense), source: groups[0] }],
  pageInfo: { hasNextPage: false, endCursor: 'e1' },
};
const activity = {
  __typename: 'ActivityConnection',
  __isActivityResult: 'ActivityConnection',
  edges: [
    {
      cursor: 'a1',
      node: {
        __typename: 'ActivityEvent',
        id: 'a1',
        recordId: 'e1',
        kind: 'EXPENSE_CREATED',
        groupId: 'T',
        groupName: 'Maui',
        groupKind: 'TRIP',
        isHousehold: false,
        amountMinor: '300',
        currency: 'USD',
        effectiveDate: '2026-10-01',
        timestamp: '2026-10-01T12:00:00Z',
        creator: members[0],
        payer: members[0],
        sender: null,
        recipient: null,
      },
    },
  ],
  pageInfo: { hasNextPage: false, endCursor: 'a1' },
};
function contrast(a, b) {
  const luminance = (hex) => {
    if (hex.length === 4)
      hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
    const values = hex
      .replace('#', '')
      .match(/../g)
      .map((n) => parseInt(n, 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const aa = luminance(a),
    bb = luminance(b);
  return (Math.max(aa, bb) + 0.05) / (Math.min(aa, bb) + 0.05);
}
async function checkContrast(page) {
  const pairs = [
    ['ink', 'surface', 4.5],
    ['muted', 'surface', 4.5],
    ['primary', 'surface', 4.5],
    ['on-primary', 'primary', 4.5],
    ['danger', 'error-surface', 4.5],
    ['owes', 'orange-surface', 4.5],
    ['border', 'surface', 3],
    ['focus', 'surface', 3],
  ];
  for (const [foreground, background, minimum] of pairs) {
    const colors = await page.evaluate(
      (names) =>
        names.map((name) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-' + name)
            .trim(),
        ),
      [foreground, background],
    );
    for (const [index, color] of colors.entries()) {
      assert.match(
        color,
        /^#[\da-f]{3}(?:[\da-f]{3})?$/i,
        `Missing or invalid contrast token: ${[foreground, background][index]}`,
      );
    }
    assert(
      contrast(...colors) >= minimum,
      `${foreground}/${background} contrast below ${minimum}: ${colors}`,
    );
  }
}
withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      window.__firstTheme = document.documentElement.dataset.theme;
    });
  });
  let preference = 'LIGHT',
    empty = false,
    profileFailure = false,
    profileDelay = 0;
  const errors = [],
    results = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedSession(page.context(), origin, session);
  await page.context().route('**/api/onboarding-config', (r) =>
    r.fulfill({
      json: { url: authOrigin, key: 'synthetic-public' },
    }),
  );
  await page.context().route(authOrigin + '/auth/v1/**', (r) =>
    r.fulfill({
      json: r.request().url().includes('/user') ? user : session,
    }),
  );
  await page.context().route('**/api/graphql', async (r) => {
    const { query, variables } = r.request().postDataJSON();
    const op = query.match(/(?:query|mutation) (\w+)/)?.[1];
    let data;
    if (op === 'appearanceQuery' || op === 'profileQuery')
      data = {
        currentProfile: {
          __typename: 'Profile',
          id: 'profile-v',
          displayName: 'Alex',
          appearance: preference,
        },
      };
    else if (op === 'appearanceMutation') {
      preference = variables.appearance;
      data = {
        updateMyAppearance: { __typename: 'Profile', appearance: preference },
      };
    } else if (op === 'journeyWorkspaceQuery')
      data = {
        viewer: { __typename: 'Viewer', today: '2026-10-05' },
        group: group(variables.id),
        ...(variables.ledger ? { groupExpenses: view } : {}),
        ...(variables.activity ? { groupActivity: activity } : {}),
      };
    else if (op === 'expensesHouseholdInitialQuery')
      data = {
        viewer: { __typename: 'Viewer', today: '2026-10-05' },
        householdDashboard: {
          ...dashboard({ mode: 'complete', net: '0' }),
          contextVersion: 'fixture-context-v1',
          spaces: groups.map((g) => ({
            ...g,
            groupId: g.id,
            viewerNetMinor: '0',
            viewerMembership: members[0],
            members,
          })),
        },
        householdExpenses: view,
      };
    else if (op === 'journeyExpenseQuery')
      data = {
        node: {
          ...expense,
          currency: 'USD',
          note: 'Private fixture note',
          creator: members[0],
          createdAt: '2026-10-01T12:00:00Z',
        },
      };
    else if (op === 'householdAccessQuery' || op === 'profileReturnQuery')
      data = {
        viewer: { __typename: 'Viewer', groups },
      };
    else if (op === 'journeyViewerQuery')
      data = {
        groupDirectory: {
          __typename: 'GroupDirectory',
          entries: groups
            .filter((g) => !g.isHousehold)
            .map((group) => ({
              group,
              activeMemberCount: 3,
              financialSummary: {
                __typename: 'GroupFinancialSummary',
                totalSpendMinor: '300',
                viewerNetMinor: '8420',
              },
            })),
        },
        viewer: {
          __typename: 'Viewer',
          id: 'v',
          displayName: 'Alex',
          today: '2026-10-05',
          canCreateGroups: false,
          groups,
        },
      };
    else if (op === 'journeyGroupQuery' || op === 'householdMembersQuery')
      data = { group: group(variables.id || 'T') };
    else if (op === 'householdWorkspaceQuery')
      data = {
        householdDashboard: dashboard({ mode: 'complete', net: '0' }),
        householdExpenses: view,
      };
    else if (op === 'expensesHouseholdContextQuery')
      data = {
        viewer: { __typename: 'Viewer', id: 'v', today: '2026-10-05' },
        householdDashboard: {
          ...dashboard({ mode: 'complete', net: '0' }),
          spaces: groups.map((g) => ({
            ...g,
            groupId: g.id,
            viewerNetMinor: '0',
            viewerMembership: members[0],
            members,
          })),
        },
      };
    else if (op === 'expensesGroupQuery') data = { groupExpenses: view };
    else if (op === 'expensesHouseholdQuery')
      data = { householdExpenses: view };
    else if (op === 'activityGroupQuery') data = { groupActivity: activity };
    else if (op === 'activityHouseholdQuery')
      data = { householdActivity: activity };
    else if (query.includes('ownerInvitations'))
      data = {
        ownerInvitations: {
          __typename: 'OwnerInvitationPage',
          items: [],
          nextCursor: null,
        },
      };
    else throw new Error('Unknown ' + op);
    if (empty && data.householdExpenses)
      data.householdExpenses = {
        ...view,
        edges: [],
        totalExpenseMinor: '0',
        expenseCount: '0',
        months: [],
      };
    if (empty && data.householdDashboard)
      data.householdDashboard = {
        ...data.householdDashboard,
        totals: {
          ...data.householdDashboard.totals,
          viewerNetMinor: '0',
          viewerShareMinor: '0',
          viewerPaidMinor: '0',
          openBalanceCount: '0',
          totalSharedExpenseMinor: '0',
          totalSharedExpenseCount: '0',
        },
      };
    if (profileFailure && data.currentProfile)
      data.currentProfile = {
        __typename: 'ProfileProblem',
        code: 'UNAVAILABLE',
        message: 'Fixture unavailable',
      };
    await new Promise((resolve) =>
      setTimeout(resolve, data.currentProfile ? delay + profileDelay : delay),
    );
    await r.fulfill({ json: { data } });
  });

  if (process.env.TEXT_ONLY === '1') {
    preference = 'DARK';
    await page.goto(origin + '/account');
    await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .waitFor();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      '200% text document overflow',
    );
    await page.screenshot({
      path: path.join(output, `account-text200-dark-${width}.png`),
      fullPage: true,
    });
    fs.writeFileSync(
      path.join(output, `text200-${width}.json`),
      JSON.stringify({
        commit: process.env.TESTED_COMMIT,
        width,
        textScale: 2,
        overflow: false,
        errors,
      }),
    );
    assert.deepEqual(errors, []);
    await browser.close();
    return;
  }
  const theme = async (expected) => {
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      expected,
    );
  };
  await page.goto(origin + '/account');
  await page
    .getByRole('heading', { name: 'Preferences', exact: true })
    .waitFor();
  await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .waitFor();
  await theme('light');
  assert.equal(
    await page.getByRole('button', { name: 'Save appearance' }).count(),
    0,
  );
  await checkContrast(page);
  const themeSelect = page.getByRole('combobox', {
    name: 'Appearance',
    exact: true,
  });
  await themeSelect.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await theme('dark');
  await page.getByText('Saving appearance…', { exact: true }).waitFor();
  assert(
    await themeSelect.evaluate((e) => e === document.activeElement),
    'selection keeps focus during save',
  );
  await themeSelect.selectOption('LIGHT');
  await page
    .getByText('Appearance saved for your account.', { exact: true })
    .waitFor();
  await theme('light');
  assert(
    (await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .inputValue()) === preference,
    'rapid keyboard selection keeps latest intent',
  );
  assert.equal(
    preference,
    'LIGHT',
    'queued keyboard selection persists latest choice',
  );
  results.push({
    keyboardSelectDuringSave: true,
    latestKeyboardIntentPersisted: true,
  });
  for (const choice of ['Dark', 'Light', 'System']) {
    await themeSelect.selectOption(choice.toUpperCase());
    await page
      .getByText('Appearance saved for your account.', { exact: true })
      .waitFor();
    await theme(choice === 'Light' ? 'light' : 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await theme(choice === 'Dark' ? 'dark' : 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await theme(choice === 'Light' ? 'light' : 'dark');
    results.push({ choice, liveOSChange: true });
  }
  await themeSelect.selectOption('DARK');
  await page
    .getByText('Appearance saved for your account.', { exact: true })
    .waitFor();
  // The supported cookie binds the paint cache before the profile read.
  // Assert the first application frame as well as the authoritative result.
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kami-auth')),
    null,
  );
  await page.reload();
  await theme('dark');
  assert.equal(
    await page.evaluate(() => window.__firstTheme),
    'dark',
    'cookie-only startup paints the matching saved Dark preference',
  );
  await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .waitFor();
  assert(
    (await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .inputValue()) === preference,
  );
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key !== 'kami-auth') localStorage.removeItem(key);
  });
  await page.reload();
  await theme('dark');
  await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .waitFor();
  assert(
    (await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .inputValue()) === preference,
    'server preference restored without local theme cache',
  );
  results.push({
    serverPreferenceWithoutLocalCache: true,
    reloadPersistence: true,
    cookieBootstrapDark: true,
    authorizedDarkAfterReload: true,
  });
  await checkContrast(page);
  // Approved #227 palette, also guarded by appearance-palette.test.ts.
  const canonical = {
    canvas: '#0B111B',
    surface: '#131D2C',
    subtle: '#192535',
    high: '#24364A',
    chrome: '#101927',
    separator: '#2A394C',
    ink: '#F5F7FF',
    muted: '#AFBED1',
    primary: '#50E1B4',
    container: '#163C35',
    'on-container': '#79F0CB',
    border: '#7D90A7',
    violet: '#AAA2FF',
    blue: '#7CBDFF',
    orange: '#FFC27E',
    coral: '#FF9CA8',
  };
  for (const [name, expected] of Object.entries(canonical)) {
    const actual = await page.evaluate(
      (name) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-' + name)
          .trim(),
      name,
    );
    assert.equal(actual.toUpperCase(), expected);
  }
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).focus();
  assert(
    await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .evaluate((e) => e === document.activeElement),
  );
  const geometry = await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .evaluate((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    }));
  assert(
    geometry.width <= 560 && geometry.height >= 44,
    'compact select retains an accessible control target',
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, `account-dark-${width}.png`),
    fullPage: true,
  });
  for (const route of [
    '/household',
    '/trips',
    '/groups',
    '/trips/T?tab=balances',
    '/household/ledger?tab=expenses',
    '/household/ledger?tab=activity',
    '/household/ledger?tab=members',
    '/invitations',
  ]) {
    await page.goto(origin + route);
    await theme('dark');
    await page.waitForTimeout(700);
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      'overflow: ' + route,
    );
    if (route === '/household') {
      assert.equal(
        await page.getByText('repayments excluded', { exact: false }).count(),
        0,
      );
      assert.equal(
        await page.getByRole('link', { name: /open balances/ }).count(),
        0,
      );
      await page.getByRole('link', { name: 'Balances', exact: true }).waitFor();
    }
    await page.screenshot({
      path: path.join(
        output,
        route.replaceAll('/', '_').replaceAll('?', '_') + `-dark-${width}.png`,
      ),
      fullPage: true,
    });
    results.push({ route, dark: true, overflow: false });
    if (route.endsWith('tab=expenses')) {
      const trigger = page.getByRole('button', {
        name: 'Filters',
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('dialog', { name: 'Expense filters' }).waitFor();
      await page.screenshot({
        path: path.join(output, `expense-dialog-dark-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert(
        await trigger.evaluate((e) => e === document.activeElement),
        'dialog focus return',
      );
      results.push({ keyboardDialog: true, escapeFocusReturned: true });
    }
  }

  empty = true;
  await page.goto(origin + '/household');
  await theme('dark');
  await page.getByText('No shared expenses yet.', { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, `household-empty-dark-${width}.png`),
    fullPage: true,
  });
  empty = false;
  preference = 'LIGHT';
  await page.goto(origin + '/account');
  await theme('light');
  for (const route of [
    '/household',
    '/trips/T?tab=balances',
    '/household/ledger?tab=expenses',
  ]) {
    await page.goto(origin + route);
    await theme('light');
    await page.waitForTimeout(700);
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      'light overflow: ' + route,
    );
    await page.screenshot({
      path: path.join(
        output,
        route.replaceAll('/', '_').replaceAll('?', '_') + `-light-${width}.png`,
      ),
      fullPage: true,
    });
    results.push({ route, light: true, overflow: false });
  }
  preference = 'DARK';
  await page.goto(origin + '/account');
  await theme('dark');
  await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .waitFor();
  profileDelay = 1500;
  await page.reload();
  await page.getByText('Loading appearance…', { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, `account-loading-dark-${width}.png`),
    fullPage: true,
  });
  await page
    .getByRole('combobox', { name: 'Appearance', exact: true })
    .waitFor();
  profileDelay = 0;
  profileFailure = true;
  await page.reload();
  await theme('dark');
  await page
    .getByText('Appearance could not be loaded. Try again.', { exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(output, `account-error-dark-${width}.png`),
    fullPage: true,
  });
  results.push({ loadingAndErrorDarkTheme: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, `appearance-${width}.json`),
    JSON.stringify(
      {
        commit: process.env.TESTED_COMMIT || 'working tree',
        browser: browser.version(),
        results,
        canonical,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
  await browser.close();
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
