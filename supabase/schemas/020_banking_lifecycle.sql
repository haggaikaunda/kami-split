SET ROLE kami_migrator;

ALTER TABLE app.banking_connections ADD COLUMN health text NOT NULL DEFAULT 'healthy' CHECK(health IN('healthy','repair_required','accounts_available'));
-- Carry existing worker attention into the new owner-visible status at upgrade.
UPDATE app.banking_connections c SET health='repair_required' WHERE c.state='active' AND
 (EXISTS(SELECT FROM app.banking_reconciliation r JOIN app.banking_bindings b ON b.id=r.binding_id WHERE b.connection_id=c.id AND r.generation=b.generation AND r.state='attention')
 OR EXISTS(SELECT FROM app.banking_work w WHERE w.connection_id=c.id AND w.generation=c.generation AND w.kind='reconcile' AND w.state='needs_attention'));

ALTER TABLE app.banking_operations DROP CONSTRAINT banking_operations_kind_check;
ALTER TABLE app.banking_operations ADD CONSTRAINT banking_operations_kind_check CHECK(kind IN('create_connection','record_source','stop','delete_history','selection'));
CREATE TABLE app.banking_repairs (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES app.users(id),
  connection_id uuid NOT NULL REFERENCES app.banking_connections(id), generation bigint NOT NULL,
  input_digest bytea NOT NULL CHECK(octet_length(input_digest)=32), key_version text NOT NULL,
  finish_digest bytea, state text NOT NULL CHECK(state IN('preparing','prepared','complete')),
  result_code text NOT NULL, link_ciphertext bytea, token_key_version text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes'
);
ALTER TABLE app.banking_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.banking_repairs FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
CREATE POLICY owner_read ON app.banking_repairs FOR SELECT TO kami_api USING(owner_id=app.banking_owner());
GRANT SELECT ON app.banking_repairs TO kami_api;

-- Exact authenticated delivery fingerprints are distinct from body receipts:
-- provider retries may be newly signed and have no semantic event identifier.
CREATE TABLE app.banking_webhook_deliveries (
  correlation_id uuid NOT NULL REFERENCES app.banking_webhook_correlations(id) ON DELETE CASCADE,
  delivery_digest bytea NOT NULL CHECK(octet_length(delivery_digest)=32),
  PRIMARY KEY(correlation_id,delivery_digest)
);
ALTER TABLE app.banking_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.banking_webhook_deliveries FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;

-- Keep only a correlation-scoped one-way terminal identity after the raw Item
-- and credential are erased. Existing private correlation retention prevents a
-- callback for that removed Item being mistaken for a distinct late enrollment.
ALTER TABLE app.banking_webhook_correlations ADD COLUMN removed_item_digest bytea
  CHECK(removed_item_digest IS NULL OR octet_length(removed_item_digest)=32);
CREATE FUNCTION app.banking_remember_removed_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 UPDATE app.banking_webhook_correlations w SET removed_item_digest=
   sha256(convert_to(w.id::text||'/'||OLD.environment||'/'||OLD.provider_item_id,'UTF8'))
 WHERE w.connection_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_remember_removed_item AFTER UPDATE OF provider_removed ON app.banking_connections
 FOR EACH ROW WHEN (NEW.provider_removed AND NOT OLD.provider_removed)
 EXECUTE FUNCTION app.banking_remember_removed_item();

-- Recovery may remove several distinct Items over successive cleanup cycles.
-- Job arrays are transient work state; positive removal identity must survive a
-- later reset without retaining another raw provider identifier.
CREATE TABLE app.banking_enrollment_removals (
  attempt_id uuid NOT NULL REFERENCES app.banking_enrollments(id) ON DELETE CASCADE,
  item_digest bytea NOT NULL CHECK(octet_length(item_digest)=32),
  PRIMARY KEY(attempt_id,item_digest)
);
ALTER TABLE app.banking_enrollment_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.banking_enrollment_removals FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
CREATE FUNCTION app.banking_remember_enrollment_removals() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 INSERT INTO app.banking_enrollment_removals
 SELECT NEW.attempt_id,sha256(convert_to(e.id::text||'/'||e.environment||'/'||removed.item,'UTF8'))
 FROM app.banking_enrollments e CROSS JOIN unnest(NEW.removed_items) removed(item)
 WHERE e.id=NEW.attempt_id ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_remember_enrollment_removals AFTER UPDATE OF removed_items ON app.banking_enrollment_jobs
 FOR EACH ROW EXECUTE FUNCTION app.banking_remember_enrollment_removals();
