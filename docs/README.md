# Documentation

Kami Grow uses real Auth and server-authorized Relay/GraphQL workspaces. Repository documentation explains the system and how to maintain it. GitHub issues and PRs record requirements, plans, verification, review and delivery history.

- [Application guide](application/README.md): current features and financial/security contracts.
- [Product scope](product-scope.md): supported behavior and deferred work.
- [Repository layout](repository-layout.md): commands and configuration ownership.
- [Navigation](navigation/README.md): canonical routes and authorized restoration.
- [UI guide](application/ui.md): current shared presentation rules.
- [Design inputs](design/README.md): original approved references and their limits.
- [Architecture decisions](application/decisions/README.md): accepted rationale and unresolved policy.
- [Testing strategy](testing-strategy.md) and [browser verification](browser-verification.md): repeatable checks and limitations.
- [Production runbook](application/production-deployment.md): deployment, rollback and recovery; provider state requires explicit inspection.
- [Agent workflow](agents/README.md) and [contributing](../CONTRIBUTING.md): issue, independent testing/review, CI and closeout requirements.

Keep run outputs in ignored `test-results/` or an external temporary directory. Publish results, screenshots and unique historical material on the owning issue/PR. Do not add checked-in task plans, acceptance ledgers, review reports or documentation archives. The retired seeded application is described in [its GitHub tracker](https://github.com/haggaikaunda/kami-split/issues/13), not as current runtime guidance.
