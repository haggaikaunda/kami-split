SET ROLE kami_migrator;

-- Collection authority is independent of historical reporting ownership.
ALTER TABLE app.banking_bindings ADD COLUMN reporting_state text NOT NULL DEFAULT 'current'
  CHECK(reporting_state IN('current','staged','retired','cancelled'));
ALTER TABLE app.banking_bindings ADD COLUMN collection_stopped boolean NOT NULL DEFAULT false;
ALTER TABLE app.banking_bindings ADD COLUMN import_state text NOT NULL DEFAULT 'unknown'
  CHECK(import_state IN('unknown','loading','usable','failed','unavailable'));
ALTER TABLE app.banking_bindings ADD COLUMN import_revision bigint NOT NULL DEFAULT 1 CHECK(import_revision>0);
ALTER TABLE app.banking_bindings ADD COLUMN coverage_after date;
ALTER TABLE app.banking_bindings ADD COLUMN coverage_through date;
ALTER TABLE app.banking_sources ADD COLUMN discrepancy text NOT NULL DEFAULT 'none'
  CHECK(discrepancy IN('none','historical_discrepancy','cross_boundary_change'));
ALTER TABLE app.banking_accounts ADD COLUMN reporting_revision bigint NOT NULL DEFAULT 1 CHECK(reporting_revision>0);
ALTER TABLE app.banking_plans ADD COLUMN transition_date date;
ALTER TABLE app.banking_plans ADD COLUMN active_binding_id uuid;
ALTER TABLE app.banking_enrollments ADD COLUMN replacement_account_id uuid;
ALTER TABLE app.banking_enrollments ADD COLUMN replacement_target_fence text;
-- No FK on the opaque reservation: deletion can purge all private account data.
ALTER TABLE app.banking_operations DROP CONSTRAINT banking_operations_kind_check;
ALTER TABLE app.banking_operations ADD CONSTRAINT banking_operations_kind_check CHECK(kind IN
 ('create_connection','record_source','stop','delete_history','selection','replacement_publish','replacement_cancel'));

-- Every change relevant to a preview invalidates the account's shared cursor
-- revision. Existing connection-first source/lifecycle locks remain authoritative.
CREATE FUNCTION app.banking_reporting_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE account uuid;
BEGIN
 IF TG_TABLE_NAME='banking_bindings' THEN account:=NEW.account_id;
 ELSIF TG_TABLE_NAME='banking_sources' THEN
   SELECT account_id INTO account FROM app.banking_bindings WHERE id=NEW.binding_id;
 ELSIF TG_TABLE_NAME='banking_connections' THEN
   UPDATE app.banking_accounts a SET reporting_revision=a.reporting_revision+1
    WHERE EXISTS(SELECT FROM app.banking_bindings b WHERE b.account_id=a.id AND b.connection_id=NEW.id);
   RETURN NEW;
 ELSE
   SELECT b.account_id INTO account FROM app.banking_bindings b JOIN app.banking_sources s ON s.binding_id=b.id WHERE s.id=NEW.source_id;
 END IF;
 UPDATE app.banking_accounts SET reporting_revision=reporting_revision+1 WHERE id=account;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_reporting_changed AFTER INSERT OR UPDATE ON app.banking_bindings FOR EACH ROW EXECUTE FUNCTION app.banking_reporting_changed();
CREATE TRIGGER banking_reporting_changed AFTER UPDATE ON app.banking_connections FOR EACH ROW EXECUTE FUNCTION app.banking_reporting_changed();
CREATE TRIGGER banking_reporting_changed AFTER INSERT ON app.banking_source_revisions FOR EACH ROW EXECUTE FUNCTION app.banking_reporting_changed();
CREATE TRIGGER banking_reporting_changed AFTER UPDATE OF revision,discrepancy ON app.banking_sources FOR EACH ROW EXECUTE FUNCTION app.banking_reporting_changed();
CREATE TRIGGER banking_reporting_changed AFTER INSERT ON app.banking_annotations FOR EACH ROW EXECUTE FUNCTION app.banking_reporting_changed();

