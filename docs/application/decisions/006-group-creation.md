# ADR-006: Ordinary and trip-group creation

> Seeded-runtime references below are historical evidence. #184 removed the executable preview and simulation-only tests; they must not be retained or restored. Accepted production policy remains authoritative.

- Status: Design for #85; independent review and PR adoption required. No feature implementation.
- Recorded: 2026-09-30.
- Basis: ADR-001–005 and implemented #75 / PR #98, commit b86475f.
- Scope: Smallest creation, discovery and navigation extension to the first real UI.

## Fixed domain and access model

A stable application user is an identity, a membership is that user's permanent
identity within one group, and a group is one access and financial boundary.
Reuse `app.users`, `app.groups`, `app.memberships` and `app.installation` from
[the implemented foundation](../identity-foundation.md). Do not replace their IDs,
Auth linkage, permanent unique membership, RLS or exactly-one-active-owner FK.

`installation.household_group_id` already designates the private household.
`installation.group_creator_user_id` already designates the only additional-group
creator. Neither is inferred from names, earliest rows, current ownership or
number of members. No new household eligibility or partner-role representation
is needed for creation. Bootstrap remains operator-only #81. Creation cannot set
or change either installation pointer or create another designated household.
The existing self-only `Viewer.canCreateGroups` is a UI hint; every write rechecks
the enabled, linked stable identity against the installation pointer.

Ordinary and trip groups share exactly the same membership and ledger. Represent
classification minimally by an optional one-to-one `group_trip` extension keyed
by group ID: absent means ORDINARY, present means TRIP. Expose a derived `kind`
and nullable `trip` object rather than a tag engine or a second persisted enum
that could contradict the extension. The designated household is an ordinary
group with a separate designation; prevent attaching trip metadata to that group.
No parent-group, household-membership inheritance or reporting association.

| Example                  | Explicit active memberships                   | Access and money                                                                                   |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Household H              | designated creator A, invited partner B       | Only A/B see H; its expenses and balances stay in H                                                |
| Trip T                   | creator A, separately admitted B and friend C | A/B/C see all T history, including expenses split only between A/B; no access to H is granted to C |
| Ordinary friends group F | creator A and separately admitted C           | F has its own history and balances; B gains no access from being A's partner                       |

Every new group starts with only its creator as active owner, including trips.
Inviting/admitting anyone else is a subsequent #79/#80 operation. Owning T after
#84 transfer does not give C group-creation permission; A retains its separate
capability even without ownership of T. A valid new invitation restores an
inactive membership as an ordinary member with full history under ADR-004;
classification/dates do not restrict that history. No guest/pending Member rows.

One expense belongs to one group, with payments and shares each equal to its
integer-minor-unit total. Group nets sum to zero. No duplicated household record,
automatic cross-group settlement, private-expense-to-trip-report link or moving
an expense between groups. A future repayment affects two members equally and
oppositely in its original group; this design adds no repayment functionality.

## Minimal metadata and creation contract

The following is a design contract, not SDL imported into gqlgen or Relay.
Reuse ADR-005's public Group/Viewer/Membership IDs, Date and OperationKey scalars,
authentication failures and safe error conventions.

`createGroup(input)` takes `operationKey`, `name`, `kind` (ORDINARY or TRIP),
and optional `trip: { destination, startDate, endDate }`. Kind is explicit on the
wire. Ordinary creation rejects a non-null trip object; trip creation requires
one. Currency is server-fixed USD, with no editable currency input. No actor,
owner, household, membership list, partner, status, cover or expense input.

| Field             | Rule and default                                                                                | Actual consumer/need                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| name              | Required, trim leading/trailing ASCII space/tab/CR/LF, 1–120 Unicode scalar values              | Group selector, trip cards and detail title; preview `validateTripDraft` uses 120 |
| destination       | Optional, absent/null becomes empty string; preserve content, maximum 200 Unicode scalar values | Existing trip form and detail subtitle; no geocoder/place ID                      |
| startDate/endDate | Required for trips; valid Gregorian YYYY-MM-DD, years 0001–9999; end >= start, equal allowed    | Existing cards/detail and date-derived status                                     |
| kind              | Form starts ORDINARY from Groups; Create trip preselects TRIP                                   | Discovery and selecting the small set of trip fields                              |
| currency          | USD server default, read-only label                                                             | Existing USD UI and #75 invariant                                                 |
| status            | Derived, never stored or submitted                                                              | Upcoming before start, In progress on inclusive start/end, Past after end         |
| cover             | Deterministic abstract presentation, no stored field                                            | Existing new-trip fallback; no uploads/remote image selection                     |

