/* eslint-disable @typescript-eslint/no-require-imports -- Standalone guarded synthetic browser checks. */
// Development support evidence, not an independent acceptance verdict.
// Run only with visual-parity-fixture.cjs. SCENARIOS may select comma-separated cases.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.BROWSER_ORIGIN || 'http://localhost:3228';
const output = process.env.OUTPUT_DIR || '/tmp/kami-visual-interactions';
const selected = process.env.SCENARIOS?.split(',');
fs.mkdirSync(output, { recursive: true });
const cases = [];
const test = (name, work) => {
  if (
    !selected ||
    selected.includes(name) ||
    selected.some(
      (prefix) => prefix.endsWith('*') && name.startsWith(prefix.slice(0, -1)),
    )
  )
    cases.push({ name, work });
};
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
test('fixture-explicit-write-contracts', async (page) => {
  const { buildSchema, parse, execute } = require('graphql');
  const schema = buildSchema(
    fs
      .readdirSync('packages/schema')
      .filter((name) => name.endsWith('.graphql'))
      .map((name) =>
        fs.readFileSync(path.join('packages/schema', name), 'utf8'),
      )
      .join('\n'),
  );
  const wire = (name) =>
    JSON.parse(
      fs
        .readFileSync(
          `apps/web/src/lib/relay/__generated__/${name}.graphql.ts`,
          'utf8',
        )
        .match(/"text": ("(?:[^"\\]|\\.)*")/)[1],
    );
  const setup = async (state) => {
    await page.request.get(origin + '/__fixture/reset');
    await page.request.get(`${origin}/__fixture/health?fixtureState=${state}`);
  };
  const graph = async (query, variables = {}) => {
    const response = await page.request.post(origin + '/api/graphql', {
      data: { query, variables },
    });
    assert.equal(response.status(), 200);
    const payload = await response.json();
    assert.equal(payload.errors, undefined);
    // Execute the real selected contract over fixture values; required/null and
    // union/type errors fail rather than being hidden by loose object assertions.
    const checked = await execute({
      schema,
      document: parse(query),
      rootValue: payload.data,
      variableValues: variables,
    });
    assert.equal(checked.errors, undefined, JSON.stringify(checked.errors));
    return payload.data;
  };
  const creation = {
    operationKey: '10000000-0000-4000-8000-000000000001',
    name: 'Synthetic new group',
    kind: 'ORDINARY',
    trip: null,
  };
  await setup('complete');
  assert.equal(
    (await graph(wire('journeyGroupCreationMutation'), { input: creation }))
      .createGroup.code,
    'UNAVAILABLE',
  );
  await setup('no-workspaces');
  assert.equal(
    (await graph(wire('journeyViewerQuery'))).viewer.groups.length,
    0,
  );
  const created = (
    await graph(wire('journeyGroupCreationMutation'), { input: creation })
  ).createGroup;
  assert.equal(created.__typename, 'GroupCreationCompleted');
  assert.deepEqual(
    (await graph(wire('journeyGroupCreationMutation'), { input: creation }))
      .createGroup,
    created,
  );
  assert.equal(
    (
      await graph(wire('journeyGroupCreationMutation'), {
        input: { ...creation, name: 'Changed intent' },
      })
    ).createGroup.__typename,
    'GroupCreationConflict',
  );
  const newGroup = (
    await graph(wire('journeyGroupQuery'), { id: created.groupId })
  ).group;
  assert.equal(newGroup.name, creation.name);
  assert.equal(newGroup.members.length, 1);
  assert.equal(newGroup.balances.totalExpenseMinor, '0');
  const trip = {
    operationKey: '10000000-0000-4000-8000-000000000002',
    name: 'Synthetic mountain trip',
    kind: 'TRIP',
    trip: {
      destination: 'Mountains',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    },
  };
  const createdTrip = (
    await graph(wire('journeyGroupCreationMutation'), { input: trip })
  ).createGroup;
  assert.deepEqual(
    (await graph(wire('journeyGroupQuery'), { id: createdTrip.groupId })).group
      .trip,
    trip.trip,
  );
  await setup('write-success');
  const repayment = {
    groupId: 'F',
    key: '10000000-0000-4000-8000-000000000003',
    senderId: 'M1',
    recipientId: 'M0',
    amountMinor: '1234',
    currency: 'USD',
    effectiveDate: '2026-10-09',
    note: 'Synthetic transfer only',
  };
  const before = (await graph(wire('journeyGroupQuery'), { id: 'F' })).group
    .balances.positions;
  const committed = (
    await graph(wire('journeyRepaymentMutation'), { input: repayment })
  ).recordRepayment;
  assert.equal(committed.__typename, 'RepaymentCommitted');
  assert.deepEqual(
    (await graph(wire('journeyRepaymentMutation'), { input: repayment }))
      .recordRepayment,
    committed,
  );
  const afterGroup = (await graph(wire('journeyGroupQuery'), { id: 'F' }))
    .group;
  assert.equal(
    BigInt(afterGroup.balances.positions[0].netMinor) -
      BigInt(before[0].netMinor),
    -1234n,
  );
  assert.equal(
    BigInt(afterGroup.balances.positions[1].netMinor) -
      BigInt(before[1].netMinor),
    1234n,
  );
  const invariant = await (
    await page.request.get(origin + '/__fixture/invariants')
  ).json();
  assert.equal(invariant.repaymentCount, '1');
  assert.ok(invariant.groups.every((group) => group.netMinor === '0'));
  const fields =
    '__typename ... on InvitationActionResult { actionID invitationID groupID outcome committedExpiresAt currentExpiresAt lifecycle delivery hasAccess } ... on InvitationProblem { code message }';
  const createInvite = `mutation($groupID:ID!,$email:String!,$key:OperationKey!){createTargetedInvitation(groupID:$groupID,email:$email,key:$key){${fields}}}`;
  const invitation = (
    await graph(createInvite, {
      groupID: 'F',
      email: 'invitee@example.com',
      key: '10000000-0000-4000-8000-000000000004',
    })
  ).createTargetedInvitation;
  assert.equal(invitation.outcome, 'SAVED');
  assert.equal(invitation.delivery, 'PENDING');
  const listing =
    'query($groupID:ID!){ownerInvitations(groupID:$groupID,first:20){__typename ... on OwnerInvitationPage { items{id kind recipient expiresAt lifecycle actionID delivery} nextCursor } ... on InvitationProblem {code}}}';
  assert.equal(
    (await graph(listing, { groupID: 'F' })).ownerInvitations.items[0]
      .recipient,
    'invitee@example.com',
  );
  await setup('member');
  assert.equal(
    (await graph(listing, { groupID: 'F' })).ownerInvitations.code,
    'FORBIDDEN',
  );
  const unsupported = await page.request.post(
    origin + '/api/unknown-synthetic-write',
    { data: {} },
  );
  assert.equal(unsupported.status(), 503);
  await setup('join-targeted');
  const post = async (route, data) => {
    const response = await page.request.post(origin + route, { data });
    assert.equal(response.status(), 200);
    return response.json();
  };
  await post('/api/onboarding/start', { token: 'synthetic-targeted' });
  assert.equal((await post('/api/onboarding/preview', {})).kind, 'TARGETED');
  const tokenDigest = require('node:crypto')
    .createHash('sha256')
    .update('synthetic-targeted')
    .digest('hex');
  const continuation = await post('/api/onboarding/targeted-continuation', {
    tokenDigest,
  });
  assert.equal(continuation.needsPassword, true);
  const auth = await post('/synthetic-auth/auth/v1/verify', {
    token_hash: continuation.tokenHash,
    type: continuation.type,
  });
  assert.equal(auth.user.email, 'haggai@example.com');
  assert.equal(
    (
      await post('/api/onboarding/accept', {
        tokenDigest,
        key: '10000000-0000-4000-8000-000000000005',
      })
    ).hasAccess,
    true,
  );
  return {
    syntheticContractOnly: true,
    checkedAgainstRepositorySDL: true,
    createdGroup: created.groupId,
    createdTrip: createdTrip.groupId,
    invariant,
  };
});
async function ready(page, route, state = 'complete', theme = 'light') {
  await page.request.get(origin + '/__fixture/reset');
  await page.request.get(
    `${origin}/__fixture/health?fixtureState=${state}&fixtureTheme=${theme}`,
  );
  await page.goto(origin + route, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    theme,
  );
  await page.evaluate(() => document.fonts.ready);
}
test('fixture-create-group-and-trip-browser', async (page) => {
  await ready(page, '/groups', 'no-workspaces');
  await snapshot(page, 'no-workspaces');
  for (const kind of ['group', 'trip']) {
    await page.goto(`${origin}/${kind}s/new`, { waitUntil: 'networkidle' });
    await page
      .getByLabel('Name', { exact: true })
      .fill(`Synthetic new ${kind}`);
    if (kind === 'trip') {
      await page
        .getByLabel('Destination (optional)', { exact: true })
        .fill('Mountains');
      await page
        .getByLabel('Start date (UTC)', { exact: true })
        .fill('2026-11-01');
      await page
        .getByLabel('End date (UTC)', { exact: true })
        .fill('2026-11-03');
    }
    await page
      .getByRole('button', { name: `Create ${kind}`, exact: true })
      .click();
    await page
      .getByRole('heading', { name: `Synthetic new ${kind}`, exact: true })
      .waitFor();
    await snapshot(page, `created-${kind}`);
  }
  return snapshot(page, 'fixture-create-group-and-trip-browser');
});
test('fixture-repayment-browser', async (page) => {
  await ready(page, '/groups/F/repayments/new', 'write-success');
  await page.getByLabel('Sender', { exact: true }).selectOption('M1');
  await page.getByLabel('Recipient', { exact: true }).selectOption('M0');
  await page.getByLabel('Amount (USD)', { exact: true }).fill('12.34');
  await page.getByLabel('Transfer date', { exact: true }).fill('2026-10-09');
  await page
    .getByLabel('Optional note', { exact: true })
    .fill('Synthetic transfer only');
  await page
    .getByRole('button', { name: 'Record repayment', exact: true })
    .click();
  await page
    .getByText(
      'Repayment recorded once. No money was moved. Current balances and recent repayments are a separately authorized read.',
      { exact: true },
    )
    .waitFor();
  const invariant = await (
    await page.request.get(origin + '/__fixture/invariants')
  ).json();
  assert.equal(invariant.repaymentCount, '1');
  return { ...(await snapshot(page, 'fixture-repayment-browser')), invariant };
});
test('fixture-owner-member-invitations-browser', async (page) => {
  await ready(page, '/groups/F?tab=members', 'owner-invitations');
  await page
    .getByRole('heading', { name: 'Invitations for Maple House', exact: true })
    .waitFor();
  await page
    .getByLabel('Invitee email address', { exact: true })
    .fill('new-member@example.com');
  await page
    .getByRole('button', { name: 'Create invitation', exact: true })
    .click();
  await page.getByText('new-member@example.com', { exact: true }).waitFor();
  await page
    .getByText(
      'Send status: PROVIDER_ACCEPTED. Provider acceptance does not confirm recipient delivery.',
      { exact: true },
    )
    .first()
    .waitFor();
  await snapshot(page, 'owner-invitation-created');
  await ready(page, '/groups/F?tab=members', 'member');
  assert.equal(
    await page
      .getByRole('heading', {
        name: 'Invitations for Maple House',
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Create invitation', exact: true })
      .count(),
    0,
  );
  return snapshot(page, 'member-no-invitation-controls');
});
test('fixture-targeted-join-browser', async (page) => {
  await ready(page, '/join#synthetic-targeted', 'join-targeted');
  await page
    .getByRole('button', { name: 'Continue with invitation', exact: true })
    .click();
  await page
    .getByRole('heading', {
      name: 'Create your Kami Grow account',
      exact: true,
    })
    .waitFor();
  await snapshot(page, 'targeted-password-setup');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticOnly123!');
  await page
    .getByLabel('Confirm password', { exact: true })
    .fill('SyntheticOnly123!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Join Maple House', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'You joined Maple House!', exact: true })
    .waitFor();
  return snapshot(page, 'targeted-join-success');
});
test('fixture-shared-signin-join-browser', async (page) => {
  await ready(page, '/join#synthetic-shared', 'join-shared');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Email address', { exact: true })
    .fill('haggai@example.com');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticOnly123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Join Maple House', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'You joined Maple House!', exact: true })
    .waitFor();
  return snapshot(page, 'shared-join-success');
});
async function filters(page) {
  await page.getByRole('button', { name: /^Filters/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Expense filters' });
  await dialog.waitFor();
  return dialog;
}
async function closedDetail(page) {
  await page.waitForURL((url) => !url.searchParams.has('expense'));
  await page.locator('.expense-presentation').waitFor({ state: 'detached' });
}
async function snapshot(page, name) {
  const overlay = await page.locator('dialog[open]').count();
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: !overlay,
  });
  await page.screenshot({
    path: path.join(output, `${name}-viewport.png`),
    fullPage: false,
  });
  return page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    bodyFont: getComputedStyle(document.body).fontSize,
    rootFont: getComputedStyle(document.documentElement).fontSize,
    focus: {
      id: document.activeElement?.id,
      text: document.activeElement?.textContent?.slice(0, 100),
    },
    headings: [...document.querySelectorAll('h1,h2,h3')]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.textContent),
    alerts: [...document.querySelectorAll('[role=alert]')]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.textContent),
    outsideViewport: [...document.querySelectorAll('body *')]
      .filter((e) => e.getClientRects().length)
      .map((e) => ({ element: e, bounds: e.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.left < -1 || bounds.right > innerWidth + 1)
      .map(({ element, bounds }) => ({
        selector:
          element.tagName.toLowerCase() +
          (element.className
            ? '.' + String(element.className).trim().replaceAll(' ', '.')
            : ''),
        text: element.textContent.slice(0, 100),
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
      }))
      .slice(0, 30),
    summaryGeometry: [
      ...document.querySelectorAll(
        '.ui-summary-row,.ui-summary-metric,.ui-signed-balance,.ui-metric-value,.ui-workspace-header,.workspace-heading,.workspace-title,.banner-action',
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .map((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          selector: e.className,
          width: r.width,
          scrollWidth: e.scrollWidth,
          font: s.fontSize,
          display: s.display,
          flex: s.flex,
          flexWrap: s.flexWrap,
          grid: s.gridTemplateColumns,
          minWidth: s.minWidth,
        };
      }),
  }));
}
async function longMoneyMetrics(page) {
  return page.locator('.ui-money--long').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const value = element.querySelector('.ui-money-value'),
          r = value.getBoundingClientRect();
        const owner =
            element.closest(
              '.ui-summary-metric,.overview-expense-price,.ledger-money,.expense-detail-total',
            ) || element.parentElement,
          bounds = owner.getBoundingClientRect(),
          style = getComputedStyle(owner),
          ownStyle = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(value);
        const text = range.getBoundingClientRect();
        const legalPan =
          ['auto', 'scroll'].includes(ownStyle.overflowX) &&
          element.tabIndex >= 0 &&
          !!element.getAttribute('aria-label');
        const availableLeft = bounds.left + parseFloat(style.paddingLeft),
          availableRight = bounds.right - parseFloat(style.paddingRight);
        return {
          text: value.textContent,
          textWidth: text.width,
          valueWidth: r.width,
          ownerWidth: bounds.width,
          availableWidth: availableRight - availableLeft,
          safe:
            legalPan ||
            (text.left >= availableLeft - 1 &&
              text.right <= availableRight + 1),
          ellipsis: [ownStyle, getComputedStyle(value), style].some(
            (s) => s.textOverflow === 'ellipsis',
          ),
          legalPan,
          owner: owner.className,
        };
      }),
  );
}
test('six-row-pagination', async (page) => {
  await ready(page, '/household/expenses');
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 6,
  );
  await page
    .getByRole('button', { name: /Load more expenses|Show more/ })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 12,
  );
  await page
    .getByRole('button', { name: /Load more expenses|Show more/ })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ledger-description strong').length === 16,
  );
  const ids = await page
    .locator('.ledger-month li a')
    .evaluateAll((elements) => elements.map((element) => element.id));
  assert.equal(new Set(ids).size, 16);
  return snapshot(page, 'six-row-pagination');
});
test('five-and-filters-and-chart', async (page) => {
  await ready(page, '/household/expenses');
  let dialog = await filters(page);
  const expected = {
    groupId: 'F',
    category: 'HOME',
    memberId: 'M0',
    from: '2026-10-02',
    to: '2026-10-07',
  };
  for (const key of ['groupId', 'category', 'memberId'])
    await dialog.locator(`[name=${key}]`).selectOption(expected[key]);
  for (const key of ['from', 'to'])
    await dialog.locator(`[name=${key}]`).fill(expected[key]);
  await dialog.getByRole('button', { name: 'Apply filters' }).click();
  await page.waitForURL((url) =>
    Object.entries(expected).every(
      ([key, value]) => url.searchParams.get(key) === value,
    ),
  );
  await page.locator('.ledger-description strong').first().waitFor();
  assert.deepEqual(
    await page.locator('.ledger-description strong').allTextContents(),
    ['Internet', 'Household supplies', 'Electricity'],
  );
  dialog = await filters(page);
  await dialog.locator('[name=category]').selectOption('DINING');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(
    params(page).category,
    'HOME',
    'Cancel preserves applied filters.',
  );
  dialog = await filters(page);
  await dialog
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  for (const key of Object.keys(expected))
    assert.equal(await dialog.locator(`[name=${key}]`).inputValue(), '');
  assert.equal(params(page).category, 'HOME', 'Reset is staged until Apply.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Breakdown', exact: true }).click();
  await page.locator('.expense-breakdown').waitFor();
  for (const [key, value] of Object.entries(expected))
    assert.equal(params(page)[key], value);
  await page
    .getByRole('combobox', { name: 'Chart amount' })
    .selectOption('share');
  await page.waitForURL((url) => url.searchParams.get('basis') === 'share');
  assert.match(await page.locator('.breakdown-center').innerText(), /67\.52/);
  const home = page
    .locator('.breakdown-legend button')
    .filter({ hasText: 'Home' });
  await home.click();
  assert.equal(await home.getAttribute('aria-pressed'), 'true');
  await page
    .getByRole('button', { name: 'View expenses', exact: true })
    .click();
  await page.waitForURL((url) => !url.searchParams.has('view'));
  for (const [key, value] of Object.entries(expected))
    assert.equal(params(page)[key], value);
  assert.equal(params(page).basis, 'share');
  dialog = await filters(page);
  await dialog
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await page.waitForURL((url) =>
    Object.keys(expected).every((key) => !url.searchParams.has(key)),
  );
  await page.getByRole('button', { name: 'Breakdown', exact: true }).click();
  const accommodation = page
    .locator('.breakdown-legend button')
    .filter({ hasText: 'Accommodation' });
  await accommodation.click();
  await page
    .getByRole('button', { name: 'View expenses', exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get('category') === 'ACCOMMODATION' &&
      !url.searchParams.has('view'),
  );
  assert.equal(params(page).basis, 'share');
  return snapshot(page, 'five-and-filters-and-chart');
});
test('detail-dismissal-history-focus-and-draft-resize', async (page) => {
  await ready(page, '/household/expenses');
  const row = page.locator('#ledger-expense-expense-0');
  await row.focus();
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('.expense-presentation').getAttribute('role'),
    'dialog',
  );
  await page.mouse.click(12, 400);
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await row.click();
  await page
    .getByRole('button', { name: 'Edit expense', exact: true })
    .waitFor();
  await page.goBack();
  await closedDetail(page);
  await page.waitForFunction(
    () => document.activeElement?.id === 'ledger-expense-expense-0',
  );
  await page.goForward();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  const description = page.getByRole('textbox', {
    name: 'Description',
    exact: true,
  });
  await description.fill('Draft retained across screen sizes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector('.expense-presentation')?.getAttribute('role') ===
      'region',
  );
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await snapshot(page, 'draft-resize-phone');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () =>
      document.querySelector('.expense-presentation')?.getAttribute('role') ===
      'dialog',
  );
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await page.keyboard.press('Escape');
  await closedDetail(page);
  await row.click();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  assert.equal(
    await description.inputValue(),
    'Draft retained across screen sizes',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Back to expenses', exact: true })
    .click();
  await closedDetail(page);
  return snapshot(page, 'detail-dismissal-history-focus-and-draft-resize');
});
test('system-theme-and-isolated-signout', async (page) => {
  await ready(page, '/account');
  const system = page.getByRole('radio', { name: 'System', exact: true });
  await system.focus();
  await page.keyboard.press('Space');
  assert.equal(await system.isChecked(), true);
  assert.equal(
    await page
      .getByRole('button', { name: 'Save appearance', exact: true })
      .count(),
    0,
  );
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('kami-appearance') || '{}').value ===
      'SYSTEM',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark',
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.getByRole('radio', { name: 'System', exact: true }).isChecked(),
    true,
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light',
  );
  await snapshot(page, 'system-theme-account');
  await page
    .getByRole('button', { name: 'Sign out of this session', exact: true })
    .click();
  await page.waitForURL('**/sign-in');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kami-auth')),
    null,
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kami-auth')),
    null,
    'Fixture must not reauthenticate after sign-out.',
  );
  assert.equal(
    (
      await page.request.post(origin + '/api/graphql', {
        data: { query: 'query profileQuery { currentProfile { __typename } }' },
      })
    ).status(),
    401,
  );
  return snapshot(page, 'system-theme-and-isolated-signout');
});
for (const state of ['conflict', 'recovery'])
  test(`edit-${state}`, async (page) => {
    await ready(
      page,
      '/household/expenses?expense=expense-0&expenseGroup=F',
      state,
    );
    await page
      .getByRole('button', { name: 'Edit expense', exact: true })
      .click();
    const description = page.getByRole('textbox', {
      name: 'Description',
      exact: true,
    });
    await description.fill(`Synthetic ${state} edit`);
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    if (state === 'conflict') {
      await page
        .getByRole('button', { name: 'Reload latest expense', exact: true })
        .click();
      await page
        .getByText('Weekly groceries updated by Alex', { exact: true })
        .waitFor();
      assert.equal(await description.inputValue(), 'Synthetic conflict edit');
      await snapshot(page, 'edit-conflict-before-reapply');
      await page
        .getByRole('button', {
          name: 'Reapply my draft to this version',
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .click();
    } else {
      await page
        .getByRole('button', { name: 'Recover original edit', exact: true })
        .waitFor();
      await snapshot(page, 'edit-recovery-before-recover');
      await page
        .getByRole('button', { name: 'Recover original edit', exact: true })
        .click();
    }
    await page
      .getByRole('heading', { name: `Synthetic ${state} edit`, exact: true })
      .waitFor();
    const invariant = await (
      await page.request.get(origin + '/__fixture/invariants')
    ).json();
    assert.equal(invariant.valid, true);
    assert.equal(invariant.expenseCount, '16');
    assert.equal(invariant.totalMinor, '181600');
    return { ...(await snapshot(page, `edit-${state}`)), invariant };
  });
for (const state of ['long-names', 'huge', 'denied'])
  for (const theme of ['light', 'dark'])
    test(`${state}-${theme}`, async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await ready(
        page,
        state === 'long-names' ? '/groups/F?tab=overview' : '/household',
        state,
        theme,
      );
      if (state === 'denied') {
        await page
          .getByText(/unavailable/i)
          .first()
          .waitFor();
        assert.equal(
          await page.getByText('Weekly groceries', { exact: true }).count(),
          0,
        );
      } else {
        await page.locator('.ui-summary-row').waitFor();
        if (state === 'huge') {
          const exact = '1,816,000,000,005,448.00';
          assert.ok(
            (await page.locator('.ui-summary-row').innerText()).includes(exact),
          );
        }
      }
      const result = await snapshot(page, `${state}-${theme}`);
      if (state === 'huge') {
        result.money = await longMoneyMetrics(page);
        assert.ok(
          result.money.every((item) => item.safe && !item.ellipsis),
          'Every huge exact amount must fit its owning element or expose keyboard-accessible horizontal panning, without ellipsis. ' +
            JSON.stringify(
              result.money.filter((item) => !item.safe || item.ellipsis),
            ),
        );
      }
      assert.ok(
        result.scrollWidth <= result.width,
        `${state}/${theme} horizontally overflows ${result.scrollWidth} > ${result.width}`,
      );
      const invariant = await (
        await page.request.get(origin + '/__fixture/invariants')
      ).json();
      assert.equal(invariant.valid, true);
      assert.ok(invariant.groups.every((group) => group.netMinor === '0'));
      return { ...result, invariant };
    });
async function enlargedText(page, width, theme, model, surface = 'overview') {
  await page.setViewportSize({ width, height: 844 });
  await ready(
    page,
    surface === 'activity' ? '/household/activity' : '/household',
    'complete',
    theme,
  );
  await page
    .locator(
      surface === 'activity' ? '.activity-feed-panel' : '.ui-summary-row',
    )
    .waitFor();
  const normalBodyFont = await page.evaluate(
    () => getComputedStyle(document.body).fontSize,
  );
  assert.equal(
    normalBodyFont,
    '14px',
    'Stress starts with the actual normal 14px body.',
  );
  // Explicit text-enlargement stress, not browser/pinch zoom. Snapshot original
  // computed values before applying changes so inherited styles never compound.
  if (model === 'root')
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
  else
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('body *')].filter(
        (element) =>
          element.getClientRects().length &&
          [...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          ),
      );
      const sizes = nodes.map((element) => {
        const style = getComputedStyle(element);
        return {
          element,
          font: parseFloat(style.fontSize),
          line: parseFloat(style.lineHeight),
        };
      });
      for (const { element, font, line } of sizes) {
        element.style.fontSize = font * 2 + 'px';
        if (Number.isFinite(line)) element.style.lineHeight = line * 2 + 'px';
      }
    });
  const result = await snapshot(
    page,
    `${surface === 'activity' ? 'activity-' : ''}${model}-200-${width}-${theme}`,
  );
  if (model === 'root')
    assert.equal(
      result.bodyFont,
      '28px',
      'Root 200% must really enlarge body font from 14px to 28px.',
    );
  assert.ok(
    result.scrollWidth <= result.width,
    `200% text creates horizontal document overflow: ${result.scrollWidth} > ${result.width}`,
  );
  return {
    ...result,
    normalBodyFont,
    model:
      model === 'root'
        ? 'html font-size:200%, verified actual body14px→28px; not browser/pinch zoom.'
        : 'Each rendered text node font and line-height enlarged200% from original computed values; not browser/pinch zoom.',
  };
}
for (const width of [320, 390, 768])
  for (const theme of ['light', 'dark'])
    for (const model of ['text', 'root'])
      test(`${model}-200-${width}-${theme}`, (page) =>
        enlargedText(page, width, theme, model));
