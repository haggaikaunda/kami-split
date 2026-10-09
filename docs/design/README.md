# Kami Split design references

Current production visual acceptance is governed by [issue #227](https://github.com/haggaikaunda/kami-split/issues/227) and its [commit-pinned reference pack and parity matrix](issue-227-parity-matrix.md). The [implementation note](issue-227-implementation.md) describes the corrective migration. The [sealed visual/requirements report](evidence/issue-227/reports/independent-testing.md) passes all 46 matrix rows; publication-head CI, final review and post-merge closeout are separately recorded on [PR #228](https://github.com/haggaikaunda/kami-split/pull/228). The earlier [Board A/B references](references/approved-ui/README.md), specification and prototype below are historical records.

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

Production-policy note: [ADR-004](../application/decisions/004-group-balances-membership-and-recovery.md) now accepts automatic within-group simplification, revised departure eligibility and recovery/readmission requirements. Unsimplified debt and session-only behavior in this document remain historical seeded-preview requirements/evidence, not the current production policy.

This is the approved design for the **completed seeded UX phase**. Design PR #12 and implementation tracker #13 are merged/completed. These specifications remain the behavioral reference; start with the [current documentation index](../README.md) for implemented features, setup and remaining production work.

| Document                                            | Purpose                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| [UX specification](ux-spec.md)                      | Screens, validation, components, responsive and accessibility behavior |
| [Screen flows](screen-flows.md)                     | Routes, navigation context, Back/Forward, focus and mutation outcomes  |
| [Decisions](decisions.md)                           | Accepted product choices and explicit exclusions                       |
| [Data access](data-access.md)                       | Async port, domain invariants and replaceable seed adapter             |
| [Prototype verification](prototype-verification.md) | Run the reference, repeatable walkthroughs and known limitations       |
| [Asset sources](assets/README.md)                   | Fonts, photos, icons and replacement rules                             |
| [Implementation plan](implementation-plan.md)       | Completed issue/PR record and original dependencies                    |
| [Issue specifications](issues/README.md)            | Versioned acceptance criteria mirrored into GitHub issues              |

The code in [prototype/](prototype/) is a frozen design reference, **not production code** or a component architecture to port verbatim. The implementation lives in the Next.js application and follows its testing and PR workflow. Keep the prototype separate from the production bundle and do not expose it as a private-data service.

Within the archived seeded phase, these consolidated documents and its approved issues controlled behavior and the prototype supplied visual intent. Current approved issues and application contracts take precedence; #227 supplies the production visual authority. Known prototype gaps are not accepted product behavior.

Current sample trips: **A week in Maui**, September 5–13, 2026; **Lake Tahoe escape**, August 14–17, 2026; **Porto, here we come**, May 12–18, 2027. Prototype clock: September 20, 2026. History remains the seeded preview navigation label. The authenticated redesign approved in [#166](https://github.com/haggaikaunda/kami-split/issues/166) standardizes workspace navigation as Overview, Expenses, Balances, Activity, Members; its written contract governs the new product patterns.
