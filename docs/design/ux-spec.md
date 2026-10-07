# UX specification

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

Production-policy note: [ADR-004](../application/decisions/004-group-balances-membership-and-recovery.md) now accepts automatic within-group simplification, revised departure eligibility and recovery/readmission requirements. Unsimplified debt and session-only behavior in this document remain historical seeded-preview requirements/evidence, not the current production policy.

## Scope and screen inventory

Kami Split makes shared spending and repayment understandable for an invited household. The initial sample uses Kaunda and Mizenin. Member count, identifiers, copy and layout must not encode a permanent two-person limit.

This phase uses deterministic seed data and session-local mutations behind an async data-access interface. No database, durable storage, real email delivery, identity provider or real authorization is implemented. Simulated private-access screens and denial states must be labeled as previews. Real server authentication and household authorization remain a future release gate, never something a hidden button can satisfy.

| ID  | Screen                          | Required outcome                                                                    |
| --- | ------------------------------- | ----------------------------------------------------------------------------------- |
| H01 | Overview                        | Understand who owes whom, inspect contributions, add an expense or record repayment |
| H02 | Spending visualization          | Explore daily/monthly/yearly spending and inspect underlying records                |
| E01 | Add expense                     | Record and reconcile the complete allocation before saving                          |
| E02 | Expense detail                  | Read the financial record, associated trip and immutable revisions                  |
| E03 | Edit expense                    | Revalidate and save a new revision of the entire expense                            |
| E04 | Delete confirmation / tombstone | Remove financial effect with an explicit confirmation and retained history          |
| S01 | Record repayment                | Preview changes, then record a repayment without moving money                       |
| A01 | History                         | Trace expenses, repayments, edits and deletions chronologically                     |
| T01 | Trips list / create             | Organize spending by named trip and dates                                           |
| T02 | Trip overview                   | See total spent, allocated share, contributions and chart breakdowns                |
| T03 | Trip expenses                   | Inspect and filter expenses grouped by effective date                               |
| U01 | Sign-in / invitation preview    | Explore entry, expired-link and unavailable-access paths                            |
| U02 | Household setup / membership    | Name the household and explore owner/member management                              |
| R01 | Recovery states                 | Recover from validation errors, failed requests, conflicts and unavailable records  |

Use [screen-flows.md](screen-flows.md) as the navigation contract and [data-access.md](data-access.md) for domain/adapter boundaries.

## H01: Overview

Four destinations: Overview, History, Trips, Household. Desktop uses persistent side navigation; phone uses bottom navigation. Profile leads to account/sign-in preview. Overview prioritizes a compact balance card and Add expense / Record repayment actions; contribution cards, spending chart and recent activity follow. Do not add a separate duplicate Balances destination.

Name both parties: “Kaunda owes Mizenin $42.18 USD”; at zero say “You’re all settled up.” For 3+ members show positions per member and direct obligations based on actual payer/participant relationships, without generating a simplified repayment plan. Keep each currency separate. Use real names from member data rather than “partner.”

“How this adds up” reconciles allocated share minus expenses paid minus net repayments sent. Contributions mean expenses paid, excluding repayments. Recent activity includes revisions and repayments, clearly labeled. Deleted expenses do not contribute to active totals.

## H02: Spending charts

Daily = all dates within selected month; Monthly = twelve months in selected year; Yearly = five-year window. Previous/next changes one month, one year or five years respectively. Scope switches between household expense totals and signed-in member allocations; neither means expenses that person paid. Period and scope must remain visible and survive detail navigation.

Use bar charts with a zero baseline and readable scale. Every bar has an exact amount and expense count in its accessible name; activate it to inspect contributing records. Provide an equivalent exact-value data table. Zero periods stay zero and open a useful empty result. No reliance on hover, color or a chart alone for financial information. All calculations use current active expense revisions and **expense effective dates**, not creation timestamps. Repayments/deleted records are excluded. Editing amount/date/trip/category immediately updates all affected queries; never duplicate a trip expense in household totals. USD is the seed phase's only enabled currency, explicitly labeled; data carries ISO currency and future queries must partition rather than convert currencies.

