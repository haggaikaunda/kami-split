package expense

import "strings"

// scope and the selected ledgers, profiles, revisions, rows and all aggregates
// share a fresh post-lock statement snapshot. Append-only anchors restrict the
// complete filtered dataset, not just the page. No text search participates.
const expenseViewSQL = `WITH scope AS MATERIALIZED (__SCOPE__),
selected AS (SELECT value::uuid AS id FROM scope,jsonb_array_elements_text(scope.data->'groups') ids(value)),
revisions AS (SELECT s.id,coalesce(max(f.revision),0) AS revision FROM selected s LEFT JOIN app.financial_records f ON f.group_id=s.id GROUP BY s.id),
anchors AS (SELECT x.group_id::uuid AS id,x.revision FROM jsonb_to_recordset(coalesce($6::jsonb,'[]'::jsonb)) x(group_id text,revision bigint)),
filtered AS MATERIALIZED (
 SELECT e.*,
  coalesce((SELECT sum(a.amount_minor) FROM app.allocations_at_revision(e.id,e.version) a WHERE a.participant_id=app.viewer_membership(e.group_id)),0) AS viewer_share_minor,
  CASE WHEN e.payer_id=app.viewer_membership(e.group_id) THEN e.total_minor ELSE 0 END AS viewer_paid_minor
 FROM selected s JOIN revisions r ON r.id=s.id CROSS JOIN LATERAL app.expenses_at_revision(s.id,coalesce((SELECT revision FROM anchors WHERE id=s.id),r.revision)) e
 WHERE ($1::uuid IS NULL OR e.group_id=$1) AND (coalesce(cardinality($2::uuid[]),0)=0 OR e.payer_id=ANY($2) OR EXISTS(SELECT FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id AND a.participant_id=ANY($2)))
 AND (coalesce(cardinality($12::uuid[]),0)=0 OR e.payer_id=ANY($12))
 AND ($3::date IS NULL OR e.effective_date>=$3) AND ($4::date IS NULL OR e.effective_date<=$4) AND (coalesce(cardinality($5::text[]),0)=0 OR e.category=ANY($5))
), page AS (
 SELECT * FROM filtered e WHERE $7::date IS NULL OR __BOUNDARY__
 ORDER BY __ORDER__ LIMIT $11
), months AS (SELECT to_char(effective_date,'YYYY-MM') AS month,coalesce(sum(total_minor),0)::text AS total,count(*)::text AS count FROM filtered GROUP BY 1)
SELECT jsonb_build_object(
 'ContextVersion',` + contextVersionSQL + `,'State',scope.data->>'state','Eligibility',scope.data->>'anchor','Groups',scope.data->'groups',
 'ValidGroup',($1::uuid IS NULL OR EXISTS(SELECT FROM selected WHERE id=$1)),
 'ValidMember',(NOT EXISTS(SELECT FROM unnest(coalesce($2::uuid[],'{}'::uuid[]) || coalesce($12::uuid[],'{}'::uuid[])) requested(id) WHERE NOT EXISTS(SELECT FROM app.memberships m JOIN selected s ON s.id=m.group_id WHERE m.id=requested.id AND ($1::uuid IS NULL OR m.group_id=$1)))),
 'Revisions',coalesce((SELECT jsonb_agg(jsonb_build_object('GroupID',id,'Revision',revision) ORDER BY id) FROM revisions),'[]'::jsonb),
 'Total',(SELECT coalesce(sum(total_minor),0)::text FROM filtered),'Count',(SELECT count(*)::text FROM filtered),
 'ViewerShare',(SELECT coalesce(sum(viewer_share_minor),0)::text FROM filtered),'ViewerPaid',(SELECT coalesce(sum(viewer_paid_minor),0)::text FROM filtered),
 'Categories',coalesce((SELECT jsonb_agg(jsonb_build_object('Category',category,'Total',total,'ViewerShare',share,'Count',count) ORDER BY category) FROM (SELECT category,sum(total_minor)::text AS total,sum(viewer_share_minor)::text AS share,count(*)::text AS count FROM filtered GROUP BY category) categories),'[]'::jsonb),
 'Months',coalesce((SELECT jsonb_agg(jsonb_build_object('Month',month,'Total',total,'Count',count) ORDER BY month DESC) FROM months),'[]'::jsonb),
 'Sources',coalesce((SELECT jsonb_agg(jsonb_build_object('ID',g.id,'Name',g.name,'Currency',g.currency,'IsHousehold',app.is_household_group(g.id),
  'Trip',(SELECT jsonb_build_object('destination',t.destination,'startDate',to_char(t.start_date,'YYYY-MM-DD'),'endDate',to_char(t.end_date,'YYYY-MM-DD')) FROM app.group_trip t WHERE t.group_id=g.id),
  'Members',(SELECT jsonb_agg(jsonb_build_object('ID',m.id,'DisplayName',m.display_name,'Status',m.status,'Role',m.role,'CanParticipate',m.can_participate) ORDER BY m.id) FROM app.group_members(g.id) m)) ORDER BY g.id) FROM app.groups g JOIN selected s ON s.id=g.id),'[]'::jsonb),
 'Records',coalesce((SELECT jsonb_agg(jsonb_build_object('ExpenseID',e.id,'GroupID',e.group_id,'CreatorMembershipID',e.creator_id,'PayerMembershipID',e.payer_id,'TotalMinor',e.total_minor,'Currency',e.currency,'Description',e.description,'EffectiveDate',to_char(e.effective_date,'YYYY-MM-DD'),'Category',e.category,'Note',e.note,'Split',e.split,'CommittedAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'Revision',e.revision,'Version',e.version,
  'Percentages',(SELECT coalesce(jsonb_agg(jsonb_build_object('ParticipantID',a.participant_id,'Hundredths',a.percentage_hundredths) ORDER BY a.participant_id),'[]'::jsonb) FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id AND a.percentage_hundredths IS NOT NULL),
  'Allocations',(SELECT jsonb_agg(jsonb_build_object('ParticipantID',a.participant_id,'Amount',a.amount_minor) ORDER BY a.participant_id) FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id)) ORDER BY __ORDER__) FROM page e),'[]'::jsonb)) FROM scope`