-- Even a freshly read generation cannot authorize collection on a retired stream.
CREATE FUNCTION app.banking_require_collecting_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM app.banking_bindings WHERE id=NEW.binding_id AND reporting_state IN('current','staged') AND NOT collection_stopped)
  AND NOT EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_account_barriers d ON d.account_id=b.account_id WHERE b.id=NEW.binding_id) THEN
   RAISE EXCEPTION 'retired banking stream' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_collecting BEFORE INSERT OR UPDATE OF revision ON app.banking_sources
 FOR EACH ROW WHEN (NEW.revision IS NOT NULL) EXECUTE FUNCTION app.banking_require_collecting_binding();

CREATE FUNCTION app.banking_replacement_target_fence(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(a.generation,b.id,b.generation,c.id,c.generation,c.state,c.permission_state)::text,',' ORDER BY b.id),''),'UTF8')),'hex')
 FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id JOIN app.banking_connections c ON c.id=b.connection_id WHERE a.id=target;
$$;
CREATE FUNCTION app.banking_replacement_enrollment_start(target uuid,env text,digest bytea,version text,webhook text,account uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); code text;
BEGIN
 IF NOT EXISTS(SELECT FROM app.banking_accounts a WHERE a.id=account AND a.owner_id=actor
   AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)) THEN RETURN 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT FROM app.banking_bindings WHERE account_id=account AND reporting_state='staged') THEN RETURN 'ATTEMPT_IN_PROGRESS'; END IF;
 code:=app.banking_enrollment_start(target,env,digest,version,'existing',webhook);
 UPDATE app.banking_enrollments SET replacement_account_id=account,replacement_target_fence=app.banking_replacement_target_fence(account) WHERE id=target AND owner_id=actor AND state='preparing';
 RETURN code;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_replacement_enrollment_start(uuid,text,bytea,text,text,uuid) TO kami_api;

-- Exact provider identity is unique per logical account, while an explicitly
-- authorized replacement may retain several bindings for that same account.
CREATE TABLE app.banking_account_identities (
 owner_id uuid NOT NULL, environment text NOT NULL, institution_id text NOT NULL,
 stable_id text NOT NULL, account_id uuid NOT NULL REFERENCES app.banking_accounts(id) ON DELETE CASCADE,
 PRIMARY KEY(owner_id,environment,institution_id,stable_id)
);
ALTER TABLE app.banking_account_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.banking_account_identities FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
INSERT INTO app.banking_account_identities
 SELECT m.owner_id,m.environment,m.institution_id,m.stable_id,b.account_id
 FROM app.banking_enrollment_accounts m JOIN app.banking_bindings b ON b.id=m.binding_id WHERE m.stable_id<>'';
DROP INDEX app.banking_exact_account;
CREATE FUNCTION app.banking_check_exact_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE account uuid;
BEGIN
 IF NEW.stable_id='' THEN RETURN NEW; END IF;
 SELECT account_id INTO account FROM app.banking_bindings WHERE id=NEW.binding_id;
 INSERT INTO app.banking_account_identities VALUES(NEW.owner_id,NEW.environment,NEW.institution_id,NEW.stable_id,account) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM app.banking_account_identities i WHERE i.owner_id=NEW.owner_id AND i.environment=NEW.environment AND i.institution_id=NEW.institution_id AND i.stable_id=NEW.stable_id AND i.account_id=account) THEN
  RAISE EXCEPTION 'duplicate banking account' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_exact_account BEFORE INSERT ON app.banking_enrollment_accounts FOR EACH ROW EXECUTE FUNCTION app.banking_check_exact_account();

