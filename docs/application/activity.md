# Authenticated activity

Issue #172 adds `groupActivity` and `householdActivity`. Both read immutable
expense-created, expense-updated and repayment-recorded events directly from
persisted financial history. They never merge client expense/repayment pages,
include preview History or invent delete/reversal events.

Every event has stable event and record IDs, original group, current authorized
source/member labels, exact `MinorUnits` and currency, effective date, and the
original recorded commit timestamp. Ordering is descending timestamp, kind, record
UUID. Effective dates do not determine event order. Existing expense/repayment
records and their immutable audit provenance remain the authoritative source.

Forward pagination limits `first` to 1–100. HMAC cursors bind the actor, workspace,
event-type/source filters, eligible group set, and every source's financial revision.
A refresh starts new revisions; continuation excludes later commits. The cursor is
an integrity mechanism, never an authorization grant. Access is rechecked before
cursor validation; eligibility changes invalidate the old traversal.

Household activity reuses #111's `household_dashboard_lock` boundary: every active
Household member receives the ledger plus sources shared by all active members
under [ADR-010](decisions/010-household-membership-sharing.md). A viewer-only group contributes no events, identity, count or cursor.
Unavailable discovery returns an explicit failure rather than a partial feed.
Household Activity signs the same membership/account eligibility fingerprint as
Expenses, samples scope with events, and retries changed discovery in a fresh
transaction at most three times within five seconds. Leave/rejoin invalidates
old Household continuations even when source IDs and financial revisions return.

The authenticated web entry points are the canonical ordinary/Trip/Household-ledger
workspace `?tab=activity` routes and aggregated `/household/activity`. Legacy group
activity routes replace to canonical `/trips/:groupId` or `/household/ledger` after
authorized metadata resolution. Current `groupKind` is sampled with event metadata
for direct canonical source links; original financial IDs and history remain unchanged.
Both use shared workspace primitives and the financial
session scope. Each event labels its source and separates effective date from
recorded event time. The initial UI filter is event type; the API also supports an
exact eligible source filter. Next-page navigation replaces the visible page after
fresh authorization. Refresh and filter changes clear cached rows immediately;
foreground focus/visibility/pageshow events clear content immediately and coalesce a fresh read; embedded feeds delegate this to their Group owner. Account changes dispose the old scope, and late
responses cannot populate a disposed scope.

Selecting an event opens immutable historical detail through `activityEvent`,
rechecking the feed source context. Expense events read the original recorded
revision; updates include labeled previous/new values. A separate “View current
expense” action obtains currently authorized expense detail. Closing restores
focus to the event trigger; the original group link preserves source context.
Empty, filtered-empty, loading and unavailable states remain distinct. Activity
routes use the sole authenticated financial session. Group Overview/Balances/Members and repayment (#171), Household navigation (#112) and the shared [structured Expenses ledger](expenses-ledger.md) (#170) are implemented. The seeded DataPort providers were removed in #184.

The PR is stacked on #111; its SQL discovery contract must be deployed first.
The original #172 slice added no mutation or migration. [Expense editing](expense-editing.md)
adds guarded edits, immutable revision backfill and real update events under #212.
