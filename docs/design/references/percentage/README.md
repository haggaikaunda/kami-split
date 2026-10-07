# Percentage visual reference and rendered evidence

[#199](https://github.com/haggaikaunda/kami-split/issues/199) extends the approved
[#189 visual system](../approved-ui/README.md). The owner-provided
[full-resolution concept](concept-reference.png) informs percentage fields,
adjacent amounts, validation and saved intent. Its Edit panel is outside scope;
current navigation, fields, source ownership and shared components remain intact.

Before captures use unchanged main `fd9389c`. Final captures were rerun against application source `fa0aa60`, which integrates
main `70c8fb8` (account/profile changes) and unique Percentage migration014.
Synthetic records and Auth/GraphQL interception render the real production build;
these images establish UI state/layout, not database authorization. Separate
PostgreSQL/GraphQL integration tests and the optional real verified-actor browser
pass establish actual persistence. The real browser pass uses fixture-issued JWTs
verified by the API; Auth-provider session responses are isolated fixture responses.

| State                                               | Desktop                                                                            | Mobile                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Before: existing Equal form                         | [top](evidence/before-top-1280-1.png), [bottom](evidence/before-bottom-1280-1.png) | [top](evidence/before-top-390-1.png), [bottom](evidence/before-bottom-390-1.png) |
| P1/P2: Household $125, linked 60/40                 | [top](evidence/P1-P2-top-1280-1.png), [bottom](evidence/P1-P2-bottom-1280-1.png)   | [top](evidence/P1-P2-top-390-1.png), [bottom](evidence/P1-P2-bottom-390-1.png)   |
| P3: 85% incomplete                                  | [desktop](evidence/P3-invalid-1280-1.png)                                          | [mobile](evidence/P3-invalid-390-1.png)                                          |
| P3: explicit Assign remaining, 40/30/30             | [desktop](evidence/P3-valid-1280-1.png)                                            | [mobile](evidence/P3-valid-390-1.png)                                            |
| P4: saved $10.01, 60%/$6.01 and 40%/$4.00           | [desktop](evidence/P4-1280-1.png)                                                  | [mobile](evidence/P4-390-1.png)                                                  |
| Trip, system dark preference, long participant name | [desktop](evidence/trip-dark-long-1280-1.png)                                      | [mobile](evidence/trip-dark-long-390-1.png)                                      |

The [evidence directory](evidence/) additionally includes 320/768px and actual 200%
root text at all four widths. [Machine results](evidence/results.json) record eight
passing final configurations. `scripts/percentage-browser.cjs` checks reconciliation,
linked edits, missing input, maximum valid amount, reload, frozen original retry,
recovery, Group remaining assignment, Trip entry, system dark preference, long names, reachable
Save, no document overflow, modal forward/reverse focus containment and browser
runtime errors under reduced motion. It does not prove physical iOS/Android safe
areas, screen-reader speech or provider email delivery. The current application explicitly sets `color-scheme: light`; the system-dark
pass verifies that existing behavior rather than claiming a new dark theme.
Existing native dialogs,
visible focus and safe-area CSS remain in use. Browser success/recovery uses
synthetic transport; the real API browser pass is separately documented on the PR.

Reproduce with a production preview on port 3199 and an externally installed
Playwright module via `PLAYWRIGHT_MODULE`, then run `node scripts/percentage-browser.cjs`.
Set `BASELINE=true ORIGIN=http://localhost:3198` for the unmodified comparison build.
No fixture is exposed as a production route.
