/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in real Go/database browser bridge. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require(
  process.env.BANKING_MANAGEMENT_PLAYWRIGHT_MODULE,
);
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const origin = process.env.BANKING_MANAGEMENT_BROWSER_ORIGIN;
const endpoint = process.env.BANKING_MANAGEMENT_ENDPOINT;
const token = process.env.BANKING_MANAGEMENT_TOKEN;
const scenario = process.env.BANKING_MANAGEMENT_SCENARIO;
const user = {
  id: process.env.BANKING_MANAGEMENT_SUBJECT,
  email: 'management-browser@example.invalid',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T00:00:00Z',
};
const session = {
  access_token: token,
  refresh_token: 'unused-fixture',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user,
};
const accounts = [
  {
    id: 'selected-checking',
    name: 'Selected checking',
    type: 'depository',
    subtype: 'checking',
  },
  {
    id: 'unselected-savings',
    name: 'Unselected bank metadata',
    type: 'depository',
    subtype: 'savings',
  },
];
withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BANKING_MANAGEMENT_CHROMIUM
      ? { executablePath: process.env.BANKING_MANAGEMENT_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 1000 },
  });
  const evidence =
    process.env.BANKING_MANAGEMENT_EVIDENCE ||
    '/private/tmp/kami-banking-management-browser';
  fs.mkdirSync(evidence, { recursive: true });
  const errors = [];
  const observed = {};
  const repairFinishes = [];
  const repairStarts = [];
  const selections = [];
  let lose;
  page.on('pageerror', (error) => errors.push(error.message));
  await seedSession(page.context(), origin, session);
  await page.addInitScript(
    ({ accounts }) => {
      window.__repairExit = false;
      window.Plaid = {
        create(options) {
          return {
            destroy() {},
            open() {
              setTimeout(() => {
                if (window.__repairExit) {
                  window.__repairExit = false;
                  options.onExit(null);
                } else options.onSuccess(null, { accounts });
              }, 0);
            },
          };
        },
      };
    },
    { accounts },
  );
  await page.route('**/api/onboarding-config', (r) =>
    r.fulfill({ json: { url: authOrigin, key: 'synthetic-public' } }),
  );
  await page.route(authOrigin + '/auth/v1/**', (r) =>
    r.fulfill({ json: r.request().url().includes('/user') ? user : session }),
  );
  // Every GraphQL result comes from Go. Lost-response cases discard a real
  // committed response; they never synthesize a successful application result.
  await page.route('**/api/graphql', async (r) => {
    const response = await r.fetch({ url: endpoint + '/graphql' });
    const result = await response.json();
    assert(
      !result.errors,
      `Unexpected GraphQL errors in ${r.request().postDataJSON().operationName || 'operation'}`,
    );
    Object.assign(observed, result.data);
    if (Object.hasOwn(result.data, 'startBankingRepair'))
      repairStarts.push(r.request().postDataJSON().variables.input);
    if (Object.hasOwn(result.data, 'changeBankingSelection'))
      selections.push(r.request().postDataJSON().variables.input);
    if (Object.hasOwn(result.data, 'finishBankingRepair'))
      repairFinishes.push(r.request().postDataJSON().variables.input);
    if (lose && Object.hasOwn(result.data, lose)) {
      lose = undefined;
      await r.abort('failed');
      return;
    }
    await r.fulfill({ response, json: result });
  });
  const checkpoint = async (name, data) => {
    const response = await page.request.post(endpoint + '/fixture/' + name, {
      headers: { Authorization: 'Bearer ' + token },
      ...(data ? { data } : {}),
    });
    assert.equal(response.status(), 204, 'Fixture checkpoint ' + name);
  };
  const click = async (name) =>
    page.getByRole('button', { name, exact: true }).click();
  const waitText = async (text) =>
    page.getByText(text, { exact: false }).first().waitFor();
  const open = async () => {
    await page.goto(origin + '/personal?tab=connections');
    const card = page
      .locator('article')
      .filter({ hasText: 'Unselected bank metadata' })
      .first();
    delete observed.bankingConnection;
    await card
      .getByRole('button', {
        name: /^(Repair \/ manage accounts|Manage accounts)$/,
      })
      .click();
    await page.getByRole('dialog', { name: 'Manage connection' }).waitFor();
    await page
      .getByRole('group', { name: 'Selected accounts', exact: true })
      .waitFor();
    await expect
      .poll(() => observed.bankingConnection?.connection?.id)
      .toBe(process.env.BANKING_MANAGEMENT_CONNECTION);
  };
  const screenshot = async (label) => {
    const dialogs = page.getByRole('dialog');
    const metrics = (await dialogs.count())
      ? await dialogs.last().evaluate((element) => {
          const rect = (value) => {
            if (!value) return null;
            const r = value.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
              width: r.width,
              height: r.height,
            };
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            dialog: rect(element),
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            title: rect(element.querySelector('h2')),
            focused: rect(document.activeElement),
          };
        })
      : { dialog: null };
    fs.writeFileSync(
      path.join(evidence, scenario + '-' + label + '-viewport.json'),
      JSON.stringify(metrics, null, 2),
    );
    await page.screenshot({
      path: path.join(evidence, scenario + '-' + label + '-viewport.png'),
      fullPage: false,
    });
  };
  try {
    await open();
    if (scenario === 'lifecycle') {
      const savings = () =>
        page.getByRole('checkbox', { name: /^Unselected bank metadata/ });
      assert(await savings().isChecked());
      await savings().uncheck();
      await click('Cancel');
      await open();
      assert(
        await savings().isChecked(),
        'Cancel must preserve persisted selection',
      );
      await page.evaluate(() => (window.__repairExit = true));
      await click('Reconnect with Plaid');
      await waitText('Repair canceled.');
      await checkpoint('retained');
      assert(
        await savings().isChecked(),
        'Canceled provider flow must preserve selection',
      );
      await checkpoint('expire-repair');
      await click('Cancel');
      await click('Check repair outcome');
      await waitText('Repair this connection before adding accounts.');
      await open();
      await click('Reconnect with Plaid');
      await waitText('Link success alone is not renewed consent');
      assert(await savings().isChecked());
      lose = 'finishBankingRepair';
      await click('Apply repair');
      await waitText('The response was lost or unavailable.');
      assert.equal(observed.finishBankingRepair.code, 'READY');
      await expect(savings()).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Apply repair', exact: true }),
      ).toBeDisabled();
      await savings().evaluate((element) => element.click());
      await page
        .getByRole('button', { name: 'Apply repair', exact: true })
        .evaluate((element) => element.click());
      assert.equal(
        repairFinishes.length,
        1,
        'Ambiguous repair cannot resend changed input',
      );
      assert.equal(repairFinishes[0].accountIds.length, 2);
      await screenshot('uncertain-repair-finish');
      await click('Cancel');
      await click('Check repair outcome');
      await expect.poll(() => observed.bankingRepair?.code).toBe('READY');
      assert.equal(
        observed.bankingRepair.attemptId,
        repairFinishes[0].attemptId,
      );
      await open();
      assert(
        await savings().isChecked(),
        'Original committed repair selection survives recovery',
      );
      await checkpoint('retained');
      await savings().uncheck();
      lose = 'changeBankingSelection';
      await click('Apply selection');
      await waitText('The response was lost or unavailable.');
      await screenshot('uncertain-selection');
      await click('Cancel');
      await click('Check management outcome');
      await expect.poll(() => observed.bankingOperation?.code).toBe('READY');
      assert.equal(observed.bankingOperation.code, 'READY');
      await open();
      assert(
        !(await savings().isChecked()),
        'Recovered selection must survive reload',
      );
      await checkpoint('selection');
      await page.getByText('Disconnect & history', { exact: true }).click();
      await click('Disconnect');
      await screenshot('disconnect-confirmation');
      await click('Keep connection');
      await click('Disconnect');
      await click('Confirm disconnect');
      await waitText('The local change is confirmed.');
      assert.equal(observed.disconnectBanking.code, 'READY');
      await checkpoint('retained');
      await click('Reload current state');
      await open();
      await waitText('Provider removal: pending.');
      await screenshot('disconnect-pending');
      await page.getByText('Disconnect & history', { exact: true }).click();
      await click('Delete connection and history');
      await waitText(
        'irreversibly delete affected current, staged and archived',
      );
      await screenshot('delete-confirmation');
      await click('Confirm deletion');
      await waitText('The local change is confirmed.');
      assert.equal(observed.deleteBankingHistory.code, 'READY');
    } else if (scenario === 'repair-failure') {
      const savings = () =>
        page.getByRole('checkbox', { name: /^Unselected bank metadata/ });
      const pending = (kind) =>
        page.evaluate(
          (kind) =>
            Object.entries(sessionStorage).find(([key]) =>
              key.endsWith(':manage:' + kind),
            )?.[1] ?? null,
          kind,
        );
      await click('Reconnect with Plaid');
      await waitText('This new attempt was not reserved.');
      assert.equal(observed.startBankingRepair.code, 'ATTEMPT_IN_PROGRESS');
      assert.equal(observed.startBankingRepair.state, null);
      assert.equal(observed.startBankingRepair.attemptId, null);
      assert.equal(await pending('repair'), null);
      await checkpoint('unreserved', {
        attemptId: repairStarts.at(-1).attemptId,
      });
      await checkpoint('expire-repair');
      await click('Cancel');
      await open();
      await checkpoint('provider-prepare-failure');
      await click('Reconnect with Plaid');
      await waitText('Repair this connection before adding accounts.');
      assert.equal(observed.startBankingRepair.state, 'complete');
      assert.equal(await pending('repair'), null);
      await checkpoint('completed-repair', {
        attemptId: repairStarts.at(-1).attemptId,
      });
      await checkpoint('provider-ready');
      await click('Cancel');
      await open();
      await click('Reconnect with Plaid');
      await waitText('Link success alone is not renewed consent');
      await checkpoint('provider-failure');
      await click('Apply repair');
      await waitText('Repair this connection before adding accounts.');
      const original = repairFinishes.at(-1).attemptId;
      assert.equal(observed.finishBankingRepair.code, 'REPAIR_REQUIRED');
      assert.equal(observed.finishBankingRepair.state, null);
      assert.equal(observed.finishBankingRepair.attemptId, null);
      assert.equal(await pending('repair'), original);
      await expect(savings()).toBeDisabled();
      await checkpoint('prepared-repair', { attemptId: original });
      await checkpoint('retained');
      await screenshot('provider-failure-prepared');
      await click('Cancel');
      await click('Check repair outcome');
      await expect.poll(() => observed.bankingRepair?.code).toBe('PREPARED');
      assert.equal(observed.bankingRepair.state, 'prepared');
      assert.equal(await pending('repair'), original);
      await checkpoint('expire-repair');
      await click('Check repair outcome');
      await expect
        .poll(() => observed.bankingRepair?.code)
        .toBe('REPAIR_REQUIRED');
      assert.equal(observed.bankingRepair.state, 'prepared');
      assert.equal(await pending('repair'), null);
      await checkpoint('provider-ready');
      await open();
      await click('Reconnect with Plaid');
      await waitText('Link success alone is not renewed consent');
      assert.notEqual(repairStarts.at(-1).attemptId, original);
      await click('Apply repair');
      await waitText('The local change is confirmed.');
      assert.equal(observed.finishBankingRepair.state, 'complete');
      await click('Close management');
      await open();
      await savings().uncheck();
      await click('Apply selection');
      await waitText('The local change is confirmed.');
      await click('Close management');
      await open();
      await checkpoint('provider-missing-account');
      await savings().check();
      lose = 'changeBankingSelection';
      await click('Apply selection');
      await waitText('The response was lost or unavailable.');
      const invalid = selections.at(-1).attemptId;
      assert.equal(observed.changeBankingSelection.code, 'INVALID_SELECTION');
      await checkpoint('terminal-selection', { attemptId: invalid });
      await checkpoint('selection');
      await click('Cancel');
      await click('Check management outcome');
      await expect
        .poll(() => observed.bankingOperation?.code)
        .toBe('INVALID_SELECTION');
      assert.equal(await pending('management'), null);
      await checkpoint('provider-ready');
      await open();
      assert(
        !(await savings().isChecked()),
        'Invalid selection must preserve saved subset',
      );
      await savings().check();
      await click('Apply selection');
      await waitText('The local change is confirmed.');
      assert.notEqual(selections.at(-1).attemptId, invalid);
      await checkpoint('retained');
      await click('Close management');
      await open();
      await checkpoint('delete-from-other-device');
      await click('Authorize account additions');
      await waitText('The connection or preview changed.');
      assert.equal(observed.startBankingRepair.code, 'CONFLICT');
      assert.equal(observed.startBankingRepair.state, null);
      assert.equal(await pending('repair'), null);
      await checkpoint('unreserved', {
        attemptId: repairStarts.at(-1).attemptId,
      });
      await click('Reload current state');
      await expect(
        page.getByRole('button', { name: 'Manage connection', exact: true }),
      ).toHaveCount(0);
    } else {
      const replacement = () =>
        page.getByRole('button', {
          name: 'Replacement and recovery — Selected checking',
          exact: true,
        });
      await page.getByText('Disconnect & history', { exact: true }).click();
      await replacement().click();
      await click('Replace existing');
      await page.getByRole('radio', { name: /Selected checking/ }).check();
      await page.getByLabel('Posted-bank transition date D').fill('2026-09-30');
      await click('Preview transition');
      await page
        .getByRole('region', { name: 'Transition impact preview' })
        .waitFor();
      assert.equal(observed.bankingReplacementPreview.code, 'READY');
      assert.equal(observed.bankingReplacementPreview.prior.count, 1);
      assert.equal(observed.bankingReplacementPreview.retained.count, 1);
      assert.equal(observed.bankingReplacementPreview.new.count, 1);
      assert.equal(observed.bankingReplacementPreview.proposed.count, 2);
      assert.equal(
        observed.bankingReplacementPreview.proposed.spendingMinor,
        '6250',
      );
      assert.equal(
        observed.bankingReplacementPreview.retained.annotationCount,
        1,
      );
      await checkpoint('conflict');
      await click('Confirm transition');
      await waitText('The connection or preview changed.');
      assert.equal(observed.confirmBankingReplacement.code, 'CONFLICT');
      await screenshot('version-conflict');
      await click('Preview transition');
      await waitText('Reporting impact preview');
      lose = 'confirmBankingReplacement';
      await click('Confirm transition');
      await waitText('The response was lost or unavailable.');
      await screenshot('uncertain-transition');
      await page
        .getByRole('button', { name: 'Close Manage connection', exact: true })
        .click();
      await click('Check transition / recovery outcome');
      await expect
        .poll(() => observed.bankingReplacementOperation?.code)
        .toBe('READY');
      assert.equal(observed.bankingReplacementOperation.code, 'READY');
      await open();
      await page.getByText('Disconnect & history', { exact: true }).click();
      await replacement().click();
      await click('Restore preceding plan');
      await click('Preview recovery');
      await waitText('Reporting impact preview');
      assert.equal(observed.bankingReplacementPreview.code, 'READY');
      await screenshot('recovery-preview');
      await click('Confirm recovery');
      await waitText('The local change is confirmed.');
      assert.equal(observed.confirmBankingReplacement.code, 'READY');
    }
    // Same-group membership grants no private bank read. A new verified actor
    // must receive an empty real inventory and discard the previous actor's view.
    session.access_token = process.env.BANKING_MANAGEMENT_OTHER_TOKEN;
    user.id = process.env.BANKING_MANAGEMENT_OTHER_SUBJECT;
    await seedSession(page.context(), origin, session);
    await page.goto(origin + '/personal?tab=connections');
    await page
      .getByRole('heading', { name: 'No connected accounts yet', exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('Selected checking', { exact: true }).count(),
      0,
    );
    assert.deepEqual(observed.bankingConnections.connections, []);
    assert.deepEqual(errors, []);
    console.log(
      scenario +
        ': production UI -> verified Go GraphQL -> restricted PostgreSQL passed; deterministic provider and imported facts only',
    );
  } finally {
    await screenshot('final');
    await browser.close();
  }
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
