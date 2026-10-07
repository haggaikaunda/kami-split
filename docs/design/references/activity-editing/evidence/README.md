# Expense editing browser evidence

Captured from the production Next.js build at `1a20369` using
`TestEditRealBrowserJourney` and `scripts/edit-real-browser.cjs`, against the real
GraphQL service and restricted-role disposable PostgreSQL database. Authentication
transport uses synthetic fixture accounts; financial responses are not mocked.
No production personal or financial data appears in these images.

The browser test passed with Go's race detector (18.480s). Each of Aggregate,
Group, Trip and Household ledger creates a $120 expense, edits the same identity
to $100 with category/note changes, reloads, records a real $1 repayment and
verifies the resulting update's $120/$100 comparison. Creation detail remains
$120, and repayment detail remains $1. Keyboard Enter opens detail; Close detail
returns focus to its event. Long descriptions/notes wrap without horizontal
overflow. The test checks actual light/dark themes and feed secondary text
contrast of at least 4.5:1.

For each context, `*-activity-{320,390,768,1280}-{light,dark}-{100,200}.png`
contains the complete responsive/theme/text-size matrix. Text-size 200 means
200% root text, with the CSS viewport retained. `*-feed-*-light-100.png` shows all
three event types. `*-edit-390-light-100.png`, `*-created-detail.png` and
`*-repayment-detail.png` capture the associated form and historical details.
These are full-page captures: fixed mobile navigation appears at the viewport
boundary and remains reachable while scrolling.

Compare with the [approved original board](../README.md). Representative captures:

| State                | Capture                                                        |
| -------------------- | -------------------------------------------------------------- |
| Mobile feed          | [Group, 390px](group-feed-390-light-100.png)                   |
| Mobile edit          | [Group form](group-edit-390-light-100.png)                     |
| Mobile update        | [Aggregate, 390px](aggregate-activity-390-light-100.png)       |
| Narrow enlarged text | [Trip, 320px dark / 200%](trip-activity-320-dark-200.png)      |
| Tablet               | [Group, 768px light](group-activity-768-light-100.png)         |
| Desktop update       | [Group, 1280px dark](group-activity-1280-dark-100.png)         |
| Household desktop    | [Household, 1280px dark](household-activity-1280-dark-100.png) |
| Historical creation  | [Created expense](group-created-detail.png)                    |
| Actual repayment     | [Repayment](group-repayment-detail.png)                        |

Visual inspection corrected embedded feed button colors, dark brand text and
Group/Household header surfaces. The final captures retain the production
navigation, supported categories/splits, actor/source/time attribution and
clearly labeled previous/new values; the reference's illustrative extra controls
are not introduced.
