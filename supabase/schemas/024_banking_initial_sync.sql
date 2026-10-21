SET ROLE kami_migrator;

-- A binding generation owns its first-import budget independently of siblings.
ALTER TABLE app.banking_work DROP CONSTRAINT banking_work_kind_check;
ALTER TABLE app.banking_work ADD CONSTRAINT banking_work_kind_check CHECK(kind IN('teardown','purge','reconcile','initial_sync'));
ALTER TABLE app.banking_work ADD COLUMN binding_id uuid;
ALTER TABLE app.banking_work ADD COLUMN binding_generation bigint;
ALTER TABLE app.banking_work ADD CONSTRAINT banking_work_sync_scope CHECK((kind='initial_sync')=(binding_id IS NOT NULL AND binding_generation IS NOT NULL));
ALTER TABLE app.banking_work DROP CONSTRAINT banking_work_connection_id_generation_kind_key;
CREATE UNIQUE INDEX banking_work_lifecycle_identity ON app.banking_work(connection_id,generation,kind) WHERE kind<>'initial_sync';
CREATE UNIQUE INDEX banking_work_import_identity ON app.banking_work(binding_id,binding_generation,generation) WHERE kind='initial_sync';
ALTER TABLE app.banking_work ADD COLUMN requested_days integer CHECK(requested_days=365);
ALTER TABLE app.banking_work ADD COLUMN requested_after date;
ALTER TABLE app.banking_work ADD COLUMN requested_through date;
ALTER TABLE app.banking_work ADD COLUMN import_code text;
-- Availability is not inferred from row extrema or a successful empty batch.
ALTER TABLE app.banking_bindings ADD COLUMN history_availability text NOT NULL DEFAULT 'unknown' CHECK(history_availability IN('unknown','provider_reported'));
ALTER TABLE app.banking_bindings ADD COLUMN provider_historical_update_at timestamptz;

CREATE OR REPLACE FUNCTION app.banking_enqueue(target uuid, version bigint, operation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE work_id uuid; message bigint;
BEGIN
 INSERT INTO app.banking_work(connection_id,generation,kind) VALUES(target,version,operation)
 ON CONFLICT DO NOTHING RETURNING id INTO work_id;
 IF work_id IS NOT NULL THEN
  SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',work_id,'generation',version)) INTO message;
  UPDATE app.banking_work SET message_id=message WHERE id=work_id;
 END IF;
 RETURN work_id;
END $$;

CREATE FUNCTION app.banking_initial_enqueue(target uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b record; operation uuid; message bigint; n integer:=0;
BEGIN
 FOR b IN SELECT stream.id,stream.generation,c.id AS connection_id,c.generation AS connection_generation,coalesce((SELECT e.created_at FROM app.banking_enrollments e WHERE e.connection_id=c.id ORDER BY e.created_at LIMIT 1),c.created_at) AS requested_at
 FROM app.banking_bindings stream JOIN app.banking_enrollment_accounts metadata ON metadata.binding_id=stream.id JOIN app.banking_connections c ON c.id=stream.connection_id
 JOIN app.banking_accounts a ON a.id=stream.account_id JOIN app.users u ON u.id=c.owner_id
 WHERE c.id=target AND c.state='active' AND c.permission_state='granted' AND NOT c.provider_removed AND NOT c.enrollment_pending
 AND u.enabled AND u.live_auth_id=u.auth_subject AND a.selected AND stream.reporting_state IN('current','staged')
 AND NOT stream.collection_stopped AND stream.sync_cursor IS NULL
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id)
 ORDER BY stream.id LOOP
  INSERT INTO app.banking_work(connection_id,generation,kind,binding_id,binding_generation,requested_days,requested_after,requested_through,import_code)
  VALUES(b.connection_id,b.connection_generation,'initial_sync',b.id,b.generation,365,(b.requested_at AT TIME ZONE 'UTC')::date-365,(b.requested_at AT TIME ZONE 'UTC')::date,'QUEUED')
  ON CONFLICT DO NOTHING RETURNING id INTO operation;
  IF operation IS NOT NULL THEN
   SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',operation,'generation',b.connection_generation)) INTO message;
   UPDATE app.banking_work SET message_id=message WHERE id=operation;
   n:=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;

-- Deferred execution sees the final selected subset after enrollment has saved
-- bindings. Intent and transport commit or roll back with that transition.
CREATE FUNCTION app.banking_initial_handoff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM app.banking_initial_enqueue(NEW.id);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER initial_import_handoff AFTER INSERT OR UPDATE ON app.banking_connections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.banking_initial_handoff();

ALTER FUNCTION app.banking_reconcile() RENAME TO banking_reconcile_lifecycle;
CREATE OR REPLACE FUNCTION app.banking_reconcile() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate record; n integer;
BEGIN
 n:=app.banking_reconcile_lifecycle();
 FOR candidate IN SELECT DISTINCT b.connection_id FROM app.banking_bindings b
 JOIN app.banking_enrollment_accounts metadata ON metadata.binding_id=b.id
 JOIN app.banking_connections c ON c.id=b.connection_id JOIN app.banking_accounts a ON a.id=b.account_id
 JOIN app.users u ON u.id=c.owner_id
 WHERE b.sync_cursor IS NULL AND c.state='active' AND c.permission_state='granted' AND NOT c.enrollment_pending AND NOT c.provider_removed
 AND a.selected AND NOT b.collection_stopped AND b.reporting_state IN('current','staged') AND u.enabled AND u.live_auth_id=u.auth_subject
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id)
 AND NOT EXISTS(SELECT FROM app.banking_work w WHERE w.binding_id=b.id AND w.binding_generation=b.generation AND w.generation=c.generation AND w.kind='initial_sync')
 ORDER BY b.connection_id LIMIT 100 LOOP
  n:=n+app.banking_initial_enqueue(candidate.connection_id);
 END LOOP;
 RETURN n;
