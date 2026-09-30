# Open architecture decisions

This register distinguishes accepted outcomes from unresolved questions; it is not an implementation backlog. Accepted foundations are in [ADR-001](001-backend-foundation.md) and refinements in [ADR-002](002-authentication-and-database-operations.md) [ADR-003](003-bootstrap-groups-and-invitations.md), and [ADR-004](004-group-balances-membership-and-recovery.md). Resolve each entry in a reviewed ADR/update and link its implementation issue when created. Keep stable IDs and retain resolved entries with their outcome.

## O01–O07: accepted policies and remaining details

[ADR-002](002-authentication-and-database-operations.md) records the accepted outcomes. These entries are retained for traceability; partially settled does not mean the policy is unapproved or the feature is implemented.

| ID  | Status and accepted outcome                                                                                                                                                                             | Still to resolve                                                                                                                       | Timing                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| O01 | Policy settled: email/password, invite-only, Supabase Auth + Resend, seven-day invitation, same-link resend extending expiry, acceptance/revocation terminal                                            | Bootstrap and lifecycle policies settled in ADR-003; O09/O10 retain details; delivery configuration remains                            | Auth and invitations                            |
| O02 | Policy settled: golang-jwt/v5 + keyfunc/v3, ES256, Relay Bearer transport, Supabase session integration, no immediate session revocation, hourly JWKS refresh/two-hour maximum age                      | Exact versions, issuer/audience values, fetch timeout/rate limit and clock tolerance; ADR-006 settles token lifetime/logout scope      | Auth integration                                |
| O03 | Partially settled: stable application identity, unique Auth link, ordinary invite-based retry-safe provisioning plus ADR-003 administrative bootstrap, verified email changes, deactivate-before-delete | Retention/anonymized display, account-deletion recovery, group closure dependencies                                                    | User lifecycle                                  |
| O04 | Architecture settled: private app schema, separate restricted roles, transaction-local verified identity, RLS isolation, Go business authorization                                                      | Concrete role grants, policy SQL and helper privileges, tested claims mapping                                                          | Database foundation                             |
| O05 | Partially settled: direct pgxpool/session fallback, initial five-connection cap, verified TLS, separate secrets                                                                                         | Host/region, hosted staging choice, connection mode and total deployment budget                                                        | Hosted connectivity                             |
| O06 | Workflow settled: stable tooling only, desired SQL plus migrations, Supabase local stack and API Compose, isolated synthetic CI                                                                         | Local tooling resolved by [database foundation](../database-development.md); real query/managed-object analysis awaits business schema | Persistence tooling                             |
| O07 | Policy settled: serialized GitHub Actions deployment, no cancellation/startup runner, expand/backfill/contract, free-plan-only backups                                                                  | Deployment triggers, staging choice, verified backup/export availability and storage/retention, tested recovery limits                 | First deployed migrations and production launch |

## Partially resolved membership and invitation decisions

