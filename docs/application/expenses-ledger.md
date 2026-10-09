# Production Expenses workspaces

Issue #170 connects `/household/expenses` and the Group/Trip **Expenses** tab
(`/groups/{groupId}?tab=expenses`) to the structured expense views implemented
in #169. Both render the same `ExpenseLedger`; the authenticated Household Overview/Balances/Members tabs remain at `/household`
and the retired preview financial routes return not-found responses.

Household initial context and first-page work run in one composed operation. The independent results require `COMPLETE` eligibility and matching nonempty server `contextVersion` values before any private content is revealed. Later pages/filters must match that owning context or fail closed. See [workspace loading](../navigation/workspace-loading.md).
Only its spaces and retained same-group memberships appear in filter and create
choices. Group views have fixed source scope. Household spending and space count
come from complete server projections; the signed viewer position is informational
and never a cross-group repayment target. Balance metrics are explicitly
unfiltered. A zero viewer position does not assert that every member is settled.

Structured space (Household only), category, member and inclusive date filters
are edited in a combined filter dialog on desktop and phone, live in the URL and are sent to `householdExpenses`/`groupExpenses`. Member IDs
are scoped to the original group, matching payer **or** explicit participant,
including zero shares. No search control or client filtering is provided. A
filter change starts a new traversal. Initial requests and Load more request six
rows; Load more appends the ordered server page;
headline count/total and month subtotals always use server aggregates rather
than sums of loaded rows. Money formatting uses canonical strings and `bigint`.

An expense selection adds `expense` and `expenseGroup` to the originating URL.
The native dialog is a contextual desktop panel and full-screen phone detail.
The mounted list retains loaded pages, filters and month position across detail
Back/Forward, restores trigger focus/scroll, and provides a list fallback for a
direct URL. Every detail first rechecks source eligibility, then reads the stable
expense node and verifies both expense and group identity. Refresh/foreground
invalidates prior rows and detail before reauthorization; failed, stale, denied
and unavailable reads never manufacture empty success or settled data. Account
replacement disposes the entire financial scope and cancels pending requests.

**Add expense** opens the existing persisted `ExpenseForm` in a centered desktop
dialog or an inset phone dialog, including original-key recovery, draft storage
and duplicate suppression. The same form remains mounted across responsive
changes. Detail and in-place editing retain the desktop panel/full-screen phone
presentation. Household selects an original
eligible ledger; success returns to the originating URL and refreshes spending
and context. No receipt, category expansion, edit/delete or repayment command is
added here. Free-text search remains deferred to #177.

Verification: `ledger.independent.test.tsx` covers exact large totals, complete
month subtotals, paging, zero shares, filter/history traversal, refresh races,
disposed accounts, stale details, denied direct sources and mismatched nodes.
The delivery PR records actual Chrome layout/navigation tests at 320/390/768/1280px
and 100%/200% root text. Synthetic browser service responses demonstrate browser
behavior; server authorization remains covered by #169 and real database checks.

The [#227 corrective migration](../design/issue-227-implementation.md) applies the commit-pinned reference's exact typography, palette, shared shell and compact ledger presentation. The earlier [Board A/B visual foundation](../design/references/approved-ui/foundation.md) and #223 visual evidence are historical. Category identity and structured filter behavior remain: Reset changes the draft; Apply updates the URL. Search, saved filters and unsupported status controls remain absent. The [parity matrix](../design/issue-227-parity-matrix.md) and [sealed independent report](../design/evidence/issue-227/reports/independent-testing.md) record passing visual/requirements acceptance; publication-head CI, final review and closeout are separately recorded on [PR #228](https://github.com/haggaikaunda/kami-split/pull/228).

The prior [screen adoption evidence](../design/references/approved-ui/adoption.md) records
contract-preserving changes to expense detail and creation: category identity, exact total,
payer and allocation rows, retained note/audit fields, and the existing explicit
payer/split/participant controls. The boards do not remove required contract fields.

## Edited expenses (#212)

Anchored traversals select one immutable expense revision and its matching
allocations at each source anchor before filtering or computing month totals.
A date/category/payer/participant correction appears on a fresh traversal;
continuing an existing traversal retains its original coherent rows and totals.
Current detail and complete balances use the current projection. Household detail
edits always target the original source expense and recheck its membership; no
aggregate writes or duplicated expenses are introduced. See
[expense editing](expense-editing.md).

## Category breakdown and viewer spending (#223)

Expenses has URL-backed List and Breakdown views using the same active structured
filters and traversal. Category aggregates, counts, viewer allocations and viewer
payer totals describe every authorized matching expense at the traversal anchor,
independently of loaded pages. Repayments are excluded. The category legend gives
exact amounts and matching-expense counts even where viewer allocation is zero;
percentages are rounded to one decimal place and may not sum to exactly 100%.
Chart geometry converts only bounded integer ratios to numbers. Selecting a
category and View expenses retains the other filters. A fresh traversal after an
edit refreshes category/share aggregates along with list/month totals.
