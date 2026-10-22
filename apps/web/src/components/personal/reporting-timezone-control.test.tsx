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
it('renders concrete initial month dates in saved zone across a UTC boundary', async () => {
  expect(
    currentMonthLabel('America/Los_Angeles', new Date('2026-11-01T01:00:00Z')),
  ).toBe('This month: Oct 1, 2026 – Oct 31, 2026');
  expect(
    currentMonthLabel('Asia/Tokyo', new Date('2026-11-01T01:00:00Z')),
  ).toBe('This month: Nov 1, 2026 – Nov 30, 2026');
  await act(async () =>
    root.render(<ReportingTimezoneInitialization showPeriod />),
  );
});