-- One coherent statement exposes only the enabled owner's complete replacement
-- state. The five digests compare actual persisted state rather than client hints.
CREATE FUNCTION app.banking_replacement_snapshot(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH account AS (
 SELECT a.* FROM app.banking_accounts a WHERE a.id=target AND a.owner_id=app.banking_owner()
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 ), bindings AS (
 SELECT b.*,c.state AS connection_state,c.generation AS connection_generation,c.permission_state,c.health,c.enrollment_pending,c.provider_removed
 FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id JOIN account a ON a.id=b.account_id
 ), sources AS (
 SELECT s.id,s.binding_id,r.revision,(r.revision=s.revision) AS is_latest,s.discrepancy,r.amount_minor::text AS amount_minor,r.bank_date::text AS bank_date,r.processing_state,r.stage,
 coalesce(an.revision,0) AS annotation_revision,an.activity,an.category,an.note,coalesce(an.excluded,false) AS excluded,coalesce(an.reviewed,false) AS reviewed
 FROM app.banking_sources s JOIN bindings b ON b.id=s.binding_id JOIN app.banking_source_revisions r ON r.source_id=s.id 
 LEFT JOIN LATERAL (SELECT a.* FROM app.banking_annotations a WHERE a.source_id=s.id AND a.material_source_revision=r.revision ORDER BY a.revision DESC LIMIT 1) an ON true
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
GRANT EXECUTE ON FUNCTION app.banking_replacement_snapshot(uuid) TO kami_api;

-- The API supplies a server-derived proposal. This narrow wrapper reauthorizes,
-- locks lifecycle resources, compares the entire preview, validates provenance
-- through existing constraints and commits publication/captures/fences together.
CREATE FUNCTION app.banking_replacement_publish(target uuid,expected jsonb,proposal jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); snapshot jsonb; plan uuid:=gen_random_uuid(); archive uuid:=gen_random_uuid(); previous uuid; next_revision bigint; entry jsonb; active uuid;
BEGIN
 PERFORM 1 FROM app.banking_connections c WHERE c.owner_id=actor AND EXISTS(SELECT FROM app.banking_bindings b WHERE b.connection_id=c.id AND b.account_id=target) ORDER BY c.id FOR UPDATE;
 PERFORM 1 FROM app.banking_bindings WHERE account_id=target ORDER BY id FOR UPDATE;
 PERFORM 1 FROM app.banking_accounts WHERE id=target AND owner_id=actor FOR UPDATE;
 snapshot:=app.banking_replacement_snapshot(target);
 IF snapshot IS NULL OR snapshot->'revisions' IS DISTINCT FROM expected THEN RETURN NULL; END IF;
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
 SELECT archive,actor,s.id,s.revision,(SELECT a.revision FROM app.banking_annotations a WHERE a.source_id=s.id AND a.material_source_revision=s.revision ORDER BY a.revision DESC LIMIT 1)
 FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=target AND s.revision IS NOT NULL;
 -- Recovery changes reporting only; a retired stream never regains collection.
 UPDATE app.banking_bindings SET reporting_state='retired',collection_stopped=true,generation=generation+1
 WHERE account_id=target AND reporting_state='current' AND id<>active;
 UPDATE app.banking_bindings SET reporting_state='current' WHERE id=active AND reporting_state='staged';
 UPDATE app.banking_accounts SET reporting_revision=reporting_revision+1 WHERE id=target;
 RETURN plan;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_replacement_publish(uuid,jsonb,jsonb) TO kami_api;

CREATE FUNCTION app.banking_replacement_cancel(target uuid,binding uuid,expected jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); connection uuid;
BEGIN
 SELECT b.connection_id INTO connection FROM app.banking_bindings b WHERE b.id=binding AND b.account_id=target AND b.owner_id=actor;
 PERFORM 1 FROM app.banking_connections WHERE id=connection FOR UPDATE;
 PERFORM 1 FROM app.banking_bindings WHERE id=binding FOR UPDATE;
 IF (app.banking_replacement_snapshot(target)->'revisions') IS DISTINCT FROM expected THEN RETURN false; END IF;
 UPDATE app.banking_bindings SET reporting_state='cancelled',collection_stopped=true,generation=generation+1 WHERE id=binding AND reporting_state='staged';
 IF NOT FOUND THEN RETURN false; END IF;
 -- A dedicated cancelled candidate needs durable narrow teardown. Selected
 -- siblings retain their Item; cancellation never claims remote completion.
 IF NOT EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=connection AND b.reporting_state IN('current','staged') AND NOT b.collection_stopped AND a.selected) THEN
  UPDATE app.banking_connections SET state='stopped',generation=generation+1 WHERE id=connection AND state='active';
  PERFORM app.banking_enqueue(connection,(SELECT generation FROM app.banking_connections WHERE id=connection),'teardown');
 END IF;
 RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_replacement_cancel(uuid,uuid,jsonb) TO kami_api;

CREATE OR REPLACE FUNCTION app.banking_enrollment_activate(target uuid, accounts jsonb, institution text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); env text; e app.banking_enrollments; connection app.banking_connections; a jsonb; account uuid; binding uuid;
BEGIN
  -- Environment is immutable; this read supplies only the reservation lock key.
  -- Reauthorize and lock the attempt after acquiring the same first lock as Start.
  SELECT environment INTO env FROM app.banking_enrollments WHERE id=target AND owner_id=actor;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||'/banking/'||env,0));
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target AND owner_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF e.state<>'exchanging' OR e.cancelled OR e.expires_at<=clock_timestamp() OR e.connection_id IS NULL THEN RETURN 'CLEANUP_PENDING'; END IF;
  -- The attempt lock precedes the connection lock, matching recovery/ingress.
  -- Only the untouched provisional generation may publish selected accounts.
  SELECT * INTO connection FROM app.banking_connections WHERE id=e.connection_id AND owner_id=actor FOR UPDATE;
  IF NOT FOUND OR connection.state<>'stopped' OR connection.generation<>1 OR connection.deletion_generation<>0
    OR NOT connection.enrollment_pending OR connection.provider_removed
    OR EXISTS(SELECT FROM app.banking_deletion_barriers WHERE connection_id=connection.id) THEN RETURN 'CLEANUP_PENDING'; END IF;
  IF EXISTS(SELECT FROM app.banking_enrollment_receipts r JOIN app.banking_connections c ON c.id=e.connection_id WHERE r.attempt_id=e.id AND r.hint_item_id<>c.provider_item_id) THEN RETURN 'CLEANUP_PENDING'; END IF;
  IF e.replacement_account_id IS NOT NULL THEN
    PERFORM 1 FROM app.banking_connections c WHERE c.owner_id=actor AND EXISTS(SELECT FROM app.banking_bindings b WHERE b.connection_id=c.id AND b.account_id=e.replacement_account_id) ORDER BY c.id FOR UPDATE;
    PERFORM 1 FROM app.banking_accounts WHERE id=e.replacement_account_id FOR UPDATE;
  END IF;
  IF e.intent='existing' AND e.replacement_account_id IS NULL THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
  IF e.replacement_account_id IS NOT NULL AND
   (jsonb_array_length(accounts)<>1 OR NOT EXISTS(SELECT FROM app.banking_accounts a WHERE a.id=e.replacement_account_id AND a.owner_id=actor AND a.kind=accounts->0->>'Kind' AND e.replacement_target_fence=app.banking_replacement_target_fence(a.id)
     AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id))
    OR EXISTS(SELECT FROM app.banking_bindings WHERE account_id=e.replacement_account_id AND reporting_state='staged')) THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
  IF jsonb_typeof(accounts)<>'array' OR jsonb_array_length(accounts) NOT BETWEEN 1 AND 100 OR institution='' THEN RETURN 'INVALID_SELECTION'; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
    IF a->>'Kind' NOT IN('checking','savings','credit_card') OR a->>'Currency'<>'USD' OR coalesce(a->>'ID','')='' THEN RETURN 'INVALID_SELECTION'; END IF;
    IF coalesce(a->>'StableID','')<>'' AND EXISTS(SELECT FROM app.banking_enrollment_accounts WHERE owner_id=actor AND environment=e.environment AND institution_id=institution AND stable_id=a->>'StableID' AND NOT EXISTS(SELECT FROM app.banking_bindings b WHERE b.id=banking_enrollment_accounts.binding_id AND b.account_id=e.replacement_account_id)) THEN RETURN 'DUPLICATE_ACCOUNT'; END IF;
  END LOOP;
  UPDATE app.banking_connections SET state='active',permission_state='granted',enrollment_pending=false
    WHERE id=e.connection_id AND state='stopped' AND generation=1 AND deletion_generation=0 AND enrollment_pending AND NOT provider_removed;
  IF NOT FOUND THEN RETURN 'CLEANUP_PENDING'; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
    account:=coalesce(e.replacement_account_id,gen_random_uuid()); binding:=gen_random_uuid();
    IF e.replacement_account_id IS NULL THEN
      INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES(account,actor,a->>'Kind',true);
    ELSIF NOT EXISTS(SELECT FROM app.banking_accounts WHERE id=account AND kind=a->>'Kind') THEN
      RAISE EXCEPTION 'incompatible replacement' USING ERRCODE='23514';
    END IF;
    INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES(binding,actor,e.connection_id,account,a->>'ID');
    IF e.replacement_account_id IS NOT NULL THEN
      UPDATE app.banking_bindings SET collection_stopped=true,generation=generation+1 WHERE account_id=account AND id<>binding AND NOT (SELECT selected FROM app.banking_accounts WHERE id=account);
      UPDATE app.banking_accounts SET selected=true WHERE id=account;
    END IF;
    UPDATE app.banking_bindings SET reporting_state='staged' WHERE id=binding AND e.replacement_account_id IS NOT NULL;
    INSERT INTO app.banking_enrollment_accounts VALUES(binding,actor,e.environment,institution,coalesce(a->>'StableID',''),a->>'Name','USD',365);
  END LOOP;
  INSERT INTO app.banking_webhook_correlations(id,connection_id,generation) VALUES(target,e.connection_id,1);
  UPDATE app.banking_enrollments SET state='ready',blocks_enrollment=false,result_code='AWAITING_INITIAL_IMPORT',link_ciphertext=NULL,public_ciphertext=NULL,lease_until=NULL WHERE id=target;
  UPDATE app.banking_enrollment_jobs SET state='complete' WHERE attempt_id=target;
  RETURN 'AWAITING_INITIAL_IMPORT';
