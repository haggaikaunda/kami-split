-- Supabase Queues is private; runtime roles can use only the banking wrappers.
CREATE EXTENSION IF NOT EXISTS pgmq;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='kami_worker') THEN
    CREATE ROLE kami_worker LOGIN NOINHERIT;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='kami_worker' AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'unsafe worker role';
  END IF;
END $$;
REVOKE kami_migrator FROM kami_worker;
SELECT pgmq.create('banking_lifecycle');
REVOKE ALL ON SCHEMA pgmq FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
GRANT USAGE ON SCHEMA pgmq TO kami_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO kami_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO kami_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO kami_migrator;
SET ROLE kami_migrator;
GRANT USAGE ON SCHEMA app TO kami_worker;

-- Account barriers hide every historical binding of a logical account, including
-- replacement bindings on another Item. No expiry can permit resurrection.
ALTER TABLE app.banking_connections ADD COLUMN provider_removed boolean NOT NULL DEFAULT false;
CREATE TABLE app.banking_account_barriers (
  account_id uuid PRIMARY KEY, owner_id uuid NOT NULL,
  connection_id uuid NOT NULL, generation bigint NOT NULL CHECK(generation>0)
);
CREATE TABLE app.banking_deletion_accounts (
  connection_id uuid NOT NULL, account_id uuid NOT NULL,
  PRIMARY KEY(connection_id,account_id)
);
CREATE TABLE app.banking_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES app.banking_connections(id),
  generation bigint NOT NULL CHECK(generation>0),
  kind text NOT NULL CHECK(kind IN ('teardown','purge','reconcile')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','complete','needs_attention')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, lease_token uuid, message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  progress bigint NOT NULL DEFAULT 0, last_code text,
  UNIQUE(connection_id,generation,kind)
);
CREATE TABLE app.banking_webhook_correlations (
  id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES app.banking_connections(id),
  generation bigint NOT NULL CHECK(generation>0)
);
CREATE TABLE app.banking_webhook_receipts (
  correlation_id uuid NOT NULL REFERENCES app.banking_webhook_correlations(id),
  body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32),
  generation bigint NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK(state IN ('accepted','terminal')),
  event_type text NOT NULL CHECK(event_type ~ '^[A-Z_]{1,80}$'),
  event_code text NOT NULL CHECK(event_code ~ '^[A-Z_]{1,80}$'),
  PRIMARY KEY(correlation_id,body_digest)
);
-- The foundation records notification intent without claiming dispatch. Later
-- lifecycle/sync handlers consume accepted receipts and extend the same verifier.
CREATE TABLE app.banking_reconciliation (
  binding_id uuid PRIMARY KEY REFERENCES app.banking_bindings(id) ON DELETE CASCADE,
  generation bigint NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK(state IN('healthy','attention'))
);
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['account_barriers','deletion_accounts','work','webhook_correlations','webhook_receipts','reconciliation'] LOOP
    EXECUTE format('ALTER TABLE app.banking_%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('REVOKE ALL ON app.banking_%I FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker',relation);
  END LOOP;
END $$;
-- During bounded purge, the hidden source shell no longer references its current
-- revision. Readers and writers are already blocked by the permanent barrier.
ALTER TABLE app.banking_sources ALTER COLUMN revision DROP NOT NULL;

CREATE OR REPLACE FUNCTION app.banking_visible_source(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id
    WHERE s.id=target AND s.owner_id=app.banking_owner()
    AND app.banking_visible_connection(b.connection_id)
    AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=b.account_id));
$$;
-- Account/plan/interval/archive reads must also disappear immediately, even when
-- an affected account has a replacement binding on a still-active sibling Item.
DROP POLICY owner_read ON app.banking_accounts;
CREATE POLICY owner_read ON app.banking_accounts FOR SELECT TO kami_api USING
  (owner_id=app.banking_owner() AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=id)
    AND EXISTS(SELECT FROM app.banking_bindings b WHERE b.account_id=banking_accounts.id));
DROP POLICY owner_read ON app.banking_bindings;
CREATE POLICY owner_read ON app.banking_bindings FOR SELECT TO kami_api USING
  (owner_id=app.banking_owner() AND app.banking_visible_connection(connection_id)
    AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=banking_bindings.account_id));
CREATE POLICY owner_read ON app.banking_account_barriers FOR SELECT TO kami_api USING(owner_id=app.banking_owner());
GRANT SELECT ON app.banking_account_barriers TO kami_api;

