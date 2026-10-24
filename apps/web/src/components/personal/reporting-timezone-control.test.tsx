// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import {
  ReportingTimezoneControl,
  ReportingTimezoneInitialization,
  currentMonthLabel,
} from './reporting-timezone-control';
const session = vi.hoisted(() => ({
  scope: undefined as FinancialScope | undefined,
  loading: false,
}));
vi.mock('../groups/session', () => ({ useFinancialSession: () => session }));
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
const requests: Request[] = [];
let root: Root, host: HTMLDivElement;
const saved = (timezone = 'America/Los_Angeles', version = '1') => ({
  __typename: 'ReportingTimezone',
  timezone,
  version,
});
const problem = (code: string) => ({
  __typename: 'ReportingTimezoneProblem',
  code,
});
function button(text: string) {
  const result = [...host.querySelectorAll('button')].find(
    (value) => value.textContent === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function input(value: string) {
  await act(async () => {
    const element = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  session.scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    environment: queryEnvironment((request) => requests.push(request)),
  } as FinancialScope;
  session.loading = false;
  root = relayRoot(createRoot(host), () => session.scope);
  await act(async () => root.render(<ReportingTimezoneControl />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it('initializes once from device only when missing and retains the server-returned zone', async () => {
  await act(async () =>
    requests[0].next({ reportingTimezone: problem('NOT_INITIALIZED') }),
  );
  expect(requests[1].name).toBe('reportingTimezoneInitializeMutation');
  expect(requests[1].variables.attemptId).toEqual(expect.any(String));
  await act(async () =>
    requests[1].next({ initializeReportingTimezone: saved('Europe/London') }),
  );
  expect(host.textContent).toContain('Saved timezone: Europe/London');
  await act(async () => root.render(<ReportingTimezoneControl />));
  expect(
    requests.filter(
      (request) => request.name === 'reportingTimezoneInitializeMutation',
    ),
  ).toHaveLength(1);
});
it('does not overwrite an existing saved timezone from device travel', async () => {
  await act(async () =>
    requests[0].next({ reportingTimezone: saved('Pacific/Auckland', '4') }),
  );
  expect(requests).toHaveLength(1);
  expect(host.querySelector('input')!.value).toBe('Pacific/Auckland');
});
it('retains explicit draft on conflict and adopts fresh independent version before another save', async () => {
  await act(async () => requests[0].next({ reportingTimezone: saved() }));
  await input('Europe/London');
  await click('Save timezone');
  expect(requests[1].variables).toMatchObject({
    timezone: 'Europe/London',
    expectedVersion: '1',
  });
  await act(async () =>
    requests[1].next({ updateReportingTimezone: problem('CONFLICT') }),
  );
  expect(host.querySelector('input')!.value).toBe('Europe/London');
  expect(button('Save timezone').disabled).toBe(true);
  await click('Check saved timezone');
  expect(requests[2].name).toBe('reportingTimezoneRecoveryQuery');
  await act(async () =>
    requests[2].next({ reportingTimezoneAttempt: problem('CONFLICT') }),
  );
  await act(async () =>
    requests[3].next({ reportingTimezone: saved('Asia/Tokyo', '2') }),
  );
  expect(host.querySelector('input')!.value).toBe('Europe/London');
  expect(host.textContent).toContain('Saved timezone: Asia/Tokyo');
  await click('Save timezone');
  expect(requests[4].variables).toMatchObject({
    timezone: 'Europe/London',
    expectedVersion: '2',
  });
  expect(requests[4].variables.attemptId).not.toBe(
    requests[1].variables.attemptId,
  );
});
it('replays the exact frozen write after missing uncertain receipt before separately reading current', async () => {
  await act(async () => requests[0].next({ reportingTimezone: saved() }));
  await input('Europe/London');
  await click('Save timezone');
  const original = requests[1].variables;
  await act(async () => requests[1].error());
  await input('Asia/Tokyo');
  await click('Check saved timezone');
  await act(async () =>
    requests[2].next({ reportingTimezoneAttempt: problem('NOT_FOUND') }),
  );
  expect(requests[3].name).toBe('reportingTimezoneUpdateMutation');
  expect(requests[3].variables).toEqual(original);
  await act(async () =>
    requests[3].next({ updateReportingTimezone: saved('Europe/London', '2') }),
  );
  await act(async () =>
    requests[4].next({ reportingTimezone: saved('Europe/London', '2') }),
  );
  expect(host.querySelector('input')!.value).toBe('Asia/Tokyo');
  expect(host.textContent).toContain('Saved timezone: Europe/London');
});
it('does not publish late saved state after an actor replacement', async () => {
  await act(async () => requests[0].next({ reportingTimezone: saved() }));
  await input('Europe/London');
  await click('Save timezone');
  session.scope = {
    ...session.scope!,
    actor: 'bob',
    id: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => root.render(<ReportingTimezoneControl />));
  await act(async () =>
    requests[1].next({ updateReportingTimezone: saved('Europe/London', '2') }),
  );
  expect(host.textContent).not.toContain('Europe/London');
});
it('does not expose timezone data while session verification is pending', async () => {
  await act(async () => requests[0].next({ reportingTimezone: saved() }));
  session.loading = true;
  await act(async () => root.render(<ReportingTimezoneControl />));
  expect(host.textContent).toBe('');
});
it.each([
  ['2026-10-24T01:00:00Z', 'America/Los_Angeles', 'Oct 1, 2026 – Oct 23, 2026'],
  ['2026-10-24T01:00:00Z', 'UTC', 'Oct 1, 2026 – Oct 24, 2026'],
  ['2026-11-01T01:00:00Z', 'America/Los_Angeles', 'Oct 1, 2026 – Oct 31, 2026'],
  ['2026-11-01T01:00:00Z', 'Asia/Tokyo', 'Nov 1, 2026 – Nov 1, 2026'],
  ['2024-03-01T01:00:00Z', 'America/Los_Angeles', 'Feb 1, 2024 – Feb 29, 2024'],
  ['2024-03-01T01:00:00Z', 'Asia/Tokyo', 'Mar 1, 2024 – Mar 1, 2024'],
  ['2027-01-01T01:00:00Z', 'Asia/Tokyo', 'Jan 1, 2027 – Jan 1, 2027'],
])(
  'ends this month at saved-zone today for %s in %s',
  (instant, timezone, bounds) => {
    expect(currentMonthLabel(timezone, new Date(instant))).toBe(
      `This month: ${bounds}`,
    );
  },
);
it('renders first-use dates through saved-zone today without reinitializing an existing preference', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T01:00:00Z'));
  await act(async () =>
    root.render(<ReportingTimezoneInitialization showPeriod />),
  );
  await act(async () =>
    requests.at(-1)!.next({ reportingTimezone: saved('America/Los_Angeles') }),
  );
  expect(host.textContent).toBe(
    'This month: Oct 1, 2026 – Oct 23, 2026 · America/Los_Angeles',
  );
  expect(
    requests.filter(
      (request) => request.name === 'reportingTimezoneInitializeMutation',
    ),
  ).toHaveLength(0);
});
it('uses the server-confirmed initialized zone for first-use dates at a UTC month boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T01:00:00Z'));
  await act(async () =>
    root.render(<ReportingTimezoneInitialization showPeriod />),
  );
  await act(async () =>
    requests.at(-1)!.next({ reportingTimezone: problem('NOT_INITIALIZED') }),
  );
  const initialize = requests.at(-1)!;
  expect(initialize.name).toBe('reportingTimezoneInitializeMutation');
  await act(async () =>
    initialize.next({ initializeReportingTimezone: saved('Asia/Tokyo') }),
  );
  expect(host.textContent).toBe(
    'This month: Nov 1, 2026 – Nov 1, 2026 · Asia/Tokyo',
  );
  await act(async () =>
    root.render(<ReportingTimezoneInitialization showPeriod />),
  );
  expect(
    requests.filter(
      (request) => request.name === 'reportingTimezoneInitializeMutation',
    ),
  ).toHaveLength(1);
});

it.each([
  ['UNAVAILABLE', 'success'],
  ['UNAVAILABLE', 'conflict'],
  ['replay-unavailable', 'success'],
  ['replay-unavailable', 'conflict'],
  ['UNKNOWN_FUTURE_OUTCOME', 'success'],
])(
  'keeps the frozen write after %s recovery until later definitive %s',
  async (failure, terminal) => {
    await act(async () => requests[0].next({ reportingTimezone: saved() }));
    await input('Europe/London');
    await click('Save timezone');
    const original = requests[1].variables;
    await act(async () => requests[1].error());
    await input('Asia/Tokyo');
    await click('Check saved timezone');
    if (failure === 'replay-unavailable') {
      await act(async () =>
        requests[2].next({ reportingTimezoneAttempt: problem('NOT_FOUND') }),
      );
      expect(requests[3].variables).toEqual(original);
      await act(async () =>
        requests[3].next({ updateReportingTimezone: problem('UNAVAILABLE') }),
      );
    } else {
      await act(async () =>
        requests[2].next({ reportingTimezoneAttempt: problem(failure) }),
      );
    }
    const afterUncertainty = requests.length;
    expect(button('Save timezone').disabled).toBe(true);
    expect(host.querySelector('input')!.value).toBe('Asia/Tokyo');
    expect(
      requests.filter((request) => request.name === 'reportingTimezoneQuery'),
    ).toHaveLength(1);
    // The next check still recovers the original UUID, never a new mutation.
    await click('Check saved timezone');
    expect(requests[afterUncertainty].name).toBe(
      'reportingTimezoneRecoveryQuery',
    );
    expect(requests[afterUncertainty].variables).toEqual({
      attemptId: original.attemptId,
      operation: 'UPDATE',
    });
    await act(async () =>
      requests[afterUncertainty].next({
        reportingTimezoneAttempt:
          terminal === 'success'
            ? saved('Europe/London', '2')
            : problem('CONFLICT'),
      }),
    );
    expect(requests[afterUncertainty + 1].name).toBe('reportingTimezoneQuery');
    await act(async () =>
      requests[afterUncertainty + 1].next({
        reportingTimezone: saved('Europe/London', '2'),
      }),
    );
    expect(button('Save timezone').disabled).toBe(false);
    await click('Save timezone');
    expect(requests.at(-1)!.variables).toMatchObject({
      timezone: 'Asia/Tokyo',
      expectedVersion: '2',
    });
    expect(requests.at(-1)!.variables.attemptId).not.toBe(original.attemptId);
  },
);
