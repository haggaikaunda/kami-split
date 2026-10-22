import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createOperationDescriptor,
  readInlineData,
  type Environment,
  type OperationDescriptor,
} from 'relay-runtime';
import { createScope } from './environment';
import query, {
  type bankingReportingContractQuery,
} from './__generated__/bankingReportingContractQuery.graphql';
import partialQuery, {
  type bankingReportingContractPartialQuery,
} from './__generated__/bankingReportingContractPartialQuery.graphql';
import transactionFragment, {
  type bankingReportingContractTransaction$key,
} from './__generated__/bankingReportingContractTransaction.graphql';

const source = 'stable-source';
const row = (version = 1, note: string | null = null) => ({
  id: `BankingTransaction:fact-${version}:note-${note ?? 'none'}`,
  sourceId: source,
  sourceRevision: String(version),
  amountMinor: version === 1 ? '10000' : '-4000',
  annotationRevision: note ? '2' : '1',
  note,
  excluded: false,
  current: version === 1,
  archives: [
    {
      archiveId: 'archive',
      annotation: { revision: '1', note: 'captured', excluded: false },
    },
  ],
});
const report = (period = 'month', version = 1, note: string | null = null) => ({
  id: `BankingReport:${period}:${version}:${note ?? 'none'}`,
  summary: { netMinor: version === 1 ? '10000' : '6000' },
  accounts: [
    {
      id: `BankingReportAccount:${period}:${version}`,
      accountId: 'stable-account',
      coverage: period === 'month' ? 'COMPLETE' : 'PARTIAL',
      intervals: [
        {
          bindingId: 'binding',
          coverage: period === 'month' ? 'COMPLETE' : 'PARTIAL',
        },
      ],
    },
  ],
  rows: [row(1, note)],
});
const scopes: ReturnType<typeof createScope>[] = [];
function environment() {
  const scope = createScope({} as SupabaseClient, 'owner');
  scopes.push(scope);
  return scope.environment;
}
function read(env: Environment, operation: OperationDescriptor) {
  return env.lookup(operation.fragment)
    .data as bankingReportingContractQuery['response'];
}
const vars = (period = 'THIS_MONTH', after: string | null = null) => ({
  filter: { period: period as 'THIS_MONTH' | 'YEAR_TO_DATE' },
  after,
  source,
  archive: 'archive',
});
const payload = (
  period = 'month',
  version = 1,
  note: string | null = null,
) => ({
  bankingReport: report(period, version, note),
  canonical: { transaction: row(1, note) },
  correction: { transaction: row(2, note) },
  archived: { transaction: row(2, note) },
});
function readTransaction(ref: bankingReportingContractTransaction$key) {
  return readInlineData(transactionFragment, ref);
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.dispose());
  vi.restoreAllMocks();
});

describe('private banking snapshot normalization in the actual Relay store', () => {
  it('keeps canonical and archived/discrepant financial versions coherent in one response', () => {
    const warn = vi.spyOn(console, 'error');
    const env = environment();
    const operation = createOperationDescriptor(query, vars());
    env.commitPayload(operation, payload());
    const data = read(env, operation);
    expect(readTransaction(data.canonical.transaction!)).toMatchObject({
      sourceId: source,
      sourceRevision: '1',
      amountMinor: '10000',
    });
    for (const detail of [data.correction, data.archived])
      expect(readTransaction(detail.transaction!)).toMatchObject({
        sourceId: source,
        sourceRevision: '2',
        amountMinor: '-4000',
      });
    expect(data.bankingReport.summary?.netMinor).toBe('10000');
    expect(readTransaction(data.bankingReport.rows[0]).amountMinor).toBe(
      '10000',
    );
    expect(warn).not.toHaveBeenCalled();
  });
  it('keeps differing-range coverage and mutable annotations separate from retained pages', () => {
    const env = environment();
    const month = createOperationDescriptor(query, vars());
    const year = createOperationDescriptor(query, vars('YEAR_TO_DATE'));
    const oldPage = createOperationDescriptor(
      query,
      vars('THIS_MONTH', 'old-boundary'),
    );
    env.commitPayload(month, payload());
    env.commitPayload(oldPage, payload());
    env.commitPayload(year, payload('year', 2, 'latest note'));
    const monthData = read(env, month);
    const yearData = read(env, year);
    expect(monthData.bankingReport.accounts[0]).toMatchObject({
      accountId: 'stable-account',
      coverage: 'COMPLETE',
      intervals: [{ coverage: 'COMPLETE' }],
    });
    expect(yearData.bankingReport.accounts[0]).toMatchObject({
      accountId: 'stable-account',
      coverage: 'PARTIAL',
      intervals: [{ coverage: 'PARTIAL' }],
    });
    expect(readTransaction(monthData.bankingReport.rows[0]).note).toBeNull();
    expect(readTransaction(yearData.bankingReport.rows[0])).toMatchObject({
      note: 'latest note',
      archives: [{ annotation: { note: 'captured' } }],
    });
    env.commitPayload(month, payload('month', 2, 'latest note'));
    expect(
      readTransaction(read(env, oldPage).bankingReport.rows[0]).note,
    ).toBeNull();
  });
  it('a partial same-argument refresh cannot combine fresh rows with an old unselected summary', () => {
    const env = environment();
    const full = createOperationDescriptor(query, vars());
    const partial = createOperationDescriptor(partialQuery, vars());
    env.commitPayload(full, payload());
    const before = read(env, full).bankingReport;
    env.commitPayload(partial, {
      bankingReport: {
        id: report('month', 2, 'new note').id,
        rows: [row(1, 'new note')],
      },
    });
    const refreshed = env.lookup(full.fragment);
    expect(refreshed.isMissingData).toBe(true);
    expect(
      (refreshed.data as bankingReportingContractQuery['response'])
        .bankingReport.summary,
    ).toBeUndefined();
    expect(readTransaction(before.rows[0]).note).toBeNull();
    expect(
      (
        env.lookup(partial.fragment)
          .data as bankingReportingContractPartialQuery['response']
      ).bankingReport.rows[0].note,
    ).toBe('new note');
  });
});
