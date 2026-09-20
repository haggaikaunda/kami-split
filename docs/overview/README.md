# Overview and shared data boundary

Issue [#18](https://github.com/haggaikaunda/kami-split/issues/18) replaces the Overview navigation fixture with the seeded financial overview. Charts remain a labeled reserved area; Add expense and Record repayment lead to their clearly marked entry previews until those separate issues land. No payments are sent.

## Financial meaning

The sample shows **Kaunda owes Mizenin $42.18 USD**. Expenses paid are Kaunda $2,496.10 and Mizenin $2,630.46, totaling $5,126.56. Repayment $25.00 is separate. How this adds up explains each member's allocated share minus expenses paid minus repayments sent plus repayments received; negative amount owed means the member is owed.

The selectors validate the ledger and use checked integer-minor-unit sums. Direct obligations sum each participant's non-self allocation to the actual payer and subtract repayments on that same pair. Opposite directions on one pair offset; overpayment can reverse that pair. No obligation is reassigned through a third member. A cycle can therefore have zero net positions and still have direct obligations; it must not be called settled.

Three-member expected positions `(paid, share, net)` are Kaunda `(249610, 170893, 81217)`, Mizenin `(263046, 170884, 89662)` and River `(0, 170879, -170879)`. Direct obligations are Kaunda → Mizenin $19.84, River → Kaunda $832.01, River → Mizenin $876.78. Names come from member records, never from pair-specific domain branches.

Current active expense snapshots drive contributions and positions. Recent activity independently shows immutable event descriptions, event dates/actors, and explicit added/edited/deleted/repayment labels. Expense rows use stable logical focus IDs and contextual expense links. The separate detail work adds selected-revision inspection to those links. An entirely empty household gets a first-expense prompt, not a claim that an unloaded ledger is settled.

## `AppDataProvider` integration

The persistent root layout nests `AppDataProvider` inside `NavigationProvider`. It creates one session-owned `createMockData()` instance. Tests and later adapters can inject `source={{ port, demo? }}` plus an optional `householdId` (default `household-demo`). Components do not import fixture arrays.

`useAppData()` exposes:

- `port`: replaceable `DataPort` for reads/commands/operation resolution.
- `snapshot?: Snapshot`: current successful data, or explicitly stale data during same-context refresh/offline failure.
- `status`: `loading`, `refreshing`, `ready`, `stale`, `error`, `denied`, `expired`, or `unavailable`.
- `failure`: typed failure reason when present; thrown errors become generic `unexpected`, without logging financial details.
- `readyVersion: number | null`: captured navigation refresh generation of the newest completed query; null while waiting.
- `refresh(): Promise<void>`: request another read. Subscription invalidations and navigation refresh generations invoke the same path.
- `demo?`: optional simulation controls, separate from the application port.

A screen calls `useRouteReady(itsRoute, readyVersion)` after rendering its snapshot or terminal error/empty state. The provider records the generation captured when the request starts, never a newer generation when it finishes. A sequence guard rejects obsolete completions after invalidation, context change or unmount. Port/household provenance gates the exposed snapshot during render, so a source switch cannot expose one frame of another context's financial data before effects run.

Same-context refresh retains the last snapshot with a refresh label. Offline failure with previous data is explicitly stale; initial offline/error has no financial snapshot. Denied, expired, unavailable and unexpected failures clear financial fields. Simulated actor/reset/denial changes clear data before revalidation. Consumers must preserve these distinctions; no loading/error state should manufacture a zero balance. The explanation dialog repeats the stale warning while open.

## Demo controls and access limits

The separate collapsible Simulation controls panel changes fixture, actor and named adapter scenario. Its identity remains stable through access failures so its selected scenario remains truthful and Normal can recover from Denied. Reset explicitly confirms loss of drafts and fixture mutations; pending drafts block reset. Source explanation/reset dialogs suspend while a foreground route is active so a retained background cannot keep a modal above expense detail.

These access checks are simulations, not authenticated server authorization. Session data resets on page reload. A future server adapter must enforce membership and authentication independently.

## Verification

Domain tests cover seed totals, three members, exact settlement and overpayment, deletion, multiple payers, currency partitioning, zero-share members, and a zero-net cycle that remains unsimplified. Provider tests cover committed-mutation refresh, offline/stale distinction, denial/expiry, out-of-order responses, stale navigation generations, independent port/household changes, obsolete rejections and pending reset protection. Component tests cover the real seed rendering, explanation arithmetic, recent-expense/repayment navigation, distinct empty state, stale/denied presentation, suspended source modals and stable recovery controls.

Independent CUA at desktop verified the $42.18 balance, both contributions and the explanation's $2,563.28 share minus $2,496.10 paid minus $25.00 sent. The three-member reset showed the exact positions and direct obligations above. Additional responsive and recovery checks are recorded with the PR as they complete.

CUA at an actual 320×844 viewport and 200% text confirmed a computed 32px root font and 320px document width. Header actions wrapped. Keyboard Enter opened How this adds up; the dialog measured 318px for both rendered and scroll width, with no horizontal clipping. Its scrolled calculation remained fully readable: $2,563.28 share − $2,496.10 paid − $25.00 sent + $0.00 received = $42.18 owed. Escape remained available. A temporary selector in the simulation panel set root text size through React for this check and was removed afterward; it is not a product setting.

Phone 390px verification also exercised Overview → expense → Back → explanation → browser Forward. The foreground expense remained full-page with zero open source dialogs, visible heading focus and matching document/viewport width. Denied kept its selected simulation value and recovered with one Normal selection. Offline preserved $42.18 only with an explicit last-available-data label.
