# Material migration: workspace parity inventory

Implementation-start inspection: `e7f76f58999a42c12842e70c8ba6b898fd17c6d1`
(local primary `main` equals freshly fetched `origin/main`, 2026-10-09).
Issue [#223](https://github.com/haggaikaunda/kami-split/issues/223) is the approved
scope. This inventory was written before workspace implementation. Evidence below
identifies existing tests; final-head results and browser evidence remain pending.

The approved reference ZIP README and desktop/mobile browser exports were read.
The pale Light banner/cards supersede earlier dark Light surfaces. Production
contracts govern where reference controls simplify current behavior.

| Existing action/state and source                                                                        | Old entry point                                              | Intended new entry point / retained behavior                                                                                     | Verification target                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Authorized discovery, creation, UTC Trip status and metadata (`journey.tsx`, `creation-form.tsx`)       | `/groups`, `/trips`, `/groups/new`                           | Same routes, actual authorized cards and create forms; tonal cards/art only                                                      | `discovery`, `creation-form`, `creation-session`, `creation-entry` independent tests |
| Source navigation, cancellation, access loss, foreground refresh (`navigation.tsx`, `journey.tsx`)      | Group/Trip cards; Back to source                             | Same canonical source/visit records; no private placeholders or account-crossing results                                         | `workspace-lifecycle`, `foreground`, `session`, `intent` tests                       |
| Group/Trip overview complete total/net, recent five rows (`workspace.tsx`)                              | default `/groups/:id`, `/trips/:id`, `/household/ledger`     | Same overview; complete share/paid from viewer balance position; desktop member panel; mobile dedicated Balances                 | workspace requirements tests; new complete-position regression                       |
| Household total/net/eligible spaces and unavailable/incomplete distinctions (`household-workspace.tsx`) | `/household`                                                 | Same route; replace active-space card with complete authorized share/paid, retain original sources, recent expenses and fallback | household workspace/Relay/lifecycle tests; additive dashboard API tests              |
| Detail direct entry and source return (`journey.tsx`, `expense-detail.tsx`)                             | canonical `/expenses/:id`; selected `expense`/`expenseGroup` | Desktop scrim/drawer, mobile full detail screen, source fallback; same guarded editor and recovery                               | ledger/edit/source-navigation tests; browser outside click/Back/refresh              |
| Complete balances and deterministic obligations                                                         | `?tab=balances`                                              | Same dedicated tab and source-specific repayment entry; optional overview panel carries no mutation shortcut                     | workspace/repayment tests; complete API financial invariants                         |
| Actual repayment, uncertain result/retry/recovery                                                       | source repayment route                                       | Same original group, frozen operation, sender/recipient eligibility, no actual money movement                                    | `repayment-form` and persisted-repayment integration tests                           |
| Activity immutable history/current record distinction                                                   | `?tab=activity`, `/household/activity`                       | Same feed, paging and historical details; current expense remains fresh authorized read                                          | activity feed, API activity/revision tests                                           |
| Members/historical identity/owner invitation actions                                                    | `?tab=members`, scoped invitation routes                     | Same owners/members, shared and targeted recovery/delivery actions; tonal shared surfaces                                        | onboarding/scoped invitation and household members tests                             |
| Loading/denied/unavailable/empty states                                                                 | Every destination                                            | Same source ownership, fresh authorization and truthful failure messages                                                         | lifecycle and denial regressions; browser matrix                                     |
| Original banner artwork and responsive tabs                                                             | Workspace header and five tabs                               | Same Household/Trip PNG assets; theme-specific overlay, all five tabs in order at large text/narrow widths                       | visual browser matrix at 320/390/768/1280/1440; contrast checks                      |

Related inventories: [foundation](material-parity-foundation.md),
[expenses](material-parity-expenses.md), [read model](material-parity-read-model.md).
These are an acceptance index, not evidence that pending checks passed.

## Builder convention self-check

- Existing workspaces retain navigation/session ownership; overview detail is a
  small source-authorized adapter around the same ExpenseDetail/editor. It keeps
  the overview mounted for URL selections and uses session-owned source visits
  for Back/Forward. No new financial mutation or session provider exists.
- Complete group paid/share come from the viewer balance position; Household
  uses the new coherent dashboard totals. Overview sidebar rows are informational
  and link to original Balances; mobile hides only this redundant panel.
- Current documentation searched for editing/deferred, Quietly Warm, Board A/B,
  overview metrics and category aggregates. README, product scope, current
  onboarding/expense/navigation guides and API instructions are reconciled;
  historical design archives remain unchanged.
- Parent-owned committed-save notice survives Household refresh failure. A denied
  detail hides original private projections. Existing request diagnostics and
  operation/draft ownership remain unchanged. Review found and tests now cover
  overview history and committed-save/failed-refresh cases.
- Generated Relay operations were regenerated from SDL. Unused overview revision
  and page-boundary selections were removed after independent transport testing found
  complexity 202; current maximum is 198 against the unchanged limit of 200.
  The overview edge cursor and all complete Expenses paging fields remain intact.
- Reference Roboto was not added: the repository's bundled local DM Sans/Manrope
  loading and fallback policy is retained. Original brand and artwork remain.

This complete migration shares primitives and read contracts across the current
surfaces. Final verification, screenshots and limitations are recorded with the
implementation PR; the parent issue remains open until actual merge and closeout.
