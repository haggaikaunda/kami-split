# Account and contextual invitations (#202)

Real Chromium exercised the production build with synthetic identities and
intercepted Auth/GraphQL responses at 320, 390, 768 and 1280px, at 16px and 32px
root text. All eight configurations passed, with no page errors or document
horizontal overflow. This is frontend evidence; actual authorization, persisted
profile changes, admission, concurrency, migrations and grants are exercised by
`make db-test` against disposable real Supabase/PostgreSQL.

The unmodified baseline is `fd9389c`. The PR records the exact final tested head.

| Surface                  | Before                                                                    | After                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Account desktop          | [1280px](evidence/account-202/before-account-1280-1.png)                  | [1280px](evidence/account-202/account-1280-1.png)                                                                                |
| Account mobile           | [390px](evidence/account-202/before-account-390-1.png)                    | [390px](evidence/account-202/account-390-1.png)                                                                                  |
| Trip invitations desktop | [Generic Account hub](evidence/account-202/before-invitations-1280-1.png) | [Maui Members](evidence/account-202/trips-invitations-1280-1.png)                                                                |
| Trip invitations mobile  | [Generic Account hub](evidence/account-202/before-invitations-390-1.png)  | [Maui Members](evidence/account-202/trips-invitations-390-1.png)                                                                 |
| Household invitations    | Former generic hub above                                                  | [Desktop](evidence/account-202/household-invitations-1280-1.png), [mobile](evidence/account-202/household-invitations-390-1.png) |
| Group invitations        | Former generic hub above                                                  | [Desktop](evidence/account-202/groups-invitations-1280-1.png), [mobile](evidence/account-202/groups-invitations-390-1.png)       |

Additional rendered evidence: [320px Account](evidence/account-202/account-320-1.png),
[768px Account](evidence/account-202/account-768-1.png),
[120-codepoint international name at 320px/200%](evidence/account-202/account-long-name-320-2.png),
[dark Account at 390px/200%](evidence/account-202/account-dark-390-2.png),
[dark scoped invitations on mobile](evidence/account-202/household-invitations-dark-390-2.png) and
[desktop](evidence/account-202/household-invitations-dark-1280-1.png),
[failed profile read at 320px/200%](evidence/account-202/profile-error-320-2.png),
[signed-out desktop](evidence/account-202/signed-out-1280-1.png) and
[signed-out mobile](evidence/account-202/signed-out-390-1.png).

## Verified interactions

`scripts/account-browser.cjs` verifies Account's active shared navigation and
read-only email, whitespace-trimmed international saves, persisted fresh reads,
120-codepoint rendering, response-loss reconciliation before another save,
owner-only Household/Group/Trip administration, scoped group IDs and reloads,
explicit legacy-target replacement and the untargeted landing. Household
invitation entry works while the aggregate overview returns unavailable.

A valid actor-scoped expense draft envelope containing an unresolved expense
attempt survives visiting Account and saving names byte-for-byte. Logout clears
it. This exercises the real root FinancialSession; the harness never resets that
provider to simulate a profile refresh. Existing session tests and independent
requirements tests additionally cover account-switch and late-response safety.

The browser asserts actual dark color-scheme tokens on Account and scoped
invitations; these surfaces supply dark semantic tokens because the existing
base application otherwise forces light mode. The browser also checks navigation during failed profile reads, dark mode,
keyboard focus from display name to read-only email, retryable failed sign-out
while the session remains active, automatic history replacement to a usable
sign-in form, and Back/reload/direct protected Account visits after logout. The
failed active-session logout fixture fails the context-clear boundary; independent
component tests cover SDK failure and invitation Switch account separately.

The existing `scripts/navigation-browser.cjs` regression also passes on the
updated build, covering canonical Household/Trip destinations, shell persistence,
workspace tab transitions, detail/filter Back/Forward, keyboard focus restoration,
modified-click entry and denied late financial content.

## Reproduction and limits

Build with `pnpm build`, run `pnpm start --port 3194`, then run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROME_PATH=/absolute/path/to/chrome node scripts/account-browser.cjs
PORT=3194 PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROME_PATH=/absolute/path/to/chrome node scripts/navigation-browser.cjs
```

`OUTPUT_DIR` changes the screenshot/report destination. For before images, build
and serve the baseline independently, then set `BASELINE=1` and its `PORT`.
The [configuration report](evidence/account-202/report.json) records all eight
runs. Screenshots use synthetic email addresses and no production data. Real
email-provider delivery, physical devices/safe-area hardware and spoken assistive
technology are not claimed. No dialog was introduced; existing dialog focus tests
remain in the navigation regression.
