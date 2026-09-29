# Simulated entry

## Production onboarding boundary

This page records the simulated entry UX. [ADR-003](../application/decisions/003-bootstrap-groups-and-invitations.md#b1-explicit-administrative-bootstrap-o09) approves an operator-created first Auth account and empty USD Household with ordinary emailed password recovery and verification required. There is no production first-group setup screen or bootstrap invitation. Ordinary invitation onboarding and recovery are separately implemented through #79/#80; bootstrap is #81. This decision does not claim those flows are delivered.

## Seeded preview

Issue #28 provides a deterministic entry rehearsal through `DataPort.entry`. Email input is validated transiently and discarded after requesting a preview link; no credentials, token, message, network delivery or persistent storage is created. These tests are not server-authentication coverage.

Named scenarios cover existing membership, first household, invitation, used/expired/revoked links, wrong identity and expired session. Entry errors and declined invitations deny financial reads, expense detail, commands and operation lookup. Successful existing-member entry retains the active actor and revalidates the adapter. Invitation acceptance activates the pending identity displayed in the preview (or creates the deterministic sample invitee when using the default scenario) and changes actor only once; repeated acceptance does not duplicate membership. First-time entry keeps financial access denied until the implemented [household setup](../household/README.md) creates and selects its distinct empty household.

The UI labels every entry/setup surface as a preview, supplies recovery actions, clears transient email after a request, focuses errors and announces transitions. Scenario switching is disabled while financial operations are unresolved. Existing session drafts are retained and their commands still revalidate actor/access through the shared command provider.

## Recorded issue #28 verification

At issue #28 acceptance, formatting, lint, type checking, 215 tests and production build passed. This count and the browser observations below are historical evidence, not a current suite count. Nine entry contract cases and three UI cases cover every named error, denial, duplicate acceptance, invalid email focus, no retained email, actor restoration and setup handoff. Independent requirements testing added 11 adapter/UI probes; stale read and unmounted-action races were fixed and independently re-reviewed. Live CUA confirmed wrong-account recovery and denied Overview, invitation acceptance to Household, first-time setup-required routing/focus, and invalid email focus with reachable controls at 320px and 200% text. No horizontal page overflow (320px document/viewport, 32px root font). The temporary text-size helper was removed.
