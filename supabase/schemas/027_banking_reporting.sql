SET ROLE kami_migrator;

-- User intent is distinct from automatic source projections. Review has its own
-- material acknowledgement so checking Reviewed cannot validate stale activity.
ALTER TABLE app.banking_annotations ADD COLUMN changed_field text CHECK(changed_field IN('category','activity','note','excluded','reviewed'));
ALTER TABLE app.banking_annotations ADD COLUMN reviewed_material_revision bigint;
ALTER TABLE app.banking_annotations ADD CONSTRAINT banking_annotation_review_material FOREIGN KEY(source_id,reviewed_material_revision,owner_id) REFERENCES app.banking_source_revisions(source_id,revision,owner_id);
CREATE FUNCTION app.banking_annotation_projection(target uuid,fact bigint,cutoff bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH source AS (SELECT r.* FROM app.banking_source_revisions r WHERE r.source_id=target AND r.revision=fact AND r.owner_id=app.banking_owner()),
 -- Earlier storage versions had no field provenance. A source projection
 -- carries owner fields unchanged; a legacy full-row edit changes at least one
 -- private intent field (including an explicit null activity reset).
 history AS MATERIALIZED (
  SELECT a.*,(a.changed_field IS NULL AND (a.applies_to_source_revision IS NULL OR prior.revision IS NULL OR
   (a.material_source_revision,a.activity,a.category,a.note,a.excluded) IS DISTINCT FROM
   (prior.material_source_revision,prior.activity,prior.category,prior.note,prior.excluded))) AS legacy_intent
  FROM app.banking_annotations a LEFT JOIN LATERAL (SELECT p.* FROM app.banking_annotations p WHERE p.source_id=a.source_id AND p.revision<a.revision ORDER BY p.revision DESC LIMIT 1) prior ON true
  WHERE a.source_id=target AND (cutoff IS NULL OR a.revision<=cutoff)
 ),
 latest AS (SELECT a.* FROM history a ORDER BY a.revision DESC LIMIT 1),
 activity AS (SELECT a.* FROM history a WHERE a.changed_field='activity' OR a.legacy_intent ORDER BY a.revision DESC LIMIT 1),
 review AS (SELECT a.* FROM history a WHERE a.changed_field='reviewed' OR a.legacy_intent ORDER BY a.revision DESC LIMIT 1)
 SELECT jsonb_build_object('revision',coalesce(l.revision,0)::text,'annotation_revision',coalesce(l.revision,0)::text,
  'category',l.category,'activity',a.activity,'note',l.note,'excluded',coalesce(l.excluded,false),
  'material_revision',coalesce(a.material_source_revision,coalesce(s.material_revision,s.revision))::text,
  'reviewed_material_revision',coalesce(v.reviewed_material_revision,v.material_source_revision)::text,
  'reviewed',coalesce(v.reviewed AND coalesce(v.reviewed_material_revision,v.material_source_revision)=coalesce(s.material_revision,s.revision),false),
  'material_conflict',coalesce(a.activity IS NOT NULL AND a.material_source_revision<>coalesce(s.material_revision,s.revision),false))
 FROM source s LEFT JOIN latest l ON true LEFT JOIN activity a ON true LEFT JOIN review v ON true;
$$;
REVOKE ALL ON FUNCTION app.banking_annotation_projection(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role,kami_worker,kami_api;


-- One statement observes plans, source facts, edits and lifecycle together. The
-- resource ceiling fails the whole read, never truncates a successful report.
CREATE FUNCTION app.banking_reporting_snapshot(request jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH calendar AS (
  SELECT (statement_timestamp() AT TIME ZONE coalesce((SELECT timezone FROM app.reporting_timezones WHERE owner_id=app.banking_owner()),'UTC'))::date AS day
 ), bounds AS (
  SELECT CASE WHEN (coalesce(request->>'source_id','')<>'' OR coalesce(request->>'unbounded','false')='true') THEN NULL::date
   WHEN request->>'period'='CUSTOM' THEN (request->>'start')::date
   WHEN request->>'period'='LAST_MONTH' THEN (date_trunc('month',day)::date-1-extract(day FROM date_trunc('month',day)::date-1)::integer+1)
   WHEN request->>'period'='LAST_60_DAYS' THEN day-59
   WHEN request->>'period'='LAST_90_DAYS' THEN day-89
   WHEN request->>'period'='YEAR_TO_DATE' THEN make_date(extract(year FROM day)::integer,1,1)
   ELSE date_trunc('month',day)::date END AS lower_date,
   CASE WHEN (coalesce(request->>'source_id','')<>'' OR coalesce(request->>'unbounded','false')='true') THEN NULL::date
    WHEN request->>'period'='CUSTOM' THEN (request->>'end')::date
    WHEN request->>'period'='LAST_MONTH' THEN date_trunc('month',day)::date-1 ELSE day END AS upper_date
  FROM calendar
 ), accounts AS MATERIALIZED (
  SELECT a.* FROM app.banking_accounts a WHERE a.owner_id=app.banking_owner()
   AND (coalesce(jsonb_array_length(request->'accounts'),0)=0 OR a.id::text IN(SELECT jsonb_array_elements_text(request->'accounts')))
   AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
   AND EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.account_id=a.id AND c.state<>'deleted')
 ), plans AS (
  SELECT a.id AS account_id,p.id,p.predecessor_id,p.transition_date,p.active_binding_id,p.revision FROM accounts a
  LEFT JOIN LATERAL (SELECT * FROM app.banking_plans p WHERE p.account_id=a.id ORDER BY p.revision DESC LIMIT 1) p ON true
 ), intervals AS (
  SELECT p.account_id,i.binding_id,i.after_date,i.through_date,coalesce(p.active_binding_id=i.binding_id,false) AS active FROM plans p JOIN app.banking_plan_intervals i ON i.plan_id=p.id
  UNION ALL SELECT p.account_id,b.id,NULL::date,NULL::date,true FROM plans p JOIN app.banking_bindings b ON b.account_id=p.account_id WHERE p.id IS NULL AND b.reporting_state='current'
 ), canonical AS (
  SELECT s.id,coalesce(captured.source_revision,s.revision) AS revision FROM intervals i
  JOIN app.banking_sources s ON s.binding_id=i.binding_id
  LEFT JOIN plans p ON p.account_id=i.account_id
  LEFT JOIN app.banking_plan_sources captured ON captured.plan_id=p.id AND captured.source_id=s.id AND s.discrepancy<>'none'
  JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=coalesce(captured.source_revision,s.revision)
  JOIN app.banking_bindings b ON b.id=s.binding_id
  WHERE r.stage='current' AND ((r.processing_state<>'pending' AND (i.after_date IS NULL OR r.bank_date>i.after_date) AND (i.through_date IS NULL OR r.bank_date<=i.through_date))
   OR (r.processing_state='pending' AND i.active AND b.reporting_state NOT IN('retired','cancelled')))
 ), visible AS (
  SELECT id,revision FROM canonical
  UNION SELECT s.id,s.revision FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id JOIN accounts a ON a.id=b.account_id WHERE s.discrepancy<>'none' AND s.revision IS NOT NULL
  UNION SELECT c.source_id,c.source_revision FROM app.banking_captures c JOIN app.banking_archives ar ON ar.id=c.archive_id JOIN app.banking_plans p ON p.id=ar.plan_id JOIN accounts a ON a.id=p.account_id
 ), rows AS (
  SELECT s.id::text AS id,b.account_id::text AS account_id,s.binding_id::text AS binding_id,r.revision::text AS source_revision,s.revision::text AS latest_source_revision,
   coalesce(r.material_revision,r.revision)::text AS material_revision,r.amount_minor::text AS amount_minor,r.currency,r.bank_date::text AS bank_date,r.authorization_date::text AS authorization_date,r.processing_state,
   r.provider_primary_category,r.provider_category,r.provider_confidence,r.provider_code,r.mapping_version,r.name,r.merchant_name,s.discrepancy,
   an.body->>'annotation_revision' AS annotation_revision,an.body->>'category' AS category,an.body->>'activity' AS activity,an.body->>'note' AS note,(an.body->>'excluded')::boolean AS excluded,
   (an.body->>'reviewed')::boolean AS reviewed,(an.body->>'material_conflict')::boolean AS material_conflict,
   EXISTS(SELECT FROM canonical c WHERE c.id=s.id AND c.revision=r.revision) AS current,
   CASE WHEN EXISTS(SELECT FROM canonical c WHERE c.id=s.id) THEN s.id::text END AS current_id,
   coalesce((SELECT jsonb_agg(jsonb_build_object('archive_id',c.archive_id,'source_revision',c.source_revision::text,'annotation_revision',c.annotation_revision::text,
    'annotation',CASE WHEN c.annotation_revision IS NOT NULL THEN app.banking_annotation_projection(c.source_id,c.source_revision,c.annotation_revision) END) ORDER BY c.archive_id) FROM app.banking_captures c WHERE c.source_id=s.id AND c.source_revision=r.revision),'[]') AS archives
  FROM visible v JOIN app.banking_sources s ON s.id=v.id JOIN app.banking_bindings b ON b.id=s.binding_id JOIN accounts a ON a.id=b.account_id
  JOIN app.banking_source_revisions r ON r.source_id=v.id AND r.revision=v.revision
  CROSS JOIN LATERAL (SELECT app.banking_annotation_projection(s.id,r.revision,NULL) AS body) an
  WHERE CASE WHEN coalesce(request->>'discrepancies','false')='true' THEN s.discrepancy<>'none' AND r.revision=s.revision ELSE (coalesce(request->>'archive_id','')<>'' OR coalesce(request->>'include_archives','false')='true' OR EXISTS(SELECT FROM canonical c WHERE c.id=s.id AND c.revision=r.revision)) END
   AND (coalesce(request->>'source_id','')='' OR s.id::text=request->>'source_id')
   AND (coalesce(request->>'archive_id','')='' OR EXISTS(SELECT FROM app.banking_captures cap WHERE cap.source_id=s.id AND cap.source_revision=r.revision AND cap.archive_id::text=request->>'archive_id'))
   AND ((SELECT lower_date FROM bounds) IS NULL OR r.bank_date>=(SELECT lower_date FROM bounds))
   AND ((SELECT upper_date FROM bounds) IS NULL OR r.bank_date<=(SELECT upper_date FROM bounds))
  ORDER BY s.id,r.revision LIMIT 100001
 ), payload AS (
  SELECT (SELECT to_jsonb(t) FROM app.reporting_timezones t WHERE t.owner_id=app.banking_owner()) AS timezone,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'selected',a.selected,'kind',a.kind,'reporting_revision',a.reporting_revision::text,
   'plan_id',p.id,'predecessor_id',p.predecessor_id,'transition_date',p.transition_date,
   'archives',coalesce((SELECT jsonb_agg(jsonb_build_object('id',ar.id,'plan_id',ar.plan_id,'boundary_date',ar.boundary_date,'count',(SELECT count(*) FROM app.banking_captures cap WHERE cap.archive_id=ar.id)) ORDER BY ar.id) FROM app.banking_archives ar JOIN app.banking_plans old ON old.id=ar.plan_id WHERE old.account_id=a.id),'[]'),
   'intervals',coalesce((SELECT jsonb_agg(jsonb_build_object('binding_id',i.binding_id,'after_date',i.after_date,'through_date',i.through_date,
    'import_state',b.import_state,'coverage_after',b.coverage_after,'coverage_through',b.coverage_through,'history_availability',b.history_availability,
    'last_local_commit',b.last_local_commit,'provider_success_at',b.provider_success_at,'historical_update_at',b.provider_historical_update_at,
    'collection_state',b.reporting_state||'/'||c.state||'/'||c.permission_state,'collection_stopped',b.collection_stopped,'discrepancy_count',(SELECT count(*) FROM app.banking_sources s WHERE s.binding_id=b.id AND s.discrepancy<>'none')) ORDER BY i.after_date NULLS FIRST)
    FROM intervals i JOIN app.banking_bindings b ON b.id=i.binding_id JOIN app.banking_connections c ON c.id=b.connection_id WHERE i.account_id=a.id),'[]')) ORDER BY a.id) FROM accounts a JOIN plans p ON p.account_id=a.id),'[]') AS accounts,
  coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM rows r),'[]') AS rows
 ) SELECT jsonb_build_object('sampled_at',statement_timestamp(),'timezone',timezone,'accounts',accounts,'rows',rows,
  'revision',encode(sha256(convert_to(jsonb_build_array(timezone,accounts,rows)::text,'UTF8')),'hex')) FROM payload;