END $$;


CREATE OR REPLACE FUNCTION app.banking_purge_batch(target uuid, authority uuid) RETURNS integer
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
    AND s.revision IS NULL AND NOT EXISTS(SELECT FROM app.banking_annotations a WHERE a.source_id=x.source_id AND a.material_source_revision=x.revision)
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


CREATE OR REPLACE FUNCTION app.banking_record_source(target uuid, proposed uuid, provider_id text,
  expected_generation bigint, expected_binding_generation bigint, expected_revision bigint,
  minor text, currency text, bank_date date, processing text, mapping text)
RETURNS TABLE(code text,source_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := app.lock_banking_owner(); connection app.banking_connections;
  binding app.banking_bindings; existing app.banking_sources; next_revision bigint;
BEGIN
  SELECT b.* INTO binding FROM app.banking_bindings b WHERE b.id=target AND b.owner_id=actor;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text,NULL::uuid; RETURN; END IF;
  SELECT c.* INTO connection FROM app.banking_connections c WHERE c.id=binding.connection_id AND c.owner_id=actor FOR UPDATE;
  SELECT b.* INTO binding FROM app.banking_bindings b WHERE b.id=target AND b.owner_id=actor FOR UPDATE;
  IF binding.collection_stopped OR binding.reporting_state NOT IN('current','staged') OR connection.state <> 'active' OR NOT EXISTS(SELECT FROM app.banking_accounts a WHERE a.id=binding.account_id AND a.selected) OR connection.generation <> expected_generation
    OR binding.generation <> expected_binding_generation
    OR EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=binding.account_id) THEN
    RETURN QUERY SELECT 'CONFLICT'::text,NULL::uuid; RETURN;
  END IF;
  IF minor !~ '^(0|-?[1-9][0-9]*)$' OR length(minor)>20 OR currency <> 'USD' THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text,NULL::uuid; RETURN;
  END IF;
  SELECT s.* INTO existing FROM app.banking_sources s WHERE s.binding_id=target AND s.provider_transaction_id=provider_id;
  IF coalesce(existing.revision,0) <> expected_revision THEN
    RETURN QUERY SELECT 'CONFLICT'::text,NULL::uuid; RETURN;
  END IF;
  next_revision := expected_revision+1;
  IF existing.id IS NULL THEN
    INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES(proposed,actor,target,provider_id,next_revision);
    existing.id := proposed;
  ELSE
    UPDATE app.banking_sources SET revision=next_revision WHERE id=existing.id;
  END IF;
  INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage)
    VALUES(existing.id,actor,next_revision,minor::bigint,currency,bank_date,processing,mapping,'current');
  RETURN QUERY SELECT 'READY'::text,existing.id;
