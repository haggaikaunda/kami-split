# Prototype verification for implementation agents

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

## Run both surfaces

From repository root (no prototype dependencies):

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/design/prototype
```

Open `http://localhost:4173/#home`. If port 4173 is occupied by the earlier root-directory preview, use 4174 with the same directory rather than kill an unrelated server. Run its limited arithmetic checks from its own directory:

```bash
cd docs/design/prototype
node verify.cjs
```

Run the actual Next.js app separately with the repository's Node 24/pnpm 11 setup (`pnpm dev`, normally port 3000). Compare implementation and prototype at the **same viewport and named seed fixture**. Never change production source just to keep the prototype buildable; it has no build. Prototype HTML/CSS/JS are intentionally excluded from production linting, but may be formatted and syntax-checked. External fonts/Unsplash may need a network connection; missing images must not block financial actions.

## Repeatable walkthroughs

Reset demo or reload before each independent walkthrough. Prototype data is memory-only and clock is frozen at 2026-09-20. Run at 1280×900 desktop and 390×844 phone; also check 320px width, 200% text and keyboard-only operation in the implementation.

| Scenario                | Steps and expected evidence                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 Overview            | Initial Kaunda owes Mizenin $42.18. Contributions: Kaunda $2,496.10; Mizenin $2,630.46. All expense spend $5,126.56. Repayment $25 is separate.                                                                                                                      |
| P02 Add/equal           | Add “Coffee together”, $10.01, Kaunda paid, both included. See $5.01/$5.00 and full reconciliation. Save once → debt $37.18.                                                                                                                                         |
| P03 Repayment           | After P02 record Kaunda → Mizenin $37.18. Preview settled, then save → $0 debt. Expense spending and paid contributions unchanged.                                                                                                                                   |
| P04 Exact/validation    | Total $40, exact $15/$20 → $5 left and save blocked. $15/$25 → valid. Try zero, negative, third decimal, no participants and zero-share included participant. Some prototype edge handling is incomplete; spec wins.                                                 |
| P05 History navigation  | Search Juniper; optionally set type/member. Open result → desktop panel → Open full page → Back. Restore search/filter/scroll. Repeat phone, browser Back/Forward and two sources for same record.                                                                   |
| P06 Editing/deleting    | Open `#expenses/2`, edit note/amount, save → same URL/revision history. Delete → Keep returns unchanged; confirm creates tombstone and removes spending effect. Inspect prior allocations and actor.                                                                 |
| P07 Trip flow           | Trips → Maui (Sep 5–13, 2026), total $1,644.20; Expenses tab → search/category → detail → edit → Back. Restore tab/filter; recompute total. Add expense here keeps Maui selected. Tahoe $840; Porto May 12–18, 2027 empty/upcoming.                                  |
| P08 Charts              | Monthly 2026 $3,666.56; September $1,914.56. Switch Daily/Yearly and scope; inspect exact table. September → expense → edit date out of period → Back; implementation must recompute bucket, even though prototype may restore stale HTML.                           |
| P09 Deep links/resizing | Direct `#expenses/2` is full page even on desktop; contextual desktop entry is panel. Missing ID is neutral unavailable. Resize panel and dirty form without losing state. Test unrelated external history doesn't trap Back.                                        |
| P10 Recovery/access     | Footer gallery shows copy intent. In implementation, use named seed-adapter fault scenarios to actually fail before/after commit, retry same request, create a revision conflict, deny access and expire session. Inspect stored revisions/events, not only a toast. |

## How to report verification

Link the issue acceptance criterion and N/P scenario to an automated test or recorded manual check. Include viewport, seed fixture/clock, route sequence, expected/actual values, screenshots of relevant outcomes and commands/results. Avoid screenshot-only approval: test the underlying financial state and navigation state. Inspect phone keyboard, focus return, selected revision, Back/Forward, chart table and screen-reader names.

Use the current app/browser tools to inspect the rendered page and perform real interactions. A source-code search or screenshot of an unopened form is not a completed happy-path test. Reset the reference between mutation scenarios and do not enter real personal/financial information. Keep implementation code independent from this script-based reference.

## Known limitations

Read [decisions.md](decisions.md#prototype-versus-approved-behavior) before copying behavior. `verify.cjs` only checks a subset of calculations; it does not verify router state, authorization, concurrency, accessibility or durable storage. Auth, recovery and membership dialogs demonstrate intent, not a backend. Prototype-created IDs disappear on reload. Synthetic examples are not current travel-price guidance. Text scale, minimum bar heights, revision selection and some navigation exits require improvements in the actual implementation.