Reject NUL/unpaired surrogates in strings, count Unicode scalars consistently in
Go/SQL/browser validation (the preview uses UTF-16 length). No unique-name rule:
separate groups may share a name. Preserve destination whitespace as the preview
does; no silent Unicode normalization. Trip dates initially default to the current
UTC date in the form, editable before submission. Use server-provided `today`
(UTC date sampled once per response) for consistent status and form defaults;
refresh at UTC midnight/on foregrounding, without changing submitted drafts.
Keep All/Upcoming/Past filters; In progress appears in All, matching the preview.
Status never closes a group, blocks writes or filters financial history. Expenses
before/after travel dates remain valid, including pre-trip bookings.

The initial slice creates metadata only. Existing owner-only rename policy is
unchanged but rename/date/destination editing has no new endpoint here. Creation
correction before submit is supported; unknown attempts stay frozen. Conversion
ORDINARY↔TRIP, household reassignment and retrospective metadata editing are
outside these slices, not silently enabled or permanently prohibited. None is
necessary to create/browse the current UI's groups. If requested later, scope
an explicit metadata-update issue with concurrency/history rules; never implement
conversion by copying expenses. Group names are current labels, not historical
name snapshots. Current full-history access remains ADR-004; #86 reporting history
is not decided here.

### Atomicity, authorization and recovery

Creation is identity-scoped because there is no existing group to authorize.
Bind the verified identity using #78 / `WithIdentity`. In READ COMMITTED, lock the
actor user FOR SHARE, recheck enabled/live linkage, then lock/read the installation
row FOR SHARE and recheck its creator pointer. No membership-count, household
membership or ownership test is an added creator requirement. Future operator
pointer updates must take a conflicting installation lock and may not acquire a
user lock afterwards. Creation uses a narrow reviewed database function with
fixed search_path, restricted execution and repeated authorization/validation;
do not grant blanket group/membership INSERT rights to the runtime role or try
to call `lock_group_write` on a nonexistent group.

Serialize by permanent unique `(creator_user_id, CREATE_GROUP, operation_key)`.
After user/installation locks, acquire the attempt row, then insert new server UUID
group and owner membership, optional trip extension and durable creation result
in one transaction. The existing deferred same-group active-owner FK checks at
commit. These are new unshared groups, so no existing group lock is acquired
after the attempt lock. Replays that read an existing group use a separate ordinary
authorized read after the creation transaction, preserving #75 user→group order.
Crash/rollback cannot leave an ownerless group, metadata orphan or success without
the group. Keep a nonfinancial creation record (actor/key/canonical input/group ID/
owner membership ID/created time), not a synthetic financial audit event or ledger
revision increment. A new group has no expenses, repayments or fabricated entries.

Canonical comparison includes operation kind, trimmed name, kind and normalized
trip tuple (destination default empty, exact valid dates); ordinary has null trip.
Same key/input returns the original result; changed input returns
OPERATION_CONFLICT and never overwrites or creates again. Independently generated
keys intentionally represent distinct creations even for identical names.
Structurally valid domain-validation rejection is retained for the key and returned
on retry; editing after that definitive rejection uses a new key. Authentication,
authorization, malformed scalar/transport and transient failures are not recorded
as successful or terminal creation. Attempt storage/lookup has no initial expiry
or pruning job; lifecycle deletion/retention needs a separate reviewed design.
This reuses the recovery pattern without expanding financial operations or #86.

`groupCreationOperation(operationKey)` is self-only: current enabled, linked,
designated creator is required. Return COMPLETED (original Group ID and creator
Membership ID), REJECTED (field errors), NOT_STARTED (no committed attempt), or
safe UNAVAILABLE. Other actors never see another attempt. Replays/lookup of a
completed result must also check current access to the resulting group; inaccessible
results use NOT_FOUND with no group metadata/IDs disclosed. No privileged recovery
exception after departure, disability or grant loss. Lookup/replay authorization
failure does not assert that the original write failed.

