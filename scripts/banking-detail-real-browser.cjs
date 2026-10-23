/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in real API/database browser runner. */
// Run through TestBankingDetailRealBrowserJourney with an owned production
// preview whose Auth URL matches BROWSER_AUTH_ORIGIN. Only Auth is synthetic;
// financial GraphQL reads/writes reach the restricted-role Go HTTP fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium, expect } = require(
  process.env.BANKING_DETAIL_PLAYWRIGHT_MODULE || '@playwright/test',
);
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const origin = process.env.BANKING_DETAIL_BROWSER_ORIGIN;
const endpoint = process.env.BANKING_DETAIL_BROWSER_ENDPOINT;
const token = process.env.BANKING_DETAIL_BROWSER_TOKEN;
const source = process.env.BANKING_DETAIL_BROWSER_SOURCE;
const account = process.env.BANKING_DETAIL_BROWSER_ACCOUNT;
for (const value of [origin, endpoint, authOrigin]) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:');
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Only owned loopback services are supported',
  );
}
const user = {
  id: process.env.BANKING_DETAIL_BROWSER_SUBJECT,
  email: 'bank-detail-browser@example.invalid',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-23T00:00:00Z',
};
const session = {
  access_token: token,
  refresh_token: 'unused-local-fixture',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user,
};
const rowFields =
  'sourceId sourceRevision materialRevision annotationRevision amountMinor bankDate authorizationDate note excluded activity activityOverride current categoryOverride reviewed';
const detailFields = `{code currentId transaction{${rowFields}}}`;
const resultFields = `{code sourceId detail${detailFields}}`;
const filter = {
  period: 'CUSTOM',
  start: '2024-02-01',
  end: '2024-02-29',
  accountIds: [account],
};
async function graphql(query, variables = {}, bearer = token) {
  const response = await fetch(endpoint + '/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + bearer,
    },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.errors,
    undefined,
    'Real API must complete its domain contract',
  );
  return result.data;
}
async function current() {
  const data = await graphql(
    `query($source:ID!){bankingTransaction(sourceId:$source)${detailFields}}`,
    { source },
  );
  assert.equal(data.bankingTransaction.code, 'READY');
  return data.bankingTransaction.transaction;
}
async function report() {
  const data = await graphql(
    'query($filter:BankingReportFilter!){bankingReport(filter:$filter,first:50){code totalCount hasNextPage summary{netMinor} rows{sourceId}}}',
    { filter },
  );
  assert.equal(data.bankingReport.code, 'READY');
  return data.bankingReport;
}
async function edit(row, field, value, bearer = token) {
  const input = {
    attemptId: randomUUID(),
    sourceId: source,
    sourceRevision: row.sourceRevision,
    materialRevision: row.materialRevision,
    expectedRevision: row.annotationRevision,
    field,
    value,
  };
  const data = await graphql(
    `mutation($input:BankingAnnotationInput!){editBankingAnnotation(input:$input)${resultFields}}`,
    { input },
    bearer,
  );
  return data.editBankingAnnotation;
}
const listHref =
  '/personal?' +
  new URLSearchParams({
    tab: 'transactions',
    period: 'custom',
    start: filter.start,
    end: filter.end,
    account,
  });
const evidence =
  process.env.BANKING_DETAIL_BROWSER_EVIDENCE ||
  '/private/tmp/kami-banking-detail-browser';
fs.mkdirSync(evidence, { recursive: true });

withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  let stage = 'filtered read and immutable facts';
  let loseNextSave = false;
  const writes = [],
    recoveries = [],
    reports = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedSession(page.context(), origin, session);
  await page.route('**/api/onboarding-config', (route) =>
    route.fulfill({ json: { url: authOrigin, key: 'synthetic-public' } }),
  );
  await page.route('**/api/graphql', async (route) => {
    const request = route.request().postDataJSON();
    const response = await route.fetch({ url: endpoint + '/graphql' });
    const result = await response.json();
    if (
      request.query.includes('mutation personalTransactionAnnotationMutation')
    ) {
      writes.push({
        input: request.variables.input,
        result: result.data?.editBankingAnnotation,
      });
      if (loseNextSave) {
        loseNextSave = false;
        assert.equal(
          result.data?.editBankingAnnotation?.code,
          'READY',
          'Lose only a response whose actual commit is known',
        );
        await route.abort('failed');
        return;
      }
    }
    if (
      request.query.includes('query personalTransactionAnnotationRecoveryQuery')
    )
      recoveries.push({
        variables: request.variables,
        result: result.data?.bankingAnnotationOperation,
      });
    if (result.data?.bankingReport) reports.push(result.data.bankingReport);
    await route.fulfill({ response, json: result });
  });
  const editButton = page.getByRole('button', { name: 'Edit', exact: true });
  const saveButton = page.getByRole('button', {
    name: 'Save changes',
    exact: true,
  });
  async function save() {
    await saveButton.click();
    await editButton.waitFor();
  }
  async function open() {
    await page
      .getByRole('link', { name: 'Exact private purchase', exact: true })
      .click();
    await editButton.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('transaction'), source);
  }
  async function back(expectedNet) {
    await page
      .getByRole('button', { name: 'Back to transactions', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Account activity', exact: true })
      .waitFor();
    const summary = page.getByText('Spending from your accounts:', {
      exact: false,
    });
    await expect(summary).toContainText(expectedNet);
    for (const [key, value] of Object.entries({
      period: 'custom',
      start: filter.start,
      end: filter.end,
      account,
    }))
      assert.equal(new URL(page.url()).searchParams.get(key), value);
  }
  try {
    const initial = await report();
    assert.equal(initial.totalCount, 64);
    assert.equal(initial.rows.length, 50);
    assert.equal(initial.hasNextPage, true);
    assert.equal(initial.summary.netMinor, '12000');
    await page.goto(origin + listHref);
    await page
      .getByRole('heading', { name: 'Account activity', exact: true })
      .waitFor();
    await open();
    assert.equal(
      await page.getByLabel('Private note', { exact: true }).count(),
      0,
      'Detail opens read-only',
    );
    assert.equal(
      await page.locator('input[type="number"], input[type="date"]').count(),
      0,
      'Bank amount/date are immutable',
    );
    await expect(
      page.getByText('Posted bank date', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Authorization date', { exact: true }),
    ).toBeVisible();
    const detail = page.getByRole('dialog', {
      name: 'Transaction detail',
      exact: true,
    });
    await expect(detail.locator('[data-ui~="money-value"]').first()).toHaveText(
      '$100.00',
    );
    await expect(detail.getByText('2024-02-29', { exact: true })).toBeVisible();
    await expect(detail.getByText('2024-02-27', { exact: true })).toBeVisible();
    stage = 'private note persistence and reload';
    await editButton.click();
    await page
      .getByLabel('Private note', { exact: true })
      .fill('Persisted private browser note');
    await save();
    await page.reload();
    await editButton.waitFor();
    await expect(
      page.getByText('Persisted private browser note', { exact: true }),
    ).toBeVisible();
    assert.equal((await current()).note, 'Persisted private browser note');

    stage = 'complete exclusion summaries';
    await editButton.click();
    await page.getByLabel('Exclude from spending', { exact: true }).check();
    await save();
    await back('$20.00');
    assert.equal((await report()).summary.netMinor, '2000');
    assert(
      reports.some(
        (value) =>
          value.summary?.netMinor === '2000' &&
          value.rows.length === 50 &&
          value.totalCount === 64,
      ),
      'Reconciliation must fetch a complete server summary while only one page is loaded',
    );
    await open();
    await editButton.click();
    await page.getByLabel('Exclude from spending', { exact: true }).uncheck();
    await save();
    await back('$120.00');

    stage = 'complete activity classification summaries';
    await open();
    await editButton.click();
    await page
      .getByLabel('Activity type', { exact: true })
      .selectOption('transfer');
    await save();
    await back('$20.00');
    assert.equal((await report()).summary.netMinor, '2000');
    await open();
    await editButton.click();
    await page
      .getByRole('button', { name: 'Reset activity type', exact: true })
      .click();
    await save();
    await back('$120.00');

    // A real second writer advances the annotation version after the form opens.
    stage = 'concurrent annotation conflict';
    await open();
    await editButton.click();
    await page
      .getByLabel('Private note', { exact: true })
      .fill('Kept conflict draft');
    assert.equal(
      (await edit(await current(), 'NOTE', 'Concurrent private note')).code,
      'READY',
    );
    await saveButton.click();
    await page
      .getByRole('button', { name: 'Check current record', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Use current versions', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('Private note', { exact: true }).inputValue(),
      'Kept conflict draft',
    );
    await save();
    assert.equal((await current()).note, 'Kept conflict draft');

    // Discard only the HTTP response after the actual API commit, then recover
    // its original durable attempt. No simulated success payload is returned.
    stage = 'lost committed response recovery';
    await editButton.click();
    await page
      .getByLabel('Private note', { exact: true })
      .fill('Recovered original save');
    loseNextSave = true;
    await saveButton.click();
    await page
      .getByRole('button', { name: 'Check original save', exact: true })
      .click();
    await editButton.waitFor();
    assert.equal(recoveries.at(-1)?.result?.code, 'READY');
    assert.equal(
      recoveries.at(-1)?.variables.attemptId,
      writes.at(-1)?.input.attemptId,
      'Recovery uses the exact original attempt',
    );
    assert.equal(
      writes.filter(
        (write) => write.input?.attemptId === writes.at(-1).input.attemptId,
      ).length,
      1,
      'Committed original save is not written again',
    );
    const persisted = await current();
    assert.equal(persisted.note, 'Recovered original save');
    assert.equal(persisted.annotationRevision, '8');
    assert.equal(persisted.amountMinor, '10000');
    assert.equal(persisted.bankDate, '2024-02-29');
    assert.equal(persisted.authorizationDate, '2024-02-27');
    assert.equal((await report()).summary.netMinor, '12000');
    stage = 'foreign actor isolation and return focus';
    const foreignToken = process.env.BANKING_DETAIL_BROWSER_FOREIGN_TOKEN;
    const foreign = await graphql(
      `query($source:ID!){bankingTransaction(sourceId:$source)${detailFields}}`,
      { source },
      foreignToken,
    );
    assert.equal(foreign.bankingTransaction.code, 'NOT_FOUND');
    assert.equal(foreign.bankingTransaction.transaction, null);
    assert.equal(
      (await edit(persisted, 'NOTE', 'Foreign actor note', foreignToken)).code,
      'NOT_FOUND',
    );
    assert.equal((await current()).note, 'Recovered original save');
    await page.screenshot({
      path: path.join(evidence, 'real-detail-mobile.png'),
      fullPage: true,
    });
    await back('$120.00');
    await expect(
      page.getByRole('link', { name: 'Exact private purchase', exact: true }),
    ).toBeFocused();
    stage = 'current and archive-only edit ownership';
    const archive = process.env.BANKING_DETAIL_BROWSER_ARCHIVE;
    const archiveSource = process.env.BANKING_DETAIL_BROWSER_ARCHIVE_SOURCE;
    const archiveURL = new URL(origin + listHref);
    archiveURL.searchParams.set('archive', archive);
    archiveURL.searchParams.set('end', '2024-03-01');
    await page.goto(archiveURL.href);
    await page
      .getByRole('heading', { name: 'Captured account activity', exact: true })
      .waitFor();
    await page
      .getByRole('link', { name: 'Exact private purchase', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'View current record', exact: true })
      .click();
    await editButton.waitFor();
    assert.equal(
      new URL(page.url()).searchParams.has('archive'),
      false,
      'A captured current source has one current edit owner',
    );
    await page.goto(archiveURL.href);
    await page
      .getByRole('link', { name: 'Archived-only transaction', exact: true })
      .click();
    await editButton.click();
    await page
      .getByLabel('Private note', { exact: true })
      .fill('Latest archive-only private note');
    await save();
    await page.reload();
    await editButton.waitFor();
    await expect(
      page.getByText('Latest archive-only private note', { exact: true }),
    ).toBeVisible();
    const archived = await graphql(
      'query($source:ID!,$archive:ID!){bankingTransaction(sourceId:$source,archiveId:$archive){code currentId transaction{note current archives{annotation{note revision}}}}}',
      { source: archiveSource, archive },
    );
    assert.equal(archived.bankingTransaction.code, 'READY');
    assert.equal(archived.bankingTransaction.currentId, null);
    assert.equal(archived.bankingTransaction.transaction.current, false);
    assert.equal(
      archived.bankingTransaction.transaction.note,
      'Latest archive-only private note',
    );
    assert.equal(
      archived.bankingTransaction.transaction.archives[0].annotation.note,
      'Original captured private note',
    );
    assert.equal(
      (await report()).summary.netMinor,
      '12000',
      'Archive edits never alter current spending',
    );
    const deniedArchive = await graphql(
      'query($source:ID!,$archive:ID!){bankingTransaction(sourceId:$source,archiveId:$archive){code currentId transaction{sourceId}}}',
      { source: archiveSource, archive },
      foreignToken,
    );
    assert.equal(deniedArchive.bankingTransaction.code, 'NOT_FOUND');
    assert.equal(deniedArchive.bankingTransaction.transaction, null);
    await page.screenshot({
      path: path.join(evidence, 'real-detail-archive-only.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      'Real HTTP/database detail: filtered 50/64 rows, immutable exact facts, note persistence/reload, complete exclusion/classification totals, conflict input retention, original-attempt lost-response recovery, foreign-actor read/write denial, return focus and current/archive edit ownership passed.',
    );
  } catch (error) {
    console.error('Failed real banking detail stage: ' + stage);
    await page
      .screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
