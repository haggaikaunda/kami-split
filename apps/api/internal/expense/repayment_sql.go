package expense

// repaymentProjectionSQL binds group, limit, revision anchor, cursor date/time/ID
// and optional repayment ID, in the order supplied by ReadRepayments. Complete
// members and the bounded history page share its post-lock statement snapshot.
const repaymentProjectionSQL = `WITH revision AS (
  SELECT coalesce(max(revision), 0) n
  FROM app.financial_records
  WHERE group_id = $1
), filtered AS (
  SELECT *
  FROM app.repayments
  WHERE group_id = $1
  AND revision <= coalesce($3::bigint, (SELECT n FROM revision))
  AND ($7::uuid IS NULL OR id = $7)
), page AS (
  SELECT *
  FROM filtered
  WHERE $4::date IS NULL
  OR (effective_date, created_at, id) < ($4::date, $5::timestamptz, $6::uuid)
  ORDER BY effective_date DESC, created_at DESC, id DESC
  LIMIT $2
)
SELECT jsonb_build_object(
  'Revision', (
    SELECT n
    FROM revision
  ),
  'HasPrevious', (
    $4::date IS NOT NULL
    AND EXISTS(
      SELECT
      FROM filtered
      WHERE (effective_date, created_at, id) >= ($4::date, $5::timestamptz, $6::uuid)
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
      FROM app.group_members($1)
    ), '[]'::jsonb
  ),
  'Records', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'RepaymentID', id,
          'CreatorMembershipID', creator_id,
          'SenderMembershipID', sender_id,
          'RecipientMembershipID', recipient_id,
          'AmountMinor', amount_minor,
          'Currency', currency,
          'EffectiveDate', to_char(effective_date, 'YYYY-MM-DD'),
          'Note', note,
          'CommittedAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'Revision', revision
        )
        ORDER BY effective_date DESC, created_at DESC, id DESC
      )
      FROM page
    ), '[]'::jsonb
  )
)`