-- Existing positive confirmations can be carried forward; missing/redacted
-- history is never reconstructed from absence or an unconfirmed hint.
INSERT INTO app.banking_enrollment_removals
 SELECT e.id,sha256(convert_to(e.id::text||'/'||e.environment||'/'||removed.item,'UTF8'))
 FROM app.banking_enrollments e JOIN app.banking_enrollment_jobs j ON j.attempt_id=e.id
 CROSS JOIN unnest(j.removed_items) removed(item) ON CONFLICT DO NOTHING;

-- The status projection deliberately permits opaque deleted-connection status,
-- without weakening history RLS or exposing any provider or financial payload.
CREATE FUNCTION app.banking_lifecycle_status(target uuid)
RETURNS TABLE(id uuid,environment text,state text,generation bigint,deletion_generation bigint,health text,cleanup text,purge text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT c.id,c.environment,c.state,c.generation,c.deletion_generation,c.health,
 CASE WHEN c.provider_removed THEN 'confirmed' ELSE coalesce((SELECT w.state FROM app.banking_work w WHERE w.connection_id=c.id AND w.generation=c.generation AND w.kind='teardown'),'not_requested') END,
 CASE WHEN c.state<>'deleted' THEN 'not_requested' ELSE coalesce((SELECT d.cleanup_state FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id),'pending') END
 FROM app.banking_connections c WHERE c.id=target AND c.owner_id=app.banking_owner();
$$;
GRANT EXECUTE ON FUNCTION app.banking_lifecycle_status(uuid) TO kami_api;

CREATE FUNCTION app.banking_repair_start(target uuid, connection uuid, expected bigint, digest bytea, version text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); r app.banking_repairs; c app.banking_connections;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text,0));
 SELECT * INTO r FROM app.banking_repairs WHERE id=target;
 PERFORM 1 FROM app.banking_connections WHERE id=coalesce(r.connection_id,connection) AND owner_id=actor FOR UPDATE;
 SELECT * INTO r FROM app.banking_repairs WHERE id=target FOR UPDATE;
 IF FOUND THEN
   IF r.owner_id<>actor THEN RETURN 'NOT_FOUND'; END IF;
   IF r.input_digest<>digest THEN RETURN 'CONFLICT'; END IF;
   RETURN r.result_code;
 END IF;
 SELECT * INTO c FROM app.banking_connections WHERE id=connection AND owner_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF c.state<>'active' OR c.generation<>expected OR c.provider_removed OR c.enrollment_pending THEN RETURN 'CONFLICT'; END IF;
 UPDATE app.banking_repairs SET state='complete',result_code='REPAIR_REQUIRED',link_ciphertext=NULL WHERE connection_id=connection AND state<>'complete' AND expires_at<=clock_timestamp();
 IF EXISTS(SELECT FROM app.banking_repairs WHERE connection_id=connection AND state<>'complete') THEN RETURN 'ATTEMPT_IN_PROGRESS'; END IF;
 INSERT INTO app.banking_repairs(id,owner_id,connection_id,generation,input_digest,key_version,state,result_code)
 VALUES(target,actor,connection,expected,digest,version,'preparing','PREPARING');
 RETURN 'CLAIMED';
END $$;
CREATE FUNCTION app.banking_repair_prepared(target uuid, token bytea, version text, expiration timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); r app.banking_repairs; c app.banking_connections;
BEGIN
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor;
 SELECT * INTO c FROM app.banking_connections WHERE id=r.connection_id FOR UPDATE;
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor FOR UPDATE;
 IF r.state<>'preparing' OR c.state<>'active' OR c.generation<>r.generation OR r.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 UPDATE app.banking_repairs SET state=CASE WHEN token IS NULL THEN 'complete' ELSE 'prepared' END,result_code=CASE WHEN token IS NULL THEN 'REPAIR_REQUIRED' ELSE 'PREPARED' END,
 link_ciphertext=token,token_key_version=version,expires_at=least(expires_at,expiration) WHERE id=target;
 RETURN true;
END $$;

