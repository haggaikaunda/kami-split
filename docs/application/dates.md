# Calendar dates and recorded times

Expense and trip dates are Gregorian calendar values (`YYYY-MM-DD`), not instants.
Readable labels preserve their calendar components in every device time zone.
The formatter uses UTC solely to prevent a browser-zone shift when rendering these
components. Input values, stored values, inclusive date-filter bounds, lexical
sorting and month grouping remain date-only strings; no historical data migration
is performed. Trip status and new-trip date defaults retain the server-day policy.

A new expense reads the device's current local calendar date when its form mounts.
Reopening a fresh form after local midnight reads the new day. An open form,
explicitly chosen date, saved draft or frozen recovery attempt retains its date;
clock changes never rewrite user intent. A cleared form after a confirmed save also
uses the then-current device date. Users can still select past or future dates.

Actual invitation expiry, expense creation and Activity recorded timestamps use
one explicit UTC display policy: an English abbreviated month, day, year, time
including seconds, and UTC label. This intentionally replaces mixed browser-local
and raw-ISO presentation. Offset-bearing input timestamps identify instants and
are converted to UTC; daylight-saving changes do not create ambiguous recorded
labels. Date-only financial facts remain separate from the recorded time.

Detail/audit and invitation surfaces expose a keyboard- and touch-operable
**Exact timestamp** disclosure retaining the original offset/fractional precision.
Ordinary labels are human-readable; semantic `time` elements retain wire values.
Activity ordering still uses the server timestamp/cursor, and snapshot comparisons
still compare the original calendar values before formatting them. No account
time-zone preference, authentication, mutation or financial calculation changes.

Verification covers local midnight on both sides of UTC, DST boundaries, Gregorian
parsing, saved/explicit dates, exact timestamp inspection and inclusive filters.
Browser checks use synthetic authenticated fixtures; they do not prove API
permissions or persistence.
