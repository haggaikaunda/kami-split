# Documentation

The application has one authenticated runtime: real onboarding, Relay/GraphQL-backed independent Group/Trip workspaces and the Household five-tab workspace. The seeded application, data model, providers and routes were retired in #184. Historical feature guides below describe the removed implementation and must not be used to restore it. Start with [current application documentation](application/README.md) and the [project README](../README.md).

See [repository layout and deployment](repository-layout.md) for workspace commands, configuration ownership and external hosting settings.
The [production deployment configuration](application/production-deployment.md)
records the approved #140 hosting and environment contract; provisioning and
successful hosted release evidence is linked there alongside operating procedures.

## Documentation sections

- [Agent documentation](agents/README.md): delivery instructions and Go engineering conventions.
- [Application documentation](application/README.md): current web/API implementation references and deferred features.

- [Architecture decisions](application/decisions/README.md): accepted production design, including [bootstrap, groups and invitations](application/decisions/003-bootstrap-groups-and-invitations.md) and [group balances, membership and recovery](application/decisions/004-group-balances-membership-and-recovery.md), distinct from the seeded preview.

## Historical seeded implementation guides

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

## Approved production visual references

[Issue #227](https://github.com/haggaikaunda/kami-split/issues/227) requires exact parity with the commit-pinned Kami Grow interactive reference pack, including Roboto, exact Light/Dark tokens, the shared app bar/rail and phone navigation, while retaining all production behavior. The [implementation note](design/issue-227-implementation.md) records the corrective changes and evidence boundaries; the [parity matrix](design/issue-227-parity-matrix.md) remains pending until final evidence is recorded. The [#223 workspace inventory](design/material-parity-workspaces.md) and [#189 Board A/B evidence](design/references/approved-ui/README.md) are preserved historical records, not current visual acceptance.

## Approved design archive

The [design index](design/README.md) archives the former seeded UX specification, navigation contracts and data-access design. The prototype and numbered issue specifications preserve the original approved scope. Historical readiness instructions and unchecked specification checkboxes are not an active backlog; completion and subsequent changes are recorded in GitHub and linked implementation guides.