CREATE FUNCTION app.banking_enqueue(target uuid, version bigint, operation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE work_id uuid; message bigint;
BEGIN
  INSERT INTO app.banking_work(connection_id,generation,kind) VALUES(target,version,operation)
    ON CONFLICT(connection_id,generation,kind) DO NOTHING RETURNING id INTO work_id;
  IF work_id IS NOT NULL THEN
    SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',work_id,'generation',version)) INTO message;
    UPDATE app.banking_work SET message_id=message WHERE id=work_id;
  END IF;
  RETURN work_id;
END $$;
-- Idempotently extend an existing connection barrier to its logical-account
-- scope before any purge becomes executable. This also upgrades #328 barriers.
CREATE FUNCTION app.banking_prepare_deletion(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE connection app.banking_connections; peer app.banking_connections; affected uuid[];
BEGIN
  SELECT * INTO connection FROM app.banking_connections WHERE id=target AND state='deleted' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO app.banking_deletion_accounts(connection_id,account_id)
    SELECT DISTINCT target,account_id FROM app.banking_bindings WHERE connection_id=target ON CONFLICT DO NOTHING;
  WITH added AS (
    INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation)
      SELECT d.account_id,connection.owner_id,target,connection.deletion_generation FROM app.banking_deletion_accounts d WHERE d.connection_id=target
      ON CONFLICT(account_id) DO NOTHING RETURNING account_id
  ) SELECT array_agg(account_id) INTO affected FROM added;
  UPDATE app.banking_accounts SET selected=false,generation=generation+1 WHERE id=ANY(affected);
  UPDATE app.banking_bindings SET generation=generation+1 WHERE account_id=ANY(affected);
  PERFORM app.banking_enqueue(target,connection.generation,'purge');
  -- Historical peers that still serve selected siblings must retain access.
  FOR peer IN SELECT c.* FROM app.banking_connections c WHERE c.owner_id=connection.owner_id AND c.state='active'
    AND EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_deletion_accounts d ON d.account_id=b.account_id WHERE b.connection_id=c.id AND d.connection_id=target)
    AND NOT EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_accounts account ON account.id=b.account_id WHERE b.connection_id=c.id AND account.selected
      AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=b.account_id)) ORDER BY c.id FOR UPDATE LOOP
    UPDATE app.banking_connections SET state='stopped',generation=generation+1 WHERE id=peer.id;
    UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=peer.id;
    PERFORM app.banking_enqueue(peer.id,peer.generation+1,'teardown');
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.banking_fence(target uuid, expected_generation bigint, erase boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := app.lock_banking_owner(); connection app.banking_connections;
BEGIN
  SELECT c.* INTO connection FROM app.banking_connections c WHERE c.id=target AND c.owner_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF connection.generation<>expected_generation OR connection.state='deleted' THEN RETURN 'CONFLICT'; END IF;
  UPDATE app.banking_connections SET generation=generation+1,
    state=CASE WHEN erase THEN 'deleted' ELSE 'stopped' END,
    deletion_generation=deletion_generation+CASE WHEN erase THEN 1 ELSE 0 END WHERE id=target;
  IF erase THEN
    INSERT INTO app.banking_deletion_barriers(connection_id,owner_id,generation)
      VALUES(target,actor,connection.deletion_generation+1);
    PERFORM app.banking_prepare_deletion(target);
  ELSE
    UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=target;
  END IF;
  PERFORM app.banking_enqueue(target,connection.generation+1,'teardown');
  RETURN 'READY';
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
  IF connection.state <> 'active' OR connection.generation <> expected_generation
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

-- Enforce account barriers for both existing and future source-write primitives.
CREATE FUNCTION app.banking_guard_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.revision IS NULL AND NOT EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_account_barriers d ON d.account_id=b.account_id WHERE b.id=NEW.binding_id) THEN
    RAISE EXCEPTION 'invalid banking source shell' USING ERRCODE='23514';
  END IF;
  IF NEW.revision IS NOT NULL AND EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_account_barriers d ON d.account_id=b.account_id WHERE b.id=NEW.binding_id) THEN
    RAISE EXCEPTION 'banking deletion barrier' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_barrier BEFORE INSERT OR UPDATE ON app.banking_sources
  FOR EACH ROW EXECUTE FUNCTION app.banking_guard_source();

-- Collection observations have stricter authority than terminal cleanup.
CREATE FUNCTION app.banking_work_authorized(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id
    JOIN app.users u ON u.id=c.owner_id WHERE w.id=target AND c.generation=w.generation
    AND ((w.kind IN('teardown','purge') AND c.state<>'active') OR
      (w.kind='reconcile' AND c.state='active' AND c.permission_state='granted' AND u.enabled
       AND u.live_auth_id=u.auth_subject AND EXISTS(SELECT FROM app.banking_bindings b
         JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=c.id AND a.selected
         AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=b.account_id)))));