## E01/E03: Expense forms

Order: prominent amount and currency; description; payer and effective date; category and optional trip; participants and split method; reconciliation; optional note; cancel/save. Focus the amount field on entry. Default signed-in payer, all active members, Equal mode, household currency and current local date. In trip context preselect that trip; suggested date is current date clamped to the trip range, visibly editable. Allow legitimate pre-trip booking expenses outside travel dates.

Fields: nonblank description (up to 120 characters), positive exact monetary amount, ISO currency, valid date, one payer, explicit participant set, split mode, resolved allocations, category, nullable trip ID and optional note. Categories: Dining, Groceries, Accommodation, Transport, Activities, Home, Other. Trip “Everyday expense” clears association. Seed picker offers USD only.

Equal, Exact and Percentage modes are mutually exclusive. Percentage is implemented under [#199](../application/percentage-splits.md), with explicit linking, remaining assignment and historical intent; each mode retains its draft inputs. Divide integer minor units with deterministic remainder assignment in stable member order; explain the extra cent and show allocations. A $10.01 split becomes $5.01/$5.00. Exact shares may be zero but cannot be negative; excluded membership differs from an included member with zero share. At least one participant required; payer need not participate. Selecting/deselecting members must not silently erase a manual draft; warn before discarding exact allocations on mode changes.

Reject zero/negative values, malformed decimals, too many decimal places, amounts above the documented safe bound, invalid dates, missing payer/participants and unsupported currencies. Do not silently round. Inline field errors appear on blur/submit, associate through aria-describedby and set aria-invalid. A submit error summary focuses the first invalid control. Reconciliation announces exact remaining/excess amounts and blocks save until sum equals total. Editing revalidates the full form including unchanged fields.

Use one submission operation ID, disable during save, do not allow Enter/double click to duplicate. On timeout retain draft and operation ID. Success closes once, announces success and refreshes derived views. Cancellation and browser navigation away from dirty forms require Keep editing / Discard changes; preserving a draft is distinct from falsely claiming it was saved. Desktop uses a contained dialog; mobile uses a full-screen form with reachable/sticky actions, safe-area padding and keyboard-aware scrolling.

## E02/E04: Detail and deletion

Use a stable expense URL. Desktop contextual entry opens a side panel with Open full page. Phone and direct-link entry use a full detail page. Present category icon, name, effective date, total/currency, payer, category, optional trip link, creator, revision, participant allocations, note and readable activity snapshots. An edit updates this same record and returns to the same detail presentation.

Delete confirmation names expense and amount, explains exclusion from balances/charts and retained history, offers optional reason, and separates Keep expense from destructive Delete expense. Default focus is the safe action. Soft deletion creates an immutable event with actor/timestamps/revision; the detail URL stays readable as a tombstone with edit/delete disabled. Repeated submission cannot apply deletion twice. Do not add restoration behavior without an explicit product decision.

Revision snapshots show before/after or complete comparable values: amount, effective date, payer, participant membership, allocations, split method, category, trip, note, creator/editor and reason where relevant. Actor names must correspond to actor IDs; creation actor never changes because someone else edits.

## S01: Record repayment

Capture distinct sender/recipient, positive amount/currency, effective date and optional note. Default the owing member → owed member and full outstanding amount for a pair; for groups require an explicit pair. Before/after preview names the affected people, exact amounts and any reversed direction. Require acknowledgment for overpayment/reversal. At zero do not invent a positive default.

Copy: “This records a repayment. No money is moved.” Repayments change positions by equal/opposite values and never change expense contribution or spending charts. Do not assign repayments to trips in this phase. Desktop short dialog / mobile full-screen form. Save returns to its source with updated positions and history. Do not implement payment methods, actual payments or unaudited repayment editing/deletion.

## A01: History

Chronological activity contains creations, edits, deletion tombstones and repayments, not merely active purchases. Provide description search, event type and member filters. Expense filter shows creation events; edits/deletions have dedicated filters. Member filter means participant/payer or repayment sender/recipient, not the editor alone. Show a year when necessary to distinguish multi-year samples. Order by event timestamp plus deterministic sequence; distinguish event time from expense effective date. Selecting an event opens current detail with its relevant revision identifiable. Repayment detail is read-only and retains source context.

Seed phase does not require pagination, date-range filters or additional reports; these must not be inferred from earlier aspirational notes. Empty filters offer Clear filters without destroying underlying data.

## T01/T02/T03: Trips

Cards show cover/default treatment, name, dates/year, Upcoming/In progress/Past state, total spent and expense count. All/Upcoming/Past filters work; in-progress trips appear in All. Create requires nonblank name, valid start/end and end >= start; optional destination. No budgets or itinerary fields.

Overview shows total expenses, your allocated share, each member’s expenses paid, daily spending and category bars with exact values. Day drill-downs show contributing records, including zero days. Include expenses outside travel dates; no truncation of long ranges. Provide scrollable or appropriately aggregated charts with explicit coverage for long ranges. Expenses tab groups by effective day and supports description/category filtering. Add expense preselects trip. Every trip expense is the same household record, counted once. Trip settlement action explicitly opens household repayment, not a new trip debt ledger. New trips may use default covers; cover upload/edit is excluded.

## U01/U02: Access and household previews

Clearly mark simulated sign-in; do not send emails. Show email-link request/sent, expired/used/revoked link and wrong-account states, invitation accept/decline and first-household setup. Setup captures household name/default USD; invitation-only membership uses active/pending/inactive statuses and owner/member roles. Pending invitations can be simulated as resent/revoked. Owner actions unavailable to ordinary members, with adapter-level denial as well as UI restrictions. Last owner cannot leave without ownership transfer; removal of a member with an outstanding balance is blocked. Removing access must retain financial attribution. These are deterministic domain/UI simulations, not a privacy guarantee. Production server authorization is a separate future gate.

## R01: Shared states

- Loading: skeletons, never fake $0 balances; preserve prior valid data during refresh with an explicit state.
- Empty household: prompt for first expense; empty trip: totals zero and useful Add expense; filtered empty: clear filters.
- Invalid amount/split: exact inline errors, preserve input and reconcile again.
- In flight/duplicate: pending button and stable request ID; duplicate returns original result.
- Offline or timeout: preserve draft, explain unknown outcome, query operation status then retry with same ID.
- Stale revision: preserve original/latest/draft, show differences and explicitly reapply to latest version; never silent overwrite.
- Concurrent deletion: show tombstone and retain draft for reference; do not recreate automatically.
- Session expired/denied/unavailable: avoid disclosing fields, return to safe destination; simulated access recovery revalidates before continuing.

Use deterministic fixture scenarios in the seed adapter rather than production-looking buttons that merely show a toast. Clear scenario controls belong in a marked development/demo surface.

## Shared visual and accessibility rules

Forest-green primary actions, pale-green balance surface, white financial cards, coherent line/category icons, Manrope display and DM Sans body (system fallbacks). Extract spacing, color, radius, type, focus, elevation and breakpoint tokens; do not copy the prototype's cascading overrides. Money uses tabular numerals, integer-derived formatting and visible currency.

Reusable primitives: shell/nav, avatar/member selector, money/date/currency fields, split mode and allocation rows, reconciliation status, buttons/loading, dialog/panel, confirmation, toast/error summary, cards, event row, chart/table and empty/skeleton states. Do not introduce a second design system unnecessarily.

Phone-first at 320/390px, tablet around 768px, desktop 1280px+. Prototype panel/full-screen boundary is 760px. Layout transitions preserve record identity, draft and context. Use at least 44px interactive targets, visible focus, sufficient contrast, real labels, sensible heading order, keyboard operation, no color-only status, reduced-motion support, 200% text enlargement and screen-reader announcements. Keep focus inside dialogs and restore it to the trigger or a sensible surviving fallback after mutation. Validate soft-keyboard and safe-area behavior; no clipped controls or accidental page-wide horizontal scroll. Charts may have clearly scoped horizontal scrolling.
