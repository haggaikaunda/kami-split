SET ROLE kami_migrator;

-- Import revisions describe committed streams only; staging is never a source.
ALTER TABLE app.banking_bindings ADD COLUMN data_revision bigint NOT NULL DEFAULT 1 CHECK(data_revision>0);
ALTER TABLE app.banking_bindings ADD COLUMN last_local_commit timestamptz;
ALTER TABLE app.banking_bindings ADD COLUMN provider_update_status text;
ALTER TABLE app.banking_bindings ADD COLUMN provider_success_at timestamptz;
ALTER TABLE app.banking_bindings ADD COLUMN provider_failed_at timestamptz;
ALTER TABLE app.banking_source_revisions ADD COLUMN material_revision bigint;
ALTER TABLE app.banking_source_revisions ADD COLUMN provider_transaction_id text;
ALTER TABLE app.banking_source_revisions ADD COLUMN pending_transaction_id text;
ALTER TABLE app.banking_source_revisions ADD COLUMN name text;
ALTER TABLE app.banking_source_revisions ADD COLUMN merchant_name text;
ALTER TABLE app.banking_annotations ADD COLUMN material_conflict boolean NOT NULL DEFAULT false;
ALTER TABLE app.banking_annotations ADD COLUMN applies_to_source_revision bigint;
ALTER TABLE app.banking_annotations ADD CONSTRAINT banking_annotation_application FOREIGN KEY(source_id,applies_to_source_revision,owner_id) REFERENCES app.banking_source_revisions(source_id,revision,owner_id);

