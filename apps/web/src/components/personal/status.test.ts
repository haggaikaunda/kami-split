import { expect, it } from 'vitest';
import { coverageSummary, importSummary, type ImportFacts } from './status';
const facts: ImportFacts = {
  operation: 'IDLE',
  importState: 'USABLE',
  usable: true,
  recovery: 'NONE',
  collection: 'COLLECTING',
  reportingState: 'CURRENT',
  freshness: 'OBSERVED',
  coverage: 'UNKNOWN',
  historicalUpdate: 'COMPLETE',
  historyAvailability: 'unknown',
  discrepancyCount: '0',
};
it('never converts local usable history and provider completion into complete bank coverage', () => {
  expect(importSummary(facts)).toContain('separate facts');
  expect(coverageSummary(facts)).toContain('unknown');
  expect(
    importSummary({ ...facts, usable: false, importState: 'LOADING' }),
  ).toContain('Initial history is importing');
});
it.each(['DISCONNECTED', 'REVOKED', 'DESELECTED', 'RETIRED'])(
  'retains history for %s and explains collection gaps',
  (collection) => {
    expect(importSummary({ ...facts, collection })).toContain(
      'Previously imported private history remains',
    );
    expect(coverageSummary({ ...facts, coverage: 'KNOWN_GAP' })).toContain(
      'cannot cover the interruption',
    );
  },
);
it('keeps staged, reconnect, stale and exhausted work actionable without fake completion', () => {
  expect(importSummary({ ...facts, reportingState: 'STAGED' })).toContain(
    'does not contribute',
  );
  expect(
    importSummary({ ...facts, collection: 'RECONNECT_REQUIRED' }),
  ).toContain('Reconnect needed');
  expect(importSummary({ ...facts, freshness: 'STALE' })).toContain(
    'recent activity may be missing',
  );
  expect(importSummary({ ...facts, recovery: 'CONTACT_SUPPORT' })).toContain(
    'Do not restart',
  );
});