-- Explicit selection changes retain source/binding/annotation identities. New
-- authorization is proved by server-side Accounts before entering this wrapper.
CREATE FUNCTION app.banking_selection(target uuid, expected bigint, accounts jsonb, institution text, expected_item text) RETURNS text
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
     IF NOT FOUND OR m.institution_id<>institution OR (m.stable_id<>'' AND m.stable_id<>coalesce(a->>'StableID',''))
       OR EXISTS(SELECT FROM app.banking_accounts WHERE id=saved_binding.account_id AND kind<>a->>'Kind')
       OR EXISTS(SELECT FROM app.banking_account_barriers WHERE account_id=saved_binding.account_id) THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
   ELSE
     IF coalesce(a->>'StableID','')<>'' AND EXISTS(SELECT FROM app.banking_enrollment_accounts WHERE owner_id=actor AND environment=c.environment AND institution_id=institution AND stable_id=a->>'StableID') THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
   END IF;
 END LOOP;
 UPDATE app.banking_accounts owned SET selected=false,generation=owned.generation+1 WHERE owned.selected AND EXISTS(SELECT FROM app.banking_bindings stream WHERE stream.account_id=owned.id AND stream.connection_id=target AND NOT EXISTS(SELECT FROM jsonb_array_elements(accounts) x WHERE x->>'ID'=stream.provider_account_id));
 UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=target;
 FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
   SELECT * INTO saved_binding FROM app.banking_bindings WHERE connection_id=target AND provider_account_id=a->>'ID';
   IF FOUND THEN
     UPDATE app.banking_accounts SET selected=true,generation=generation+CASE WHEN selected THEN 0 ELSE 1 END WHERE id=saved_binding.account_id;
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
CREATE FUNCTION app.banking_repair_finish_claim(target uuid,digest bytea) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); r app.banking_repairs;
BEGIN
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor;
 PERFORM 1 FROM app.banking_connections WHERE id=r.connection_id FOR UPDATE;
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF r.finish_digest IS NOT NULL AND r.finish_digest<>digest THEN RETURN 'CONFLICT'; END IF;
 UPDATE app.banking_repairs SET finish_digest=digest WHERE id=target AND finish_digest IS NULL;
 IF r.state='prepared' AND r.result_code='PREPARED' AND r.expires_at>clock_timestamp() THEN RETURN 'CLAIMED'; END IF;
 RETURN r.result_code;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_repair_finish_claim(uuid,bytea) TO kami_api;

CREATE FUNCTION app.banking_repair_finish(target uuid, digest bytea, accounts jsonb, institution text, item text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); r app.banking_repairs; code text;
BEGIN
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor;
 PERFORM 1 FROM app.banking_connections WHERE id=r.connection_id FOR UPDATE;
 SELECT * INTO r FROM app.banking_repairs WHERE id=target AND owner_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF r.finish_digest IS NOT NULL AND r.finish_digest<>digest THEN RETURN 'CONFLICT'; END IF;
 IF r.state='complete' THEN RETURN r.result_code; END IF;
 IF r.state<>'prepared' OR r.result_code<>'PREPARED' OR r.expires_at<=clock_timestamp() THEN RETURN 'REPAIR_REQUIRED'; END IF;
 code:=app.banking_selection(r.connection_id,r.generation,accounts,institution,item);
 IF code='READY' THEN UPDATE app.banking_connections SET health='healthy' WHERE id=r.connection_id; END IF;
 UPDATE app.banking_repairs SET state='complete',result_code=code,finish_digest=digest,link_ciphertext=NULL WHERE id=target;
 RETURN code;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_repair_start(uuid,uuid,bigint,bytea,text),app.banking_repair_prepared(uuid,bytea,text,timestamptz),app.banking_repair_finish(uuid,bytea,jsonb,text,text),app.banking_selection(uuid,bigint,jsonb,text,text) TO kami_api;

-- Identity loss immediately fences collection and records durable cleanup in the
-- same transaction; retaining history is distinct from explicit private deletion.
CREATE FUNCTION app.banking_identity_stop() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections;
BEGIN
 IF (NEW.enabled AND NEW.live_auth_id=NEW.auth_subject) THEN RETURN NEW; END IF;
 FOR c IN SELECT * FROM app.banking_connections WHERE owner_id=NEW.id AND state='active' ORDER BY id FOR UPDATE LOOP
   UPDATE app.banking_connections SET state='stopped',permission_state='revoked',generation=generation+1 WHERE id=c.id;
   UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=c.id;
   PERFORM app.banking_enqueue(c.id,c.generation+1,'teardown');
 END LOOP;

 RETURN NEW;
END $$;
CREATE TRIGGER banking_identity_stop AFTER UPDATE OF enabled,live_auth_id ON app.users FOR EACH ROW EXECUTE FUNCTION app.banking_identity_stop();
-- All repair mutations lock connection before attempt. Terminal/selection fences
-- destroy old handoffs in that same order, so late Link cannot authorize a commit.
CREATE FUNCTION app.banking_invalidate_repairs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 UPDATE app.banking_repairs SET link_ciphertext=NULL,state='complete',result_code='CONFLICT'
 WHERE connection_id=NEW.id AND state<>'complete' AND generation<>NEW.generation;
 RETURN NEW;
