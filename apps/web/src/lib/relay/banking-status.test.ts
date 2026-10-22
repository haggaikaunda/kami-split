import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationDescriptor } from 'relay-runtime';
import { createScope, financialDataID } from './environment';
import query from './__generated__/bankingStatusContractQuery.graphql';

const status = (reportingState: 'CURRENT' | 'STAGED' | 'RETIRED') => ({
  operation: reportingState === 'STAGED' ? 'RUNNING' : 'COMMITTED',
  importState: reportingState === 'STAGED' ? 'UNKNOWN' : 'USABLE',
  usable: reportingState !== 'STAGED',
  recovery: 'NONE',
  collection: reportingState === 'RETIRED' ? 'RETIRED' : 'COLLECTING',
  reportingState,
  freshness: 'UNKNOWN',
  coverage: 'UNKNOWN',
  historyAvailability: 'unknown',
  requestedAfter: '2025-10-21',
  requestedThrough: '2026-10-21',
  coverageAfter: null,
  coverageThrough: null,
  historicalUpdate: 'UNKNOWN',
  providerUpdateStatus: null,
  historicalUpdateAt: null,
  lastLocalCommit: null,
  providerSuccessAt: null,
  providerFailedAt: null,
  retryAt: null,
  attempts: 0,
  importRevision: '1',
  dataRevision: '1',
  bindingGeneration: '1',
  accountGeneration: '1',
  reportingRevision: '2',
  planRevision: null,
  intervals: [],
  discrepancyCount: '0',
});
const payload = (
  connection: string,
  stream: string,
  reporting: 'CURRENT' | 'STAGED' | 'RETIRED',
) => ({
  bankingConnection: {
    code: 'READY',
    connection: {
      id: connection,
      state: 'active',
      generation: '1',
      deletionGeneration: '0',
      permission: 'granted',
      health: 'healthy',
      cleanup: 'not_requested',
      purge: 'not_requested',
      snapshotRevision: `snapshot-${stream}-${reporting}`,
      accounts: [
        {
          id: 'same-logical-account',
          streamId: stream,
          selected: reporting !== 'RETIRED',
          requestedHistoryDays: 365,
          importStatus: status(reporting),
        },
      ],
    },
  },
});

describe('banking status consumer identity', () => {
  it('preserves old and staged stream facts for the same logical account across connection reads', () => {
    const scope = createScope({} as SupabaseClient, 'owner');
    const old = createOperationDescriptor(query, { connectionId: 'old' });
    const replacement = createOperationDescriptor(query, {
      connectionId: 'replacement',
    });
    scope.environment.commitPayload(
      old,
      payload('old', 'old-stream', 'CURRENT'),
    );
    scope.environment.commitPayload(
      replacement,
      payload('replacement', 'new-stream', 'STAGED'),
    );
    const read = (operation: typeof old) =>
      scope.environment.lookup(operation.fragment).data;
    expect(read(old)).toMatchObject({
      bankingConnection: {
        connection: {
          accounts: [
            {
              streamId: 'old-stream',
              importStatus: { usable: true, reportingState: 'CURRENT' },
            },
          ],
        },
      },
    });
    expect(read(replacement)).toMatchObject({
      bankingConnection: {
        connection: {
          accounts: [
            {
              streamId: 'new-stream',
              importStatus: { usable: false, reportingState: 'STAGED' },
            },
          ],
        },
      },
    });
    scope.environment.commitPayload(
      old,
      payload('old', 'old-stream', 'RETIRED'),
    );
    expect(read(replacement)).toMatchObject({
      bankingConnection: {
        connection: {
          accounts: [{ importStatus: { reportingState: 'STAGED' } }],
        },
      },
    });
    const source = scope.environment.getStore().getSource();
    expect(source.get('BankingAccount:old-stream')?.id).toBe(
      'same-logical-account',
    );
    expect(source.get('BankingAccount:new-stream')?.id).toBe(
      'same-logical-account',
    );
    scope.dispose();
    expect(source.size()).toBe(0);
  });

  it('keeps projections without a selected streamId parent-scoped', () => {
    expect(
      financialDataID({ id: 'same-logical-account' }, 'BankingAccount'),
    ).toBeNull();
    expect(
      financialDataID(
        { id: 'same-logical-account', streamId: 'stream' },
        'BankingAccount',
      ),
    ).toBe('BankingAccount:stream');
  });
});