$$;

ALTER TABLE app.banking_operations DROP CONSTRAINT banking_operations_kind_check;
ALTER TABLE app.banking_operations ADD CONSTRAINT banking_operations_kind_check CHECK(kind IN
 ('create_connection','record_source','stop','delete_history','selection','replacement_publish','replacement_cancel','annotation'));

-- Connection/binding/account order matches source publication and replacement.
-- Annotation versions are immutable. Notes and retained overrides survive source
-- changes, while explicit acknowledgement uses the current material revision.
CREATE FUNCTION app.banking_edit_annotation(target uuid, fact bigint, expected bigint, material bigint, field text, value text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); binding app.banking_bindings; r app.banking_source_revisions; snapshot jsonb; projection jsonb;
 category_value text; activity_value text; note_value text; excluded_value boolean; reviewed_value boolean; activity_material bigint; review_material bigint;
BEGIN
 SELECT b.* INTO binding FROM app.banking_bindings b JOIN app.banking_sources s ON s.binding_id=b.id WHERE s.id=target AND s.owner_id=actor;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 PERFORM 1 FROM app.banking_connections WHERE id=binding.connection_id FOR UPDATE;
 PERFORM 1 FROM app.banking_bindings WHERE id=binding.id FOR UPDATE;
 PERFORM 1 FROM app.banking_accounts WHERE id=binding.account_id FOR UPDATE;
 IF EXISTS(SELECT FROM app.banking_account_barriers WHERE account_id=binding.account_id) THEN RETURN 'NOT_FOUND'; END IF;
 snapshot:=app.banking_reporting_snapshot(jsonb_build_object('source_id',target,'include_archives',true));
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(snapshot->'rows') row WHERE row->>'id'=target::text AND row->>'source_revision'=fact::text
  AND ((row->>'current')::boolean OR jsonb_array_length(row->'archives')>0)) THEN RETURN 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(snapshot->'rows') row WHERE row->>'id'=target::text AND (row->>'current')::boolean AND row->>'source_revision'<>fact::text) THEN RETURN 'CONFLICT'; END IF;
 SELECT * INTO r FROM app.banking_source_revisions WHERE source_id=target AND revision=fact;
 projection:=app.banking_annotation_projection(target,fact,NULL);
 IF (projection->>'annotation_revision')::bigint<>expected OR coalesce(r.material_revision,r.revision)<>material THEN RETURN 'CONFLICT'; END IF;
 IF field='activity' AND value IS NOT NULL AND (value NOT IN('purchase','bank_fee','debit_interest','refund','income','transfer','repayment','cash_withdrawal','loan_proceeds','unresolved') OR
  (r.amount_minor>0 AND value IN('refund','income','loan_proceeds')) OR (r.amount_minor<0 AND value IN('purchase','bank_fee','debit_interest','cash_withdrawal'))) THEN RETURN 'INVALID_INPUT'; END IF;
 category_value:=projection->>'category';activity_value:=projection->>'activity';note_value:=projection->>'note';excluded_value:=(projection->>'excluded')::boolean;reviewed_value:=(projection->>'reviewed')::boolean;
 activity_material:=(projection->>'material_revision')::bigint;review_material:=(projection->>'reviewed_material_revision')::bigint;
 IF field='category' THEN category_value:=value;
 ELSIF field='activity' THEN activity_value:=value;activity_material:=material;
 ELSIF field='note' THEN note_value:=value;
 ELSIF field='excluded' THEN excluded_value:=coalesce(value::boolean,false);
 ELSIF field='reviewed' THEN reviewed_value:=coalesce(value::boolean,false);review_material:=material;
 ELSE RETURN 'INVALID_INPUT'; END IF;
 INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed,material_conflict,applies_to_source_revision,changed_field,reviewed_material_revision)
 VALUES(target,actor,expected+1,activity_material,category_value,activity_value,note_value,excluded_value,reviewed_value,false,fact,field,review_material);
 RETURN 'READY';