-- Explicit identities preserve a pending source's stable ID without changing its
-- original provenance. Aliases never cross bindings or logical accounts.
CREATE TABLE app.banking_source_identities (
 binding_id uuid NOT NULL REFERENCES app.banking_bindings(id) ON DELETE CASCADE,
 provider_transaction_id text NOT NULL CHECK(char_length(provider_transaction_id) BETWEEN 1 AND 256),
 source_id uuid NOT NULL REFERENCES app.banking_sources(id) ON DELETE CASCADE,
 PRIMARY KEY(binding_id,provider_transaction_id)
);
INSERT INTO app.banking_source_identities SELECT binding_id,provider_transaction_id,id FROM app.banking_sources;
CREATE TABLE app.banking_sync_batches (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL,
 binding_id uuid NOT NULL REFERENCES app.banking_bindings(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,
 authority uuid NOT NULL,
 connection_generation bigint NOT NULL,
 deletion_generation bigint NOT NULL,
 binding_generation bigint NOT NULL,
 account_generation bigint NOT NULL,
 reporting_revision bigint NOT NULL,
 starting_cursor text NOT NULL,
 next_cursor text NOT NULL,
 page_count integer NOT NULL DEFAULT 0 CHECK(page_count BETWEEN 0 AND 1000),
 state text NOT NULL DEFAULT 'staging' CHECK(state IN('staging','complete','committed','cancelled','invalid')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour',
 result jsonb
);
CREATE INDEX banking_sync_expiry ON app.banking_sync_batches(expires_at,id);
CREATE TABLE app.banking_sync_pages (
 batch_id uuid NOT NULL REFERENCES app.banking_sync_batches(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 999),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=65536),
 PRIMARY KEY(batch_id,ordinal)
);
-- Unknown removals retain identity-only history; a known removal also has an
-- immutable removed source revision. No amount or date is invented.
CREATE TABLE app.banking_sync_removals (
 binding_id uuid NOT NULL REFERENCES app.banking_bindings(id) ON DELETE CASCADE,
 provider_transaction_id text NOT NULL,
 import_revision bigint NOT NULL,
 removed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(binding_id,provider_transaction_id,import_revision)
);
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['source_identities','sync_batches','sync_pages','sync_removals'] LOOP
 EXECUTE format('ALTER TABLE app.banking_%I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('REVOKE ALL ON app.banking_%I FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker',relation);
 END LOOP;
END $$;

-- The helper takes lifecycle locks before a batch lock, matching collection and
-- terminal operations. It never manufactures app.verified_subject(). The only
-- authority is a current restricted reconcile lease for this exact connection.
CREATE FUNCTION app.banking_sync_authorized(work uuid, token uuid, target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE binding app.banking_bindings; connection app.banking_connections; account app.banking_accounts; job app.banking_work;
BEGIN
 SELECT b.* INTO binding FROM app.banking_bindings b WHERE b.id=target;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM app.users u WHERE u.id=binding.owner_id AND u.enabled AND u.live_auth_id=u.auth_subject FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT c.* INTO connection FROM app.banking_connections c WHERE c.id=binding.connection_id FOR UPDATE;
 SELECT b.* INTO binding FROM app.banking_bindings b WHERE b.id=target FOR UPDATE;
 SELECT a.* INTO account FROM app.banking_accounts a WHERE a.id=binding.account_id FOR UPDATE;
 SELECT w.* INTO job FROM app.banking_work w WHERE w.id=work FOR UPDATE;
 RETURN job.connection_id=connection.id AND job.kind='reconcile' AND job.state='running'
  AND job.lease_token=token AND job.lease_until>clock_timestamp() AND job.generation=connection.generation
  AND connection.state='active' AND connection.permission_state='granted' AND NOT connection.provider_removed AND NOT connection.enrollment_pending
  AND account.selected AND binding.reporting_state IN('current','staged') AND NOT binding.collection_stopped
  AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=account.id)
  AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=connection.id);
END $$;

CREATE FUNCTION app.banking_sync_begin(work uuid, token uuid, target uuid, batch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b app.banking_bindings; c app.banking_connections; a app.banking_accounts; saved app.banking_sync_batches;
BEGIN
 IF NOT coalesce(app.banking_sync_authorized(work,token,target),false) THEN RETURN NULL; END IF;
 SELECT * INTO b FROM app.banking_bindings WHERE id=target;
 SELECT * INTO c FROM app.banking_connections WHERE id=b.connection_id;
 SELECT * INTO a FROM app.banking_accounts WHERE id=b.account_id;
 INSERT INTO app.banking_sync_batches(id,owner_id,binding_id,work_id,authority,connection_generation,deletion_generation,binding_generation,account_generation,reporting_revision,starting_cursor,next_cursor)
 VALUES(batch,b.owner_id,b.id,work,token,c.generation,c.deletion_generation,b.generation,a.generation,a.reporting_revision,coalesce(b.sync_cursor,''),coalesce(b.sync_cursor,'')) ON CONFLICT DO NOTHING;
 SELECT * INTO saved FROM app.banking_sync_batches WHERE id=batch FOR UPDATE;
 IF saved.binding_id<>target OR saved.work_id<>work OR saved.authority<>token OR saved.expires_at<=clock_timestamp() OR saved.state NOT IN('staging','complete') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('batch_id',batch,'binding_id',b.id,'environment',c.environment,'item_id',c.provider_item_id,'account_id',b.provider_account_id,'cursor',saved.starting_cursor);
END $$;

-- Validate every exposed worker call as well as the adapter boundary. Casts run
-- in an exception subtransaction, so malformed facts never leave partial pages.
CREATE FUNCTION app.banking_sync_valid_page(payload jsonb, account text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE change jsonb; value text; day date;
BEGIN
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR jsonb_typeof(payload->'changes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(payload->'changes')>20 OR octet_length(payload::text)>65536
  OR jsonb_typeof(payload->'from_cursor') IS DISTINCT FROM 'string' OR length(payload->>'from_cursor')>256
  OR jsonb_typeof(payload->'next_cursor') IS DISTINCT FROM 'string' OR length(payload->>'next_cursor') NOT BETWEEN 1 AND 256 OR payload->>'next_cursor'='now'
  OR jsonb_typeof(payload->'has_more') IS DISTINCT FROM 'boolean' OR ((payload->>'has_more')::boolean AND payload->>'next_cursor'=payload->>'from_cursor') THEN RETURN false; END IF;
 IF payload->>'update_status' IS NOT NULL AND (jsonb_typeof(payload->'update_status')<>'string' OR length(payload->>'update_status')>256) THEN RETURN false; END IF;
 FOREACH value IN ARRAY ARRAY['provider_success_at','provider_failed_at'] LOOP
  IF payload->>value IS NOT NULL THEN
   IF jsonb_typeof(payload->value)<>'string' THEN RETURN false; END IF;
   PERFORM (payload->>value)::timestamptz;
  END IF;
 END LOOP;
 FOR change IN SELECT * FROM jsonb_array_elements(payload->'changes') LOOP
  IF jsonb_typeof(change)<>'object' OR jsonb_typeof(change->'id') IS DISTINCT FROM 'string' OR length(change->>'id') NOT BETWEEN 1 AND 256
   OR coalesce(change->>'operation','') NOT IN('added','modified','removed') THEN RETURN false; END IF;
  IF change ? 'account_id' AND change->>'account_id' IS DISTINCT FROM account THEN RETURN false; END IF;
  IF change->>'operation'='removed' THEN CONTINUE; END IF;
  IF change->>'account_id' IS DISTINCT FROM account OR change->>'currency' IS DISTINCT FROM 'USD'
   OR jsonb_typeof(change->'amount_minor') IS DISTINCT FROM 'string'
   OR (change->>'amount_minor') !~ '^(0|-?[1-9][0-9]*)$' OR length(change->>'amount_minor')>20
   OR jsonb_typeof(change->'pending') IS DISTINCT FROM 'boolean'
   OR coalesce(change->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  PERFORM (change->>'amount_minor')::bigint; day:=(change->>'date')::date;
  IF day NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RETURN false; END IF;
  FOREACH value IN ARRAY ARRAY['pending_transaction_id','authorized_date','name','merchant_name','transaction_code'] LOOP
   IF change ? value AND jsonb_typeof(change->value) NOT IN('string','null') THEN RETURN false; END IF;
  END LOOP;
  IF change->>'pending_transaction_id' IS NOT NULL AND (length(change->>'pending_transaction_id') NOT BETWEEN 1 AND 256 OR change->>'pending_transaction_id'=change->>'id' OR (change->>'pending')::boolean) THEN RETURN false; END IF;
  IF change->>'authorized_date' IS NOT NULL THEN
   IF change->>'authorized_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
   day:=(change->>'authorized_date')::date;
   IF day NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;

CREATE FUNCTION app.banking_sync_stage(work uuid, token uuid, batch uuid, ordinal integer, payload jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved app.banking_sync_batches; account text;
BEGIN
 SELECT * INTO saved FROM app.banking_sync_batches WHERE id=batch;
 IF NOT FOUND OR saved.work_id<>work OR saved.authority<>token OR NOT coalesce(app.banking_sync_authorized(work,token,saved.binding_id),false) THEN RETURN 'DENIED'; END IF;
 SELECT * INTO saved FROM app.banking_sync_batches WHERE id=batch FOR UPDATE;
 IF saved.expires_at<=clock_timestamp() OR saved.state NOT IN('staging','complete') THEN RETURN 'CONFLICT'; END IF;
 IF EXISTS(SELECT FROM app.banking_sync_pages p WHERE p.batch_id=batch AND p.ordinal=banking_sync_stage.ordinal AND p.payload=banking_sync_stage.payload) THEN RETURN 'READY'; END IF;
 SELECT provider_account_id INTO account FROM app.banking_bindings WHERE id=saved.binding_id;
 IF saved.state<>'staging' OR ordinal IS DISTINCT FROM saved.page_count OR saved.page_count>=1000
  OR payload->>'from_cursor' IS DISTINCT FROM saved.next_cursor OR NOT coalesce(app.banking_sync_valid_page(payload,account),false) THEN
  UPDATE app.banking_sync_batches SET state='invalid',starting_cursor='',next_cursor='' WHERE id=batch;
  DELETE FROM app.banking_sync_pages WHERE batch_id=batch;
  RETURN 'INVALID_BATCH';
 END IF;
 INSERT INTO app.banking_sync_pages VALUES(batch,ordinal,payload);
 UPDATE app.banking_sync_batches SET page_count=page_count+1,next_cursor=payload->>'next_cursor',state=CASE WHEN (payload->>'has_more')::boolean THEN 'staging' ELSE 'complete' END WHERE id=batch;
 RETURN 'READY';
END $$;

CREATE FUNCTION app.banking_sync_cancel(work uuid, token uuid, batch uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE app.banking_sync_batches SET state='cancelled',starting_cursor='',next_cursor=''
 WHERE id=batch AND work_id=work AND authority=token AND state IN('staging','complete')
  AND EXISTS(SELECT FROM app.banking_work w WHERE w.id=work AND w.lease_token=token AND w.state='running' AND w.lease_until>clock_timestamp());
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM app.banking_sync_pages WHERE batch_id=batch;
 RETURN true;
END $$;

-- One source revision is an immutable bank fact. Annotations get a new revision
-- acknowledging that fact while preserving every owner field and prior version.
CREATE FUNCTION app.banking_sync_apply(target uuid, owner uuid, change jsonb, initial boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE source app.banking_sources; old app.banking_source_revisions; annotation app.banking_annotations;
 linked uuid; next_revision bigint; processing text; material boolean; conflict boolean; notice text:='none'; lower_bound date; upper_bound date; outside_old boolean; outside_new boolean;
BEGIN
 SELECT s.* INTO source FROM app.banking_source_identities i JOIN app.banking_sources s ON s.id=i.source_id WHERE i.binding_id=target AND i.provider_transaction_id=change->>'id';
 IF source.id IS NULL THEN SELECT s.* INTO source FROM app.banking_sources s WHERE s.binding_id=target AND s.provider_transaction_id=change->>'id'; END IF;
 IF change->>'pending_transaction_id' IS NOT NULL THEN
  SELECT s.id INTO linked FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision
   LEFT JOIN app.banking_source_identities i ON i.source_id=s.id
   WHERE s.binding_id=target AND (i.provider_transaction_id=change->>'pending_transaction_id' OR s.provider_transaction_id=change->>'pending_transaction_id') AND r.processing_state IN('pending','removed') AND EXISTS(SELECT FROM app.banking_source_revisions prior WHERE prior.source_id=s.id AND prior.processing_state='pending' AND coalesce(prior.provider_transaction_id,s.provider_transaction_id)=change->>'pending_transaction_id') LIMIT 1;
  IF source.id IS NULL AND linked IS NOT NULL THEN SELECT * INTO source FROM app.banking_sources WHERE id=linked;
  ELSIF linked IS NOT NULL AND source.id<>linked THEN RAISE EXCEPTION 'conflicting explicit source identity' USING ERRCODE='23514'; END IF;
 END IF;
 IF source.id IS NOT NULL THEN SELECT * INTO old FROM app.banking_source_revisions WHERE source_id=source.id AND revision=source.revision; END IF;
 IF change->>'operation'='removed' THEN
  IF old.source_id IS NULL OR coalesce(old.provider_transaction_id,source.provider_transaction_id)<>change->>'id' OR old.processing_state='removed' THEN RETURN; END IF;
  change:=jsonb_build_object('id',change->>'id','amount_minor',old.amount_minor::text,'currency',old.currency,'date',old.bank_date::text,'authorized_date',old.authorization_date::text,'pending_transaction_id',old.pending_transaction_id,'name',old.name,'merchant_name',old.merchant_name,'transaction_code',old.provider_code,'operation','removed');
  processing:='removed';
 ELSE processing:=CASE WHEN (change->>'pending')::boolean THEN 'pending' ELSE 'posted' END;
 END IF;
 -- Exact duplicate facts do not create extra source or annotation versions.
 IF old.source_id IS NOT NULL AND (old.amount_minor,old.currency,old.bank_date,old.authorization_date,old.processing_state,old.provider_code,old.pending_transaction_id,old.name,old.merchant_name,coalesce(old.provider_transaction_id,source.provider_transaction_id))
  IS NOT DISTINCT FROM ((change->>'amount_minor')::bigint,change->>'currency',(change->>'date')::date,(change->>'authorized_date')::date,processing,change->>'transaction_code',change->>'pending_transaction_id',change->>'name',change->>'merchant_name',change->>'id') THEN RETURN; END IF;
 SELECT i.after_date,i.through_date INTO lower_bound,upper_bound FROM app.banking_plan_intervals i JOIN app.banking_plans p ON p.id=i.plan_id WHERE p.account_id=(SELECT account_id FROM app.banking_bindings WHERE id=target) AND i.binding_id=target ORDER BY p.revision DESC LIMIT 1;
 outside_new:=coalesce((change->>'date')::date<=lower_bound,false) OR coalesce((change->>'date')::date>upper_bound,false);
 outside_old:=coalesce(old.bank_date<=lower_bound,false) OR coalesce(old.bank_date>upper_bound,false);
 IF old.source_id IS NOT NULL AND old.bank_date<>(change->>'date')::date AND outside_old<>outside_new THEN notice:='cross_boundary_change';
 ELSIF NOT initial AND outside_new THEN notice:='historical_discrepancy';
 END IF;
 IF source.id IS NULL THEN
  source.id:=gen_random_uuid(); source.revision:=0;
  INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision,discrepancy) VALUES(source.id,owner,target,change->>'id',1,notice);
 END IF;
 next_revision:=source.revision+1;
 material:=(old.amount_minor,old.currency,old.bank_date,old.processing_state,old.provider_code) IS DISTINCT FROM ((change->>'amount_minor')::bigint,'USD',(change->>'date')::date,processing,change->>'transaction_code');
 INSERT INTO app.banking_source_identities VALUES(target,change->>'id',source.id) ON CONFLICT DO NOTHING;
 INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,authorization_date,processing_state,provider_code,mapping_version,stage,provider_transaction_id,pending_transaction_id,name,merchant_name,material_revision)
 VALUES(source.id,owner,next_revision,(change->>'amount_minor')::bigint,'USD',(change->>'date')::date,(change->>'authorized_date')::date,processing,change->>'transaction_code','sync-v1-unclassified','current',change->>'id',change->>'pending_transaction_id',change->>'name',change->>'merchant_name',CASE WHEN material THEN next_revision ELSE coalesce(old.material_revision,old.revision) END);
 UPDATE app.banking_sources s SET revision=next_revision,discrepancy=CASE WHEN s.discrepancy='none' OR notice='cross_boundary_change' THEN notice ELSE s.discrepancy END WHERE s.id=source.id;
 SELECT * INTO annotation FROM app.banking_annotations WHERE source_id=source.id ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN
  conflict:=annotation.material_conflict OR (material AND annotation.activity IS NOT NULL AND (processing<>'posted' OR
   (annotation.activity IN('purchase','bank_fee','debit_interest','cash_withdrawal') AND (change->>'amount_minor')::bigint<0) OR
   (annotation.activity IN('refund','income','loan_proceeds') AND (change->>'amount_minor')::bigint>0)));
  -- A previously stale annotation never regains acknowledgement on ingestion.
  INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed,material_conflict,applies_to_source_revision)
  VALUES(source.id,owner,annotation.revision+1,annotation.material_source_revision,annotation.category,annotation.activity,annotation.note,annotation.excluded,annotation.reviewed AND NOT material AND annotation.material_source_revision=coalesce(old.material_revision,old.revision),conflict,next_revision);
 END IF;
END $$;

CREATE FUNCTION app.banking_sync_commit(work uuid, token uuid, batch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved app.banking_sync_batches; b app.banking_bindings; c app.banking_connections; a app.banking_accounts; change jsonb; latest jsonb; outcome jsonb;
BEGIN
 SELECT * INTO saved FROM app.banking_sync_batches WHERE id=batch;
 IF NOT FOUND OR saved.work_id<>work OR saved.authority<>token OR NOT coalesce(app.banking_sync_authorized(work,token,saved.binding_id),false) THEN RETURN jsonb_build_object('code','DENIED'); END IF;
 SELECT * INTO saved FROM app.banking_sync_batches WHERE id=batch FOR UPDATE;
 IF saved.state='committed' THEN RETURN saved.result; END IF;
 SELECT * INTO b FROM app.banking_bindings WHERE id=saved.binding_id;
 SELECT * INTO c FROM app.banking_connections WHERE id=b.connection_id;
 SELECT * INTO a FROM app.banking_accounts WHERE id=b.account_id;
 IF saved.state<>'complete' OR saved.page_count=0 OR saved.expires_at<=clock_timestamp()
  OR (saved.connection_generation,saved.deletion_generation,saved.binding_generation,saved.account_generation,saved.reporting_revision,saved.starting_cursor)
  IS DISTINCT FROM (c.generation,c.deletion_generation,b.generation,a.generation,a.reporting_revision,coalesce(b.sync_cursor,'')) THEN RETURN jsonb_build_object('code','CONFLICT'); END IF;
 -- Multiple facts for one identity within a provider sequence are ambiguous.
 -- Reject the whole sequence rather than silently choosing a page's winner.
 IF EXISTS(SELECT fact->>'id' FROM app.banking_sync_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'changes') fact WHERE p.batch_id=batch AND fact->>'operation'<>'removed' GROUP BY fact->>'id' HAVING count(DISTINCT fact)>1) THEN
  UPDATE app.banking_sync_batches SET state='invalid' WHERE id=batch; RETURN jsonb_build_object('code','INVALID_BATCH');
 END IF;
 -- Pending facts first allow explicit links across pages; removals run last and
 -- cannot remove the posted identity when the pending identity was superseded.
 FOR change IN SELECT entry FROM (SELECT DISTINCT entry FROM app.banking_sync_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'changes') entry WHERE p.batch_id=batch AND entry->>'operation'<>'removed') changes ORDER BY (entry->>'pending')::boolean DESC,entry->>'id' LOOP
  PERFORM app.banking_sync_apply(b.id,b.owner_id,change,b.sync_cursor IS NULL);
 END LOOP;
 FOR change IN SELECT DISTINCT entry FROM app.banking_sync_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'changes') entry WHERE p.batch_id=batch AND entry->>'operation'='removed' LOOP
  INSERT INTO app.banking_sync_removals(binding_id,provider_transaction_id,import_revision) VALUES(b.id,change->>'id',b.import_revision+1) ON CONFLICT DO NOTHING;
  PERFORM app.banking_sync_apply(b.id,b.owner_id,change,b.sync_cursor IS NULL);
 END LOOP;
 IF NOT EXISTS(SELECT FROM app.banking_work w WHERE w.id=work AND w.lease_token=token AND w.state='running' AND w.lease_until>clock_timestamp()) THEN
  RAISE EXCEPTION 'sync authority expired' USING ERRCODE='42501';
 END IF;
 SELECT payload INTO latest FROM app.banking_sync_pages WHERE batch_id=batch ORDER BY ordinal DESC LIMIT 1;
 UPDATE app.banking_bindings SET sync_cursor=saved.next_cursor,staged_batch_id=NULL,import_state='usable',import_revision=import_revision+1,data_revision=data_revision+1,last_local_commit=clock_timestamp(),provider_update_status=latest->>'update_status',provider_success_at=(latest->>'provider_success_at')::timestamptz,provider_failed_at=(latest->>'provider_failed_at')::timestamptz WHERE id=b.id RETURNING * INTO b;
 SELECT * INTO a FROM app.banking_accounts WHERE id=b.account_id;
 outcome:=jsonb_build_object('code','READY','binding_id',b.id,'import_revision',b.import_revision,'data_revision',b.data_revision,'reporting_revision',a.reporting_revision,'committed_at',b.last_local_commit);
 UPDATE app.banking_sync_batches SET state='committed',result=outcome,starting_cursor='',next_cursor='' WHERE id=batch;
 DELETE FROM app.banking_sync_pages WHERE batch_id=batch;
 RETURN outcome;
END $$;

-- Bounded housekeeping is private staging cleanup, never retained bank history.
CREATE FUNCTION app.banking_sync_cleanup() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n integer;
BEGIN
 DELETE FROM app.banking_sync_batches WHERE id IN(SELECT id FROM app.banking_sync_batches WHERE expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT 10 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.banking_sync_authorized(uuid,uuid,uuid),app.banking_sync_valid_page(jsonb,text),app.banking_sync_apply(uuid,uuid,jsonb,boolean),app.banking_sync_begin(uuid,uuid,uuid,uuid),app.banking_sync_stage(uuid,uuid,uuid,integer,jsonb),app.banking_sync_cancel(uuid,uuid,uuid),app.banking_sync_commit(uuid,uuid,uuid),app.banking_sync_cleanup() FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_sync_begin(uuid,uuid,uuid,uuid),app.banking_sync_stage(uuid,uuid,uuid,integer,jsonb),app.banking_sync_cancel(uuid,uuid,uuid),app.banking_sync_commit(uuid,uuid,uuid),app.banking_sync_cleanup() TO kami_worker;
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
 coalesce(an.revision,0) AS annotation_revision,CASE WHEN an.material_source_revision=coalesce(r.material_revision,r.revision) AND NOT (an.material_conflict AND coalesce(an.applies_to_source_revision,an.material_source_revision)=r.revision) THEN an.activity ELSE NULL END AS activity,an.category,an.note,coalesce(an.material_conflict AND coalesce(an.applies_to_source_revision,an.material_source_revision)=r.revision,false) AS material_conflict,coalesce(an.excluded,false) AS excluded,coalesce(an.reviewed,false) AS reviewed
 FROM app.banking_sources s JOIN bindings b ON b.id=s.binding_id JOIN app.banking_source_revisions r ON r.source_id=s.id
 LEFT JOIN LATERAL (SELECT a.* FROM app.banking_annotations a WHERE a.source_id=s.id AND (coalesce(a.applies_to_source_revision,a.material_source_revision)=r.revision OR a.material_source_revision=coalesce(r.material_revision,r.revision)) ORDER BY a.revision DESC LIMIT 1) an ON true
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
RESET ROLE;