END $$;

ALTER FUNCTION app.banking_work_authorized(uuid) RENAME TO banking_lifecycle_authorized;
CREATE OR REPLACE FUNCTION app.banking_work_authorized(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT app.banking_lifecycle_authorized(target) OR EXISTS(
 SELECT FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id
 JOIN app.users u ON u.id=c.owner_id JOIN app.banking_bindings b ON b.id=w.binding_id
 JOIN app.banking_accounts a ON a.id=b.account_id
 WHERE w.id=target AND w.kind='initial_sync' AND c.generation=w.generation AND b.generation=w.binding_generation AND b.connection_id=c.id
 AND c.state='active' AND c.permission_state='granted' AND NOT c.provider_removed AND NOT c.enrollment_pending
 AND u.enabled AND u.live_auth_id=u.auth_subject AND a.selected AND NOT b.collection_stopped AND b.reporting_state IN('current','staged')
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id));
$$;

CREATE OR REPLACE FUNCTION app.banking_sync_authorized(work uuid, token uuid, target uuid) RETURNS boolean
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
 RETURN job.connection_id=connection.id AND (job.kind='reconcile' OR (job.kind='initial_sync' AND job.binding_id=binding.id AND job.binding_generation=binding.generation)) AND job.state='running'
  AND job.lease_token=token AND job.lease_until>clock_timestamp() AND job.generation=connection.generation
  AND connection.state='active' AND connection.permission_state='granted' AND NOT connection.provider_removed AND NOT connection.enrollment_pending
  AND account.selected AND binding.reporting_state IN('current','staged') AND NOT binding.collection_stopped
  AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=account.id)
  AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=connection.id);
END $$;

CREATE FUNCTION app.banking_initial_credential(work uuid, token uuid)
RETURNS TABLE(owner_id uuid,connection_id uuid,environment text,provider_item_id text,key_version text,ciphertext bytea,removed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid;
BEGIN
 SELECT binding_id INTO target FROM app.banking_work WHERE id=work AND kind='initial_sync';
 IF NOT coalesce(app.banking_sync_authorized(work,token,target),false) THEN RETURN; END IF;
 RETURN QUERY SELECT c.owner_id,c.id,c.environment,c.provider_item_id,k.key_version,k.ciphertext,c.provider_removed
 FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id JOIN app.banking_credentials k ON k.connection_id=c.id WHERE w.id=work;
END $$;

CREATE FUNCTION app.banking_initial_target(work uuid, token uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT w.binding_id FROM app.banking_work w WHERE w.id=work AND w.kind='initial_sync' AND w.lease_token=token AND w.state='running' AND w.lease_until>clock_timestamp() AND app.banking_work_authorized(work);
$$;

CREATE FUNCTION app.banking_initial_outcome(work uuid, token uuid, code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF code NOT IN('AWAITING_PROVIDER_HISTORY','RETRYABLE','PAGINATION_RESTART','REPAIR_REQUIRED','INVALID_DATA','RUNNING') THEN RETURN false; END IF;
 UPDATE app.banking_work SET import_code=code WHERE id=work AND kind='initial_sync' AND lease_token=token AND state='running' AND lease_until>clock_timestamp() AND app.banking_work_authorized(work);
 RETURN FOUND;
END $$;

-- Completion is in the same transaction as the source/checkpoint publication.
-- A crash or lost acknowledgement can never import the same first batch twice.
ALTER FUNCTION app.banking_sync_commit(uuid,uuid,uuid) RENAME TO banking_sync_commit_batch;
CREATE OR REPLACE FUNCTION app.banking_sync_commit(work uuid, token uuid, batch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE outcome jsonb; historical boolean;
BEGIN
 SELECT EXISTS(SELECT FROM app.banking_sync_pages WHERE batch_id=batch AND payload->>'update_status'='HISTORICAL_UPDATE_COMPLETE') INTO historical;
 outcome:=app.banking_sync_commit_batch(work,token,batch);
 IF outcome->>'code'='READY' AND historical THEN
  UPDATE app.banking_bindings SET provider_historical_update_at=coalesce(provider_historical_update_at,clock_timestamp()) WHERE id=(outcome->>'binding_id')::uuid;
 END IF;
 IF outcome->>'code'='READY' AND EXISTS(SELECT FROM app.banking_work WHERE id=work AND kind='initial_sync') THEN
  IF NOT app.banking_finish(work,token,true,0) THEN RAISE EXCEPTION 'sync authority expired' USING ERRCODE='42501'; END IF;
  UPDATE app.banking_work SET import_code='LOCAL_BATCH_COMMITTED' WHERE id=work;
 END IF;
 RETURN outcome;
END $$;

REVOKE ALL ON FUNCTION app.banking_reconcile_lifecycle(),app.banking_lifecycle_authorized(uuid),app.banking_initial_enqueue(uuid),app.banking_initial_handoff(),app.banking_sync_commit_batch(uuid,uuid,uuid),app.banking_initial_credential(uuid,uuid),app.banking_initial_target(uuid,uuid),app.banking_initial_outcome(uuid,uuid,text),app.banking_reconcile(),app.banking_work_authorized(uuid),app.banking_sync_commit(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_reconcile(),app.banking_initial_credential(uuid,uuid),app.banking_initial_target(uuid,uuid),app.banking_initial_outcome(uuid,uuid,text),app.banking_sync_commit(uuid,uuid,uuid) TO kami_worker;
-- Recover already selected eligible bindings during migration as well as polling.
SELECT app.banking_initial_enqueue(id) FROM app.banking_connections WHERE state='active';
RESET ROLE;