END $$;
REVOKE ALL ON FUNCTION app.banking_reporting_snapshot(jsonb),app.banking_edit_annotation(uuid,bigint,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_reporting_snapshot(jsonb),app.banking_edit_annotation(uuid,bigint,bigint,bigint,text,text) TO kami_api;
CREATE OR REPLACE FUNCTION app.banking_replacement_snapshot(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH account AS (
 SELECT a.* FROM app.banking_accounts a WHERE a.id=target AND a.owner_id=app.banking_owner()
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 ), bindings AS (
 SELECT b.*,c.state AS connection_state,c.generation AS connection_generation,c.permission_state,c.health,c.enrollment_pending,c.provider_removed
 FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id JOIN account a ON a.id=b.account_id
 ), sources AS (
 SELECT s.id,s.binding_id,r.revision,(r.revision=s.revision) AS is_latest,s.discrepancy,r.amount_minor::text AS amount_minor,r.bank_date::text AS bank_date,r.processing_state,r.stage,
 r.currency,r.provider_primary_category,r.provider_category,r.provider_confidence,r.provider_code,r.mapping_version,
 (an.body->>'annotation_revision')::bigint AS annotation_revision,an.body->>'activity' AS activity,an.body->>'activity' AS activity_override,
 an.body->>'category' AS category,an.body->>'note' AS note,(an.body->>'excluded')::boolean AS excluded,
 (an.body->>'reviewed')::boolean AS reviewed,(an.body->>'material_conflict')::boolean AS material_conflict
 FROM app.banking_sources s JOIN bindings b ON b.id=s.binding_id JOIN app.banking_source_revisions r ON r.source_id=s.id
 CROSS JOIN LATERAL (SELECT app.banking_annotation_projection(s.id,r.revision,NULL) AS body) an
 ), plans AS (
 SELECT p.*,coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.after_date NULLS FIRST) FROM app.banking_plan_intervals i WHERE i.plan_id=p.id),'[]') AS intervals,
 coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source_id) FROM app.banking_plan_sources s WHERE s.plan_id=p.id),'[]') AS captures
 FROM app.banking_plans p JOIN account a ON a.id=p.account_id
 ), payload AS (
 SELECT to_jsonb(a) AS account,
 coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM bindings b),'[]') AS bindings,
 coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id,s.revision) FROM sources s),'[]') AS sources,
 coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.revision) FROM plans p),'[]') AS plans,
 (SELECT to_jsonb(t) FROM app.reporting_timezones t WHERE t.owner_id=a.owner_id) AS timezone,
 coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.source_id,n.revision) FROM app.banking_annotations n JOIN app.banking_sources s ON s.id=n.source_id JOIN bindings b ON b.id=s.binding_id),'[]') AS annotations
 FROM account a
 ) SELECT jsonb_build_object('account',account,'bindings',bindings,'sources',sources,'plans',plans,'timezone',timezone,
 'revisions',jsonb_build_object(
 'plan',encode(sha256(convert_to(plans::text,'UTF8')),'hex'),
 'import',encode(sha256(convert_to((SELECT coalesce(jsonb_agg(jsonb_build_array(b.id,b.import_revision,b.import_state,b.coverage_after,b.coverage_through) ORDER BY b.id),'[]')::text FROM bindings b),'UTF8')),'hex'),
 'data',encode(sha256(convert_to(sources::text,'UTF8')),'hex'),
 'annotation',encode(sha256(convert_to(annotations::text,'UTF8')),'hex'),
 'lifecycle',encode(sha256(convert_to(jsonb_build_array(account,bindings,timezone)::text,'UTF8')),'hex'))) FROM payload;
