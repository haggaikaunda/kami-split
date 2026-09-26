# Financial history

Issue #24 replaces the navigation fixture with the approved chronological activity feed. Every creation, edit, deletion and repayment is an event. Event timestamps (including UTC time and year) are labeled separately from expense/repayment effective dates. Exact amounts come from the immutable event snapshot; this is an audit feed, not a sum of current spending.

Search matches the displayed description, case-insensitively. The Expenses type means creation events only; edits and deletions have their own types. Member filtering matches the event's payer or explicit participant membership (including a zero share), or either repayment party. It does not treat an unrelated editor as a financial participant. Unknown filter values stay selected and produce no matches until cleared.

Filters use `search`, `type`, and `member` URL parameters. `NavigationProvider.replaceQuery()` only changes the current path's query, preserving its history identity and active control. Next's native history integration updates route search parameters without adding entries or fetching an identical route. Retained desktop backgrounds use their source visit's parameters. Every event has a stable focus target; expense links identify the event's immutable revision inside the current record, and repayment links open read-only detail. Source restoration still waits for refreshed adapter data after mutations.

Tests cover chronological and same-timestamp ordering, years/time zones, all event types, combined filters, financial roles, zero-share membership, tombstones, selected revisions, filter URL/focus identity, asynchronous access/stale states, and empty results. Independent browser/testing/review evidence is recorded in the PR before merge.

This remains session-only mock data. There is no pagination, export, extra date-range filter, backend, or persistence.