for (const theme of ['light', 'dark'])
  for (const model of ['text', 'root'])
    test(`activity-${model}-200-320-${theme}`, (page) =>
      enlargedText(page, 320, theme, model, 'activity'));
(async () => {
  const health = await fetch(origin + '/__fixture/health').then((response) =>
    response.json(),
  );
  assert.equal(
    health.synthetic,
    true,
    'Interaction checks require the isolated synthetic fixture.',
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const results = [];
  try {
    for (const { name, work } of cases) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === new URL(origin).origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage(),
        errors = [],
        consoleProblems = [],
        failedResponses = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type()))
          consoleProblems.push({
            type: message.type(),
            text: message.text(),
            location: message.location(),
          });
      });
      page.on('response', (response) => {
        if (response.status() >= 400)
          failedResponses.push({
            url: response.url(),
            status: response.status(),
          });
      });
      let details, failure;
      try {
        details = await work(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(
          consoleProblems,
          [],
          'Browser console errors or warnings',
        );
        assert.deepEqual(failedResponses, [], 'Failed HTTP responses');
      } catch (error) {
        failure = error.message;
        details = await snapshot(page, `${name}-failure`).catch(() => ({}));
      }
      results.push({
        name,
        passed: !failure,
        ...(failure ? { failure } : {}),
        errors,
        consoleProblems,
        failedResponses,
        details,
      });
      console.log(
        `${failure ? 'FAIL' : 'PASS'} ${name}${failure ? ': ' + failure : ''}`,
      );
      fs.writeFileSync(
        path.join(output, 'results.json'),
        JSON.stringify(results, null, 2),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