$$;


CREATE OR REPLACE FUNCTION app.banking_replacement_publish(target uuid,expected jsonb,proposal jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); snapshot jsonb; prior_rows jsonb; plan uuid:=gen_random_uuid(); archive uuid:=gen_random_uuid(); previous uuid; next_revision bigint; entry jsonb; active uuid;
BEGIN
 PERFORM 1 FROM app.banking_connections c WHERE c.owner_id=actor AND EXISTS(SELECT FROM app.banking_bindings b WHERE b.connection_id=c.id AND b.account_id=target) ORDER BY c.id FOR UPDATE;
 PERFORM 1 FROM app.banking_bindings WHERE account_id=target ORDER BY id FOR UPDATE;
 PERFORM 1 FROM app.banking_accounts WHERE id=target AND owner_id=actor FOR UPDATE;
 snapshot:=app.banking_replacement_snapshot(target);
 IF snapshot IS NULL OR snapshot->'revisions' IS DISTINCT FROM expected THEN RETURN NULL; END IF;
 prior_rows:=app.banking_reporting_snapshot(jsonb_build_object('accounts',jsonb_build_array(target),'unbounded',true))->'rows';
 IF jsonb_array_length(prior_rows)>100000 THEN RETURN NULL; END IF;
 active:=(proposal->>'active_binding_id')::uuid;
 IF NOT EXISTS(SELECT FROM app.banking_bindings WHERE id=active AND account_id=target AND owner_id=actor) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM app.banking_plans WHERE account_id=target) THEN
   previous:=gen_random_uuid();
   INSERT INTO app.banking_plans(id,owner_id,account_id,revision,active_binding_id)
    SELECT previous,actor,target,1,b.id FROM app.banking_bindings b WHERE b.account_id=target AND b.reporting_state='current';
   INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id)
    SELECT previous,actor,b.id FROM app.banking_bindings b WHERE b.account_id=target AND b.reporting_state='current';
   INSERT INTO app.banking_plan_sources SELECT previous,actor,s.id,s.revision FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=target AND b.reporting_state='current' AND s.revision IS NOT NULL;
 END IF;
 SELECT p.id,p.revision+1 INTO previous,next_revision FROM app.banking_plans p WHERE p.account_id=target ORDER BY p.revision DESC LIMIT 1;
 INSERT INTO app.banking_plans(id,owner_id,account_id,revision,predecessor_id,transition_date,active_binding_id)
 VALUES(plan,actor,target,coalesce(next_revision,1),previous,(proposal->>'plan_transition_date')::date,active);
 FOR entry IN SELECT * FROM jsonb_array_elements(proposal->'intervals') LOOP
 INSERT INTO app.banking_plan_intervals VALUES(plan,actor,(entry->>'binding_id')::uuid,(entry->>'after_date')::date,(entry->>'through_date')::date);
 END LOOP;
 FOR entry IN SELECT * FROM jsonb_array_elements(proposal->'captures') LOOP
 INSERT INTO app.banking_plan_sources VALUES(plan,actor,(entry->>'source_id')::uuid,(entry->>'source_revision')::bigint);
 END LOOP;
 INSERT INTO app.banking_archives VALUES(archive,actor,coalesce(previous,plan),(proposal->>'transition_date')::date);
 INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision)
 -- The manifest records the exact preceding canonical fact, never a later
 -- noncontributing correction. Other overlap/history retains its latest fact.
 SELECT archive,actor,s.id,coalesce((prior.row->>'source_revision')::bigint,s.revision),
  (SELECT max(a.revision) FROM app.banking_annotations a WHERE a.source_id=s.id)
 FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id
 LEFT JOIN LATERAL (SELECT row FROM jsonb_array_elements(prior_rows) row WHERE row->>'id'=s.id::text LIMIT 1) prior ON true
 WHERE b.account_id=target AND s.revision IS NOT NULL;
 -- Recovery changes reporting only; a retired stream never regains collection.
 UPDATE app.banking_bindings SET reporting_state='retired',collection_stopped=true,generation=generation+1
 WHERE account_id=target AND reporting_state='current' AND id<>active;
 UPDATE app.banking_bindings SET reporting_state='current' WHERE id=active AND reporting_state='staged';
 UPDATE app.banking_accounts SET reporting_revision=reporting_revision+1 WHERE id=target;
 RETURN plan;
