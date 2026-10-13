package expense

import "strings"

// ordinaryProjectionSQL binds the readSnapshot argument contract: group, page
// limit, date range, category, participant, revision anchor, cursor tuple and
// optional expense ID. Only fixed SQL fragments fill the shared template;
// request values are supplied separately to QueryRow.
func ordinaryProjectionSQL() string {
	return strings.NewReplacer(
		"__GROUP__", "$1",
		"__LIMIT__", "$2",
		"__FROM__", "$3",
		"__TO__", "$4",
		"__CATEGORY__", "$5",
		"__PARTICIPANT__", "$6",
		"__ANCHOR__", "$7",
		"__LAST_DATE__", "$8",
		"__LAST_CREATED__", "$9",
		"__LAST_ID__", "$10",
		"__EXPENSE__", "$11",
	).Replace(snapshotProjectionSQL)
}

// All complete aggregates and page records share a READ COMMITTED statement
// snapshot after group/actor locks. Filters affect only the expense connection.
const snapshotProjectionSQL = `WITH visible AS (
  SELECT g.id, g.name, g.currency, app.viewer_membership(g.id) AS viewer
  FROM app.groups g
  WHERE g.id = __GROUP__
  AND app.can_read_group(g.id)
), members AS (
  SELECT *
  FROM app.group_members(__GROUP__)
), revision AS (
  SELECT coalesce(max(revision), 0) AS n
  FROM app.financial_records
  WHERE group_id = __GROUP__
), filtered AS (
  SELECT e.*
  FROM app.expenses_at_revision(__GROUP__, coalesce(__ANCHOR__::bigint, (SELECT n FROM revision))) e
  WHERE e.group_id = __GROUP__
  AND (__FROM__::date IS NULL OR e.effective_date >= __FROM__)
  AND (__TO__::date IS NULL OR e.effective_date <= __TO__)
  AND (__CATEGORY__::text IS NULL OR e.category = __CATEGORY__)
  AND (
    __PARTICIPANT__::uuid IS NULL
    OR EXISTS(
      SELECT
      FROM app.allocations_at_revision(e.id, e.version) a
      WHERE a.expense_id = e.id
      AND a.participant_id = __PARTICIPANT__
    )
  )
  AND (__EXPENSE__::uuid IS NULL OR e.id = __EXPENSE__)
), page AS (
  SELECT *
  FROM filtered e
  WHERE __LAST_DATE__::date IS NULL
  OR (e.effective_date, e.created_at, e.id) < (__LAST_DATE__::date, __LAST_CREATED__::timestamptz, __LAST_ID__::uuid)
  ORDER BY effective_date DESC, created_at DESC, id DESC
  LIMIT __LIMIT__
), positions AS (
  SELECT m.id, coalesce(
    (
      SELECT sum(e.total_minor)
      FROM app.expenses e
      WHERE e.group_id = __GROUP__
      AND e.payer_id = m.id
    ), 0
  )::text AS paid, coalesce(
    (
      SELECT sum(a.amount_minor)
      FROM app.allocations a
      WHERE a.group_id = __GROUP__
      AND a.participant_id = m.id
    ), 0
  )::text AS owed, coalesce(
    (
      SELECT sum(r.amount_minor)
      FROM app.repayments r
      WHERE r.group_id = __GROUP__
      AND r.sender_id = m.id
    ), 0
  )::text AS sent, coalesce(
    (
      SELECT sum(r.amount_minor)
      FROM app.repayments r
      WHERE r.group_id = __GROUP__
      AND r.recipient_id = m.id
    ), 0
  )::text AS received
  FROM members m
)
SELECT jsonb_build_object(
  'ID', v.id,
  'Name', v.name,
  'Currency', v.currency,
  'ViewerMembershipID', v.viewer,
  'IsHousehold', app.is_household_group(v.id),
  'Trip', (
    SELECT jsonb_build_object(
      'destination', t.destination,
      'startDate', to_char(t.start_date, 'YYYY-MM-DD'),
      'endDate', to_char(t.end_date, 'YYYY-MM-DD')
    )
    FROM app.group_trip t
    WHERE t.group_id = v.id
  ),
  'Revision', (
    SELECT n
    FROM revision
  ),
  'Total', (
    SELECT coalesce(sum(total_minor), 0)::text
    FROM app.expenses
    WHERE group_id = __GROUP__
  ),
  'ValidParticipant', (__PARTICIPANT__::uuid IS NULL OR EXISTS(SELECT FROM members WHERE id = __PARTICIPANT__)),
  'HasPrevious', (
    __LAST_DATE__::date IS NOT NULL
    AND EXISTS(
      SELECT
      FROM filtered e
      WHERE (e.effective_date, e.created_at, e.id) >= (__LAST_DATE__::date, __LAST_CREATED__::timestamptz, __LAST_ID__::uuid)
    )
  ),
  'Members', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'ID', id,
          'DisplayName', display_name,
          'Status', status,
          'Role', role,
          'CanParticipate', can_participate
        )
        ORDER BY id
      )
      FROM members
    ), '[]'::jsonb
  ),
  'Positions', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object('MemberID', id, 'Paid', paid, 'Owed', owed, 'Sent', sent, 'Received', received)
        ORDER BY id
      )
      FROM positions
    ), '[]'::jsonb
  ),
  'Records', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'ExpenseID', e.id,
          'CreatorMembershipID', e.creator_id,
          'PayerMembershipID', e.payer_id,
          'TotalMinor', e.total_minor,
          'Currency', e.currency,
          'Description', e.description,
          'EffectiveDate', to_char(e.effective_date, 'YYYY-MM-DD'),
          'Category', e.category,
          'Note', e.note,
          'Split', e.split,
          'CommittedAt', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'Revision', e.revision,
          'Version', e.version,
          'Percentages', (
            SELECT coalesce(
              jsonb_agg(
                jsonb_build_object('ParticipantID', a.participant_id, 'Hundredths', a.percentage_hundredths)
                ORDER BY a.participant_id
              ), '[]'::jsonb
            )
            FROM app.allocations_at_revision(e.id, e.version) a
            WHERE a.expense_id = e.id
            AND a.percentage_hundredths IS NOT NULL
          ),
          'Allocations', (
            SELECT jsonb_agg(
              jsonb_build_object('ParticipantID', a.participant_id, 'Amount', a.amount_minor)
              ORDER BY a.participant_id
            )
            FROM app.allocations_at_revision(e.id, e.version) a
            WHERE a.expense_id = e.id
          )
        )
        ORDER BY e.effective_date DESC, e.created_at DESC, e.id DESC
      )
      FROM page e
    ), '[]'::jsonb
  )
)
FROM visible v`
