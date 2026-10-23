// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import type { PlaidSDK } from './plaid-link';
import { Management } from './management';
import { ManagementRecovery } from './management-attempt';
import { exactUSD, validPostedDate } from './replacement';
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
let root: Root, host: HTMLDivElement, scope: FinancialScope, live: boolean;
let config: Parameters<PlaidSDK['create']>[0];
const requests: Request[] = [];
const changed = vi.fn(),
  destroy = vi.fn(),
  open = vi.fn();
const account = (id: string, selected: boolean) => ({
  __typename: 'BankingAccount',
  id: `logical-${id}`,
  streamId: `stream-${id}`,
  name: `Private ${id}`,
  kind: 'checking',
  currency: 'USD',
  selected,
  providerAccountId: id,
  importStatus: {
    __typename: 'BankingImportStatus',
    reportingState: 'CURRENT',
    collection: 'COLLECTING',
    discrepancyCount: '0',
  },
});
const connection = {
  __typename: 'BankingConnection',
  id: 'connection',
  institutionName: 'A very long Community Credit Union institution name',
  state: 'active',
  permission: 'granted',
  generation: '9007199254740993',
  health: 'healthy',
  cleanup: 'not_requested',
  purge: 'not_requested',
  accounts: [account('checking', true), account('savings', false)],
};
function button(text: string) {
  const found = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => {
    const target = button(text),
      disclosure = target.closest('details');
    if (disclosure && !disclosure.open)
      disclosure.querySelector('summary')?.click();
    target.click();
  });
}
async function reply(name: string, data: unknown) {
  const request = requests.findLast((r) => r.name === name);
  if (!request) throw new Error(`Missing request ${name}`);
  await act(async () => request.next(data));
  return request;
}
async function manage() {
  await click('Manage accounts');
  await reply('managementConnectionQuery', {
    bankingConnection: {
      __typename: 'BankingConnectionResult',
      code: 'READY',
      connection,
    },
  });
}
function checkboxes() {
  return [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  requests.length = 0;
  live = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => live,
    environment: queryEnvironment((r) => requests.push(r)),
  } as FinancialScope;
  window.Plaid = {
    create: vi.fn((options) => {
      config = options;
      return { open, destroy };
    }),
  };
  root = relayRoot(createRoot(host), () => scope);
  await act(async () =>
    root.render(
      <>
        <Management
          scope={scope}
          connectionId="connection"
          needsRepair={false}
          onChanged={changed}
        />
        <ManagementRecovery scope={scope} onChanged={changed} />
      </>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.Plaid;
  vi.restoreAllMocks();
});
it('reads the exact fresh generation, preserves cancellation and submits only explicit selected accounts', async () => {
  await manage();
  expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
  await act(async () => checkboxes()[1].click());
  await click('Cancel');
  expect(changed).not.toHaveBeenCalled();
  await manage();
  expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
  await act(async () => checkboxes()[0].click());
  await click('Apply selection');
  expect(requests.at(-1)?.variables.input).toEqual({
    attemptId: expect.any(String),
    connectionId: 'connection',
    expectedGeneration: '9007199254740993',
    accountIds: [],
  });
  await reply('managementSelectionMutation', {
    changeBankingSelection: {
      __typename: 'BankingManagementResult',
      code: 'READY',
    },
  });
  expect(host.textContent).toContain('local change is confirmed');
  expect(host.textContent).toContain('pending removal is not complete');
});
it.each(['Close management', 'Escape'])(
  'refreshes confirmed inventory when dismissed with %s',
  async (dismiss) => {
    await manage();
    await act(async () => checkboxes()[1].click());
    await click('Apply selection');
    await reply('managementSelectionMutation', {
      changeBankingSelection: {
        __typename: 'BankingManagementResult',
        code: 'READY',
      },
    });
    expect(changed).not.toHaveBeenCalled();
    if (dismiss === 'Escape') {
      await act(async () =>
        host
          .querySelector('dialog')!
          .dispatchEvent(
            new Event('cancel', { cancelable: true, bubbles: true }),
          ),
      );
    } else await click(dismiss);
    expect(host.querySelector('dialog')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  },
);
it('retains unresolved recovery context after dismissing a lost response', async () => {
  await manage();
  await act(async () => checkboxes()[1].click());
  await click('Apply selection');
  await act(async () => requests.at(-1)!.error());
  await act(async () =>
    host
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true })),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).toContain(
    'earlier connection change has an unresolved outcome',
  );
  expect(button('Check management outcome')).toBeDefined();
  expect(host.textContent).not.toContain('local change is confirmed');
});
it('prevents duplicate submissions and recovers a lost response with the original ID without resending', async () => {
  await manage();
  await act(async () => checkboxes()[1].click());
  await click('Apply selection');
  const original = requests.at(-1)!;
  await click('Apply selection');
  expect(
    requests.filter((r) => r.name === 'managementSelectionMutation'),
  ).toHaveLength(1);
  await act(async () => original.error());
  expect(host.textContent).toContain('response was lost');
  expect(JSON.stringify(sessionStorage)).not.toContain('Private checking');
  await click('Check management outcome');
  expect(requests.at(-1)?.variables).toEqual({
    attemptId: (original.variables.input as { attemptId: string }).attemptId,
  });
  await reply('managementOperationQuery', {
    bankingOperation: {
      __typename: 'BankingManagementResult',
      code: 'NOT_FOUND',
    },
  });
  expect(host.textContent).toContain('does not prove failure');
  await click('Apply selection');
  expect(
    requests.filter((r) => r.name === 'managementSelectionMutation'),
  ).toHaveLength(1);
});
it('keeps changed selection on a conflict and requires an explicit new baseline', async () => {
  await manage();
  await act(async () => checkboxes()[1].click());
  await click('Apply selection');
  await reply('managementSelectionMutation', {
    changeBankingSelection: { code: 'CONFLICT' },
  });
  expect(checkboxes()[1].checked).toBe(true);
  expect(host.textContent).toContain('Reload its current state');
  expect(
    requests.filter((r) => r.name === 'managementConnectionQuery'),
  ).toHaveLength(1);
});
it('does not disclose cached accounts when the current authorized connection read fails', async () => {
  await click('Manage accounts');
  await reply('managementConnectionQuery', {
    bankingConnection: { code: 'NOT_FOUND', connection: null },
  });
  expect(host.textContent).not.toContain('Private checking');
  expect(host.textContent).not.toContain('Community Credit Union');
  expect(host.textContent).toContain('Private connection unavailable');
});
async function repair() {
  await manage();
  await click('Authorize account additions');
  const attemptId = (requests.at(-1)?.variables.input as { attemptId: string })
    .attemptId;
  await reply('managementRepairStartMutation', {
    startBankingRepair: {
      code: 'PREPARED',
      state: 'prepared',
      attemptId,
      linkToken: 'private-link-token',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  });
  expect(open).toHaveBeenCalledOnce();
  expect(host.querySelector('dialog[open]')).toBeNull();
  return attemptId;
}
it('repair filters eligibility, never selects a new account implicitly, sends no public token and ignores duplicate callbacks', async () => {
  const attemptId = await repair();
  await act(async () => {
    config.onSuccess('never-exchange-this', {
      accounts: [
        {
          id: 'checking',
          name: 'Private checking',
          type: 'depository',
          subtype: 'checking',
        },
        {
          id: 'new',
          name: 'New savings',
          type: 'depository',
          subtype: 'savings',
        },
        {
          id: 'bad',
          name: 'Investment',
          type: 'investment',
          subtype: 'brokerage',
        },
      ],
    });
    config.onSuccess('duplicate', { accounts: [] });
  });
  expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
  expect(host.textContent).not.toContain('Investment');
  await click('Apply repair');
  expect(requests.at(-1)?.variables).toEqual({
    input: { attemptId, accountIds: ['checking'] },
  });
  await reply('managementRepairFinishMutation', {
    finishBankingRepair: { code: 'READY', attemptId, state: 'complete' },
  });
  expect(
    requests.filter((r) => r.name === 'enrollmentFinishMutation'),
  ).toHaveLength(0);
});
it('freezes an ambiguous repair finish and recovers its original receipt without changed-input retry', async () => {
  const attemptId = await repair();
  await act(async () =>
    config.onSuccess('unused-token', {
      accounts: [
        {
          id: 'checking',
          name: 'Private checking',
          type: 'depository',
          subtype: 'checking',
        },
        {
          id: 'savings',
          name: 'Private savings',
          type: 'depository',
          subtype: 'savings',
        },
      ],
    }),
  );
  await act(async () => checkboxes()[1].click());
  await click('Disconnect');
  await click('Apply repair');
  const original = requests.at(-1)!;
  expect(original.variables.input).toEqual({
    attemptId,
    accountIds: ['checking', 'savings'],
  });
  // The server may have committed before the response was lost.
  await act(async () => original.error());
  expect(host.textContent).toContain('response was lost');
  expect(checkboxes().every((c) => c.matches(':disabled'))).toBe(true);
  expect(button('Apply repair').disabled).toBe(true);
  expect(button('Confirm disconnect').disabled).toBe(true);
  await click('Confirm disconnect');
  expect(requests.some((r) => r.name === 'managementDisconnectMutation')).toBe(
    false,
  );
  await act(async () => checkboxes()[1].click());
  await click('Apply repair');
  expect(checkboxes().map((c) => c.checked)).toEqual([true, true]);
  expect(
    requests.filter((r) => r.name === 'managementRepairFinishMutation'),
  ).toHaveLength(1);
  expect(
    sessionStorage.getItem('kami-personal-enrollment:alice:manage:repair'),
  ).toBe(attemptId);
  await click('Cancel');
  await click('Check repair outcome');
  expect(requests.at(-1)?.variables).toEqual({ attemptId });
  await reply('managementRepairQuery', {
    bankingRepair: {
      __typename: 'BankingRepairResult',
      code: 'READY',
      attemptId,
      state: 'complete',
    },
  });
  expect(changed).toHaveBeenCalledOnce();
  expect(
    sessionStorage.getItem('kami-personal-enrollment:alice:manage:repair'),
  ).toBeNull();
});
it('canceled repair keeps saved selection and does not claim unchanged provider permission', async () => {
  await repair();
  await act(async () => config.onExit(null));
  expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
  expect(host.textContent).toContain('Provider permissions may have changed');
  expect(
    requests.filter((r) => r.name === 'managementRepairFinishMutation'),
  ).toHaveLength(0);
});
it('late provider success after closing the owner cannot submit or expose accounts', async () => {
  await repair();
  await act(async () => root.render(<p>Another actor</p>));
  await act(async () =>
    config.onSuccess('late', {
      accounts: [
        {
          id: 'secret',
          name: 'Sensitive account',
          type: 'depository',
          subtype: 'checking',
        },
      ],
    }),
  );
  expect(host.textContent).toBe('Another actor');
  expect(destroy).toHaveBeenCalled();
  expect(
    requests.filter((r) => r.name === 'managementRepairFinishMutation'),
  ).toHaveLength(0);
});
it('requires separate disconnect/delete confirmation and names current staged/archive scope without claiming completed cleanup', async () => {
  await manage();
  await click('Disconnect');
  expect(
    requests.filter((r) => r.name === 'managementDisconnectMutation'),
  ).toHaveLength(0);
  expect(host.textContent).toContain(connection.institutionName);
  await click('Keep connection');
  await click('Delete connection and history');
  expect(host.textContent).toContain('current, staged and archived');
  await click('Confirm deletion');
  const input = requests.at(-1)?.variables.input;
  expect(input).toMatchObject({
    connectionId: 'connection',
    expectedGeneration: connection.generation,
  });
  await reply('managementDeleteMutation', {
    deleteBankingHistory: { code: 'PENDING' },
  });
  expect(host.textContent).not.toContain('local change is confirmed');
  expect(host.textContent).toContain('outcome is not confirmed');
});
it('uses real nonfuture bank dates including leap/year boundaries and exact signed cents', () => {
  expect(validPostedDate('2024-02-29', '2026-10-22')).toBe(true);
  expect(validPostedDate('0001-01-01', '2026-10-22')).toBe(true);
  for (const date of [
    '2025-02-29',
    '2026-02-30',
    '0000-01-01',
    '2026-10-23',
    '2026-1-01',
  ])
    expect(validPostedDate(date, '2026-10-22')).toBe(false);
  expect(exactUSD('9007199254740991')).toBe('$90,071,992,547,409.91 USD');
  expect(exactUSD('-50')).toBe('-$0.50 USD');
});

async function recoveryPanel() {
  await manage();
  await click('Replacement and recovery — Private checking');
  await reply('managementRecoveryQuery', {
    bankingReport: {
      __typename: 'BankingReport',
      id: 'report',
      code: 'READY',
      asOfDate: '2026-10-22',
      accounts: [
        {
          __typename: 'BankingReportAccount',
          id: 'report-account',
          accountId: 'logical-checking',
          planId: 'plan-latest',
          predecessorId: 'plan-before',
          transitionDate: '2026-09-30',
          intervals: [
            {
              __typename: 'BankingReportInterval',
              bindingId: 'old',
              afterDate: null,
              throughDate: '2026-08-31',
            },
            {
              __typename: 'BankingReportInterval',
              bindingId: 'middle',
              afterDate: '2026-08-31',
              throughDate: '2026-09-30',
            },
            {
              __typename: 'BankingReportInterval',
              bindingId: 'latest',
              afterDate: '2026-09-30',
              throughDate: null,
            },
          ],
          archives: [],
        },
      ],
    },
  });
}
const revisions = {
  plan: 'plan-guard',
  import: 'import-guard',
  data: 'data-guard',
  annotation: 'annotation-guard',
  lifecycle: 'lifecycle-guard',
};
function previewValue(code = 'READY') {
  const impact = {
    __typename: 'BankingReplacementImpact',
    count: 3,
    fromDate: '2026-06-01',
    throughDate: '2026-10-02',
    spendingMinor: '5000',
    annotationCount: 2,
    pendingCount: 1,
    unresolvedCount: 0,
  };
  return {
    __typename: 'BankingReplacementPreview',
    code,
    reportingRevision: '17',
    coverage: 'unknown',
    coverageAfter: null,
    coverageThrough: null,
    discrepancyCount: 1,
    collectionState: 'stopped',
    revisions: { __typename: 'BankingReplacementRevisions', ...revisions },
    intervals: [
      { bindingId: 'old', afterDate: null, throughDate: '2026-08-31' },
      {
        bindingId: 'middle',
        afterDate: '2026-08-31',
        throughDate: '2026-09-30',
      },
      { bindingId: 'latest', afterDate: '2026-09-30', throughDate: null },
    ],
    prior: impact,
    proposed: impact,
    retained: impact,
    new: impact,
    archived: impact,
    overlap: impact,
    oldAfterBoundary: impact,
  };
}
it('preserves all earlier intervals and binds recovery confirmation to every preview guard', async () => {
  await recoveryPanel();
  expect(host.textContent).toContain('through 2026-08-31');
  expect(host.textContent).toContain('through 2026-09-30');
  await click('Change latest transition date');
  await click('Preview recovery');
  expect(requests.at(-1)?.variables).toEqual({
    input: {
      accountId: 'logical-checking',
      action: 'CHANGE_BOUNDARY',
      transitionDate: '2026-09-30',
    },
  });
  await reply('managementPreviewQuery', {
    bankingReplacementPreview: previewValue(),
  });
  expect(host.textContent).toContain('$50.00 USD');
  expect(host.textContent).toContain('2 annotated');
  expect(host.textContent).toContain(
    'Similar overlap is not proven duplication',
  );
  await click('Confirm recovery');
  const input = requests.at(-1)?.variables.input;
  expect(input).toEqual({
    attemptId: expect.any(String),
    request: {
      accountId: 'logical-checking',
      action: 'CHANGE_BOUNDARY',
      transitionDate: '2026-09-30',
    },
    expected: revisions,
  });
  await click('Confirm recovery');
  expect(
    requests.filter((r) => r.name === 'managementConfirmMutation'),
  ).toHaveLength(1);
  await reply('managementConfirmMutation', {
    confirmBankingReplacement: {
      __typename: 'BankingReplacementResult',
      code: 'CONFLICT',
      resultId: null,
    },
  });
  expect(
    host.querySelector('[aria-label="Transition impact preview"]'),
  ).toBeNull();
  expect(host.textContent).toContain('review and confirm again');
});
it('restores only the preceding plan explicitly and recovers uncertain confirmation by its original attempt', async () => {
  await recoveryPanel();
  await click('Restore preceding plan');
  await click('Preview recovery');
  expect(requests.at(-1)?.variables).toEqual({
    input: { accountId: 'logical-checking', action: 'RESTORE_PREDECESSOR' },
  });
  await reply('managementPreviewQuery', {
    bankingReplacementPreview: previewValue(),
  });
  expect(host.textContent).toContain('does not restore provider permission');
  await click('Confirm recovery');
  const original = requests.at(-1)!;
  await act(async () => original.error());
  expect(
    host.querySelector('[aria-label="Transition impact preview"]'),
  ).not.toBeNull();
  await click('Check transition / recovery outcome');
  expect(requests.at(-1)?.variables).toEqual({
    attemptId: (original.variables.input as { attemptId: string }).attemptId,
  });
  await reply('managementReplacementOperationQuery', {
    bankingReplacementOperation: {
      __typename: 'BankingReplacementResult',
      code: 'NOT_FOUND',
      resultId: null,
    },
  });
  await click('Confirm recovery');
  expect(
    requests.filter((r) => r.name === 'managementConfirmMutation'),
  ).toHaveLength(1);
});
it('canceling a preview has no reporting effect and unusable imports cannot be confirmed', async () => {
  await recoveryPanel();
  await click('Restore preceding plan');
  await click('Preview recovery');
  await reply('managementPreviewQuery', {
    bankingReplacementPreview: previewValue('IMPORT_UNAVAILABLE'),
  });
  expect(button('Confirm recovery').disabled).toBe(true);
  await click('Cancel preview');
  expect(
    requests.filter(
      (r) =>
        r.name === 'managementConfirmMutation' ||
        r.name === 'managementCancelMutation',
    ),
  ).toHaveLength(0);
  expect(host.textContent).toContain(
    'private annotations leaving reporting remain',
  );
});

it('keeps server date-boundary errors persistent on the field and prevents confirmation', async () => {
  await recoveryPanel();
  await click('Change latest transition date');
  await click('Preview recovery');
  await reply('managementPreviewQuery', {
    bankingReplacementPreview: previewValue('INVALID_INPUT'),
  });
  expect(
    host
      .querySelector<HTMLInputElement>('input[type=date]')
      ?.getAttribute('aria-invalid'),
  ).toBe('true');
  expect(host.textContent).toContain('after the preceding transition boundary');
  expect(button('Confirm recovery').disabled).toBe(true);
  expect(host.querySelector('form')?.noValidate).toBe(true);
});

it('keeps history controls collapsed until requested and restores account-trigger focus after recovery', async () => {
  await manage();
  const history = [...host.querySelectorAll('details')].find(
    (d) => d.querySelector('summary')?.textContent === 'Disconnect & history',
  )!;
  expect(history.open).toBe(false);
  await click('Replacement and recovery — Private checking');
  expect(document.activeElement?.textContent).toContain(
    'Private checking: replacement and recovery',
  );
  await click('Cancel');
  expect(document.activeElement).toBe(
    button('Replacement and recovery — Private checking'),
  );
  expect(
    button('Replacement and recovery — Private checking').closest('details')
      ?.open,
  ).toBe(true);
});

it.each(['REPAIR_REQUIRED', 'INVALID_SELECTION'])(
  'keeps an immediate %s repair failure prepared until an authoritative expired receipt',
  async (code) => {
    const attemptId = await repair();
    await act(async () =>
      config.onSuccess('unused', {
        accounts: [
          {
            id: 'checking',
            name: 'Private checking',
            type: 'depository',
            subtype: 'checking',
          },
          {
            id: 'savings',
            name: 'Private savings',
            type: 'depository',
            subtype: 'savings',
          },
        ],
      }),
    );
    await click('Apply repair');
    await reply('managementRepairFinishMutation', {
      finishBankingRepair: { code, state: null, attemptId: null },
    });
    const key = 'kami-personal-enrollment:alice:manage:repair';
    expect(sessionStorage.getItem(key)).toBe(attemptId);
    expect(checkboxes().every((c) => c.matches(':disabled'))).toBe(true);
    expect(button('Apply repair').disabled).toBe(true);
    await click('Cancel');
    await click('Check repair outcome');
    await reply('managementRepairQuery', {
      bankingRepair: { code: 'PREPARED', state: 'prepared', attemptId },
    });
    expect(sessionStorage.getItem(key)).toBe(attemptId);
    await click('Check repair outcome');
    await reply('managementRepairQuery', {
      bankingRepair: { code: 'REPAIR_REQUIRED', state: 'prepared', attemptId },
    });
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    await manage();
    await click('Authorize account additions');
    expect(
      (requests.at(-1)?.variables.input as { attemptId: string }).attemptId,
    ).not.toBe(attemptId);
  },
);
it.each(['ATTEMPT_IN_PROGRESS', 'NOT_FOUND'])(
  'releases a known-unreserved %s repair start without inventing a receipt',
  async (code) => {
    await manage();
    await click('Authorize account additions');
    const original = (requests.at(-1)!.variables.input as { attemptId: string })
      .attemptId;
    await reply('managementRepairStartMutation', {
      startBankingRepair: {
        code,
        state: null,
        attemptId: null,
        linkToken: null,
        expiresAt: null,
      },
    });
    expect(
      sessionStorage.getItem('kami-personal-enrollment:alice:manage:repair'),
    ).toBeNull();
    expect(host.textContent).toMatch(
      /This new (attempt|repair) was not reserved/,
    );
    expect(open).not.toHaveBeenCalled();
    expect(button('Authorize account additions').disabled).toBe(false);
    await click('Cancel');
    await manage();
    await click('Authorize account additions');
    expect(
      (requests.at(-1)!.variables.input as { attemptId: string }).attemptId,
    ).not.toBe(original);
  },
);
it('releases a durably completed preparation failure but retains missing or mismatched repair receipts', async () => {
  await manage();
  await click('Authorize account additions');
  const id = (requests.at(-1)!.variables.input as { attemptId: string })
    .attemptId;
  await reply('managementRepairStartMutation', {
    startBankingRepair: {
      code: 'REPAIR_REQUIRED',
      state: 'complete',
      attemptId: id,
      linkToken: null,
      expiresAt: null,
    },
  });
  const key = 'kami-personal-enrollment:alice:manage:repair';
  expect(sessionStorage.getItem(key)).toBeNull();
  await click('Cancel');
  await manage();
  await click('Authorize account additions');
  const next = requests.at(-1)!;
  const nextId = (next.variables.input as { attemptId: string }).attemptId;
  await act(async () => next.error());
  await click('Cancel');
  await click('Check repair outcome');
  await reply('managementRepairQuery', {
    bankingRepair: { code: 'NOT_FOUND', state: null, attemptId: null },
  });
  expect(sessionStorage.getItem(key)).toBe(nextId);
  await click('Check repair outcome');
  await reply('managementRepairQuery', {
    bankingRepair: {
      code: 'READY',
      state: 'complete',
      attemptId: 'different-repair',
    },
  });
  expect(sessionStorage.getItem(key)).toBe(nextId);
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('local change is confirmed');
});
it.each(['command', 'receipt'])(
  'resolves durable management INVALID_SELECTION from its %s without clearing a different kind',
  async (source) => {
    await manage();
    await act(async () => checkboxes()[1].click());
    await click('Apply selection');
    const original = requests.at(-1)!;
    const first = (original.variables.input as { attemptId: string }).attemptId;
    sessionStorage.setItem(
      'kami-personal-enrollment:alice:manage:plan',
      'unrelated-plan',
    );
    if (source === 'receipt') {
      await act(async () => original.error());
      await click('Check management outcome');
      await reply('managementOperationQuery', {
        bankingOperation: { code: 'INVALID_SELECTION' },
      });
    } else
      await reply('managementSelectionMutation', {
        changeBankingSelection: { code: 'INVALID_SELECTION' },
      });
    expect(
      sessionStorage.getItem(
        'kami-personal-enrollment:alice:manage:management',
      ),
    ).toBeNull();
    expect(
      sessionStorage.getItem('kami-personal-enrollment:alice:manage:plan'),
    ).toBe('unrelated-plan');
    await click('Reload current state');
    await reply('managementConnectionQuery', {
      bankingConnection: {
        code: 'READY',
        connection: { ...connection, generation: '9007199254740994' },
      },
    });
    await act(async () => checkboxes()[1].click());
    await click('Apply selection');
    const input = requests.at(-1)!.variables.input as {
      attemptId: string;
      expectedGeneration: string;
    };
    expect(input.attemptId).not.toBe(first);
    expect(input.expectedGeneration).toBe('9007199254740994');
  },
);
it.each(['management', 'repair'])(
  'ignores an old held %s receipt after a newer operation owns the same slot',
  async (kind) => {
    const key = `kami-personal-enrollment:alice:manage:${kind}`;
    await act(async () => {
      sessionStorage.setItem(key, 'old-attempt');
      window.dispatchEvent(new Event('kami-banking-attempt'));
    });
    await click(`Check ${kind} outcome`);
    const old = requests.at(-1)!;
    // Another owner resolved A; this owner now sends B before the held A read arrives.
    sessionStorage.removeItem(key);
    await manage();
    if (kind === 'management') {
      await act(async () => checkboxes()[1].click());
      await click('Apply selection');
    } else await click('Authorize account additions');
    const newer = requests.at(-1)!;
    const nextId = (newer.variables.input as { attemptId: string }).attemptId;
    await act(async () =>
      old.next(
        kind === 'management'
          ? { bankingOperation: { code: 'READY' } }
          : {
              bankingRepair: {
                code: 'READY',
                state: 'complete',
                attemptId: 'old-attempt',
              },
            },
      ),
    );
    expect(sessionStorage.getItem(key)).toBe(nextId);
    expect(
      button(
        kind === 'management'
          ? 'Apply selection'
          : 'Authorize account additions',
      ).disabled,
    ).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('local change is confirmed');
  },
);

it('resolves an authoritative fenced repair receipt without claiming a completed change', async () => {
  const attemptId = await repair();
  await act(async () => config.onExit(null));
  await click('Cancel');
  await click('Check repair outcome');
  await reply('managementRepairQuery', {
    bankingRepair: { code: 'CONFLICT', state: 'prepared', attemptId },
  });
  expect(
    sessionStorage.getItem('kami-personal-enrollment:alice:manage:repair'),
  ).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('local change is confirmed');
});

it('retains a reserved start NOT_FOUND until its original fenced receipt is known', async () => {
  await manage();
  await click('Authorize account additions');
  const attemptId = (requests.at(-1)!.variables.input as { attemptId: string })
    .attemptId;
  const key = 'kami-personal-enrollment:alice:manage:repair';
  await reply('managementRepairStartMutation', {
    startBankingRepair: {
      code: 'NOT_FOUND',
      state: 'preparing',
      attemptId,
      linkToken: null,
      expiresAt: null,
    },
  });
  expect(sessionStorage.getItem(key)).toBe(attemptId);
  expect(open).not.toHaveBeenCalled();
  await click('Cancel');
  await click('Check repair outcome');
  await reply('managementRepairQuery', {
    bankingRepair: { code: 'CONFLICT', state: 'preparing', attemptId },
  });
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
