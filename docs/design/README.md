# Design inputs

Approved design inputs explain visual intent; they do not prove implementation, authorization or device acceptance. Current production rules are in the [UI guide](../application/ui.md) and current behavior in the [application guide](../application/README.md).

- [Workspace mockup](issue-269/README.md): original interactive source, export, integrity checks and reference screenshots. Keep its existing banner artwork and category Breakdown constraints.
- [Percentage concept](references/percentage/README.md): original allocation-field reference.
- [Activity/editing board](references/activity-editing/README.md): immutable event details and before/after hierarchy.
- [Original Board A/B](references/approved-ui/README.md): owner-supplied provenance; current tokens/navigation supersede their earlier styling.
- [Exact Material reference](https://github.com/haggaikaunda/kami-split/issues/227): externally preserved approved interactive pack and checksum provenance. Current system-font and workspace refinements take precedence.
- [Primitive gallery](../primitives-preview/README.md): executable development examples, separate from the application.

The [original UX specification](ux-spec.md), [screen flows](screen-flows.md), [design decisions](decisions.md), [seeded data design](data-access.md), [asset provenance](assets/README.md), and [standalone prototype](prototype/index.html) remain design inputs for interpreting the original interaction model. They are superseded wherever current application contracts differ; they are not requirements to restore deleted seeded code or deferred features. Run the prototype with `python3 -m http.server 4300 --bind 127.0.0.1 --directory docs/design/prototype`. It has no real authentication, persistence or financial authority.

Issue specifications, implementation sequencing and acceptance records belong on their GitHub issues/PRs. Generated application captures and comparison reports must remain outside tracked documentation.
