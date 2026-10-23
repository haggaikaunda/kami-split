// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { PersonalTransactions } from './transactions';
const nav = vi.hoisted(() => ({
  search: 'tab=transactions',
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/personal',
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: unknown;
  }) => {
    void onNavigate;
    return <a {...props}>{children}</a>;
  },
}));
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
let root: Root, host: HTMLDivElement, scope: FinancialScope;
const requests: Request[] = [];
const row = (id = 'source-1') => ({
  id: `fact-${id}`,
  sourceId: id,
  accountId: 'account',
  bindingId: 'binding',
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
  merchantName: 'Private merchant',
  name: 'Bank fact',
  processingState: 'posted',
  activity: 'purchase',
  category: 'FOOD_AND_DRINK',
  excluded: false,
  reviewed: false,
  materialConflict: false,
  current: true,
  currentId: id,
  discrepancy: 'none',
  archives: [
    {
      archiveId: 'archive',
      sourceRevision: '1',
      annotationRevision: '3',
      annotation: {
        revision: '3',
        materialRevision: '1',
        category: null,
        activity: null,
        note: 'Original private note',
        excluded: true,
        reviewed: false,
      },
    },
  ],
});
let reportSequence = 0;
const report = (overrides: Record<string, unknown> = {}) => ({
  bankingReport: {
    id: `report-${reportSequence++}`,
    code: 'READY',
    fieldErrors: [],
    start: '2026-10-01',
    end: '2026-10-17',
    asOfDate: '2026-10-17',
    timezone: 'America/Los_Angeles',
    revision: 'rev',
    totalCount: 125,
    spendingContext: 'SPENDING_FROM_ACCOUNTS',
    endCursor: 'signed',
    hasNextPage: true,
    activityChoices: ['purchase', 'refund', 'income', 'transfer', 'unresolved'],
    categoryChoices: ['FOOD_AND_DRINK', 'UNCATEGORIZED'],
    counts: {
      count: 125,
      postedCount: 123,
      pendingCount: 2,
      removedCount: 0,
      excludedCount: 1,
      unresolvedCount: 1,
      reviewedCount: 120,
      classificationComplete: false,
    },
    summary: {
      netMinor: '-4000',
      purchaseMinor: '10000',
      refundMinor: '14000',
      classificationComplete: false,
    },
    accounts: [
      {
        id: 'snapshot-account',
        accountId: 'account',
        kind: 'checking',
        selected: true,
        coverage: 'PARTIAL',
        planId: 'plan',
        transitionDate: '2026-09-30',
        archives: [
          {
            id: 'archive',
            planId: 'old-plan',
            boundaryDate: '2026-09-30',
            count: 130,
          },
        ],
        intervals: [
          {
            bindingId: 'binding',
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
    rows: [row()],
    ...overrides,
  },
});
const render = () =>
  root.render(
    <PersonalTransactions
      scope={scope}
      names={new Map([['account', 'Private checking']])}
    />,
  );
const answered = new WeakSet<Request>();
async function answer(value: unknown = report(), index?: number) {
  const name = Object.hasOwn(value as object, 'bankingReport')
    ? 'personalTransactionsQuery'
    : Object.hasOwn(value as object, 'bankingTransaction')
      ? 'personalTransactionSelectionQuery'
      : Object.hasOwn(value as object, 'bankingAnnotationOperation')
        ? 'personalTransactionAnnotationRecoveryQuery'
        : Object.hasOwn(value as object, 'editBankingAnnotation')
          ? 'personalTransactionAnnotationMutation'
          : null;
  const request =
    index === undefined
      ? [...requests]
          .reverse()
          .find((item) => !answered.has(item) && (!name || item.name === name))!
      : requests[index];
  answered.add(request);
  await act(async () => request.next(value));
}
const latestMutation = () =>
  requests
    .filter(
      (request) => request.name === 'personalTransactionAnnotationMutation',
    )
    .at(-1)!;

async function click(label: string) {
  const target = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  )!;
  expect(target).toBeTruthy();
  await act(async () => target.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests.length = 0;
  sessionStorage.clear();
  window.history.replaceState({}, '', '/personal?tab=transactions');
  nav.search = 'tab=transactions';
  nav.push.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  host = document.createElement('div');
  document.body.append(host);
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(0), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
    invalidate: vi.fn(),
    environment: queryEnvironment((request) => requests.push(request)),
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('reads complete server counts and exact negative spending independently from one loaded row', async () => {
  await act(async () => render());
  await answer();
  expect(host.textContent).toContain('125 transactions');
  expect(host.textContent).toContain('−$40.00');
  expect(host.textContent).toContain('Partial coverage');
  expect(host.textContent).toContain('Classification incomplete');
  expect(
    host
      .querySelector('time[datetime="2026-10-17"]')
      ?.getAttribute('aria-label'),
  ).toBe('Posted bank date 2026-10-17');
  expect(host.textContent).not.toContain('Connect account');
  expect(
    host.querySelector('[data-source-id] a')?.getAttribute('href'),
  ).toContain('transaction=source-1');
});
it('appends only compatible pages and discards the traversal on concurrent changes', async () => {
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  expect(requests[1].variables.after).toBe('signed');
  await answer(
    report({ id: 'page2', rows: [row('source-2')], hasNextPage: false }),
  );
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(2);
  nav.search = 'tab=transactions&activity=income';
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  await answer(report({ code: 'RESTART_REQUIRED', rows: [], summary: null }));
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(0);
  expect(host.textContent).toContain('filters are preserved');
  await click('Restart activity');
  expect(requests.at(-1)?.variables).toMatchObject({
    filter: { activities: ['income'] },
  });
});
it('keeps custom/date and filter drafts separate until Apply and cancels safely', async () => {
  await act(async () => render());
  await answer();
  await click('This month');
  await click('Custom range');
  const dates = host.querySelectorAll<HTMLInputElement>('input[type=date]');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    set.call(dates[0], '2026-10-18');
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    dates[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Cancel');
  expect(nav.push).not.toHaveBeenCalled();
  await click('Filters');
  await click('Reset filters');
  expect(nav.push).not.toHaveBeenCalled();
  await click('Apply filters');
  expect(nav.push).toHaveBeenCalledWith('/personal?tab=transactions', {
    scroll: false,
  });
});
it('uses source identity for selected current records outside archive date/activity filters', async () => {
  nav.search =
    'tab=transactions&transaction=current-source&period=last-month&activity=income';
  await act(async () => render());
  await answer(report({ rows: [], totalCount: 0, summary: null }));
  expect(requests.at(-1)?.name).toBe('personalTransactionSelectionQuery');
  expect(requests.at(-1)?.variables).toEqual({
    source: 'current-source',
    archive: null,
    discrepancy: false,
  });
  await answer({
    bankingTransaction: {
      id: 'detail',
      code: 'READY',
      currentId: 'current-source',
      transaction: row('current-source'),
    },
  } as unknown as ReturnType<typeof report>);
  expect(host.textContent).toContain('Private merchant');
  expect(
    host.querySelector('[data-source-id]')?.getAttribute('data-source-id'),
  ).toBe('current-source');
});
it('keeps immutable archive annotation provenance and links its sole current owner', async () => {
  nav.search = 'tab=transactions&archive=archive';
  await act(async () => render());
  await answer(report({ spendingContext: 'RECOVERY_ARCHIVE', summary: null }));
  expect(host.textContent).toContain('Recovery archive');
  expect(host.textContent).toContain('Original private note');
  expect(host.querySelector('a[id^=current]')?.getAttribute('href')).toBe(
    '/personal?tab=transactions&transaction=source-1',
  );
  expect(host.textContent).not.toContain('Spending from your accounts:');
});
it.each(['DATA_UNAVAILABLE', 'INVALID_INPUT', 'FORBIDDEN'])(
  'does not turn %s into successful empty or zero spending',
  async (code) => {
    await act(async () => render());
    await answer(report({ code, summary: null, counts: null, rows: [] }));
    expect(host.textContent).not.toContain('$0');
    expect(host.textContent).not.toContain('No matching transactions');
    expect(host.textContent).not.toContain('Private merchant');
  },
);
it('hides late responses after an actor switch', async () => {
  await act(async () => render());
  scope = {
    ...scope,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => render());
  await answer(report(), 0);
  expect(host.textContent).not.toContain('Private merchant');
});
it('reauthorizes a selected-row return before restoring a retained later-page row', async () => {
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  await answer(report({ rows: [row('later-source')], hasNextPage: false }));
  nav.search = 'tab=transactions&transaction=later-source';
  await act(async () => render());
  expect(requests.at(-1)?.name).toBe('personalTransactionSelectionQuery');
  scope.visits.set('return-token', {
    href: '/personal?tab=transactions',
    focus: 'transaction-later-source',
    scroll: 100,
  });
  nav.search = 'tab=transactions&restore=return-token';
  await act(async () => render());
  expect(
    requests.some((request) => request.name === 'personalTransactionsQuery'),
  ).toBe(true);
  expect(document.activeElement?.id).not.toBe('transaction-later-source');
  await answer();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(document.activeElement?.id).toBe('transaction-later-source');
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(2);
});
it('keeps stale/reconnect import facts visible beside a usable complete current report', async () => {
  const facts = {
    operation: 'IDLE',
    importState: 'USABLE',
    usable: true,
    recovery: 'NONE',
    collection: 'RECONNECT_REQUIRED',
    reportingState: 'CURRENT',
    freshness: 'STALE',
    coverage: 'COMPLETE',
    historicalUpdate: 'COMPLETE',
    historyAvailability: 'UNKNOWN',
    discrepancyCount: '0',
  };
  await act(async () =>
    root.render(
      <PersonalTransactions
        scope={scope}
        names={new Map([['account', 'Private checking']])}
        statuses={new Map([['account', facts]])}
      />,
    ),
  );
  const account = report().bankingReport.accounts[0];
  await answer(
    report({
      accounts: [
        {
          ...account,
          coverage: 'COMPLETE',
          selected: true,
          transitionDate: null,
          intervals: [
            {
              ...account.intervals[0],
              throughDate: null,
              collectionState: 'current/active/granted',
              collectionStopped: false,
              importState: 'usable',
              coverage: 'COMPLETE',
              discrepancyCount: 0,
            },
          ],
        },
      ],
    }),
  );
  expect(host.textContent).toContain('Reconnect needed');
  expect(
    [...host.querySelectorAll('a')].some(
      (link) => link.textContent === 'View status in Connections',
    ),
  ).toBe(true);
  await act(async () =>
    root.render(
      <PersonalTransactions
        scope={scope}
        names={new Map([['account', 'Private checking']])}
        statuses={
          new Map([['account', { ...facts, collection: 'COLLECTING' }]])
        }
      />,
    ),
  );
  expect(host.textContent).toContain('updates are stale');
});

it('keeps the normal complete list compact with a whole-row target and no all-zero status block', async () => {
  await act(async () => render());
  await answer(
    report({
      counts: {
        count: 1,
        postedCount: 1,
        pendingCount: 0,
        removedCount: 0,
        excludedCount: 0,
        unresolvedCount: 0,
        reviewedCount: 1,
        classificationComplete: true,
      },
      summary: null,
      totalCount: 1,
      hasNextPage: false,
      rows: [{ ...row(), reviewed: true }],
      accounts: [
        {
          ...report().bankingReport.accounts[0],
          coverage: 'COMPLETE',
          intervals: [],
        },
      ],
    }),
  );
  const link = host.querySelector<HTMLAnchorElement>('#transaction-source-1')!;
  expect(link.textContent).toContain('Private merchant');
  expect(link.textContent).toContain('$100.00');
  expect(link.getAttribute('aria-describedby')).toContain(
    'row-source-1-context',
  );
  expect(host.textContent).not.toContain('0 pending');
  expect(host.textContent).not.toContain('0 unresolved');
  expect(host.textContent).not.toContain(
    'Activity context; no spending total applies.',
  );
});
it('restores a selected archive-record origin only after its fresh source read', async () => {
  scope.visits.set('selected-return', {
    href: '/personal?tab=transactions&archive=archive&transaction=source-1',
    focus: 'selected-current-source-1',
    scroll: 100,
  });
  nav.search =
    'tab=transactions&archive=archive&transaction=source-1&restore=selected-return';
  await act(async () => render());
  await answer(report({ summary: null, spendingContext: 'RECOVERY_ARCHIVE' }));
  expect(document.activeElement?.id).not.toBe('selected-current-source-1');
  await answer({
    bankingTransaction: {
      id: 'archive-selected-fresh',
      code: 'READY',
      currentId: 'source-1',
      transaction: row(),
    },
  } as unknown as ReturnType<typeof report>);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(document.activeElement?.id).toBe('selected-current-source-1');
});

it.each(['ready', 'revision', 'denied'])(
  'replays fresh signed archive pages across a current-record context: %s',
  async (outcome) => {
    const archive = 'tab=transactions&archive=archive&activity=income';
    nav.search = archive;
    await act(async () => render());
    await answer();
    await click('Load more transactions');
    await answer(report({ rows: [row('archive-later')], hasNextPage: false }));
    scope.visits.set('archive-return', {
      href: `/personal?${archive}`,
      focus: 'current-archive-later',
      scroll: 100,
    });
    nav.search = 'tab=transactions&activity=income&transaction=current-outside';
    await act(async () => render());
    await answer();
    nav.search = `${archive}&restore=archive-return`;
    await act(async () => render());
    const initial = requests.length - 1;
    await answer(
      report({
        revision: outcome === 'revision' ? 'changed' : 'rev',
        endCursor: 'fresh-signed',
      }),
      initial,
    );
    if (outcome !== 'revision') {
      const continuation = requests.findIndex(
        (request, index) =>
          index > initial && request.variables.after === 'fresh-signed',
      );
      expect(continuation).toBeGreaterThan(initial);
      expect(document.activeElement?.id).not.toBe('current-archive-later');
      await answer(
        report(
          outcome === 'denied'
            ? { code: 'FORBIDDEN', rows: [] }
            : { rows: [row('archive-later')], hasNextPage: false },
        ),
        continuation,
      );
      if (outcome === 'ready') {
        const authorization = requests.findIndex(
          (request, index) => index > initial && !request.variables.after,
        );
        await answer(report({ endCursor: 'fresh-signed' }), authorization);
        await act(
          async () => new Promise((resolve) => setTimeout(resolve, 10)),
        );
        expect(document.activeElement?.id).toBe('current-archive-later');
        expect(host.querySelectorAll('[data-source-id]')).toHaveLength(2);
        nav.search = 'tab=transactions&activity=refund';
        await act(async () => render());
        nav.search = archive;
        await act(async () => render());
        await answer();
        expect(host.textContent).toContain('Load more transactions');
        expect(host.querySelector('#current-archive-later')).toBeNull();
        return;
      }
    }
    expect(host.textContent).toContain('Restart activity');
    expect(host.querySelectorAll('[data-source-id]')).toHaveLength(0);
    await click('Restart activity');
    await answer();
    expect(host.textContent).toContain('Load more transactions');
    expect(requests.at(-1)?.variables.filter).toMatchObject({
      archiveId: 'archive',
      activities: ['income'],
    });
  },
);

async function openDetail(extra: Record<string, unknown> = {}) {
  nav.search = 'tab=transactions&transaction=source-1';
  await act(async () => render());
  await answer(report());
  await answer({
    bankingTransaction: {
      id: 'detail-initial',
      code: 'READY',
      currentId: 'source-1',
      transaction: { ...row(), ...extra },
    },
  } as unknown as ReturnType<typeof report>);
}
async function textInput(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const result = (
  code: string,
  value: Record<string, unknown> = row(),
  name = 'editBankingAnnotation',
) => ({
  [name]: {
    id: `result-${crypto.randomUUID()}`,
    code,
    sourceId: 'source-1',
    detail: {
      id: `detail-${crypto.randomUUID()}`,
      code: 'READY',
      currentId: 'source-1',
      transaction: value,
    },
  },
});
it('opens read-only, separates immutable dates, and protects edited input on Close and browser Back', async () => {
  await openDetail();
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain('Authorization date2026-10-16');
  await click('Edit');
  await textInput('Intended private note');
  await click('Close');
  expect(host.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  expect(host.querySelector('textarea')?.value).toBe('Intended private note');
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(host.textContent).toContain('Discard unsaved changes?');
  expect(nav.replace).not.toHaveBeenCalled();
  expect(
    requests.filter((request) => request.name.includes('Mutation')),
  ).toHaveLength(0);
});
it('serializes only changed fields and retains remaining intended input after a partial-save conflict', async () => {
  await openDetail();
  await click('Edit');
  await textInput('My note');
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  await click('Save changes');
  expect(latestMutation()?.variables.input).toMatchObject({
    field: 'NOTE',
    value: 'My note',
    expectedRevision: '0',
    sourceRevision: '1',
    materialRevision: '1',
  });
  await answer(
    result('READY', {
      ...row(),
      annotationRevision: '1',
      note: 'My note',
    }) as unknown as ReturnType<typeof report>,
  );
  expect(latestMutation()?.variables.input).toMatchObject({
    field: 'EXCLUDED',
    value: 'true',
    expectedRevision: '1',
  });
  expect(
    requests.filter((request) => request.name === 'personalTransactionsQuery'),
  ).toHaveLength(2);
  await answer(
    report({
      summary: {
        netMinor: '25000',
        purchaseMinor: '25000',
        refundMinor: '0',
        classificationComplete: true,
      },
    }),
  );
  expect(host.textContent).toContain('$250.00');
  expect(host.querySelector('textarea')?.value).toBe('My note');
  await answer(
    result('CONFLICT', {
      ...row(),
      annotationRevision: '2',
      note: 'Other saved note',
    }) as unknown as ReturnType<typeof report>,
  );
  expect(host.textContent).toContain('remaining input is preserved');
  expect(host.querySelector('textarea')?.value).toBe('My note');
  expect(
    host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked,
  ).toBe(true);
  expect(
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save changes',
    )?.disabled,
  ).toBe(true);
  await click('Use current versions');
  await click('Save changes');
  expect(latestMutation()?.variables.input).toMatchObject({
    field: 'EXCLUDED',
    expectedRevision: '2',
    value: 'true',
  });
});
it('recovers response loss after remount and replays the exact frozen input only for a missing receipt', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Recovered note');
  await click('Save changes');
  const frozen = latestMutation().variables.input;
  await act(async () => latestMutation().error());
  expect(host.textContent).toContain('could not be confirmed');
  await act(async () => root.unmount());
  root = relayRoot(createRoot(host), () => scope);
  await act(async () => render());
  await answer(report());
  await answer({
    bankingTransaction: {
      id: 'reopened',
      code: 'READY',
      currentId: 'source-1',
      transaction: row(),
    },
  } as unknown as ReturnType<typeof report>);
  expect(host.querySelector('textarea')?.value).toBe('Recovered note');
  await click('Check original save');
  expect(requests.at(-1)?.name).toBe(
    'personalTransactionAnnotationRecoveryQuery',
  );
  await answer({
    bankingAnnotationOperation: {
      id: 'missing',
      code: 'NOT_FOUND',
      sourceId: null,
      detail: null,
    },
  } as unknown as ReturnType<typeof report>);
  expect(latestMutation()?.variables.input).toEqual(frozen);
  await answer(
    result('READY', {
      ...row(),
      annotationRevision: '1',
      note: 'Recovered note',
    }) as unknown as ReturnType<typeof report>,
  );
  expect(
    requests.some((request) => request.name === 'personalTransactionsQuery'),
  ).toBe(true);
});
it('masks stale private detail after a denied mutation', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Sensitive draft');
  await click('Save changes');
  await answer({
    editBankingAnnotation: {
      id: 'denied',
      code: 'NOT_FOUND',
      sourceId: null,
      detail: null,
    },
  } as unknown as ReturnType<typeof report>);
  expect(host.textContent).toContain('no longer accessible');
  expect(host.querySelector('dialog')?.textContent).not.toContain(
    'Private merchant',
  );
  expect(host.querySelector('textarea')).toBeNull();
});
it('keeps current archive copies read-only and permits archive-only annotations with immutable captured provenance', async () => {
  nav.search = 'tab=transactions&archive=archive&transaction=source-1';
  await act(async () => render());
  await answer(report({ summary: null }));
  await answer({
    bankingTransaction: {
      id: 'archive-current',
      code: 'READY',
      currentId: 'source-1',
      transaction: row(),
    },
  } as unknown as ReturnType<typeof report>);
  expect(
    [...host.querySelectorAll('button')].some(
      (button) => button.textContent === 'Edit',
    ),
  ).toBe(false);
  expect(host.textContent).toContain('Captured note: Original private note');
});

it('requires explicit reapplication when source material changes between a confirmed field and remaining writes', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Note survives');
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  await click('Save changes');
  const mutations = requests.filter(
    (request) => request.name === 'personalTransactionAnnotationMutation',
  ).length;
  await answer(
    result('READY', {
      ...row(),
      sourceRevision: '2',
      materialRevision: '2',
      annotationRevision: '1',
      note: 'Note survives',
      amountMinor: '-10000',
      activity: 'unresolved',
    }) as unknown as ReturnType<typeof report>,
  );
  expect(
    requests.filter(
      (request) => request.name === 'personalTransactionAnnotationMutation',
    ),
  ).toHaveLength(mutations);
  expect(host.textContent).toContain('bank facts changed');
  expect(
    host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked,
  ).toBe(true);
  expect(
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save changes',
    )?.disabled,
  ).toBe(true);
});
it('allows explicit compatible activity acknowledgement while reviewed alone keeps unresolved spending separate', async () => {
  await openDetail({
    activity: 'unresolved',
    activityOverride: 'purchase',
    materialConflict: true,
    reviewed: false,
    eligible: false,
  });
  expect(host.textContent).toContain(
    'A reviewed flag alone does not resolve unknown activity',
  );
  await click('Edit');
  await click('Confirm activity type');
  await click('Save changes');
  expect(latestMutation()?.variables.input).toMatchObject({
    field: 'ACTIVITY',
    value: 'purchase',
    sourceRevision: '1',
    materialRevision: '1',
  });
});
it('ignores a delayed annotation response after the owning actor scope is replaced', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Alice-only draft');
  await click('Save changes');
  const original = latestMutation();
  const departed = scope;
  departed.isLive = () => false;
  scope = {
    ...departed,
    id: 'bob',
    actor: 'bob',
    isLive: () => true,
    visits: new Map(),
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => render());
  await act(async () =>
    original.next(
      result('READY', {
        ...row(),
        note: 'Alice-only draft',
        annotationRevision: '1',
      }),
    ),
  );
  expect(host.textContent).not.toContain('Alice-only draft');
  expect(host.querySelector('textarea')).toBeNull();
});

it('distinguishes a confirmed receipt from an unavailable follow-up detail', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Committed before removal');
  await click('Save changes');
  await answer({
    editBankingAnnotation: {
      id: 'saved-inaccessible',
      code: 'READY',
      sourceId: 'source-1',
      detail: {
        id: 'unavailable',
        code: 'NOT_FOUND',
        currentId: null,
        transaction: null,
      },
    },
  });
  expect(host.querySelector('dialog')?.textContent).toContain(
    'original field save is confirmed',
  );
  expect(host.querySelector('textarea')).toBeNull();
});

it('keeps a confirmed save distinct from failed local draft cleanup', async () => {
  await openDetail();
  await click('Edit');
  await textInput('Confirmed value');
  await click('Save changes');
  const remove = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(() => {
      throw new Error('storage unavailable');
    });
  await answer(
    result('READY', {
      ...row(),
      annotationRevision: '1',
      note: 'Confirmed value',
    }),
  );
  expect(host.textContent).toContain(
    'Private changes are confirmed, but tab storage cleanup failed',
  );
  expect(
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save changes',
    )?.disabled,
  ).toBe(true);
  remove.mockRestore();
});