$$;
-- A queue visibility window is not commit authority: every mutation also checks
-- an unexpired random lease token and the current terminal generation.
CREATE FUNCTION app.banking_claim() RETURNS TABLE(id uuid,connection_id uuid,generation bigint,kind text,token uuid,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE message record; job app.banking_work; authority uuid;
BEGIN
  FOR message IN SELECT * FROM pgmq.read('banking_lifecycle',120,1) LOOP
    SELECT w.* INTO job FROM app.banking_work w WHERE w.message_id=message.msg_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pgmq.delete('banking_lifecycle',message.msg_id); CONTINUE; END IF;
    IF job.state IN('complete','needs_attention') THEN PERFORM pgmq.delete('banking_lifecycle',message.msg_id); CONTINUE; END IF;
    IF job.due_at>clock_timestamp() OR job.lease_until>clock_timestamp() THEN CONTINUE; END IF;
    IF NOT app.banking_work_authorized(job.id) THEN
      UPDATE app.banking_work w SET state='complete',last_code='SUPERSEDED',lease_token=NULL,lease_until=NULL WHERE w.id=job.id;
      PERFORM pgmq.delete('banking_lifecycle',message.msg_id); CONTINUE;
    END IF;
    IF job.attempts>=10 THEN
      UPDATE app.banking_work w SET state='needs_attention',lease_token=NULL,lease_until=NULL,last_code='EXHAUSTED' WHERE w.id=job.id;
      PERFORM pgmq.delete('banking_lifecycle',message.msg_id); CONTINUE;
    END IF;
    authority:=gen_random_uuid();
    UPDATE app.banking_work w SET state='running',attempts=w.attempts+1,lease_token=authority,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE w.id=job.id;
    RETURN QUERY SELECT job.id,job.connection_id,job.generation,job.kind,authority,job.attempts+1;
    RETURN;
  END LOOP;
END $$;
CREATE FUNCTION app.banking_renew(target uuid, authority uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work;
BEGIN
  UPDATE app.banking_work SET lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
    WHERE id=target AND lease_token=authority AND state='running' AND lease_until>clock_timestamp() AND app.banking_work_authorized(target)
    RETURNING * INTO job;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pgmq.set_vt('banking_lifecycle',job.message_id,120);
  RETURN true;
END $$;
CREATE FUNCTION app.banking_cleanup_credential(target uuid, authority uuid)
RETURNS TABLE(owner_id uuid,connection_id uuid,environment text,provider_item_id text,key_version text,ciphertext bytea,removed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.owner_id,c.id,c.environment,c.provider_item_id,coalesce(k.key_version,''),coalesce(k.ciphertext,''::bytea),c.provider_removed
    FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id
    LEFT JOIN app.banking_credentials k ON k.connection_id=c.id
    WHERE w.id=target AND w.lease_token=authority AND w.lease_until>clock_timestamp() AND w.state='running'
      AND w.kind IN('teardown','reconcile') AND app.banking_work_authorized(target);
$$;
CREATE FUNCTION app.banking_finish(target uuid, authority uuid, confirmed boolean, delay_seconds integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work; c app.banking_connections;
BEGIN
  SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_work w ON w.connection_id=connection.id WHERE w.id=target FOR UPDATE OF connection;
  SELECT * INTO job FROM app.banking_work WHERE id=target FOR UPDATE;
  IF job.lease_token IS DISTINCT FROM authority OR job.state<>'running' OR job.lease_until<=clock_timestamp()
    OR NOT app.banking_work_authorized(target) THEN RETURN false; END IF;
  IF confirmed AND job.kind='purge' AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id AND d.generation=c.deletion_generation AND d.cleanup_state='complete') THEN RETURN false; END IF;
  IF confirmed AND job.kind='teardown' THEN
    DELETE FROM app.banking_credentials WHERE connection_id=c.id;
    UPDATE app.banking_connections SET permission_state='revoked',provider_removed=true,provider_item_id=id::text WHERE id=c.id;
  END IF;
  IF confirmed AND job.kind='reconcile' THEN
    INSERT INTO app.banking_reconciliation(binding_id,generation,checked_at,state)
      SELECT b.id,b.generation,clock_timestamp(),'healthy' FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id
      WHERE b.connection_id=c.id AND a.selected AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=b.account_id)
      ON CONFLICT(binding_id) DO UPDATE SET generation=EXCLUDED.generation,checked_at=EXCLUDED.checked_at,state=EXCLUDED.state;
  END IF;
  IF NOT confirmed AND job.kind='reconcile' AND delay_seconds=0 THEN
    INSERT INTO app.banking_reconciliation(binding_id,generation,checked_at,state)
      SELECT b.id,b.generation,clock_timestamp(),'attention' FROM app.banking_bindings b WHERE b.connection_id=c.id
      ON CONFLICT(binding_id) DO UPDATE SET generation=EXCLUDED.generation,checked_at=EXCLUDED.checked_at,state=EXCLUDED.state;
  END IF;
  IF confirmed THEN
    UPDATE app.banking_work SET state='complete',lease_token=NULL,lease_until=NULL,due_at=clock_timestamp()+interval '1 day',last_code='COMPLETE',updated_at=clock_timestamp() WHERE id=target;
    PERFORM pgmq.delete('banking_lifecycle',job.message_id);
  ELSE
    IF delay_seconds<>0 AND (delay_seconds<60 OR delay_seconds>604800) THEN RAISE EXCEPTION 'invalid banking retry delay'; END IF;
    UPDATE app.banking_work SET state=CASE WHEN attempts>=10 OR delay_seconds=0 THEN 'needs_attention' ELSE 'pending' END,
      due_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,
      last_code='UNCONFIRMED',updated_at=clock_timestamp() WHERE id=target;
    IF job.attempts>=10 OR delay_seconds=0 THEN PERFORM pgmq.delete('banking_lifecycle',job.message_id);
    ELSE PERFORM pgmq.set_vt('banking_lifecycle',job.message_id,delay_seconds); END IF;
  END IF;
  RETURN true;
END $$;
-- Only the DDL/operator role can resume; workers cannot self-reset exhaustion.
CREATE FUNCTION app.banking_resume(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work; message bigint;
BEGIN
  SELECT * INTO job FROM app.banking_work WHERE id=target AND state='needs_attention' FOR UPDATE;
  IF NOT FOUND OR NOT app.banking_work_authorized(target) THEN RETURN false; END IF;
  SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',job.id,'generation',job.generation)) INTO message;
  UPDATE app.banking_work SET state='pending',attempts=0,due_at=clock_timestamp(),message_id=message,last_code='OPERATOR_RESUMED',updated_at=clock_timestamp() WHERE id=target;
  RETURN true;
END $$;
CREATE FUNCTION app.banking_purge_batch(target uuid, authority uuid) RETURNS integer
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
  UPDATE app.banking_work SET progress=progress+n,updated_at=clock_timestamp() WHERE id=target;
  IF n=0 THEN UPDATE app.banking_deletion_barriers SET cleanup_state='complete' WHERE connection_id=job.connection_id; END IF;
  RETURN n;
END $$;
CREATE FUNCTION app.banking_accept_webhook(correlation uuid, expected_environment text, item text, digest bytea, event_type text, event_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections; version bigint;
BEGIN
  SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_webhook_correlations w ON w.connection_id=connection.id
    WHERE w.id=correlation FOR SHARE OF connection;
  IF NOT FOUND OR c.environment<>expected_environment OR c.provider_item_id<>item OR octet_length(digest)<>32 THEN RETURN false; END IF;
  SELECT generation INTO version FROM app.banking_webhook_correlations WHERE id=correlation;
  INSERT INTO app.banking_webhook_receipts(correlation_id,body_digest,generation,state,event_type,event_code)
    VALUES(correlation,digest,version,CASE WHEN c.generation=version AND c.state='active' THEN 'accepted' ELSE 'terminal' END,event_type,event_code)
    ON CONFLICT DO NOTHING;
  RETURN true;
END $$;
CREATE FUNCTION app.banking_reconcile() RETURNS integer
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
  FOR c IN SELECT connection.* FROM app.banking_connections connection WHERE state<>'active'
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
  RETURN n;
END $$;
CREATE FUNCTION app.banking_work_status() RETURNS TABLE(operation_id uuid,kind text,state text,attempts integer,age_seconds bigint,progress bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT id,kind,state,attempts,greatest(0,extract(epoch FROM clock_timestamp()-created_at)::bigint),progress FROM app.banking_work ORDER BY (state='complete'),created_at LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION app.banking_claim(),app.banking_renew(uuid,uuid),app.banking_cleanup_credential(uuid,uuid),
  app.banking_finish(uuid,uuid,boolean,integer),app.banking_purge_batch(uuid,uuid),app.banking_reconcile(),app.banking_work_status() TO kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_accept_webhook(uuid,text,text,bytea,text,text) TO kami_api;
-- Existing pending storage-foundation deletions acquire the full scope and
-- queue atomically with the upgrade, before any worker or reads can observe it.
DO $$ DECLARE c app.banking_connections; BEGIN
  FOR c IN SELECT * FROM app.banking_connections WHERE state='deleted' ORDER BY id LOOP
    PERFORM app.banking_prepare_deletion(c.id);
    PERFORM app.banking_enqueue(c.id,c.generation,'teardown');
  END LOOP;
END $$;
RESET ROLE;
