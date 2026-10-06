/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser runner supports an external Playwright module. */
// Synthetic frontend acceptance only; never point this fixture at hosted services.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
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

const members = ['Kaunda', 'Mizenin', 'Sam'].map((displayName, i) => ({
  id: 'M' + i,
  displayName,
  status: 'ACTIVE',
  role: i ? 'MEMBER' : 'OWNER',
  canParticipate: true,
}));
const groups = [
  {
    id: 'H',
    name: 'Our household',
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
const output = process.env.OUTPUT_DIR || '/tmp/kami-percentage-browser';
fs.mkdirSync(output, { recursive: true });
const origin = process.env.ORIGIN || 'http://localhost:3199';
const baseline = process.env.BASELINE === 'true';
const results = [];
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  for (const width of [320, 390, 768, 1280])
    for (const scale of [1, 2]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let mode = 'pair';
      let writes = 0;
      let lastInput;
      const detail = {
        __typename: 'Expense',
        id: 'e1',
        groupId: 'H',
        description: 'Coffee stop',
        effectiveDate: '2026-10-05',
        totalMinor: '1001',
        currency: 'USD',
        category: 'DINING',
        note: '',
        payer: members[0],
        creator: members[0],
        createdAt: '2026-10-05T12:00:00Z',
        split: 'PERCENTAGE',
        allocations: [
          {
            participant: members[0],
            amountMinor: '601',
            percentageHundredths: 6000,
          },
          {
            participant: members[1],
            amountMinor: '400',
            percentageHundredths: 4000,
          },
        ],
      };
      const view = {
        __typename: 'ExpenseView',
        contextVersion: 'fixture-context-v1',
        totalExpenseMinor: '1001',
        expenseCount: '1',
        months: [
          { month: '2026-10', totalExpenseMinor: '1001', expenseCount: '1' },
        ],
        edges: [{ cursor: 'e1', node: detail, source: groups[0] }],
        pageInfo: { hasNextPage: false, endCursor: 'e1' },
      };
      await page.addInitScript(
        (s) => localStorage.setItem('kami-auth', JSON.stringify(s)),
        session,
      );
      await page.route('**/api/onboarding-config', (r) =>
        r.fulfill({
          json: { url: origin + '/synthetic-auth', key: 'synthetic-public' },
        }),
      );
      await page.route('**/synthetic-auth/auth/v1/**', (r) =>
        r.fulfill({
          json: r.request().url().includes('/user') ? user : session,
        }),
      );
      await page.route('**/api/graphql', async (r) => {
        const { query, variables } = r.request().postDataJSON();
        const op = query.match(/(?:query|mutation) (\w+)/)?.[1];
        let data;
        const spaces = groups.map((g) => ({
          ...g,
          groupId: g.id,
          viewerNetMinor: '0',
          viewerMembership: members[0],
          members: mode === 'pair' ? members.slice(0, 2) : members,
        }));
        const dash = {
          ...dashboard({ mode: 'complete', net: '0' }),
          contextVersion: 'fixture-context-v1',
          spaces,
        };
        if (op === 'expensesHouseholdInitialQuery')
          data = {
            viewer: { __typename: 'Viewer', today: '2026-10-05' },
            householdDashboard: dash,
            householdExpenses: view,
          };
        else if (op === 'expensesHouseholdContextQuery')
          data = {
            viewer: { __typename: 'Viewer', id: 'v', today: '2026-10-05' },
            householdDashboard: dash,
          };
        else if (
          op === 'householdAccessQuery' ||
          op === 'householdWorkspaceQuery'
        )
          data = { householdDashboard: dash, householdExpenses: view };
        else if (op === 'expensesHouseholdQuery')
          data = { householdExpenses: view };
        else if (op === 'journeyExpenseQuery') data = { node: detail };
        else if (op === 'journeyViewerQuery')
          data = {
            viewer: {
              __typename: 'Viewer',
              id: 'v',
              displayName: 'Kaunda',
              today: '2026-10-05',
              canCreateGroups: false,
              groups,
            },
          };
        else if (op === 'journeyWorkspaceQuery')
          data = {
            viewer: { __typename: 'Viewer', today: '2026-10-05' },
            group: group(variables.id),
            groupExpenses: view,
          };
        else if (op === 'expensesGroupQuery') data = { groupExpenses: view };
        else if (op === 'journeyCreateMutation') {
          writes++;
          lastInput = variables.input;
          data = {
            createExpense: {
              __typename: 'OperationProgress',
              key: variables.input.key,
              state: 'UNKNOWN',
            },
          };
        } else if (op === 'journeyRecoveryQuery')
          data = {
            expenseOperation: {
              __typename: 'ExpenseCommitted',
              key: variables.key,
              record: {
                expenseId: 'e1',
                groupId: lastInput?.groupId || 'H',
                totalMinor: lastInput?.totalMinor || '1001',
                revision: '2',
                split: 'PERCENTAGE',
                allocations: detail.allocations.map((a) => ({
                  participantId: a.participant.id,
                  amountMinor: lastInput
                    ? a.percentageHundredths === 6000
                      ? '7500'
                      : '5000'
                    : a.amountMinor,
                  percentageHundredths: a.percentageHundredths,
                })),
              },
            },
          };
        else throw new Error('Unknown operation ' + op);
        await r.fulfill({ json: { data } });
      });
      await page.goto(origin + '/household/expenses');
      await page.locator('#ledger-add').waitFor();
      await page.evaluate(
        (scale) =>
          (document.documentElement.style.fontSize = `${scale * 16}px`),
        scale,
      );
      await page.locator('#ledger-add').click();
      await page.locator('#expense-description').waitFor();
      await page.locator('#expense-description').fill('Weekend groceries');
      await page.locator('#expense-amount').fill('125.00');
      await page.locator('#expense-category').selectOption('GROCERIES');
      if (!baseline) {
        await page.locator('#expense-split').selectOption('PERCENTAGE');
        await page.locator('[id="percentage-M0"]').fill('60');
        assert.equal(
          await page.locator('[id="percentage-M1"]').inputValue(),
          '40',
        );
        assert.equal(
          await page
            .getByRole('checkbox', { name: 'Link percentages (two people)' })
            .isChecked(),
          true,
        );
        assert(
          await page
            .locator('.percentage-status')
            .innerText()
            .then((s) => s.includes('100% allocated')),
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Save expense', exact: true })
            .isEnabled(),
          true,
        );
        assert.equal(
          await page
            .locator('.percentage-money')
            .allTextContents()
            .then((a) => a.join('|')),
          '$75.00|$50.00',
        );
      }
      await page.locator('#expense-description').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${output}/${baseline ? 'before' : 'P1-P2'}-top-${width}-${scale}.png`,
      });
      await page
        .getByRole('button', { name: 'Save expense', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${output}/${baseline ? 'before' : 'P1-P2'}-bottom-${width}-${scale}.png`,
      });
      const saveBox = await page
        .getByRole('button', { name: 'Save expense', exact: true })
        .boundingBox();
      assert(
        saveBox.y >= 0 && saveBox.y + saveBox.height <= 900,
        'save obscured',
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        'page overflow',
      );
      // Native modal focus traps forward/reverse traversal and restores its trigger.
      await page.locator('#expense-split').focus();
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab');
        assert(
          await page.evaluate(() => !!document.activeElement.closest('dialog')),
          'focus escaped',
        );
      }
      await page.keyboard.press('Shift+Tab');
      assert(
        await page.evaluate(() => !!document.activeElement.closest('dialog')),
      );
      if (!baseline) {
        await page.locator('[id="percentage-M0"]').fill('');
        assert.equal(
          await page.locator('[id="percentage-M1"]').inputValue(),
          '40',
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Save expense', exact: true })
            .isDisabled(),
          true,
        );
        await page.locator('[id="percentage-M0"]').fill('60');
        await page.locator('#expense-amount').fill('9999999.99');
        assert(
          await page
            .locator('.percentage-money')
            .first()
            .innerText()
            .then((s) => s === '$5,999,999.99'),
        );
        await page.locator('#expense-amount').fill('125.00');
        await page.reload();
        await page.locator('[id="percentage-M0"]').waitFor();
        assert.equal(
          await page.locator('[id="percentage-M0"]').inputValue(),
          '60',
        );
      }
      if (!baseline) {
        await page
          .getByRole('button', { name: 'Save expense', exact: true })
          .click();
        const frozen = await page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem('kami-financial-drafts-v1')).H
              .attempt,
        );
        assert.equal(frozen.split, 'PERCENTAGE');
        assert.equal(frozen.groupId, 'H');
        await page.reload();
        await page
          .getByRole('button', { name: 'Recover original result', exact: true })
          .waitFor();
        assert(
          await page.locator('#expense-description').isDisabled(),
          'attempt not frozen',
        );
        await page
          .getByRole('button', { name: 'Retry original expense', exact: true })
          .click();
        assert.deepEqual(lastInput, frozen, 'retry changed intent');
        await page
          .getByRole('button', { name: 'Recover original result', exact: true })
          .click();
        await page.waitForFunction(
          () =>
            !JSON.parse(sessionStorage.getItem('kami-financial-drafts-v1')).H
              ?.attempt,
        );
        assert.equal(
          await page.evaluate(
            () =>
              JSON.parse(sessionStorage.getItem('kami-financial-drafts-v1')).H,
          ),
          undefined,
        );
      }
      // Close dirty draft through actual confirmation before P3 context.
      await page.keyboard.press('Escape');
      const discard = page.getByRole('button', {
        name: /Discard|Leave|Close without/i,
      });
      if (await discard.count()) await discard.first().click();
      await page.evaluate(() =>
        sessionStorage.removeItem('kami-financial-drafts-v1'),
      );
      if (!baseline) {
        mode = 'three';
        await page.goto(origin + '/groups/F?tab=expenses');
        await page.locator('#ledger-add').waitFor();
        await page.locator('#ledger-add').click();
        await page.locator('#expense-description').waitFor();
        await page.locator('#expense-description').fill('Group dinner');
        await page.locator('#expense-amount').fill('200');
        await page.locator('#expense-split').selectOption('PERCENTAGE');
        for (const [id, value] of [
          ['M0', '40'],
          ['M1', '30'],
          ['M2', '15'],
        ])
          await page.locator(`[id="percentage-${id}"]`).fill(value);
        assert(
          await page
            .locator('.percentage-status')
            .innerText()
            .then((s) => s.includes('85% allocated · 15% remaining')),
        );
        assert.equal(await page.locator('.percentage-money').count(), 0);
        await page.locator('[id="percentage-M2"]').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${output}/P3-invalid-${width}-${scale}.png`,
        });
        await page
          .getByRole('button', { name: 'Assign remaining to Sam', exact: true })
          .click();
        assert.equal(
          await page.locator('[id="percentage-M2"]').inputValue(),
          '30',
        );
        assert.equal(
          await page
            .locator('.percentage-money')
            .allTextContents()
            .then((a) => a.join('|')),
          '$80.00|$60.00|$60.00',
        );
        await page.screenshot({
          path: `${output}/P3-valid-${width}-${scale}.png`,
        });
        await page.evaluate(() =>
          sessionStorage.removeItem('kami-financial-drafts-v1'),
        );
        await page.goto(
          origin + '/household/expenses?expense=e1&expenseGroup=H',
        );
        await page.getByRole('heading', { name: 'Coffee stop' }).waitFor();
        assert.equal(
          await page
            .locator('.percentage-saved')
            .allTextContents()
            .then((a) => a.join('|')),
          '60%|40%',
        );
        assert(
          await page
            .locator('.expense-allocation-list')
            .innerText()
            .then((s) => s.includes('$6.01') && s.includes('$4.00')),
        );
        await page.screenshot({ path: `${output}/P4-${width}-${scale}.png` });
        members[0].displayName =
          'Kaunda with a very long participant name that wraps safely';
        await page.goto(origin + '/trips/T?tab=expenses');
        await page.locator('#ledger-add').waitFor();
        await page.locator('#ledger-add').click();
        await page.locator('#expense-description').waitFor();
        await page.locator('#expense-description').fill('Trip groceries');
        await page.locator('#expense-amount').fill('125.00');
        await page
          .getByRole('checkbox', { name: 'Sam', exact: true })
          .uncheck();
        await page.locator('#expense-split').selectOption('PERCENTAGE');
        await page.locator('[id="percentage-M0"]').fill('60');
        await page.locator('[id="percentage-M1"]').fill('40');
        assert.equal(
          await page
            .getByRole('button', { name: 'Save expense', exact: true })
            .isEnabled(),
          true,
        );
        await page.emulateMedia({ colorScheme: 'dark' });
        await page
          .getByRole('button', { name: 'Save expense', exact: true })
          .scrollIntoViewIfNeeded();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          'long-name/dark overflow',
        );
        await page.screenshot({
          path: `${output}/trip-dark-long-${width}-${scale}.png`,
        });
        members[0].displayName = 'Kaunda';
      }
      assert.deepEqual(errors, []);
      results.push({ width, scale, baseline, writes, status: 'passed' });
      await page.close();
    }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  console.log(JSON.stringify(results));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
