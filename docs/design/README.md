# Kami Split approved UX

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

In a conflict, these consolidated documents and the relevant approved issue control behavior; the prototype controls visual intent where it is consistent with those requirements. The known prototype gaps are not accepted product behavior. Changes to these requirements should be made in a reviewed documentation PR and reflected in the corresponding issues.

Current sample trips: **A week in Maui**, September 5–13, 2026; **Lake Tahoe escape**, August 14–17, 2026; **Porto, here we come**, May 12–18, 2027. Prototype clock: September 20, 2026. History remains the current navigation label; renaming it to Activity was discussed but not approved.