END $$;



CREATE OR REPLACE FUNCTION app.banking_selection(target uuid, expected bigint, accounts jsonb, institution text, expected_item text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); c app.banking_connections; a jsonb; saved_binding app.banking_bindings; m app.banking_enrollment_accounts; account uuid; binding uuid;
BEGIN
 SELECT * INTO c FROM app.banking_connections WHERE id=target AND owner_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF c.state<>'active' OR c.generation<>expected OR c.provider_removed OR c.permission_state<>'granted' OR c.enrollment_pending THEN RETURN 'CONFLICT'; END IF;
 IF c.provider_item_id<>expected_item THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
 IF jsonb_typeof(accounts)<>'array' OR jsonb_array_length(accounts)>100 THEN RETURN 'INVALID_SELECTION'; END IF;
 -- Identity continuity belongs to the Item, regardless of proposal overlap.
 -- Empty offline deselection carries no provider institution assertion.
 IF (institution<>'' OR jsonb_array_length(accounts)>0) AND
   (NOT EXISTS(SELECT FROM app.banking_enrollment_accounts metadata JOIN app.banking_bindings stream ON stream.id=metadata.binding_id WHERE stream.connection_id=target)
    OR EXISTS(SELECT FROM app.banking_enrollment_accounts metadata JOIN app.banking_bindings stream ON stream.id=metadata.binding_id WHERE stream.connection_id=target AND metadata.institution_id<>institution)) THEN
   RETURN 'REPLACEMENT_REQUIRED';
 END IF;
 -- Validate the entire proposal before changing any stream.
 FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
   IF a->>'Kind' NOT IN('checking','savings','credit_card') OR a->>'Currency'<>'USD' OR coalesce(a->>'ID','')='' THEN RETURN 'INVALID_SELECTION'; END IF;
   SELECT * INTO saved_binding FROM app.banking_bindings WHERE connection_id=target AND provider_account_id=a->>'ID';
   IF FOUND THEN
     SELECT * INTO m FROM app.banking_enrollment_accounts WHERE binding_id=saved_binding.id;
     IF saved_binding.reporting_state NOT IN('current','staged') OR NOT FOUND OR m.institution_id<>institution OR (m.stable_id<>'' AND m.stable_id<>coalesce(a->>'StableID',''))
       OR EXISTS(SELECT FROM app.banking_accounts WHERE id=saved_binding.account_id AND kind<>a->>'Kind')
       OR EXISTS(SELECT FROM app.banking_account_barriers WHERE account_id=saved_binding.account_id) THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
   ELSE
     IF coalesce(a->>'StableID','')<>'' AND EXISTS(SELECT FROM app.banking_enrollment_accounts WHERE owner_id=actor AND environment=c.environment AND institution_id=institution AND stable_id=a->>'StableID') THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
   END IF;
 END LOOP;
 UPDATE app.banking_accounts owned SET selected=false,generation=owned.generation+1 WHERE owned.selected AND EXISTS(SELECT FROM app.banking_bindings stream WHERE stream.account_id=owned.id AND stream.connection_id=target AND stream.reporting_state='current' AND NOT EXISTS(SELECT FROM jsonb_array_elements(accounts) x WHERE x->>'ID'=stream.provider_account_id));
 UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=target;
 FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
   SELECT * INTO saved_binding FROM app.banking_bindings WHERE connection_id=target AND provider_account_id=a->>'ID';
   IF FOUND THEN
     UPDATE app.banking_accounts SET selected=true,generation=generation+CASE WHEN selected THEN 0 ELSE 1 END WHERE id=saved_binding.account_id;
     UPDATE app.banking_bindings SET collection_stopped=false WHERE id=saved_binding.id;
   ELSE
     account:=gen_random_uuid(); binding:=gen_random_uuid();
     INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES(account,actor,a->>'Kind',true);
     INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES(binding,actor,target,account,a->>'ID');
     INSERT INTO app.banking_enrollment_accounts VALUES(binding,actor,c.environment,institution,coalesce(a->>'StableID',''),a->>'Name','USD',365);
   END IF;
 END LOOP;
 UPDATE app.banking_connections SET generation=generation+1 WHERE id=target;
 UPDATE app.banking_webhook_correlations SET generation=c.generation+1 WHERE connection_id=target;
 RETURN 'READY';