END $$;
CREATE TRIGGER banking_invalidate_repairs AFTER UPDATE OF generation ON app.banking_connections
 FOR EACH ROW EXECUTE FUNCTION app.banking_invalidate_repairs();

-- Explicit deletion removes the new private delivery fingerprints in bounded
-- batches; stopped connections retain them for exact-delivery retry fencing.
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
  DELETE FROM app.banking_accounts WHERE id IN(SELECT a.id FROM app.banking_accounts a WHERE a.id=ANY(accounts)
    AND NOT EXISTS(SELECT FROM app.banking_plans p WHERE p.account_id=a.id)
    AND NOT EXISTS(SELECT FROM app.banking_bindings b WHERE b.account_id=a.id) LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  DELETE FROM app.banking_webhook_deliveries WHERE (correlation_id,delivery_digest) IN
    (SELECT d.correlation_id,d.delivery_digest FROM app.banking_webhook_deliveries d JOIN app.banking_webhook_correlations w ON w.id=d.correlation_id WHERE w.connection_id=job.connection_id LIMIT 100);
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  UPDATE app.banking_work SET progress=progress+n,updated_at=clock_timestamp() WHERE id=target;
  IF n=0 THEN UPDATE app.banking_deletion_barriers SET cleanup_state='complete' WHERE connection_id=job.connection_id; END IF;
  RETURN n;
END $$;

-- Extend the sole verified receipt acceptor. Acquire its existing enrollment ->
-- connection lock order before dispatch; only receipt digests and routing survive.
CREATE FUNCTION app.banking_accept_lifecycle_webhook(correlation uuid, expected_environment text,item text,digest bytea,delivery bytea,event_type text,event_code text,account text,revoked boolean) RETURNS boolean
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
     UPDATE app.banking_accounts SET selected=false,generation=generation+1 WHERE id=binding.account_id;
     UPDATE app.banking_bindings SET generation=generation+1 WHERE id=binding.id;
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
GRANT EXECUTE ON FUNCTION app.banking_accept_lifecycle_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean) TO kami_api;
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
  IF connection.state <> 'active' OR NOT EXISTS(SELECT FROM app.banking_accounts a WHERE a.id=binding.account_id AND a.selected) OR connection.generation <> expected_generation
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
    INSERT INTO app.banking_sources VALUES(proposed,actor,target,provider_id,next_revision);
    existing.id := proposed;
  ELSE
    UPDATE app.banking_sources SET revision=next_revision WHERE id=existing.id;
  END IF;
  INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage)
    VALUES(existing.id,actor,next_revision,minor::bigint,currency,bank_date,processing,mapping,'current');
  RETURN QUERY SELECT 'READY'::text,existing.id;
END $$;