Mutation uses the same result states plus OPERATION_CONFLICT; transport loss is
client UNKNOWN. NOT_STARTED is an observation, not proof that an in-flight request
cannot commit. Only retry the identical key/input, serialized by uniqueness.
Completed results identify the original creation, not current metadata or balances:
fetch a fresh authorized Group before opening it. Use existing HTTP 401/503 and
safe NOT_FOUND conventions; FORBIDDEN covers an enabled nondesignated creator.
Do not expose raw SQL/provider errors.

Generate a CSPRNG key before the first request and freeze key/input while pending
or unknown. Persist in tab-scoped sessionStorage through reload, keyed by stable
Viewer ID and operation kind, cleared on logout/account change as in ADR-005 P3.
Unlike expense attempts there is no originating group ID. A group switch cannot
retarget the attempt. Leaving the form preserves it; recovery checks the original
attempt, never searches by name or silently resubmits with a new key. Storage loss
cannot promise deduplication of a new attempt: show accessible groups to inspect
and explain that an earlier create may have completed before deliberate new creation.
Successful completion after navigation does not redirect the user's current page.

## Discovery, navigation and real UI adaptation

Extend the existing proposed `Viewer.groups` / `Group` projection with derived
`kind`, nullable trip metadata, and `isHousehold` only on an already authorized
group. Return `today` in the viewer response. Do not disclose an inaccessible
household ID or installation row. Retain canonical group-ID ordering, full active-
membership filtering and safe no-groups result. No global directory or partner ID.
Cards initially need only name, destination, dates and status; totals/counts are
omitted until a complete authorized group aggregate is implemented. Never derive
them from one expense page or display a missing read as zero.

Use `/groups` for discovery, `/groups/new` for creation, and `/groups/:groupId`
for the selected group. Trips is a filtered view of the same authorized list;
`/trips` may remain that convenience route, linking to canonical group detail.
Financial routes include their group explicitly, e.g.
`/groups/:groupId/expenses/:expenseId`. No production redirect maps seeded IDs
such as `maui` to real groups. Group identity in the URL is authoritative for the
view, but never sufficient for authorization.

| Entry/state                                       | Required presentation                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A or B with active household membership           | Groups and Trips, plus Household shortcut to the authorized designated group; group-local expenses/balances reuse #83                     |
| Friend C                                          | Groups and Trips containing only joined groups; no Household shortcut/setup prompt, partner inference or household label attached to T/F  |
| Enabled viewer with no groups                     | True no-groups state; Create only if canCreateGroups, otherwise invitation guidance; no automatic bootstrap                               |
| Accessible new group                              | Name, USD, creator as sole owner; no expenses; Add expense once #82/#83 are available; invitation entry only when #79/#80 are implemented |
| Wrong/unknown group or expense from another group | Same safe unavailable/not-found view; no title/member/amount leak and no fallback to a different group's record                           |
| Membership removed/account disabled               | Hide sensitive cached fields, block commands and refresh access; return to safe group selection/sign-in as appropriate                    |
| Temporary read failure                            | Explicit unavailable/stale state with retry, never empty/settled; financial commands require fresh authorized context                     |
| Unknown create                                    | Preserved frozen draft and Check creation action; recover with original actor/key/input; no duplicate optimistic card                     |

Default authenticated entry is `/groups`; a valid explicit group deep link is
preserved through sign-in. A Household shortcut is convenience, not the #86
consolidated dashboard. Do not introduce “couple/friend” account roles. Group
switches clear visible old-group records immediately and cancel/ignore stale
responses by actor/session/group/request generation. Scope Relay connection keys,
filters, pagination, source visits and expense drafts by group. Reset Relay and
private drafts on account change/logout. Preserved drafts retain their original
group; returning requires fresh access and never substitutes the selected group.

Reuse the [navigation](../../navigation/README.md) source-visit/focus model:
Back restores list filter, scroll and logical focus after a fresh authorized read;
missing/denied sources fall back to Groups and focus its heading. Direct links
have explicit in-app fallback. Keyboard labels identify group/name/type; selected
group is visible in the heading and Add expense form. Error summary focuses the
invalid field, status/recovery announcements use live regions, dialogs contain
focus and restore it on exit. Verify 320px width, 200% text, keyboard-only flow,
accessible date labels and no color-only status. Do not silently redirect focus
or route when a background request finishes.

### Consumer mapping and migration boundaries