func viewProjectionSQL(group bool, sort string) string {
	scope := `SELECT app.household_expense_scope() AS data`
	if group {
		scope = `SELECT jsonb_build_object('state','COMPLETE','groups',jsonb_build_array(g.id),'anchor',encode(sha256(convert_to(jsonb_build_array(g.id,app.viewer_membership(g.id),(SELECT id FROM app.viewer_identity()))::text,'UTF8')),'hex')) AS data FROM app.groups g WHERE g.id=$14 AND app.can_read_group(g.id)`
	}
	direction, operator := "DESC", "<"
	if sort == "DATE_ASC" || sort == "AMOUNT_ASC" {
		direction, operator = "ASC", ">"
	}
	columns := []string{"e.effective_date", "e.created_at", "e.group_id", "e.id"}
	boundary := []string{"$7::date", "$8::timestamptz", "$9::uuid", "$10::uuid"}
	if sort == "AMOUNT_ASC" || sort == "AMOUNT_DESC" {
		columns = append([]string{"e.total_minor"}, columns...)
		boundary = append([]string{"$13::bigint"}, boundary...)
	} else {
		// Keep the shared amount argument typed even when the date order does not
		// use it; PostgreSQL requires a type for every supplied parameter.
		boundary[0] = "CASE WHEN $13::bigint IS NULL THEN $7::date ELSE $7::date END"
	}
	comparison := "(" + strings.Join(columns, ",") + ")" + operator + "(" + strings.Join(boundary, ",") + ")"
	order := strings.Join(columns, " "+direction+",") + " " + direction
	return strings.NewReplacer("__SCOPE__", scope, "__BOUNDARY__", comparison, "__ORDER__", order).Replace(expenseViewSQL)
}
