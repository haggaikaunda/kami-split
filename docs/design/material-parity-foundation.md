# Material migration: shared surface inventory

> Historical #223 implementation and evidence record. [Issue #227](https://github.com/haggaikaunda/kami-split/issues/227) supersedes its visual choices, including retained DM Sans/Manrope, approximate tokens, shell geometry and earlier row counts. The original observations and test results below are preserved; they do not establish #227 acceptance. See the current [implementation note](issue-227-implementation.md) and [parity matrix](issue-227-parity-matrix.md).

Issue #223; inspected before implementation on 2026-10-09. This inventory covers
the shared shell, authentication and Account slice, alongside the workspace and
expense inventories. The approved reference is the Material pack at reference
commit `3824ce6`; prototype actions are not production contracts.

| Surface and entry point                                            | Existing actions and states to preserve                                                                                                                 | Evidence owners                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Shared navigation on `/household`, `/groups`, `/trips`, `/account` | Household → Groups → Trips → Account; link URLs, current-page indication, pending status, real discovery and creation                                   | `primitives.tsx`, workspace navigation tests, rendered responsive checks          |
| Workspace tabs                                                     | Overview → Expenses → Balances → Activity → Members; URL-backed links, prefetch intent, keyboard focus and pending status                               | `primitives.test.tsx`, workspace tests                                            |
| Source navigation                                                  | Original source URL/filter/scroll/focus; browser Back, explicit return, fresh authorization before restoration                                          | `groups/navigation.tsx`, source-navigation tests; no behavioral change            |
| `/sign-in`, `/join`, `/auth/confirm`, `/auth/password`             | Actual authentication, invitation continuation, explicit Join, verification/recovery, password setup, wrong-account switch, unavailable/loading/errors  | onboarding controller/screens and `entry.independent.test.tsx`; shared CSS only   |
| `/account` Profile                                                 | Authenticated actor-keyed load/retry, read-only email, guarded name save, no-op/validation, uncertain reconciliation preserving edits, explicit discard | `profile.tsx`, profile integration tests                                          |
| `/account` Appearance                                              | Independent Light/System/Dark selection and explicit Save; expected-value guard, unknown outcome reread, failed loading retry                           | `appearance.tsx`, `onboarding/appearance.test.tsx`                                |
| Account theme lifecycle                                            | Default Light; actor-bound prepaint cache, authoritative startup/focus refresh, live OS changes only in System, sign-out/replacement cleanup            | `components/appearance.test.tsx`; implementation unchanged                        |
| Account Session                                                    | Actual current-session sign-out, busy suppression, private-state cleanup, sign-in redirect, other-device/token explanation                              | `entry.tsx`, existing session tests                                               |
| Shared feedback                                                    | Loading, pending, unavailable, empty, denied, error, retry and recovery remain distinct; financial failures never presented as zero                     | `primitives.test.tsx`, independent accessibility tests and affected journey tests |

## Implementation contract

Central semantic tokens own light/dark surface levels, tonal summary fills,
foregrounds, category/icon accents, outlines, spacing, corners and elevation.
Summary tones are explicit component properties, independent of card order.
Existing local DM Sans and Manrope fonts are retained; no external font request
or component library is added. Rounded cards use the reference's 24px default;
controls retain 44px minimum targets and visible focus. Native links, buttons,
fields, radios and status semantics remain intact.

Account receives a compact saved-identity header, two-column desktop fields,
stacked phone fields, three visual appearance choices and a separate Session
section. Each existing save remains independent; selecting a theme is still a
draft until the explicit guarded save succeeds. No financial/session controller,
API or Relay mutation semantics change in this slice.

## Verification ledger

Token contrast tests cover body/secondary text on summary and state surfaces,
primary actions and semantic navigation/category icons in both themes. Existing
Account and primitive behavior tests remain required. Production browser evidence
and independent final testing/review are recorded by the delivery coordinator;
reference screenshots are design evidence only, not production acceptance.

## Builder self-check (shared slice)

- Shared presentation remains in the existing global stylesheet and primitives;
  no new package, routing, financial read or mutation owner is introduced.
  Summary roles are explicit `SummaryMetric` props; all seven category pairs
  are centralized and shared with category icons.
- Profile/Appearance controllers, compare-and-set guards, actor keys, Relay
  invalidation and uncertainty paths are unchanged. Session markup retains the
  actual sign-out callback, busy state and token/device explanation. Native
  appearance radios retain an accessible legend and explicit separate save.
- Existing local fonts and brand remain. Cards use 24px corners and actions
  rounded controls. Appearance options reflow with root text size; navigation
  labels wrap rather than overflowing at narrow widths.
- Reference pack README and both interactive exports were inspected in the
  browser. Light desktop Account shows paired fields and three visual theme
  choices; mobile stacks fields and uses bottom navigation. Their editable
  email and instant theme behavior are intentionally not adopted.
- Under Node 24, seven focused suites passed (78 tests):
  `appearance-palette.test.ts`, `appearance.test.tsx`,
  `onboarding/appearance.test.tsx`, `onboarding/entry.independent.test.tsx`,
  `primitives.test.tsx`, `primitives.independent.test.tsx`,
  `workspace-identity.test.tsx`. Contrast assertions compute WCAG ratios from
  actual theme tokens for summary headlines/secondary labels, body text,
  primary actions, error feedback, and every category foreground/surface pair.
  Focused ESLint and formatting pass. These are builder checks on the shared
  working diff, not independent evidence tied to a final commit.
- Final production browser matrix, full repository checks, final commit SHA and
  independent test/review records remain coordinator-owned delivery gates.
  No hosted, actual API authorization, physical-device or spoken assistive
  technology verification is claimed by these focused checks.