CREATE FUNCTION app.banking_repair_needed(target uuid,expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM app.lock_banking_owner();
 UPDATE app.banking_connections SET health='repair_required' WHERE id=target AND owner_id=app.banking_owner() AND state='active' AND generation=expected;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_repair_needed(uuid,bigint) TO kami_api;
CREATE OR REPLACE FUNCTION app.banking_reconcile() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections; n integer:=0;
BEGIN
  -- Cleanup remains authorized for disabled owners, while collection never does.
  FOR c IN SELECT connection.* FROM app.banking_connections connection JOIN app.users u ON u.id=connection.owner_id
    WHERE connection.state='active' AND (NOT u.enabled OR u.live_auth_id IS DISTINCT FROM u.auth_subject) ORDER BY connection.id LIMIT 100 FOR UPDATE OF connection SKIP LOCKED LOOP
    UPDATE app.banking_connections SET state='stopped',generation=generation+1 WHERE id=c.id;
    UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=c.id;
    PERFORM app.banking_enqueue(c.id,c.generation+1,'teardown'); n:=n+1;
  END LOOP;
  FOR c IN SELECT connection.* FROM app.banking_connections connection WHERE state<>'active' AND NOT enrollment_pending
    AND (NOT EXISTS(SELECT FROM app.banking_work w WHERE w.connection_id=connection.id AND w.generation=connection.generation AND w.kind='teardown')
      OR (state='deleted' AND NOT EXISTS(SELECT FROM app.banking_work w WHERE w.connection_id=connection.id AND w.generation=connection.generation AND w.kind='purge')))
    ORDER BY id LIMIT 100 LOOP
    IF c.state='deleted' THEN PERFORM app.banking_prepare_deletion(c.id); END IF;
    PERFORM app.banking_enqueue(c.id,c.generation,'teardown');
  END LOOP;
  -- Enqueue actual protected Item observations. Successful observations alone
  -- advance checked_at; local scheduling is never proof of provider consent.
  FOR c IN SELECT connection.* FROM app.banking_connections connection JOIN app.users u ON u.id=connection.owner_id
    WHERE connection.state='active' AND connection.permission_state='granted' AND u.enabled AND u.live_auth_id=u.auth_subject
      AND EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id
        WHERE b.connection_id=connection.id AND a.selected AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=b.account_id))
      AND NOT EXISTS(SELECT FROM app.banking_work w WHERE w.connection_id=connection.id AND w.generation=connection.generation AND w.kind='reconcile'
        AND (w.state<>'complete' OR w.due_at>clock_timestamp()))
    ORDER BY connection.id LIMIT 100 LOOP
    IF app.banking_enqueue(c.id,c.generation,'reconcile') IS NULL THEN
      UPDATE app.banking_work w SET state='pending',attempts=0,due_at=clock_timestamp(),message_id=(SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',w.id,'generation',w.generation)))
        WHERE w.connection_id=c.id AND w.generation=c.generation AND w.kind='reconcile' AND w.state='complete' AND w.due_at<=clock_timestamp();
    END IF;
  END LOOP;
  -- Repair lost queue transport from durable operation intent without resetting
  -- attempts or terminal state. No queue payload carries private facts.
  UPDATE app.banking_work w SET message_id=(SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',w.id,'generation',w.generation),greatest(0,ceil(extract(epoch FROM w.due_at-clock_timestamp()))::integer)))
    WHERE w.id IN(SELECT pending.id FROM app.banking_work pending WHERE pending.state IN('pending','running')
      AND (pending.lease_until IS NULL OR pending.lease_until<=clock_timestamp())
      AND NOT EXISTS(SELECT FROM pgmq.q_banking_lifecycle q WHERE q.msg_id=pending.message_id) LIMIT 100);
  FOR c IN SELECT connection.* FROM app.banking_connections connection
    WHERE EXISTS(SELECT FROM app.banking_repairs r WHERE r.connection_id=connection.id AND r.state<>'complete' AND r.expires_at<=clock_timestamp())
    ORDER BY connection.id LIMIT 100 FOR UPDATE OF connection SKIP LOCKED LOOP
    UPDATE app.banking_repairs SET state='complete',result_code='REPAIR_REQUIRED',link_ciphertext=NULL
      WHERE connection_id=c.id AND state<>'complete' AND expires_at<=clock_timestamp();
  END LOOP;
  RETURN n;
END $$;

-- Missed signed notifications are recovered by the same protected Item
-- observation worker. Only a current lease may turn positive revocation into a
-- terminal fence; transport failures merely expose actionable repair status.
CREATE FUNCTION app.banking_observation_result(target uuid,authority uuid,healthy boolean,revoked boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections; job app.banking_work;
BEGIN
 SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_work w ON w.connection_id=connection.id WHERE w.id=target FOR UPDATE OF connection;
 SELECT * INTO job FROM app.banking_work WHERE id=target FOR UPDATE;
 IF healthy IS NULL OR revoked IS NULL OR (healthy AND revoked) OR job.kind<>'reconcile' OR job.state<>'running'
   OR job.lease_token IS DISTINCT FROM authority OR job.lease_until<=clock_timestamp() OR NOT app.banking_work_authorized(target) THEN RETURN false; END IF;
 IF revoked THEN
   UPDATE app.banking_connections SET state='stopped',permission_state='revoked',generation=generation+1,health='repair_required' WHERE id=c.id;
   UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=c.id;
   PERFORM app.banking_enqueue(c.id,c.generation+1,'teardown');
   UPDATE app.banking_work SET state='complete',last_code='REVOKED',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=target;
   PERFORM pgmq.delete('banking_lifecycle',job.message_id);
 ELSE
   UPDATE app.banking_connections SET health=CASE WHEN NOT healthy THEN 'repair_required' WHEN health='accounts_available' THEN health ELSE 'healthy' END WHERE id=c.id;
 END IF;
 RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_observation_result(uuid,uuid,boolean,boolean) TO kami_worker;
RESET ROLE;
