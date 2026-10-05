# Trips list and creation

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

## Accepted production direction

The implementation below is the household-scoped seeded preview. [ADR-003](../application/decisions/003-bootstrap-groups-and-invitations.md#b2-groups-are-independent-access-and-financial-boundaries) specifies a trip as an independently authorized group with trip classification and structured metadata; ordinary non-trip groups use the same foundation. Trip invitations grant no household access, and each expense/settlement belongs to exactly one group. #85 adopted the production design in [ADR-006](../application/decisions/006-group-creation.md); embedded preview `Trip` records are not a production schema.

## Current authenticated discovery

Issue #105 connects `/trips` to the real authorized Viewer groups list. All,
Upcoming and Past use server UTC dates; in-progress trips appear only in All.
Cards show metadata and abstract covers without expense totals/counts. They link
to canonical `/groups/:groupId` detail and group-scoped expense URLs, reusing
complete balances and expenses regardless of travel dates. See the
[authenticated journey](../application/relay-expenses.md) for scope, authorization,
recovery and source-return behavior. Creation forms remain a separate slice.

## Seeded preview

The retained seeded components and `/trips/:tripId` detail are isolated demo surfaces. The list/creation evidence below describes the historical preview; `/trips` now uses authenticated discovery. Issue #25 implements T01 and the create-to-empty-trip part of N05. Cards derive totals and counts from current shared expense IDs through `spending`; repayments and deleted expenses do not contribute. Dates always include a year. Status is computed from the injected snapshot clock: start/end days are In progress, dates before start Upcoming, dates after end Past. Only All includes in-progress trips.

The create form validates name, optional destination, valid dates and end >= start, and stores dirty input in the shared session draft. The generic session command provider handles one operation, uncertainty, actor changes and reset leases. A confirmed create opens `/trips/:id`, where the saved name/dates, zero expenses and a working Add expense action are available immediately. A request completing after users leave does not interrupt their current route. New trips use the abstract cover.

Maui and Tahoe use the two approved remote image identifiers from `docs/design/assets/README.md`; no new imagery is fetched or bundled. The [Unsplash license](https://unsplash.com/license) was checked on September 26, 2026 and permits this use. Photographer/source credit links remain visible. Image errors replace the photo with a deterministic abstract cover, and automated tests exercise that fallback.

## Integration API

- `tripStatus(trip, today)`, `tripCards(snapshot, filter)`, `tripDateLabel(date)` and `validateTripDraft(values)` are in `apps/web/src/lib/trips.ts`.
- `TripCover` and `TripCredits` are shared by list/detail surfaces.
- `TripDestination` provides the implemented [trip detail](detail.md), including Overview/Expenses views and [spending charts](../spending/README.md).
- `NavigationProvider.replaceDestination` replaces a completed create form with its saved destination. Cards capture their list visit; confirmed creation carries its visit to the saved trip, and its Back action restores the original filter, scroll and focus. Direct trip entry offers All trips.

## Verification

At issue #25 acceptance, formatting, lint, type checking, 206 tests and production build passed. This is the historical acceptance count, not the current suite total. New tests cover status boundary days/future years, shared sample totals, deletion exclusion, date/name validation, a real create-to-empty destination, denied command retention, timeout/double-submit deduplication, filters/empty states and image failure.

No trip budgets, itineraries, booking, cover upload, separate trip ledger or durable persistence are included. Data remains session-only through the replaceable port.

## Independent verification

The independent final-diff reviewer approved the trip helpers, fallback/credits, shared create lifecycle, preserved edit fallback and final source-aware return, and ran 31 trip/create/edit tests without failures.

Root independently verified one idempotent new trip with an abstract cover and empty expenses, unchanged household finances/activity, and In progress appearing only in All. In the production browser, Upcoming → Create retained name/destination on an invalid end-before-start date and focused the end-date error. Correcting the date created the distinct saved trip with its name/dates, default cover and zero expenses. Back returned to `filter=upcoming`, focused Create trip and showed the new card. The baseline cards matched Maui 1,644.20 USD / 7 expenses, Tahoe 840.00 USD / 3 expenses and Porto 0.00 USD / 0 expenses, with the approved dates. The actual 320px form retained a 320px document and 318px dialog without overflow; the screenshot and date fields were readable.
