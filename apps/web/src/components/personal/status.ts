/** Independent persisted facts: no elapsed-time, callback or row-count inference. */
export type ImportFacts = {
  operation: string;
  importState: string;
  usable: boolean;
  recovery: string;
  collection: string;
  reportingState: string;
  freshness: string;
  coverage: string;
  historicalUpdate: string;
  historyAvailability: string;
  lastLocalCommit?: string | null;
  providerSuccessAt?: string | null;
  discrepancyCount: string;
};
export function importSummary(status: ImportFacts) {
  if (status.collection === 'RECONNECT_REQUIRED')
    return 'Reconnect needed. Previously imported history remains; recent activity may be missing.';
  if (
    ['DISCONNECTED', 'REVOKED', 'DESELECTED', 'RETIRED', 'CANCELLED'].includes(
      status.collection,
    )
  )
    return 'Updates stopped. Previously imported private history remains unless explicitly deleted.';
  if (status.reportingState === 'STAGED')
    return 'Replacement staged. This history does not contribute to current reporting.';
  if (status.recovery === 'CONTACT_SUPPORT')
    return 'Import needs attention. Do not restart or reconnect blindly.';
  if (!status.usable)
    return status.importState === 'UNAVAILABLE'
      ? 'History is currently unavailable. No complete activity or total is confirmed.'
      : 'Initial history is importing. Available activity and complete history are not confirmed yet.';
  if (status.freshness === 'STALE')
    return 'Imported history is retained, but updates are stale and recent activity may be missing.';
  return 'Imported history is available. Bank freshness and complete period coverage are separate facts.';
}
export function coverageSummary(status: ImportFacts) {
  if (status.coverage === 'KNOWN_GAP')
    return 'Known collection gap. Retained history cannot cover the interruption.';
  if (status.coverage === 'LIMITED')
    return 'Limited history availability. The requested period may have missing activity.';
  return 'Actual history coverage is unknown, including after a completed historical update.';
}
