# Implementation plan

Design planning issue: [#11](https://github.com/haggaikaunda/kami-split/issues/11). Open the design PR before creating the implementation tracking issue. Implementation remains blocked until design review/merge and issue approval. GitHub links will be populated after the draft PR exists.

## Dependency order

- UX-01: [Define exact-money and multi-member ledger rules](issues/01.md). Dependencies: design merge only.
- UX-02: [Introduce async data access and deterministic seed adapter](issues/02.md). Dependencies: UX-01.
- UX-03: [Establish design tokens and shared accessible UI primitives](issues/03.md). Dependencies: design merge only.
- UX-04: [Build responsive shell and context-aware navigation](issues/04.md). Dependencies: UX-03.
- UX-05: [Implement balance overview and contribution explanation](issues/05.md). Dependencies: UX-01, UX-02, UX-03, UX-04.
- UX-06: [Implement add-expense flow with visible reconciliation](issues/06.md). Dependencies: UX-01, UX-02, UX-03, UX-04.
- UX-07: [Implement standalone expense detail and desktop side panel](issues/07.md). Dependencies: UX-02, UX-03, UX-04.
- UX-08: [Implement safe expense editing and revision conflicts](issues/08.md). Dependencies: UX-01, UX-02, UX-03, UX-04, UX-06, UX-07.
- UX-09: [Implement expense deletion confirmation and retained tombstone](issues/09.md). Dependencies: UX-02, UX-03, UX-04, UX-07.
- UX-10: [Implement repayment recording with balance preview](issues/10.md). Dependencies: UX-01, UX-02, UX-03, UX-04.
- UX-11: [Implement chronological and filterable financial history](issues/11.md). Dependencies: UX-02, UX-03, UX-04, UX-07, UX-10.
- UX-12: [Implement trips list and create-trip flow](issues/12.md). Dependencies: UX-02, UX-03, UX-04.
- UX-13: [Implement trip overview and trip-expense browsing](issues/13.md). Dependencies: UX-01, UX-02, UX-03, UX-04, UX-06, UX-07, UX-10, UX-12.
- UX-14: [Implement spending charts and contextual drill-downs](issues/14.md). Dependencies: UX-01, UX-02, UX-03, UX-04, UX-05, UX-07, UX-13.
- UX-15: [Implement simulated sign-in and invitation entry screens](issues/15.md). Dependencies: UX-02, UX-03, UX-04.
- UX-16: [Implement household setup and simulated member management](issues/16.md). Dependencies: UX-02, UX-03, UX-04, UX-15.
- UX-17: [Complete fault recovery across seeded financial journeys](issues/17.md). Dependencies: UX-02, UX-04, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-13, UX-15, UX-16.
- UX-18: [Verify accessibility, responsive behavior and end-to-end UX parity](issues/18.md). Dependencies: UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-13, UX-14, UX-15, UX-16, UX-17.

Database persistence and real authentication are deferred. Existing pilot greeting issues #6–#9 are separate; do not close or reinterpret them as part of this plan. Foundations can proceed independently after their dependencies are met. Each journey owns its validation/accessibility/recovery; final verification issues integrate and audit rather than defer correctness.
