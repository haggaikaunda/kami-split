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
const output = process.env.OUTPUT_DIR || '/tmp/kami-navigation-browser';
fs.mkdirSync(output, { recursive: true });
const port = process.env.PORT || '3193';
const origin = process.env.BROWSER_ORIGIN || `http://localhost:${port}`;
const delay = Number(process.env.FIXTURE_DELAY_MS || 250);
const width = Number(process.env.WIDTH || 1280),
  scale = Number(process.env.SCALE || 1);
const expense = {
  __typename: 'Expense',
  id: 'e1',
  groupId: 'T',
  version: '1',
  canEdit: true,
  editLockReason: null,
  split: 'EQUAL',
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
  edges: [{ cursor: 'e1', node: expenseSnapshot(expense), source: groups[1] }],
  pageInfo: { hasNextPage: false, endCursor: 'e1' },
};
if (process.env.LAYOUT_TESTS === '1' || process.env.REFRESH_TESTS === '1') {
  view.edges = Array.from({ length: 40 }, (_, i) => ({
    cursor: `e${i + 1}`,
    node: expenseSnapshot({
      ...expense,
      id: `e${i + 1}`,
      description: `Fixture lunch ${i + 1}`,
    }),
    source: groups[1],
  }));
  view.expenseCount = '40';
  view.totalExpenseMinor =
    view.viewerShareMinor =
    view.viewerPaidMinor =
      '12000';
  view.months[0].totalExpenseMinor = '12000';
  view.months[0].expenseCount = '40';
  view.pageInfo.endCursor = 'e40';
}
if (process.env.LEDGER_TESTS === '1') {
  expense.description = 'Long dinner description '.repeat(8);
  members[0].displayName = 'Long payer name '.repeat(8);
  expense.payer = members[0];
  members[2].displayName = 'Sasha';
  view.edges = Array.from({ length: 6 }, (_, i) => ({
    cursor: `e${i + 1}`,
    node: expenseSnapshot({
      ...expense,
      id: `e${i + 1}`,
      ...(i === 1
        ? {
            description: 'Uber',
            payer: { ...members[2], displayName: 'Sasha' },
          }
        : {}),
    }),
    source: i === 1 ? { ...groups[1], name: 'Maui' } : groups[1],
  }));
  view.expenseCount = '9';
  view.totalExpenseMinor = '2700';
  view.months = [
    { month: '2026-10', totalExpenseMinor: '2400', expenseCount: '8' },
    { month: '2026-09', totalExpenseMinor: '300', expenseCount: '1' },
  ];
  view.pageInfo = { hasNextPage: true, endCursor: 'e6' };
}
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
withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const results = [];
  for (const workspace of ['group', 'household']) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      hasTouch: process.env.REFRESH_TESTS === '1',
      colorScheme: process.env.COLOR_SCHEME === 'dark' ? 'dark' : 'light',
    });
    const workspaceLink = async (name) => {
      const tabs = page.locator('[data-ui~="workspace-tabs"]');
      if (name === 'Members' || name === 'Activity') {
        const more = tabs.getByRole('button', { name: /^More/ });
        if ((await more.getAttribute('aria-expanded')) !== 'true')
          await more.click();
      }
      return tabs.getByRole('link', { name, exact: true });
    };
    let ledgerEdited = false;
    let log = [],
      documents = 0,
      denied = false,
      offline = false;
    const errors = [];
    const requestRecords = new WeakMap();
    page.on('requestfailed', (request) => {
      const item = requestRecords.get(request);
      if (item) item.canceled = true;
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.resourceType() === 'document')
        documents++;
    });
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
      const item = { op, start: Date.now(), variables };
      log.push(item);
      if (offline) return r.abort('internetdisconnected');
      requestRecords.set(r.request(), item);
      let data;
      if (op === 'appearanceQuery' || op === 'profileQuery')
        data = {
          currentProfile: {
            __typename: 'Profile',
            id: 'profile-v',
            displayName: 'Alex',
            appearance:
              process.env.THEME === 'system'
                ? 'SYSTEM'
                : process.env.THEME === 'dark'
                  ? 'DARK'
                  : 'LIGHT',
          },
        };
      else if (op === 'journeyWorkspaceQuery')
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
      else if (
        op === 'expenseEditMutation' &&
        process.env.LEDGER_TESTS === '1'
      ) {
        ledgerEdited = true;
        data = {
          updateExpense: {
            __typename: 'ExpenseEditCommitted',
            key: variables.input.key,
            version: '2',
            changed: true,
            record: {
              expenseId: variables.input.expenseId,
              groupId: 'T',
              totalMinor: '300',
            },
          },
        };
      } else if (op === 'journeyExpenseQuery')
        data = {
          node: {
            ...expense,
            ...(process.env.LEDGER_TESTS === '1'
              ? {
                  id: variables.id,
                  ...(ledgerEdited && variables.id === 'e8'
                    ? { description: 'Edited late expense', version: '2' }
                    : {}),
                }
              : {}),
            currency: 'USD',
            note: 'Private fixture note',
            creator: members[0],
            createdAt: '2026-10-01T12:00:00Z',
          },
        };
      else if (op === 'householdAccessQuery')
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
      else if (op === 'expenseEditMembersQuery')
        data = { group: group(variables.groupId) };
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
      if (process.env.LEDGER_TESTS === '1' && variables.after) {
        const next = {
          ...view,
          id: 'ExpenseView:fixture-after-e6',
          edges: [
            ...[7, 8].map((i) => ({
              cursor: `e${i}`,
              node: expenseSnapshot({
                ...expense,
                id: `e${i}`,
                ...(ledgerEdited && i === 8
                  ? { description: 'Edited late expense', version: '2' }
                  : {}),
              }),
              source: groups[1],
            })),
            {
              cursor: 'e9',
              node: expenseSnapshot({
                ...expense,
                id: 'e9',
                effectiveDate: '2026-09-30',
              }),
              source: groups[1],
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: 'e9' },
        };
        if (data.groupExpenses) data.groupExpenses = next;
        if (data.householdExpenses) data.householdExpenses = next;
      }
      if (denied)
        data = {
          ...data,
          ...(data.group
            ? {
                group: {
                  __typename: 'Problem',
                  code: 'NOT_FOUND',
                  message: 'denied',
                },
              }
            : {}),
          ...(data.householdDashboard
            ? {
                householdDashboard: {
                  __typename: 'Problem',
                  code: 'NOT_FOUND',
                },
              }
            : {}),
          ...(data.householdExpenses
            ? {
                householdExpenses: {
                  __typename: 'Problem',
                  code: 'NOT_FOUND',
                },
              }
            : {}),
        };
      if (process.env.LEDGER_TESTS === '1' && data.householdExpenses?.edges) {
        // A genuinely short Household row uses the short native Household
        // source. Do not rename the Trip's shared Relay record for one row.
        data.householdExpenses = {
          ...data.householdExpenses,
          edges: data.householdExpenses.edges.map((edge) =>
            edge.node.expenseId === 'e2'
              ? {
                  ...edge,
                  node: { ...edge.node, groupId: 'H' },
                  source: groups[0],
                }
              : edge,
          ),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      item.end = Date.now();
      await r.fulfill({ json: { data } }).catch(() => {
        item.canceled = true;
      });
    });
    if (workspace === 'group') {
      await page.goto(origin + '/groups');
      await page.getByRole('navigation', { name: 'Group type' }).waitFor();
      await page.locator('[data-ui~="discovery-cards"]').waitFor();
      const cards = page.locator('[data-ui~="discovery-cards"] a');
      assert.equal(await cards.count(), 2, 'All contains groups and trips');
      assert.equal(await cards.filter({ hasText: 'Maui' }).count(), 1);
      await page
        .getByRole('navigation', { name: 'Group type' })
        .getByRole('link', { name: 'Groups', exact: true })
        .click();
      await page.waitForURL(origin + '/groups?kind=groups');
      await page.locator('a[href="/groups/F"]').waitFor();
      assert.equal(
        await cards.count(),
        1,
        'Groups filter must contain ordinary groups only',
      );
      assert.equal(await cards.first().getAttribute('href'), '/groups/F');
      if (process.env.MATERIAL_TESTS === '1') {
        await page.goto(origin + '/groups/F?tab=overview');
        await page
          .getByRole('heading', { name: 'Recent expenses', exact: true })
          .waitFor();
        assert.equal(
          await page.locator('[data-ui~="obligation-preview"] h2').innerText(),
          'Your balances',
        );
        await page.screenshot({
          path: path.join(output, 'overview-ordinary-group.png'),
          fullPage: true,
        });
      }
      await page.goto(origin + '/trips');
      await page.locator('a[href="/trips/T"]').waitFor();
      assert.equal(await page.locator('a[href="/groups/H"]').count(), 0);
      await page.goto(origin + '/groups/H?tab=members');
      await page.waitForURL('**/household/ledger?tab=members');
      const ownerRow = page
        .getByRole('list', { name: 'People', exact: true })
        .locator('li')
        .filter({ has: page.getByText('Owner', { exact: true }) });
      await ownerRow.getByText('Active', { exact: true }).waitFor();
      assert.equal(
        await page.locator('main').count(),
        1,
        'Household has one frame',
      );
      assert.equal(
        await page.locator('[data-ui~="workspace-tabs"]').count(),
        1,
      );
      assert.equal(
        await page
          .locator('[data-ui~="workspace-navigation"] a[aria-current="page"]')
          .getAttribute('href'),
        '/household',
      );
      await page.goto(origin + '/groups/T?tab=balances');
      await page.waitForURL('**/trips/T?tab=balances');
      await page
        .getByRole('heading', { name: 'Your balances', exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator('[data-ui~="workspace-navigation"] a[aria-current="page"]')
          .getAttribute('href'),
        '/groups',
      );
      results.push({
        unifiedDiscovery: true,
        householdLegacyReplacement: true,
        tripLegacyReplacement: true,
        singleHouseholdFrame: true,
      });
      log = [];
      documents = 0;
    }
    if (process.env.PRESERVATION_TESTS === '1') {
      await require('./preservation-browser.cjs')({
        page,
        origin,
        workspace,
        width,
        scale,
        output,
        results,
      });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.env.REFRESH_TESTS === '1') {
      await require('./refresh-browser.cjs')({
        page,
        origin,
        workspace,
        width,
        scale,
        output,
        results,
        requests: () => log,
        documentCount: () => documents,
        setOffline: (value) => {
          offline = value;
        },
        setDenied: (value) => {
          denied = value;
        },
      });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.env.FILTER_TESTS === '1') {
      await require('./filter-browser.cjs')({
        page,
        origin,
        workspace,
        width,
        scale,
        output,
        results,
      });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.env.LEDGER_TESTS === '1') {
      await require('./ledger-browser.cjs')({
        page,
        origin,
        workspace,
        width,
        scale,
        output,
        results,
      });
      if (process.env.ISSUE269_TESTS === '1')
        await require('./issue-269-browser.cjs')({
          page,
          origin,
          workspace,
          width,
          scale,
          output,
          results,
        });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.env.INSTALLATION_TESTS === '1') {
      await require('./installation-browser.cjs')({
        page,
        origin,
        workspace,
        results,
      });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.env.LAYOUT_TESTS === '1') {
      await require('./navigation-layout-browser.cjs')({
        page,
        origin,
        workspace,
        width,
        scale,
        output,
        results,
      });
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    let start = Date.now();
    await page.goto(
      origin + (workspace === 'group' ? '/trips/T?tab=overview' : '/household'),
    );
    await page.locator('[data-ui~="workspace-tabs"]').waitFor();
    if (scale === 2)
      await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    await page.waitForTimeout(1000);
    if (process.env.MATERIAL_TESTS === '1') {
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        process.env.THEME || 'light',
      );
      const summary = page.locator('[data-ui~="balance-summary"]');
      assert.equal(await summary.count(), 1, 'complete directional summary');
      assert.ok((await summary.innerText()).includes('You owe'));
      assert.ok((await summary.innerText()).includes('You’re owed'));
      assert.equal(
        await page.locator('[data-ui~="obligation-preview"]').isVisible(),
        true,
        'bounded actionable preview remains visible on every width',
      );
      await page.locator('[data-ui~="overview-totals"] summary').click();
      assert.ok(
        (
          await page.locator('[data-ui~="overview-totals"]').innerText()
        ).includes('Your share'),
      );
      await page.screenshot({
        path: path.join(output, `overview-${workspace}.png`),
        fullPage: true,
      });
    }
    results.push({
      workspace,
      action: 'cold overview',
      documents,
      requests: log.map((x) => ({
        ...x,
        start: x.start - start,
        end: x.end - start,
      })),
    });
    for (const tab of [
      'Members',
      'Activity',
      'Expenses',
      'Overview',
      'Members',
    ]) {
      const link = await workspaceLink(tab);
      await link.waitFor();
      log = [];
      documents = 0;
      await page.evaluate(() => {
        window.__shell = document.querySelector('[data-ui~="workspace-tabs"]');
        window.__feedback = null;
        window.__click = null;
        document.addEventListener(
          'click',
          () => {
            window.__click = performance.now();
            window.__clickEpoch = Date.now();
            const observer = new MutationObserver(() => {
              if (window.__feedback === null)
                window.__feedback = performance.now() - window.__click;
            });
            observer.observe(document.querySelector('main') || document.body, {
              childList: true,
              subtree: true,
              attributes: true,
            });
          },
          { once: true, capture: true },
        );
      });
      const scrollBefore = await page.evaluate(() => scrollY);
      start = Date.now();
      await link.click();
      await page.waitForTimeout(80);
      const early = await page.evaluate(() => ({
        shellPresent: !!document.querySelector('[data-ui~="workspace-tabs"]'),
        sameShell:
          window.__shell ===
          document.querySelector('[data-ui~="workspace-tabs"]'),
        feedbackMs: window.__feedback,
        clickEpoch: window.__clickEpoch,
        scrollAfter: scrollY,
      }));
      await page.waitForFunction(
        (tab) => {
          if (tab === 'Expenses')
            return !!document.querySelector('#ledger-expense-e1');
          if (tab === 'Activity')
            return [...document.querySelectorAll('button')].some((e) =>
              e.textContent.includes('added an expense'),
            );
          if (tab === 'Members')
            return [
              ...document.querySelectorAll(
                '[data-ui~="group-members-list"] li',
              ),
            ].some(
              (row) =>
                row.querySelector('[data-ui~="member-detail"]')?.textContent ===
                  'Owner' &&
                row.querySelector('[data-ui~="member-state"]')?.textContent ===
                  'Active',
            );
          return [...document.querySelectorAll('h2')].some(
            (e) => e.textContent === 'Recent expenses',
          );
        },
        tab,
        { polling: 'raf' },
      );
      const authorizedContentMs = Date.now() - start;
      await page.waitForTimeout(200);
      assert(
        early.shellPresent && early.sameShell,
        'static shell replaced ' + workspace + '/' + tab,
      );
      assert.equal(
        documents,
        0,
        'document navigation ' + workspace + '/' + tab,
      );
      const total = log.length
        ? Math.max(...log.map((x) => x.end || Date.now())) - start
        : 0;
      results.push({
        workspace,
        action: 'click ' + tab,
        ...early,
        scrollBefore,
        documents,
        authorizedContentMs,
        authorizedResponseMs: total,
        requests: log.map((x) => ({
          ...x,
          phase: x.canceled ? 'canceled request' : 'completed request',
          start: x.start - start,
          end: x.end - start,
        })),
      });
    }

    await page
      .locator('[data-ui~="workspace-tabs"]')
      .getByRole('link', { name: 'Expenses', exact: true })
      .click();
    await page.locator('#ledger-expense-e1').waitFor();
    {
      const before = log.length;
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await page.getByRole('dialog', { name: 'Expense filters' }).waitFor();
      assert.equal(log.length, before, 'filter disclosure started GraphQL');
      await page.keyboard.press('Escape');
      await page
        .getByRole('dialog', { name: 'Expense filters' })
        .waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const filterControls = page.getByRole('dialog', {
      name: 'Expense filters',
    });
    await filterControls
      .locator('summary')
      .filter({ hasText: 'Categories' })
      .click();
    await filterControls.getByLabel('Groceries', { exact: true }).check();
    await filterControls.getByRole('button', { name: 'Apply filters' }).click();
    await page.waitForURL(
      (url) => url.searchParams.get('categories') === 'GROCERIES',
    );
    await page.locator('#ledger-expense-e1').waitFor();
    assert(
      log.some((request) =>
        request.variables.filter?.categories?.includes('GROCERIES'),
      ),
      'filter not sent to server',
    );
    if (process.env.MATERIAL_TESTS === '1') {
      await page
        .getByRole('button', { name: 'Breakdown', exact: true })
        .click();
      await page.waitForURL(
        (url) => url.searchParams.get('view') === 'breakdown',
      );
      const chart = page.getByRole('region', {
        name: 'Spending by category',
      });
      await chart.waitFor();
      await page.screenshot({
        path: path.join(output, `chart-${workspace}.png`),
        fullPage: true,
      });
      assert.equal(
        new URL(page.url()).searchParams.get('categories'),
        'GROCERIES',
      );
      assert(
        (await chart.innerText()).includes('$3.00'),
        'complete total in chart',
      );
      await page.getByLabel('Chart amount').selectOption('share');
      await page.waitForURL((url) => url.searchParams.get('basis') === 'share');
      const sector = page.locator('[data-ui~="breakdown-legend"] button');
      const legendContrast = async () =>
        sector.evaluate((button) => {
          const luminance = (color) =>
            color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4;
              })
              .reduce(
                (sum, value, index) =>
                  sum + value * [0.2126, 0.7152, 0.0722][index],
                0,
              );
          const foreground = luminance(
            getComputedStyle(
              button.querySelector('[data-ui~="breakdown-legend-label"]'),
            ).color,
          );
          // Match edit-real-browser's painted-ancestor contrast measurement.
          let painted = button;
          while (
            painted.parentElement &&
            getComputedStyle(painted)
              .backgroundColor.match(/[\d.]+/g)
              .map(Number)[3] === 0
          )
            painted = painted.parentElement;
          const background = luminance(
            getComputedStyle(painted).backgroundColor,
          );
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        });
      const unselectedContrast = await legendContrast();
      assert(
        unselectedContrast >= 4.5,
        `unselected legend text contrast ${unselectedContrast}`,
      );
      const switchColors = await page
        .locator('[data-ui~="ledger-view-switch"] button')
        .evaluateAll((buttons) =>
          buttons.map((button) => getComputedStyle(button).backgroundColor),
        );
      assert.notEqual(
        switchColors[0],
        switchColors[1],
        'pressed List/Breakdown appearance must be distinct',
      );
      await sector.focus();
      await page.keyboard.press('Enter');
      assert.equal(await sector.getAttribute('aria-pressed'), 'true');
      const selectedContrast = await legendContrast();
      assert(
        selectedContrast >= 4.5,
        `selected legend text contrast ${selectedContrast}`,
      );
      await page.screenshot({
        path: path.join(output, `chart-selected-${workspace}.png`),
        fullPage: true,
      });
      results.push({
        workspace,
        unselectedContrast,
        selectedContrast,
        viewSelectionDistinct: true,
      });
      await page
        .getByRole('button', { name: 'View expenses', exact: true })
        .click();
      await page.locator('#ledger-expense-e1').waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get('categories'),
        'GROCERIES',
      );
      results.push({
        workspace,
        breakdownURL: true,
        shareBasis: true,
        keyboardSectorSelection: true,
        categoryDrilldown: true,
      });
    }
    const filteredURL = page.url();
    const row = page.locator('#ledger-expense-e1');
    await row.focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole(width <= 650 ? 'region' : 'dialog', {
        name: 'Expense detail',
      })
      .waitFor();
    await page.getByText('Private fixture note').waitFor();
    if (process.env.MATERIAL_TESTS === '1') {
      const panel = page.locator('[data-ui~="expense-presentation"]');
      const bounds = await panel.boundingBox();
      await page.screenshot({
        path: path.join(output, `detail-${workspace}.png`),
        fullPage: false,
      });
      if (width <= 650) {
        assert(
          bounds.x <= 1 && bounds.width >= width - 2,
          'mobile detail fills viewport',
        );
        assert(
          Math.abs(bounds.y) <= 1 && Math.abs(bounds.height - 900) <= 2,
          'mobile detail covers full viewport height from top',
        );
        await page
          .getByRole('button', { name: 'Back to expenses', exact: true })
          .waitFor();
      } else {
        assert(
          bounds.x > 0 && Math.abs(bounds.x + bounds.width - width) <= 2,
          'desktop drawer anchored right',
        );
        await page.mouse.click(8, 8);
        await panel.waitFor({ state: 'detached' });
        assert.equal(
          page.url(),
          filteredURL,
          'outside click must dismiss without navigating underlying header',
        );
        await row.click();
        await page.getByText('Private fixture note').waitFor();
      }
      await page.getByText('Private fixture note').click();
      assert(await panel.isVisible(), 'inside click must preserve detail');
      await page.keyboard.press('Tab');
      assert(
        await panel.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        'focus contained',
      );
      results.push({
        workspace,
        presentationGeometry: true,
        outsideDismiss: width > 650,
        insidePreserved: true,
        focusContained: true,
      });
    }
    if (process.env.MATERIAL_DRAFT_TESTS === '1') {
      await page
        .getByRole('button', { name: 'Edit expense', exact: true })
        .click();
      await page.locator('#expense-note').waitFor({ state: 'attached' });
      if (!(await page.locator('#expense-note').isVisible()))
        await page
          .getByRole('button', { name: 'Add optional note', exact: true })
          .click();
      await page
        .locator('#expense-note')
        .fill('Recoverable unsaved browser draft');
      await page.setViewportSize({
        width: width > 650 ? 390 : 1280,
        height: 900,
      });
      assert.equal(
        await page.locator('#expense-note').inputValue(),
        'Recoverable unsaved browser draft',
        'resize preserves mounted draft',
      );
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.mouse.click(8, 8);
      await page
        .locator('[data-ui~="expense-presentation"]')
        .waitFor({ state: 'detached' });
      assert.equal(page.url(), filteredURL, 'draft dismiss retains source URL');
      await row.click();
      await page
        .getByRole('button', { name: 'Edit expense', exact: true })
        .click();
      assert.equal(
        await page.locator('#expense-note').inputValue(),
        'Recoverable unsaved browser draft',
        'reopening restores unsaved draft',
      );
      await page.screenshot({
        path: path.join(output, `recovered-edit-${workspace}.png`),
        fullPage: true,
      });
      assert(
        !log.some((request) => request.op === 'expenseEditMutation'),
        'dismiss and resize never save',
      );
      await page
        .getByRole('button', { name: 'Cancel editing', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Discard changes', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Edit expense', exact: true })
        .click();
      assert.equal(
        await page.locator('#expense-note').inputValue(),
        'Private fixture note',
        'discard restores confirmed values',
      );
      await page.setViewportSize({ width, height: 900 });
      results.push({
        workspace,
        draftResizePreserved: true,
        outsideDismissDraftRecovery: true,
        noImplicitSave: true,
        explicitDiscard: true,
      });
    }
    await page.keyboard.press('Escape');
    await page
      .locator('[data-ui~="expense-presentation"]')
      .waitFor({ state: 'detached' });
    await page.waitForTimeout(50);
    assert(
      await row.evaluate((e) => e === document.activeElement),
      'detail focus not restored',
    );
    await page.goForward();
    await page.getByText('Private fixture note').waitFor();
    await page.goBack();
    await page
      .locator('[data-ui~="expense-presentation"]')
      .waitFor({ state: 'detached' });
    await row.waitFor();
    assert.equal(page.url(), filteredURL, 'detail lost source filter');
    results.push({
      workspace,
      keyboardDetail: true,
      escapeFocusRestored: true,
      detailBackForward: true,
      filterSourceRestored: true,
      localFilterDisclosure: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert(!overflow, 'page overflow ' + workspace + '/' + width + '/' + scale);
    await page.screenshot({
      path: path.join(output, `after-${workspace}-${width}-${scale}.png`),
      fullPage: true,
    });
    results.push({
      workspace,
      width,
      scale,
      reducedMotion: true,
      overflow,
      errors,
    });
    const beforePopup = page.url();
    const popupReady = page.context().waitForEvent('page');
    await (
      await workspaceLink('Members')
    ).click({
      modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'],
    });
    const popup = await popupReady;
    await popup.waitForURL((url) => url.searchParams.get('tab') === 'members');
    await popup.locator('[data-ui~="workspace-tabs"]').waitFor();
    assert.equal(
      page.url(),
      beforePopup,
      'modified click changed source route',
    );
    await popup.close();
    results.push({
      workspace,
      modifiedClickNewTab: true,
      directWorkspaceEntry: true,
    });
    if (workspace === 'group') {
      const membersLink = await workspaceLink('Members');
      await membersLink.hover();
      await page.waitForTimeout(delay + 80);
      await membersLink.click();
      await page.locator('[data-ui~="group-members-list"]').waitFor();
      // A recent Members activation may reuse authorized data. Foregrounding
      // invalidates that eligibility and must observe the revoked access.
      denied = true;
      const deniedRead = page.waitForResponse(async (response) => {
        if (!response.url().endsWith('/api/graphql')) return false;
        const { data } = await response.json();
        return (
          data?.group?.__typename === 'Problem' &&
          data.group.code === 'NOT_FOUND'
        );
      });
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      await deniedRead;
      // A typed access denial disposes the account scope. The auth boundary
      // routes recovery through sign-in instead of retaining a group heading.
      await page.waitForURL(
        (url) =>
          url.pathname === '/sign-in' &&
          url.searchParams.get('auth') === 'unavailable',
      );
      await page
        .getByRole('alert')
        .filter({ hasText: 'Account verification is unavailable.' })
        .waitFor();
      assert.equal(await page.getByText('Private fixture note').count(), 0);
      assert.equal(
        await page.getByText(group('T').name, { exact: true }).count(),
        0,
      );
      results.push({ workspace, cachedTabForegroundRevocationDenied: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  fs.writeFileSync(
    path.join(output, `after-browser-${width}-${scale}.json`),
    JSON.stringify(
      {
        commit: process.env.TESTED_COMMIT || 'working tree',
        browser: browser.version(),
        delay,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