it('does not silently advance a remaining field past another private writer and keeps review required after reload', async () => {
  await openDetail();
  await click('Edit');
  const select = async (index: number, value: string) =>
    act(async () => {
      const element = host.querySelectorAll('select')[index];
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )!.set!.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await select(0, 'transfer');
  await select(1, 'TRAVEL');
  await click('Save changes');
  expect(latestMutation().variables.input).toMatchObject({
    field: 'ACTIVITY',
    value: 'transfer',
    expectedRevision: '0',
  });
  const concurrent = {
    ...row(),
    annotationRevision: '2',
    activity: 'transfer',
    activityOverride: 'transfer',
    category: 'GENERAL_MERCHANDISE',
    categoryOverride: 'GENERAL_MERCHANDISE',
  };
  await answer(result('READY', concurrent));
  expect(
    requests.filter(
      (request) => request.name === 'personalTransactionAnnotationMutation',
    ),
  ).toHaveLength(1);
  expect(host.textContent).toContain(
    'newer private changes were saved elsewhere',
  );
  expect(host.querySelectorAll('select')[1].value).toBe('TRAVEL');
  await act(async () => root.unmount());
  root = relayRoot(createRoot(host), () => scope);
  await act(async () => render());
  await answer(report());
  await answer({
    bankingTransaction: {
      id: 'fresh-concurrent',
      code: 'READY',
      currentId: 'source-1',
      transaction: concurrent,
    },
  });
  expect(
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save changes',
    )?.disabled,
  ).toBe(true);
  expect(host.querySelectorAll('select')[1].value).toBe('TRAVEL');
  await click('Check current record');
  await answer({
    bankingTransaction: {
      id: 'checked-concurrent',
      code: 'READY',
      currentId: 'source-1',
      transaction: concurrent,
    },
  });
  await click('Use current versions');
  await click('Save changes');
  expect(latestMutation().variables.input).toMatchObject({
    field: 'CATEGORY',
    value: 'TRAVEL',
    expectedRevision: '2',
  });
});
