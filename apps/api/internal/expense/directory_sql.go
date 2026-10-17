package expense

// directoryProjectionSQL has no request parameters: verified transaction-local
// identity and existing RLS own eligibility. All facts share one statement
// snapshot, including a final account-state check. Separate grouped aggregates
// avoid multiplying expenses by allocations/repayments/members. Numeric SUM and
// string transport retain exactness beyond int64 until application validation.
const directoryProjectionSQL = `WITH selected AS MATERIALIZED (
  SELECT g.id, g.name, g.currency, app.viewer_membership(g.id) AS viewer
  FROM app.groups g
  WHERE app.can_read_group(g.id) AND NOT app.is_household_group(g.id)
), expense_totals AS (
  SELECT e.group_id, sum(e.total_minor) AS total,
    sum(CASE WHEN e.payer_id = s.viewer THEN e.total_minor ELSE 0 END) AS paid
  FROM app.expenses e JOIN selected s ON s.id = e.group_id
  GROUP BY e.group_id
), owed_totals AS (
  SELECT a.group_id, sum(a.amount_minor) AS owed
  FROM app.allocations a JOIN selected s ON s.id = a.group_id AND s.viewer = a.participant_id
  GROUP BY a.group_id
), repayment_totals AS (
  SELECT r.group_id,
    sum(CASE WHEN r.sender_id = s.viewer THEN r.amount_minor ELSE 0 END) AS sent,
    sum(CASE WHEN r.recipient_id = s.viewer THEN r.amount_minor ELSE 0 END) AS received
  FROM app.repayments r JOIN selected s ON s.id = r.group_id
  GROUP BY r.group_id
), member_counts AS (
  SELECT m.group_id, count(*) AS active_count
  FROM app.memberships m JOIN selected s ON s.id = m.group_id
  WHERE m.active
  GROUP BY m.group_id
)
SELECT jsonb_build_object(
  'State', (SELECT status FROM app.viewer_identity()),
  'Rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'Group', jsonb_build_object(
        'ID', s.id, 'Name', s.name, 'Currency', s.currency, 'IsHousehold', false,
        'Trip', CASE WHEN t.group_id IS NULL THEN NULL ELSE jsonb_build_object(
          'destination', t.destination,
          'startDate', to_char(t.start_date, 'YYYY-MM-DD'),
          'endDate', to_char(t.end_date, 'YYYY-MM-DD')
        ) END
      ),
      'ActiveMemberCount', coalesce(m.active_count, 0),
      'Total', coalesce(e.total, 0)::text, 'Paid', coalesce(e.paid, 0)::text,
      'Owed', coalesce(o.owed, 0)::text, 'Sent', coalesce(r.sent, 0)::text,
      'Received', coalesce(r.received, 0)::text
    ) ORDER BY s.id)
    FROM selected s
    LEFT JOIN app.group_trip t ON t.group_id = s.id
    LEFT JOIN expense_totals e ON e.group_id = s.id
    LEFT JOIN owed_totals o ON o.group_id = s.id
    LEFT JOIN repayment_totals r ON r.group_id = s.id
    LEFT JOIN member_counts m ON m.group_id = s.id
  ), '[]'::jsonb)
)`
