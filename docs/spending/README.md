# Exact spending charts

Issue #27 implements H02/N04 for household and trip spending. All amounts remain integer minor units through the existing `spending` selector; only bar geometry uses a ratio. Household scope means current expense totals, while My allocated share means the signed-in member's included allocations, including zero-share participation. Paid amounts and repayments are not spending scope. Current effective dates and revisions drive all values; deleted expenses and other currencies do not contribute.

Daily shows every date of a selected month, Monthly every month of a year, and Yearly the five years ending in the selected year. Previous/Next move one month, one year or five years. URL state uses `chartMode`, `period=YYYY-MM`, `scope` and `chartData`; trip exact tables use `dayData` and `categoryData`. Unrelated source/tab/filter parameters are preserved.

Bars start at zero, have exact amount/count accessible names and independent targets at least 44px wide/high. A one-cent value is not artificially inflated. The equivalent exact-value table supports the same inspection. Charts/tables scroll within labeled regions without widening the page. Table visibility is URL state so returning from a record preserves the original table trigger.

Trip extent includes the entire travel range and all current out-of-range booking dates. Up to 93 days are daily; longer ranges through 60 months are monthly; longer ranges use yearly or grouped yearly buckets, bounded to 60. Full coverage and aggregation are explicit. No dates or expenses are truncated, including exceptionally long ranges.

A selected `bucket` is parsed independently of the latest series, so a mutation can leave the same bucket open and empty. It reads the latest provider snapshot, not cached markup. Expense navigation suspends the bucket dialog; Back reopens it with fresh totals/records, and closing it returns to its captured bar/table source. Repeated visits and browser Forward keep independent visit identities. Denied/expired data removes financial content; retained stale data is labeled inside the drill-down.

## Verification

Formatting, lint, type checking, 262 tests and production build pass. Fourteen pure tests cover leap/century boundaries, view shifts, zero periods, exact scope/counts, large values, complete trip extents, currency partitioning and real date-mutation invalidation. Five component probes cover truthful geometry, equivalent table inspection, URL controls, newly empty selected buckets, expense suspension/return and denied trip disclosure. Existing Overview assertions remain unchanged; its navigation stub supplies the now-used search parameters.

Two independent requirements tests cover included zero-share counts with a real deletion to the same empty bucket, retained audit history, and exact conservation over a 1000–9999 trip range with currency isolation.

No forecasts, budgets, conversion, export or new persistence are included. Independent final-diff review and production browser verification are recorded in the pull request before merge.