- **O09:** ADR-003 settles administrative bootstrap, designated-identity-only group creation and atomic ownership-transfer eligibility. [ADR-004 C1/C2](004-group-balances-membership-and-recovery.md#c2-departure-removal-visibility-and-readmission) settles automatic within-group simplification, exactly-zero individual group net as the common departure/removal financial condition, retained history/identity, ordinary-member/full-history readmission and minimal disclosure. Original pairwise obligations are no additional departure gate. Owner/authorization and enabled-account checks remain; transfer must precede owner departure. [#75](https://github.com/haggaikaunda/kami-split/issues/75) retains uniqueness, ownership representation, atomic balance/membership protocol, Auth-link deletion/retry, minimal household/creation-grant representation and their implementation validation.
  P1's exact minimal member/profile fields are owner-approved in
  [ADR-005 / S2](../proposals/first-expense/shared.md#s2-disclosure-and-historical-attribution):
  membership ID, displayName, status, role and canParticipate; self-only Viewer
  identity/capabilities, no peer email/Auth IDs/global directory. Profile retention,
  anonymization and broader lifecycle policies remain open. Transfer [#84](https://github.com/haggaikaunda/kami-split/issues/84) remains deferred; bootstrap implementation is [#81](https://github.com/haggaikaunda/kami-split/issues/81).
- **O10:** ADR-003 settles invitation expiry, same-link resend, duplicate handling, terminal/race outcomes and reusable-token protection. [ADR-004 C2](004-group-balances-membership-and-recovery.md#c2-departure-removal-visibility-and-readmission) resolves readmission: new valid invitation and authorized acceptance restore the same ordinary membership with full history, including absence-period activity; old accepted links and disabled accounts cannot reactivate access. [#79](https://github.com/haggaikaunda/kami-split/issues/79), with #75 and [#80](https://github.com/haggaikaunda/kami-split/issues/80), retains email comparison/current-verification evidence, expiry clock/boundary, locks/admission and authorization rechecks, delivery-failure semantics, key/format details and retention decisions.

[#77](https://github.com/haggaikaunda/kami-split/issues/77) was completed by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92). [#93](https://github.com/haggaikaunda/kami-split/issues/93) supplies the later ADR-004 policy documentation and affected-issue synchronization. These policies are recorded rather than awaiting a future policy ADR; remaining engineering design and implementation are separate gates. Neither baseline nor follow-up automatically makes #75/#76/#79 ready.

## Partially resolved financial contract and recovery decisions

- **O13:** [ADR-004 C3/C4](004-group-balances-membership-and-recovery.md#c3-same-attempt-financial-recovery) settles same-attempt/same-key recovery, current actor/group authorization, same-canonical-input single effect, changed-input protection, durable atomic expense/allocations/audit/result, and immutable-outcome versus fresh-balance meaning. Global IDs, cursors, pagination/filtering, error conventions, expected-version behavior, precise key scope/canonicalization/mismatch/lookup protocol are concretely specified by ADR-005 for [#76](https://github.com/haggaikaunda/kami-split/issues/76) before implementation. P2 now retains operation recovery/idempotency records with associated financial history; no timed expiry/tombstones. Future deletion/archival/pruning remains lifecycle work.
- **O14:** ADR-004 requires the frontend to possess the key before its first write and preserve uncertain-attempt recovery without silently generating a new key. Owner-approved P3 now selects tab-scoped `sessionStorage` for drafts/unresolved attempts, surviving same-tab reload and cleared on logout/account switch; P2 now retains server operation records with financial history, without adding a timed browser expiry or extending storage beyond that tab/session. Owner-approved P4 selects group selection, expense list/create, complete balances and recovery as the first real UI, with remaining preview features isolated. These choices are recorded in [ADR-005](005-identity-and-expense-contract-proposal.md). Implementation of the reviewed recovery/refresh contract and #80 session/logout details remain for [#83](https://github.com/haggaikaunda/kami-split/issues/83); #76 owns design only. No 90-day expiry/tombstone lifecycle is approved; uploaded receipt attachments remain outside the first journey.

## Other open decisions

| ID  | Decision to make                                                                                                                                                 | Resolve before                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| O08 | MinorUnits accepted syntax, int64/aggregate bounds, overflow errors, Relay scalar mapping and frontend arithmetic; stable cross-language participant ID ordering | Money schema and calculations    |
| O11 | Historical expense corrections involving inactive members; effects on previously settled obligations; settlement edit/reversal authorization and audit           | Edit/delete and settlement flows |
| O12 | Last-owner departure, group archival/deletion, handling disputed or unresolvable obligations, account deletion while membership obligations remain               | Departure/group closure          |
| O15 | Hosting, regions, CORS/TLS, rate/query budgets, latency targets, metrics/log retention, alerting and operational recovery                                        | Production launch                |
| O16 | Plaid eligibility/consent, credential storage, webhook verification, sync cursors/reconciliation, pending-to-posted changes, expense assignment                  | Plaid integration                |
| O17 | Queue payloads, atomic enqueue/outbox choice, visibility/lease durations, retry/backoff, poison-message handling, deduplication and worker monitoring            | Durable jobs                     |

## Group and reporting decisions

| ID  | Accepted boundary and remaining decision                                                                                                                                                                                                                                                                                                                                                                                                                                  | Resolve before                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| O18 | ADR-003 B2 accepts one group foundation, independent membership/ledgers and trip classification with structured metadata. Household designation/eligibility representation, trip metadata/validation, creation defaults and navigation/classification changes need design in [#85](https://github.com/haggaikaunda/kami-split/issues/85), with minimal schema representation in #75. No generic tags or private-household-expense-to-trip-report association is approved. | Affected schema decisions; full group/trip design is outside #73 |
| O19 | ADR-003 B3 accepts household plus both-active-partner groups and source-group repayment shortcuts. Combined/individual metrics, “our spending”/average-trip formulas, pre-partner state, and historical reporting after membership changes remain for [#86](https://github.com/haggaikaunda/kami-split/issues/86). Combined allocated shares are only a proposal.                                                                                                         | Consolidated reporting design; not #73                           |

Automatic within-group simplification is accepted in [ADR-004 C1](004-group-balances-membership-and-recovery.md#c1-automatic-simplification-within-one-group-and-currency). Deterministic matching/tie-breaks, stability as the ledger changes, API representation and explanatory UI remain engineering design in #75/#76 and later consumers. No minimum-repayment-count guarantee or per-group toggle is approved. Complete server projections and eligibility must agree; partial reads cannot imply settlement. O19's inclusion rule is unchanged: every individual's net must be zero in a group for that group to be settled; cross-group cancellation and hiding partners' nonzero obligations remain invalid.

O08 now has the reviewed exact scalar/arithmetic/ordering contract in ADR-005. Runtime coercion and cross-language financial tests remain implementation requirements. No transfer, trip, reporting or settlement feature becomes a first-journey prerequisite through this register.

## Working sequence

Resolve the relevant subset rather than designing every future feature now: domain contract and access boundaries → persistence/local infrastructure → identity and minimal membership → first real expense/balance journey with Relay → safe edits/settlements and remaining UI workflows → operational readiness → Plaid and workers. Track detailed sequencing and delivery in GitHub issues; this register is not evidence that features exist.

## Concrete #75/#76 design

[ADR-005](005-identity-and-expense-contract-proposal.md) and its
[gate matrix](../proposals/first-expense/gates.md) specify O04 grants/context,
O08 money/ordering, O09 identity/ownership/disclosure, O13 pagination/recovery,
O14 client lifetime/first-route scope, and minimal O18 household designation.
The owner approved P1 profile fields, P3 browser storage direction and P4 first UI
scope on 2026-09-29. The later [owner P2 decision](https://github.com/haggaikaunda/kami-split/pull/95#issuecomment-5901138197) resolves operation-record retention for the lifetime of associated financial history. These resolve the first-journey policy subsets of O09/O13/O14; final-head delivery checks and implementation remain separate. Stable register entries and unrelated questions are retained.

O10's earlier wording must be read with the newer owner-approved
[email comparison/delivery](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886277636),
[valid-link preview/shared links](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886419039),
and [immediate first-time admission](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886876182)
comments. #79/#80 own their complete reviewed reconciliation. Former-member
shared-link readmission is resolved by I1 below: new targeted invitation required.

## O01/O02/O10: invitation and onboarding reconciliation

[ADR-006](006-invitation-onboarding-design.md) and its
[gate matrix](../proposals/invitations/README.md) reconcile newer #79/#80 comments:
email comparison, committed-state-versus-delivery behavior, valid-link two-field
preview, reusable owner-distributed shared links and immediate first-time joining
are owner-approved. Do not treat them as open product choices because older rows
or issue bodies predate the comments. Shared joins do not globally consume links.

The [owner I1–I5 decisions](https://github.com/haggaikaunda/kami-split/pull/101#issuecomment-5904210048)
resolve former-member return (new targeted invitation only), shared controls,
terminal recipient/token cleanup, bounded delivery-material recovery, 15-minute
access tokens/current-session logout and critical-path placement. Shared-link
implementation is separately tracked in #108; targeted #79/#80 delivery belongs
to #73. #78 is complete and no longer blocks implementation. Engineering validates
bounded current-email evidence and its non-atomic provider race, lock ordering,
provider behavior and purge/retry mechanics within those approved boundaries.

### O18: #85 creation design resolution

[ADR-006](006-group-creation.md) resolves the minimal creation design: reuse the implemented #75 installation designation/creator pointers, ordinary groups with optional trip metadata, explicit membership, identity-scoped atomic creation/recovery and group-scoped real UI navigation. Independent review and PR adoption remain required. Follow-up implementations are linked from that ADR; this is not delivered functionality. Metadata editing/reclassification is excluded from the initial slice and needs its own issue if requested. O19 remains wholly with #86; no report formula, partner inference or settlement design is added.

### O19: #86 dashboard design and explicit deferrals

[ADR-007](007-household-dashboard.md) specifies individual net/gross metrics, complete server-authorized eligible-group reads, group-local simplified obligation rows, failure states and one shared original-group repayment form/recovery path. Adoption requires independent requirements/final-diff review and required CI. [#109](https://github.com/haggaikaunda/kami-split/issues/109) retains owner agreement on pair designation/change, dashboard access and disabled-partner behavior before implementation. No inferred partner identity is approved. Spending/average formulas and historical reporting remain explicitly deferred; current complete group history follows ADR-004. [#110](https://github.com/haggaikaunda/kami-split/issues/110) gates settlement permissions/validation and persistence; [#111](https://github.com/haggaikaunda/kami-split/issues/111) and [#112](https://github.com/haggaikaunda/kami-split/issues/112) separate backend summaries and UI. No unfinished fields enter the running SDL or expand #73.

The [#109 policy (ADR-008)](008-household-partner-policy.md) addresses pair authority, consent, pre-onboarding, separation, disabled/unlinked accounts and compatible locks. Owner agreement includes larger Households with a distinct two-person dashboard pair and no owner self-invitation. Independent design adoption remains required. Spending formulas and historical reporting remain deferred; designation implementation is still a separate prerequisite for #111.