END $$;

-- Preserve every acknowledgement dependency until bounded annotation purge drains.
CREATE OR REPLACE FUNCTION app.banking_purge_retained_batch(target uuid, authority uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work; n integer:=0; changed integer; accounts uuid[];
BEGIN
  PERFORM 1 FROM app.banking_connections c JOIN app.banking_work w ON w.connection_id=c.id
    WHERE w.id=target AND c.generation=w.generation AND c.state='deleted' FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN -1; END IF;
  SELECT * INTO job FROM app.banking_work WHERE id=target AND kind='purge' AND state='running'
    AND lease_token=authority AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN -1; END IF;
  SELECT array_agg(account_id) INTO accounts FROM app.banking_deletion_accounts WHERE connection_id=job.connection_id;
  UPDATE app.banking_enrollments SET replacement_account_id=NULL WHERE replacement_account_id=ANY(accounts);
  UPDATE app.banking_sources SET revision=NULL WHERE id IN(SELECT s.id FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=ANY(accounts) AND s.revision IS NOT NULL LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_captures WHERE ctid IN(SELECT x.ctid FROM app.banking_captures x JOIN app.banking_sources s ON s.id=x.source_id JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=ANY(accounts) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_plan_sources WHERE ctid IN(SELECT x.ctid FROM app.banking_plan_sources x JOIN app.banking_plans p ON p.id=x.plan_id WHERE p.account_id=ANY(accounts) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_annotations WHERE ctid IN(SELECT x.ctid FROM app.banking_annotations x JOIN app.banking_sources s ON s.id=x.source_id JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=ANY(accounts) AND NOT EXISTS(SELECT FROM app.banking_captures c WHERE c.source_id=x.source_id AND c.annotation_revision=x.revision) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_source_revisions WHERE ctid IN(SELECT x.ctid FROM app.banking_source_revisions x JOIN app.banking_sources s ON s.id=x.source_id JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=ANY(accounts)
    AND s.revision IS NULL AND NOT EXISTS(SELECT FROM app.banking_annotations a WHERE a.source_id=x.source_id
      AND (a.material_source_revision=x.revision OR a.applies_to_source_revision=x.revision OR a.reviewed_material_revision=x.revision))
    AND NOT EXISTS(SELECT FROM app.banking_captures c WHERE c.source_id=x.source_id AND c.source_revision=x.revision)
    AND NOT EXISTS(SELECT FROM app.banking_plan_sources p WHERE p.source_id=x.source_id AND p.source_revision=x.revision) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_sources WHERE id IN(SELECT s.id FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=ANY(accounts) AND NOT EXISTS(SELECT FROM app.banking_source_revisions r WHERE r.source_id=s.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_archives WHERE id IN(SELECT a.id FROM app.banking_archives a JOIN app.banking_plans p ON p.id=a.plan_id WHERE p.account_id=ANY(accounts) AND NOT EXISTS(SELECT FROM app.banking_captures c WHERE c.archive_id=a.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_plan_intervals WHERE ctid IN(SELECT i.ctid FROM app.banking_plan_intervals i JOIN app.banking_plans p ON p.id=i.plan_id WHERE p.account_id=ANY(accounts) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_plans WHERE id IN(SELECT p.id FROM app.banking_plans p WHERE p.account_id=ANY(accounts)
    AND NOT EXISTS(SELECT FROM app.banking_plans child WHERE child.predecessor_id=p.id)
    AND NOT EXISTS(SELECT FROM app.banking_archives a WHERE a.plan_id=p.id)
    AND NOT EXISTS(SELECT FROM app.banking_plan_sources s WHERE s.plan_id=p.id)
    AND NOT EXISTS(SELECT FROM app.banking_plan_intervals i WHERE i.plan_id=p.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_bindings WHERE id IN(SELECT b.id FROM app.banking_bindings b WHERE b.account_id=ANY(accounts)
    AND NOT EXISTS(SELECT FROM app.banking_sources s WHERE s.binding_id=b.id)
    AND NOT EXISTS(SELECT FROM app.banking_plan_intervals i WHERE i.binding_id=b.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_account_identities WHERE ctid IN(SELECT i.ctid FROM app.banking_account_identities i WHERE i.account_id=ANY(accounts) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_accounts WHERE id IN(SELECT a.id FROM app.banking_accounts a WHERE a.id=ANY(accounts)
    AND NOT EXISTS(SELECT FROM app.banking_plans p WHERE p.account_id=a.id)
    AND NOT EXISTS(SELECT FROM app.banking_bindings b WHERE b.account_id=a.id)
    AND NOT EXISTS(SELECT FROM app.banking_account_identities i WHERE i.account_id=a.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_webhook_deliveries WHERE (correlation_id,delivery_digest) IN
    (SELECT d.correlation_id,d.delivery_digest FROM app.banking_webhook_deliveries d JOIN app.banking_webhook_correlations w ON w.id=d.correlation_id WHERE w.connection_id=job.connection_id LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  UPDATE app.banking_work SET progress=progress+n,updated_at=clock_timestamp() WHERE id=target;
  IF n=0 THEN UPDATE app.banking_deletion_barriers SET cleanup_state='complete' WHERE connection_id=job.connection_id; END IF;
  RETURN n;
END $$;

RESET ROLE;
