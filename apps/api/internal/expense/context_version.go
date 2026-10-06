package expense

// contextVersionSQL binds the complete authorized source set and all current
// metadata used by concurrent Household context/ledger reads. Both projections
// evaluate it in their final statement snapshot, independently of filters/pages.
// The existing eligibility anchor binds the actor and current membership/account generations;
// financial revisions deliberately remain owned by the signed traversal cursor.
const contextVersionSQL = `CASE WHEN scope.data->>'state'='COMPLETE' THEN
 encode(sha256(convert_to(jsonb_build_array(scope.data->>'anchor',
  coalesce((SELECT jsonb_agg(jsonb_build_array(g.id,g.name,g.currency,
   app.is_household_group(g.id),app.viewer_membership(g.id),
   (SELECT to_jsonb(t)-'group_id' FROM app.group_trip t WHERE t.group_id=g.id),
   (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM app.group_members(g.id) m)
  ) ORDER BY g.id) FROM app.groups g JOIN selected s ON s.id=g.id),'[]'::jsonb)
 )::text,'UTF8')),'hex') END`
