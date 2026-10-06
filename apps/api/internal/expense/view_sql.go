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
 SELECT e.* FROM app.expenses e JOIN selected s ON s.id=e.group_id JOIN revisions r ON r.id=e.group_id
 WHERE e.revision<=coalesce((SELECT revision FROM anchors WHERE id=e.group_id),r.revision)
 AND ($1::uuid IS NULL OR e.group_id=$1) AND ($2::uuid IS NULL OR e.payer_id=$2 OR EXISTS(SELECT FROM app.allocations a WHERE a.expense_id=e.id AND a.participant_id=$2))
 AND ($3::date IS NULL OR e.effective_date>=$3) AND ($4::date IS NULL OR e.effective_date<=$4) AND ($5::text IS NULL OR e.category=$5)
), page AS (
 SELECT * FROM filtered e WHERE $7::date IS NULL OR (e.effective_date,e.created_at,e.group_id,e.id)<($7::date,$8::timestamptz,$9::uuid,$10::uuid)
 ORDER BY effective_date DESC,created_at DESC,group_id DESC,id DESC LIMIT $11
), months AS (SELECT to_char(effective_date,'YYYY-MM') AS month,coalesce(sum(total_minor),0)::text AS total,count(*)::text AS count FROM filtered GROUP BY 1)
SELECT jsonb_build_object(
 'ContextVersion',` + contextVersionSQL + `,'State',scope.data->>'state','Eligibility',scope.data->>'anchor','Groups',scope.data->'groups',
 'ValidGroup',($1::uuid IS NULL OR EXISTS(SELECT FROM selected WHERE id=$1)),
 'ValidMember',($2::uuid IS NULL OR EXISTS(SELECT FROM app.memberships m JOIN selected s ON s.id=m.group_id WHERE m.id=$2 AND ($1::uuid IS NULL OR m.group_id=$1))),
 'Revisions',coalesce((SELECT jsonb_agg(jsonb_build_object('GroupID',id,'Revision',revision) ORDER BY id) FROM revisions),'[]'::jsonb),
 'Total',(SELECT coalesce(sum(total_minor),0)::text FROM filtered),'Count',(SELECT count(*)::text FROM filtered),
 'Months',coalesce((SELECT jsonb_agg(jsonb_build_object('Month',month,'Total',total,'Count',count) ORDER BY month DESC) FROM months),'[]'::jsonb),
 'Sources',coalesce((SELECT jsonb_agg(jsonb_build_object('ID',g.id,'Name',g.name,'Currency',g.currency,'IsHousehold',app.is_household_group(g.id),
  'Trip',(SELECT jsonb_build_object('destination',t.destination,'startDate',to_char(t.start_date,'YYYY-MM-DD'),'endDate',to_char(t.end_date,'YYYY-MM-DD')) FROM app.group_trip t WHERE t.group_id=g.id),
  'Members',(SELECT jsonb_agg(jsonb_build_object('ID',m.id,'DisplayName',m.display_name,'Status',m.status,'Role',m.role,'CanParticipate',m.can_participate) ORDER BY m.id) FROM app.group_members(g.id) m)) ORDER BY g.id) FROM app.groups g JOIN selected s ON s.id=g.id),'[]'::jsonb),
 'Records',coalesce((SELECT jsonb_agg(jsonb_build_object('ExpenseID',e.id,'GroupID',e.group_id,'CreatorMembershipID',e.creator_id,'PayerMembershipID',e.payer_id,'TotalMinor',e.total_minor,'Currency',e.currency,'Description',e.description,'EffectiveDate',to_char(e.effective_date,'YYYY-MM-DD'),'Category',e.category,'Note',e.note,'Split',e.split,'CommittedAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'Revision',e.revision,
  'Allocations',(SELECT jsonb_agg(jsonb_build_object('ParticipantID',a.participant_id,'Amount',a.amount_minor) ORDER BY a.participant_id) FROM app.allocations a WHERE a.expense_id=e.id)) ORDER BY e.effective_date DESC,e.created_at DESC,e.group_id DESC,e.id DESC) FROM page e),'[]'::jsonb)) FROM scope`

func viewProjectionSQL(group bool) string {
	scope := `SELECT app.household_expense_scope() AS data`
	if group {
		scope = `SELECT jsonb_build_object('state','COMPLETE','groups',jsonb_build_array(g.id),'anchor',encode(sha256(convert_to(jsonb_build_array(g.id,app.viewer_membership(g.id),(SELECT id FROM app.viewer_identity()))::text,'UTF8')),'hex')) AS data FROM app.groups g WHERE g.id=$12 AND app.can_read_group(g.id)`
	}
	return strings.Replace(expenseViewSQL, "__SCOPE__", scope, 1)
}
