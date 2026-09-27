# Documentation

Current state: the seeded UX is complete, followed by the LAN HTTP compatibility fix, as of September 26, 2026. Start with the [project README](../README.md) to run the app or preview it on a phone. Read [product scope](product-scope.md) before treating any simulated account or financial flow as a production service.

See [repository layout and deployment](repository-layout.md) for workspace commands, configuration ownership and external hosting settings.

## Documentation sections

- [Agent documentation](agents/README.md): delivery instructions and Go engineering conventions.
- [Application documentation](application/README.md): current implementation references and planned API architecture.

## Implementation guides

| Area                                                | Guide                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| Exact money, allocations and balances               | [Ledger](ledger.md)                                      |
| Async data port, fixtures and fault scenarios       | [Mock data](mock-data.md)                                |
| Shell, visits, drafts and source restoration        | [Navigation](navigation/README.md)                       |
| Overview and balance explanation                    | [Overview](overview/README.md)                           |
| Expense creation                                    | [Add expense](add-expense.md)                            |
| Record details and revision history                 | [Expense detail](expense-detail/README.md)               |
| Conflict-aware editing                              | [Expense editing](expense-editing.md)                    |
| Soft deletion and retained audit                    | [Expense deletion](expense-deletion/README.md)           |
| Repayments                                          | [Repayment](repayment/README.md)                         |
| Financial activity and filters                      | [History](history/README.md)                             |
| Trip creation and browsing                          | [Trips](trips/README.md), [trip detail](trips/detail.md) |
| Charts and exact data tables                        | [Spending](spending/README.md)                           |
| Simulated account entry                             | [Entry preview](entry-preview/README.md)                 |
| Setup, invitations and membership                   | [Household](household/README.md)                         |
| Cross-journey retry/access safety                   | [Recovery](recovery/README.md)                           |
| Accessible shared components and standalone gallery | [Primitives](primitives-preview/README.md)               |

## Verification and delivery

[Testing strategy](testing-strategy.md) explains what the automated suite and manual browser checks cover. The [final UX report](accessibility/README.md) includes screenshots and explicit hardware/assistive-technology limitations; its [criterion matrix](accessibility/criterion-matrix.md) traces every approved journey. Feature guides retain their dated PR-specific evidence. Their historical test counts and local ports are not current runtime configuration.

The [delivery workflow](agents/delivery-workflow.md), [contributing guide](../CONTRIBUTING.md), and [agent instructions](../AGENTS.md) define issue, test, review and merge gates. GitHub is the source of truth for work status. The [completed implementation record](design/implementation-plan.md) links each UX issue to its merged PR.

## Approved design archive

The [design index](design/README.md) links the still-applicable UX specification, navigation contracts and data-access design. The prototype and numbered issue specifications preserve the original approved scope. Historical readiness instructions and unchecked specification checkboxes are not an active backlog; completion and subsequent changes are recorded in GitHub and linked implementation guides.