| Current seeded consumer                                                           | Production adaptation                                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `lib/data/port.ts`: one Household Snapshot, embedded Trip[], householdId envelope | #83 Relay per-group reads; separate viewer discovery/create operation; no all-groups financial snapshot                             |
| `lib/data/entry.ts`, entry/setup components                                       | #80 real identity and #81 operator bootstrap; remove production first-household setup path                                          |
| `Member.status = pending`, household controllers                                  | Membership and invitation are distinct #79/#80 projections; invitation grants no access; no fake name-only invite                   |
| `components/trips/form.tsx`, session-command                                      | Create Group with TRIP, identity-scoped recovery; replace text claiming shared household records                                    |
| `lib/trips.ts`, trips cards                                                       | Authorized trip groups, metadata status, no household spending aggregation                                                          |
| `lib/trip-detail.ts`, trips detail                                                | Reuse group detail/expenses; travel dates never constrain expense dates; do not feed household members/expenses into trip positions |
| `lib/ledger.ts` expense.tripId, draft trip picker                                 | Real expense has one groupId; no trip tag/picker within Household or cross-group move                                               |
| trip detail household repayment shortcut, spending charts                         | Keep unavailable until separately implemented for explicit source group; no household repayment link or copied balances             |
| data-provider, navigation/provider, expense links                                 | Actor/group-scoped cache, drafts and source restoration; reject delayed prior-scope responses                                       |

Do not mechanically implement the old DataPort promise of replacing the adapter
without changing consumers: its household/trip shape is incompatible with accepted
production access. The seeded preview was subsequently retired in #184; historical documentation remains evidence only. Do not convert demo fixtures into persisted user data.

Persisted #75 groups backfill as ordinary by absence of trip rows, retaining
installation pointers, UUIDs, membership, currency and history. Additive migration
introduces only the trip extension and creation attempt/result storage/privileges;
no rewrite of #75 migrations. Existing #82 ledger initial-state rules must recognize
new groups as complete empty ledgers without invented zero-valued entries. Migration
checks cover fresh replay, upgrade from #75 and exact desired-schema reconciliation.
Compatible app rollback leaves metadata/results intact; no destructive down migration
or automatic replay/import of the demo. No SDL field ships until its resolver,
authorization and contract tests ship in its owning follow-up.

## Regression scenarios

Design validation compares this contract to #85, #75 implementation, ADR-001–005
and actual consumers above. Independent tester and final-diff reviewer record the
reviewed commit and findings on the PR; repository CI remains required. There are
no runtime tests to add to a documentation-only change merely to assert this prose.
Implementation slices must exercise these observable scenarios:

1. A alone creates ordinary/trip groups with one owner and unchanged H; B/C cannot
   create even if owners elsewhere; email change retains A's capability, disabled
   or replaced identity and missing installation designation fail closed.
2. Same key concurrent/lost-response retry yields one group/owner/result; changed
   input conflicts; two distinct keys can create same-named groups. Inject failures
   between group/member/metadata/result inserts and at commit; no partial state.
   Race disabling/grant change against creation and removal against recovery.
3. Reject invalid name/Unicode/date/type combinations; equal-day/leap-day/date
   boundaries work. Pre-trip bookings remain valid; status never alters access.
4. Real runtime/browser roles cannot bypass creation/access; C cannot enumerate H,
   another actor's creation result, or cross-group records. New group creation
   does not expose or mutate H, including when A no longer belongs to H.
5. Switch actor/group during reads/create/recovery; reload unknown attempt; no
   stale view, duplicate group, wrong draft target or background redirect.
6. Empty authorized group is distinct from partial/failed reads; all members
   including inactive history follow ADR-004. Rejoining returns full history;
   no date-limited or split-participant-only visibility.
7. Integration with #82 verifies exact paid/owed totals and zero-sum nets per group,
   independent equal-and-opposite obligations across H/T never cancel each other.
   No copied expenses, financial revisions or settlement writes from creation.
8. Browser keyboard/responsive/focus/source-return checks cover every state above.

Current creation, discovery and recovery behavior is documented in the [Relay journey](../relay-expenses.md). Historical delivery sequencing lives on [#85](https://github.com/haggaikaunda/kami-split/issues/85).

No additional blocking owner choice was found for this minimal creation scope:
household/creator representation and access policy are settled; metadata mirrors
existing UI; navigation and retry details are engineering decisions for review.
Classification/metadata editing, consolidated metrics/history, settlement UI,
generic tags, automatic partner membership and changed eligibility are explicitly
outside this design, not proposals awaiting an unnecessary approval round.
