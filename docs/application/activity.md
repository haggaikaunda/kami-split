# Authenticated activity

Issue #172 adds `groupActivity` and `householdActivity`. Both read immutable
expense-created and repayment-recorded events directly from persisted financial
records. They never merge client expense/repayment pages, include preview History,
or invent edit/delete/reversal events.

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

Household activity reuses #111's `household_dashboard_lock` boundary: only the
finalized eligible pair may receive Household plus spaces where both are currently
eligible. A viewer-only group contributes no events, identity, count or cursor.
An unavailable designation returns an explicit failure rather than a partial feed.

The authenticated web entry points are `/groups/<Group ID>/activity` (with a legacy query-route redirect) and
`/household/activity`. The Group route redirects into the integrated `/groups/:groupId?tab=activity` workspace under #171. Both use shared workspace primitives and the financial
session scope. Each event labels its source and separates effective date from
recorded event time. The initial UI filter is event type; the API also supports an
exact eligible source filter. Next-page navigation replaces the visible page after
fresh authorization. Refresh and filter changes clear cached rows immediately;
window focus refreshes access, account changes dispose the old scope, and late
responses cannot populate a disposed scope.

Selecting an event opens an inline current-record detail, rechecking the feed
source eligibility as well as the current node authorization. Closing restores
focus to the event trigger; the original group link preserves source context.
Empty, filtered-empty, loading and unavailable states remain distinct. Activity
routes bypass all simulated DataPort providers. Group Overview/Balances/Members and repayment integrate under #171; Household
workspace and the structured expense ledger remain owned by #112/#170.

The PR is stacked on #111; its SQL discovery contract must be deployed first.
There is no new mutation, data migration, or activity-event backfill.