END $$;
-- Freeze completion input before provider observation. Retrying read-only provider
-- observation is safe; a concurrent changed subset never obtains authority.

CREATE OR REPLACE FUNCTION app.banking_accept_lifecycle_webhook(correlation uuid, expected_environment text,item text,digest bytea,delivery bytea,event_type text,event_code text,account text,revoked boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections; duplicate boolean; accepted boolean; binding app.banking_bindings;
BEGIN
 PERFORM 1 FROM app.banking_enrollments WHERE id=correlation FOR UPDATE;
 SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_webhook_correlations w ON w.connection_id=connection.id WHERE w.id=correlation FOR UPDATE OF connection;
 -- Positive secondary-Item removals outlive transient recovery job arrays.
 IF octet_length(digest)=32 AND EXISTS(
   SELECT FROM app.banking_enrollment_removals r JOIN app.banking_enrollments e ON e.id=r.attempt_id
   WHERE e.id=correlation AND e.environment=expected_environment
     AND r.item_digest=sha256(convert_to(e.id::text||'/'||e.environment||'/'||item,'UTF8'))) THEN
   RETURN true;
 END IF;
 -- Confirmed removal redacts the original Item from the connection. Recognize
 -- its durable terminal identity before the legacy unknown-Item discovery path.
 IF c.provider_removed AND c.state<>'active' AND c.environment=expected_environment AND octet_length(digest)=32
   AND EXISTS(SELECT FROM app.banking_webhook_correlations w WHERE w.id=correlation
     AND w.removed_item_digest=sha256(convert_to(w.id::text||'/'||expected_environment||'/'||item,'UTF8'))) THEN
   RETURN true;
 END IF;
 SELECT EXISTS(SELECT FROM app.banking_webhook_receipts WHERE correlation_id=correlation AND body_digest=digest) INTO duplicate;
 accepted:=app.banking_accept_webhook(correlation,expected_environment,item,digest,event_type,event_code);
 IF NOT accepted OR c.id IS NULL OR c.provider_item_id<>item OR c.environment<>expected_environment OR c.state<>'active' OR event_type<>'ITEM' THEN RETURN accepted; END IF;
 IF event_code IN('USER_PERMISSION_REVOKED','USER_ACCOUNT_REVOKED') OR (event_code='ERROR' AND revoked) THEN
   -- Only an exact verified signed delivery is known to be a retry. A newly
   -- signed identical payload must fence authority, even without a local binding.
   INSERT INTO app.banking_webhook_deliveries VALUES(correlation,delivery) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN RETURN true; END IF;
 ELSIF duplicate THEN RETURN true;
 END IF;
 IF event_code='USER_PERMISSION_REVOKED' OR (event_code='ERROR' AND revoked) THEN
   UPDATE app.banking_connections SET state='stopped',permission_state='revoked',generation=generation+1,health='repair_required' WHERE id=c.id;
   UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=c.id;
   PERFORM app.banking_enqueue(c.id,c.generation+1,'teardown');
 ELSIF event_code='USER_ACCOUNT_REVOKED' THEN
   SELECT * INTO binding FROM app.banking_bindings WHERE connection_id=c.id AND provider_account_id=account;
   IF FOUND THEN
     UPDATE app.banking_accounts SET selected=false,generation=generation+1 WHERE id=binding.account_id AND binding.reporting_state='current';
     UPDATE app.banking_bindings SET collection_stopped=true,generation=generation+1 WHERE id=binding.id;
   END IF;
   UPDATE app.banking_connections SET generation=generation+1,health='repair_required' WHERE id=c.id;
   UPDATE app.banking_webhook_correlations SET generation=c.generation+1 WHERE connection_id=c.id;
 ELSIF event_code IN('ERROR','PENDING_EXPIRATION','PENDING_DISCONNECT') THEN
   UPDATE app.banking_connections SET health='repair_required' WHERE id=c.id;
 ELSIF event_code='NEW_ACCOUNTS_AVAILABLE' THEN
   UPDATE app.banking_connections SET health='accounts_available' WHERE id=c.id;
 END IF;
 -- LOGIN_REPAIRED and out-of-order healthy events grant no selection or consent.
 RETURN true;
END $$;

RESET ROLE;
