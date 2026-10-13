package expense

import "strings"

func dashboardProjectionSQL() string {
	// Dashboard uses each authorized selected ledger, current aggregates and an
	// empty record page. This binding is independent of ordinary-read parameters.
	projection := strings.NewReplacer(
		"__GROUP__", "selected.id",
		"__LIMIT__", "0",
		"__FROM__", "NULL::date",
		"__TO__", "NULL::date",
		"__CATEGORY__", "NULL::text",
		"__PARTICIPANT__", "NULL::uuid",
		"__ANCHOR__", "NULL::bigint",
		"__LAST_DATE__", "NULL::date",
		"__LAST_CREATED__", "NULL::timestamptz",
		"__LAST_ID__", "NULL::uuid",
		"__EXPENSE__", "NULL::uuid",
	).Replace(snapshotProjectionSQL)
	return `WITH scope AS MATERIALIZED (
  SELECT app.household_expense_scope() AS data
), selected AS (
  SELECT discovered.group_id::uuid AS id
  FROM scope, jsonb_array_elements_text(scope.data -> 'groups') AS discovered(group_id)
)
SELECT jsonb_build_object(
  'State', scope.data ->> 'state',
  'ContextVersion', ` + contextVersionSQL + `,
  'Groups', scope.data -> 'groups',
  'Rows', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'Snapshot', projection.value,
          'Count', (
            SELECT count(*)::text
            FROM app.expenses e
            WHERE e.group_id = selected.id
          )
        )
        ORDER BY selected.id
      )
      FROM selected
      CROSS JOIN LATERAL (` + projection + `) projection(value)
    ), '[]'::jsonb
  )
)
FROM scope`
}
