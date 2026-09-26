# Trips list and creation

Issue #25 implements T01 and the create-to-empty-trip part of N05. Cards derive totals and counts from current shared expense IDs through `spending`; repayments and deleted expenses do not contribute. Dates always include a year. Status is computed from the injected snapshot clock: start/end days are In progress, dates before start Upcoming, dates after end Past. Only All includes in-progress trips.

The create form validates name, optional destination, valid dates and end >= start, and stores dirty input in the shared session draft. The generic session command provider handles one operation, uncertainty, actor changes and reset leases. A confirmed create opens `/trips/:id`, where the saved name/dates, zero expenses and a working Add expense action are available immediately. A request completing after users leave does not interrupt their current route. New trips use the abstract cover.

Maui and Tahoe use the two approved remote image identifiers from `docs/design/assets/README.md`; no new imagery is fetched or bundled. The [Unsplash license](https://unsplash.com/license) was checked on September 26, 2026 and permits this use. Photographer/source credit links remain visible. Image errors replace the photo with a deterministic abstract cover, and automated tests exercise that fallback.

## Integration API

- `tripStatus(trip, today)`, `tripCards(snapshot, filter)`, `tripDateLabel(date)` and `validateTripDraft(values)` are in `src/lib/trips.ts`.
- `TripCover` and `TripCredits` are shared by list/detail surfaces.
- `TripDestination` is intentionally the minimal saved-trip destination for this issue; #26 expands the overview, charts and expense tab.
- `NavigationProvider.replaceDestination` replaces a completed create form with its saved destination. Cards capture their list visit; confirmed creation carries its visit to the saved trip, and its Back action restores the original filter, scroll and focus. Direct trip entry offers All trips.

## Verification

Formatting, lint, type checking, 206 tests and production build pass. New tests cover status boundary days/future years, shared sample totals, deletion exclusion, date/name validation, a real create-to-empty destination, denied command retention, timeout/double-submit deduplication, filters/empty states and image failure.

No trip budgets, itineraries, booking, cover upload, separate trip ledger or durable persistence are included. Data remains session-only through the replaceable port.

## Independent verification

The independent final-diff reviewer approved the trip helpers, fallback/credits, shared create lifecycle, preserved edit fallback and final source-aware return, and ran 31 trip/create/edit tests without failures.

Root independently verified one idempotent new trip with an abstract cover and empty expenses, unchanged household finances/activity, and In progress appearing only in All. In the production browser, Upcoming → Create retained name/destination on an invalid end-before-start date and focused the end-date error. Correcting the date created the distinct saved trip with its name/dates, default cover and zero expenses. Back returned to `filter=upcoming`, focused Create trip and showed the new card. The baseline cards matched Maui 1,644.20 USD / 7 expenses, Tahoe 840.00 USD / 3 expenses and Porto 0.00 USD / 0 expenses, with the approved dates. The actual 320px form retained a 320px document and 318px dialog without overflow; the screenshot and date fields were readable.
