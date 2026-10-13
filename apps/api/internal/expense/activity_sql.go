package expense

// activityReadSQL preserves the event projection and, for Household reads, samples
// eligibility in the same statement. readActivity owns authorization, locks,
// execution and verification of the sampled scope.
func activityReadSQL(household bool) string {
	if household {
		return `SELECT jsonb_build_object(
  'scope', app.household_expense_scope(),
  'events', (` + activityProjectionSQL + `)
)`
	}
	return activityProjectionSQL
}

// activityAnchorsSQL binds the currently authorized group IDs as $1.
const activityAnchorsSQL = `SELECT coalesce(
  jsonb_agg(
    jsonb_build_object(
      'group', g.id,
      'revision', (
        SELECT coalesce(max(revision), 0)
        FROM app.financial_records f
        WHERE f.group_id = g.id
      )
    )
    ORDER BY g.id
  ), '[]'::jsonb
)
FROM app.groups g
WHERE g.id = ANY($1::uuid[])`

// activityProjectionSQL binds anchors, event kind, source group, cursor timestamp,
// kind and ID, page limit, and optional event ID, in readActivity's argument order.
const activityProjectionSQL = `WITH anchors AS (
  SELECT "group"::uuid group_id, revision
  FROM jsonb_to_recordset($1::jsonb) AS a("group" text, revision bigint)
), events AS (
  SELECT e.event_id id, e.id record_id, e.group_id, e.actor_membership_id creator_id,
  e.payer_id, NULL::uuid sender_id, NULL::uuid recipient_id, e.total_minor amount_minor,
  e.currency, e.effective_date, e.recorded_at created_at, CASE WHEN e.version = 1 THEN 'EXPENSE_CREATED' ELSE 'EXPENSE_UPDATED' END kind,
  e.description, e.note, e.version
  FROM app.expense_revisions e
  JOIN anchors a ON a.group_id = e.group_id
  AND e.revision <= a.revision
  UNION ALL
  SELECT r.id, r.id, r.group_id, r.creator_id, NULL::uuid, r.sender_id, r.recipient_id,
  r.amount_minor, r.currency, r.effective_date, r.created_at, 'REPAYMENT_RECORDED'::text,
  ''::text, r.note, NULL::bigint
  FROM app.repayments r
  JOIN anchors a ON a.group_id = r.group_id
  AND r.revision <= a.revision
), page AS (
  SELECT *
  FROM events
  WHERE ($2 = '' OR kind = $2)
  AND ($3::uuid IS NULL OR group_id = $3)
  AND (
    $4::timestamptz IS NULL
    OR (created_at, kind, id) < ($4::timestamptz, $5::text, $6::uuid)
  )
  AND ($8::uuid IS NULL OR id = $8)
  ORDER BY created_at DESC, kind DESC, id DESC
  LIMIT $7
)
SELECT coalesce(
  jsonb_agg(
    jsonb_build_object(
      'EventID', p.id,
      'RecordID', p.record_id,
      'Kind', p.kind,
      'GroupID', p.group_id,
      'GroupName', g.name,
      'GroupKind', CASE WHEN EXISTS(
        SELECT
        FROM app.group_trip t
        WHERE t.group_id = g.id
      ) THEN 'TRIP' ELSE 'ORDINARY' END,
      'IsHousehold', app.is_household_group(g.id),
      'AmountMinor', p.amount_minor,
      'Currency', p.currency,
      'Description', p.description,
      'Note', p.note,
      'EffectiveDate', to_char(p.effective_date, 'YYYY-MM-DD'),
      'Timestamp', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'Creator', (
        SELECT jsonb_build_object('ID', m.id, 'DisplayName', m.display_name)
        FROM app.group_members(p.group_id) m
        WHERE m.id = p.creator_id
      ),
      'Actor', (
        SELECT jsonb_build_object('ID', m.id, 'DisplayName', m.display_name)
        FROM app.group_members(p.group_id) m
        WHERE m.id = p.creator_id
      ),
      'Payer', (
        SELECT jsonb_build_object('ID', m.id, 'DisplayName', m.display_name)
        FROM app.group_members(p.group_id) m
        WHERE m.id = p.payer_id
      ),
      'Sender', (
        SELECT jsonb_build_object('ID', m.id, 'DisplayName', m.display_name)
        FROM app.group_members(p.group_id) m
        WHERE m.id = p.sender_id
      ),
      'Recipient', (
        SELECT jsonb_build_object('ID', m.id, 'DisplayName', m.display_name)
        FROM app.group_members(p.group_id) m
        WHERE m.id = p.recipient_id
      ),
      'SnapshotMembers', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'ID', m.id,
            'DisplayName', m.display_name,
            'Status', m.status,
            'Role', m.role,
            'CanParticipate', m.can_participate
          )
          ORDER BY m.id
        )
        FROM app.group_members(p.group_id) m
      ),
      'Before', (
        SELECT ` + activityRecordSQL + `
        FROM app.expense_revisions e
        WHERE e.id = p.record_id
        AND e.version = p.version - 1
      ),
      'After', (
        SELECT ` + activityRecordSQL + `
        FROM app.expense_revisions e
        WHERE e.id = p.record_id
        AND e.version = p.version
      )
    )
    ORDER BY p.created_at DESC, p.kind DESC, p.id DESC
  ), '[]'::jsonb
)
FROM page p
JOIN app.groups g ON g.id = p.group_id`

const activityRecordSQL = `jsonb_build_object(
  'ExpenseID', e.id,
  'GroupID', e.group_id,
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
    FROM app.expense_revision_allocations a
    WHERE a.expense_id = e.id
    AND a.version = e.version
    AND a.percentage_hundredths IS NOT NULL
  ),
  'Allocations', (
    SELECT jsonb_agg(
      jsonb_build_object('ParticipantID', a.participant_id, 'Amount', a.amount_minor)
      ORDER BY a.participant_id
    )
    FROM app.expense_revision_allocations a
    WHERE a.expense_id = e.id
    AND a.version = e.version
  )
)`
