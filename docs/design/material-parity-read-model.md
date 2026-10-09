# Material overview read-model parity

Issue #223 inventory, recorded before implementation against the task-start main
checkout. This additive slice retains the current entrypoints and writes.

| Existing action/state             | Old and retained entrypoint                    | Retained behavior                                                                                                                  | Verification evidence                            |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Household overview                | `Query.householdDashboard`                     | Complete authorized original spaces, coherent context, net including repayments, no partial totals on overflow/discovery failure   | `dashboard_test.go`, Household integration suite |
| Household expense filters/paging  | `Query.householdExpenses`                      | AND source/category/member/date filters; member payer OR explicit allocation; signed anchored traversal and complete months/counts | `cross_space_independent_integration_test.go`    |
| Group/trip expense filters/paging | `Query.groupExpenses`                          | Fixed original group, current authorization on each request, anchored expense versions                                             | structured view and edit integration suites      |
| Legacy group expense reads        | `Group.expenses`                               | Existing participant-only filter and pagination unchanged                                                                          | existing expense integration suite               |
| Balance/repayment reads           | `Group.balances`, repayment history            | Exact independent original-ledger positions and obligations; no cross-group settlement                                             | existing repayment integration suite             |
| Expense create/edit/recovery      | Existing expense mutations and operation reads | Validation, revisions, keys, uncertainty and authorization unchanged                                                               | existing edit and financial integration suites   |

## Additive contract

`ExpenseView` gains `viewerShareMinor`, `viewerPaidMinor`, and `categories`.
Each `ExpenseCategoryTotal` contains `category`, `totalExpenseMinor`,
`viewerShareMinor`, and `expenseCount`. Categories include matching expenses even
when the viewer allocation is zero. Missing categories are omitted. Counts mean
matching expenses in either basis. Aggregates use the same complete filtered
anchored expense versions as rows/months; repayments are excluded. Viewer share
uses stored allocations and the viewer's original-group Membership ID; payer
amounts use that membership independently. No new filter or authorization scope.

`HouseholdDashboardTotals` gains `viewerShareMinor` and `viewerPaidMinor`, summed
from complete original-space viewer positions. Net remains repayment-inclusive.
All new amounts retain canonical MinorUnits strings and checked exact bounds;
overflow fails the complete result rather than returning partial totals.

No persistence migration or public mutation change is required. GraphQL output
is regenerated from SDL. New integration evidence must cover complete aggregates
with bounded pages, combined filters, zero/absent allocations, repayments, anchored
edits and access denial; unit evidence covers overflow and malformed totals.

## Builder verification

- `go test ./...`, `go test -race ./...`, `go vet ./...`, `go build ./...`,
  and `go mod verify` passed.
- `make db-test` passed against disposable PostgreSQL, including migrations,
  permissions, all integration tests, reset/replay and dump/restore; its owned
  disposable services were stopped by the script.
- `material_totals_integration_test.go` verifies complete categories and viewer
  values with a one-row page, all five combined filters, explicit zero share,
  empty results, repayment exclusion, Household totals and anchored additions.
  `edit_integration_test.go` verifies old category/share/paid aggregates at an
  existing anchor and refreshed edited category, payer and stored allocations.
  Existing cross-space tests retain access denial, incompatible membership and
  original-source exclusion coverage.
- `material_totals_test.go` verifies exact amounts above JavaScript's safe range
  and atomic failure for share, paid and category overflow.
- `make db-generation-check`, `make api-format-check` and hash comparison before/
  after `make api-generate` passed without generated drift. No SQL migration or
  sqlc change was needed.

These are builder results; independent issue testing and whole-diff review remain
separate delivery gates.
