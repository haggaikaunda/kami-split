# Personal reporting timezone

The authenticated `reportingTimezone` read and `initializeReportingTimezone` /
`updateReportingTimezone` mutations provide an owner-only persisted preference
without requiring a bank connection. They accept no owner or resource target ID;
the preference is not a Node lookup surface. Every read, write and receipt read
checks the caller's current enabled, provisioned identity and live Auth linkage.
Restricted runtime roles have no direct preference or receipt table privileges.

Initialization validates the device's exact IANA name against PostgreSQL's timezone
database. Omitted/null information uses UTC; empty, unknown, device-local,
numeric-offset and arbitrary POSIX specifications are rejected. Names are not
trimmed or case-folded. Reinitializing with another valid zone returns the saved
value without replacing it. Concurrent initialization has one persisted winner.
Travel never updates the preference automatically.

The preference starts at version 1. An explicit update compares only its positive
`ReportingTimezoneVersion` and increments it once, including a same-zone update.
The scalar is a canonical decimal string bounded to 9007199254740991. A stale or
exhausted version returns `CONFLICT`. Invalid input and conflicts leave state
unchanged. Missing state returns `NOT_INITIALIZED`; initialize before updating.
Name and appearance use their existing independent guards; these operations cannot
overwrite one another. The preference determines today, never reinterprets stored
bank calendar dates or restricts retained history.

Every mutation requires a client-created UUID-v4 `attemptId` known before the
first effect. Actor, operation kind, canonical input (initialization null means
UTC), expected version and original outcome are committed atomically. Identical
retries return that original outcome even after later changes. Reusing a key with
changed input or expected version returns `ATTEMPT_MISMATCH`. Expected validation,
conflict and not-initialized outcomes are also durable. Receipts remain for the
lifetime of the application owner; no expiry or automatic key reuse is supported.

After a lost response or `UNAVAILABLE`, retain the same key and frozen input.
`reportingTimezoneAttempt(operation, attemptId)` recovers only the authenticated
owner's original outcome. `NOT_FOUND` does not prove an in-flight mutation failed:
retry identical input/key. After recovering, read `reportingTimezone` for current
state before an explicit new update. Receipt values describe historical outcomes,
not fresh reporting state. All failures use safe codes without SQL or other-owner
metadata.

The authoritative contract is [the timezone SDL](../../packages/schema/reporting-timezone.graphql).
The [approved Personal banking contract](personal-banking.md#dates-saved-preferences-and-navigation)
defines downstream use: #253 supplies Account controls/device handoff, #252 resolves
coherent date bounds/cursor invalidation, and replacement/recovery uses the saved
zone for allowed transition dates through the [replacement backend](banking-replacement.md). The [sync adapter and restricted persistence](banking-sync.md) implement validated pages and atomic batch/checkpoint commits. Account controls, general reporting reads, worker import orchestration and live enablement remain separate deliveries. This preference does not enable enrollment
or satisfy #255's provider/live gates.
