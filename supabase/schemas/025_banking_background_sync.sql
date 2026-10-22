SET ROLE kami_migrator;

-- Keep the existing binding/generation intent and consumer for every pass. The
-- initial_sync kind is retained for compatibility; a checkpoint makes a pass
-- incremental. A notification is a hint, never a cursor or selection authority.
ALTER TABLE app.banking_work ADD COLUMN requested_version bigint NOT NULL DEFAULT 1 CHECK(requested_version>0);
ALTER TABLE app.banking_work ADD COLUMN claimed_version bigint NOT NULL DEFAULT 0;
ALTER TABLE app.banking_work ADD COLUMN completed_version bigint NOT NULL DEFAULT 0;
ALTER TABLE app.banking_work ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app.banking_work ADD CONSTRAINT banking_work_request_order CHECK(0<=completed_version AND completed_version<=claimed_version AND claimed_version<=requested_version);
UPDATE app.banking_work SET claimed_version=1,completed_version=CASE WHEN state='complete' THEN 1 ELSE 0 END,requested_at=created_at;
ALTER TABLE app.banking_webhook_receipts ADD COLUMN dispatch_state text NOT NULL DEFAULT 'unhandled' CHECK(dispatch_state IN('unhandled','dispatched','no_eligible_binding','terminal'));

CREATE OR REPLACE FUNCTION app.banking_initial_enqueue(target uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b record; operation uuid; message bigint; n integer:=0;
BEGIN
 FOR b IN SELECT stream.id,stream.generation,c.id AS connection_id,c.generation AS connection_generation,coalesce((SELECT e.created_at FROM app.banking_enrollments e WHERE e.connection_id=c.id ORDER BY e.created_at LIMIT 1),c.created_at) AS requested_at
 FROM app.banking_bindings stream JOIN app.banking_enrollment_accounts metadata ON metadata.binding_id=stream.id JOIN app.banking_connections c ON c.id=stream.connection_id
 JOIN app.banking_accounts a ON a.id=stream.account_id JOIN app.users u ON u.id=c.owner_id
 WHERE c.id=target AND c.state='active' AND c.permission_state='granted' AND NOT c.provider_removed AND NOT c.enrollment_pending
 AND u.enabled AND u.live_auth_id=u.auth_subject AND a.selected AND stream.reporting_state IN('current','staged')
 AND NOT stream.collection_stopped
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


-- Each claim snapshots durable demand under the row lock already held by the
-- queue. Retries snapshot again; their attempt/due budget is never reset by hints.
CREATE FUNCTION app.banking_sync_claim_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.kind='initial_sync' AND NEW.state='running' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
  NEW.claimed_version:=NEW.requested_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_claim_version BEFORE UPDATE ON app.banking_work FOR EACH ROW EXECUTE FUNCTION app.banking_sync_claim_version();

-- Caller must hold the connection lock, serializing hints, lifecycle transitions
-- and final batch publication. No hint can accelerate a provider retry deadline.
CREATE FUNCTION app.banking_sync_dispatch(target uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work; n integer:=0; message bigint;
BEGIN
 PERFORM app.banking_initial_enqueue(target);
 FOR job IN SELECT w.* FROM app.banking_work w WHERE w.connection_id=target AND w.kind='initial_sync'
  AND app.banking_work_authorized(w.id) ORDER BY w.id FOR UPDATE LOOP
  UPDATE app.banking_work SET requested_version=requested_version+1 WHERE id=job.id;
  IF job.state='complete' THEN
   SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',job.id,'generation',job.generation)) INTO message;
   UPDATE app.banking_work SET state='pending',attempts=0,due_at=clock_timestamp(),requested_at=clock_timestamp(),
    message_id=message,last_code='SYNC_REQUESTED',import_code='QUEUED',updated_at=clock_timestamp() WHERE id=job.id;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- Preserve enrollment recovery and all Item lifecycle routing in the sole ingress.
ALTER FUNCTION app.banking_accept_lifecycle_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean) RENAME TO banking_accept_item_webhook;
CREATE OR REPLACE FUNCTION app.banking_accept_lifecycle_webhook(correlation uuid, expected_environment text,item text,digest bytea,delivery bytea,event_type text,event_code text,account text,revoked boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c app.banking_connections; accepted boolean; dispatched integer;
BEGIN
 accepted:=app.banking_accept_item_webhook(correlation,expected_environment,item,digest,delivery,event_type,event_code,account,revoked);
 IF NOT accepted OR event_type<>'TRANSACTIONS' OR event_code<>'SYNC_UPDATES_AVAILABLE' THEN RETURN accepted; END IF;
 SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_webhook_correlations w ON w.connection_id=connection.id WHERE w.id=correlation FOR UPDATE OF connection;
 IF c.id IS NULL OR c.environment<>expected_environment OR c.provider_item_id<>item THEN RETURN accepted; END IF;
 IF c.state<>'active' OR c.permission_state<>'granted' OR c.provider_removed THEN
  UPDATE app.banking_webhook_receipts SET dispatch_state='terminal' WHERE correlation_id=correlation AND body_digest=digest;
  RETURN true;
 END IF;
 -- Plaid does not supply a semantic event ID. A newly signed identical body can
 -- describe new updates; only an exact JWS fingerprint is a duplicate delivery.
 IF octet_length(delivery)<>32 THEN RETURN false; END IF;
 INSERT INTO app.banking_webhook_deliveries VALUES(correlation,delivery) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN true; END IF;
 dispatched:=app.banking_sync_dispatch(c.id);
 UPDATE app.banking_webhook_receipts SET dispatch_state=CASE WHEN dispatched>0 THEN 'dispatched' ELSE 'no_eligible_binding' END
  WHERE correlation_id=correlation AND body_digest=digest;
 RETURN true;
END $$;

-- Completion and checkpoint publication remain one transaction. A hint committed
-- after claim is acknowledged only by a later pass. The original message is
-- deleted before its replacement is published, atomically with both watermarks.
ALTER FUNCTION app.banking_finish(uuid,uuid,boolean,integer) RENAME TO banking_finish_lifecycle;
CREATE OR REPLACE FUNCTION app.banking_finish(target uuid, authority uuid, confirmed boolean, delay_seconds integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app.banking_work; finished boolean; message bigint;
BEGIN
 PERFORM 1 FROM app.banking_connections c JOIN app.banking_work w ON w.connection_id=c.id WHERE w.id=target FOR UPDATE OF c;
 SELECT * INTO job FROM app.banking_work WHERE id=target FOR UPDATE;
 finished:=app.banking_finish_lifecycle(target,authority,confirmed,delay_seconds);
 IF NOT finished OR NOT confirmed OR job.kind<>'initial_sync' THEN RETURN finished; END IF;
 UPDATE app.banking_work SET completed_version=job.claimed_version WHERE id=target;
 IF job.requested_version>job.claimed_version THEN
  SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',job.id,'generation',job.generation)) INTO message;
  UPDATE app.banking_work SET state='pending',attempts=0,due_at=clock_timestamp(),message_id=message,
   last_code='FOLLOWUP_QUEUED',updated_at=clock_timestamp() WHERE id=target;
 END IF;
 RETURN true;
END $$;

ALTER FUNCTION app.banking_reconcile() RENAME TO banking_reconcile_initial;
CREATE OR REPLACE FUNCTION app.banking_reconcile() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate record; due_job record; n integer;
BEGIN
 n:=app.banking_reconcile_initial();
 -- A missed scheduler run catches up immediately at restart. LIMIT bounds one
 -- poll; completed work is no longer due, so successive polls make progress.
 FOR candidate IN SELECT DISTINCT c.id FROM app.banking_connections c JOIN app.banking_bindings b ON b.connection_id=c.id
 JOIN app.banking_enrollment_accounts metadata ON metadata.binding_id=b.id
 JOIN app.banking_accounts a ON a.id=b.account_id JOIN app.users u ON u.id=c.owner_id
 LEFT JOIN app.banking_work w ON w.binding_id=b.id AND w.binding_generation=b.generation AND w.generation=c.generation AND w.kind='initial_sync'
 WHERE c.state='active' AND c.permission_state='granted' AND c.health IN('healthy','accounts_available') AND NOT c.enrollment_pending AND NOT c.provider_removed
 AND u.enabled AND u.live_auth_id=u.auth_subject AND a.selected AND NOT b.collection_stopped AND b.reporting_state IN('current','staged')
 AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id)
 AND (w.id IS NULL OR (w.state='complete' AND w.due_at<=clock_timestamp()))
 ORDER BY c.id LIMIT 100 LOOP
  -- Acquire the same lifecycle lock before rechecking due work. Never reset an
  -- active retry or operator-attention budget, even if another poll raced us.
  PERFORM 1 FROM app.banking_connections WHERE id=candidate.id FOR UPDATE;
  PERFORM app.banking_initial_enqueue(candidate.id);
  FOR due_job IN SELECT w.id FROM app.banking_work w WHERE w.connection_id=candidate.id AND w.kind='initial_sync'
   AND w.state='complete' AND w.due_at<=clock_timestamp() AND app.banking_work_authorized(w.id) FOR UPDATE LOOP
   UPDATE app.banking_work w SET requested_version=requested_version+1,state='pending',attempts=0,due_at=clock_timestamp(),
    requested_at=clock_timestamp(),import_code='QUEUED',last_code='DAILY_RECONCILIATION',updated_at=clock_timestamp(),
    message_id=(SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',w.id,'generation',w.generation))) WHERE w.id=due_job.id;
   n:=n+1;
  END LOOP;
 END LOOP;
 RETURN n;
END $$;

-- Safe bounded diagnostics: age measures the outstanding request, and lag is
-- elapsed local commit time, never a bank freshness or history-coverage claim.
CREATE FUNCTION app.banking_work_diagnostics() RETURNS TABLE(operation_id uuid,kind text,state text,attempts integer,age_seconds bigint,progress bigint,import_lag_seconds bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT operation_id,kind,state,attempts,age_seconds,progress,import_lag_seconds FROM (
  SELECT w.id AS operation_id,w.kind,w.state,w.attempts,
   greatest(0,extract(epoch FROM clock_timestamp()-CASE WHEN w.kind='initial_sync' THEN w.requested_at ELSE w.created_at END))::bigint AS age_seconds,w.progress,
   CASE WHEN w.kind='initial_sync' AND app.banking_work_authorized(w.id) THEN greatest(0,extract(epoch FROM clock_timestamp()-coalesce(b.last_local_commit,w.requested_at)))::bigint ELSE 0 END AS import_lag_seconds,
   CASE WHEN w.kind='initial_sync' THEN w.requested_at ELSE w.created_at END AS requested_at
  FROM app.banking_work w LEFT JOIN app.banking_bindings b ON b.id=w.binding_id
  UNION ALL
  SELECT e.id,'enrollment_recovery',j.state,j.attempts,
   greatest(0,extract(epoch FROM clock_timestamp()-e.created_at))::bigint,cardinality(j.removed_items)::bigint,0,e.created_at
  FROM app.banking_enrollment_jobs j JOIN app.banking_enrollments e ON e.id=j.attempt_id
 ) operations ORDER BY (state='complete'),requested_at,operation_id LIMIT 100;
$$;
REVOKE ALL ON FUNCTION app.banking_initial_enqueue(uuid),app.banking_sync_claim_version(),app.banking_sync_dispatch(uuid),app.banking_accept_item_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean),app.banking_accept_lifecycle_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean),app.banking_finish_lifecycle(uuid,uuid,boolean,integer),app.banking_finish(uuid,uuid,boolean,integer),app.banking_reconcile_initial(),app.banking_reconcile(),app.banking_work_diagnostics() FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_accept_lifecycle_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean) TO kami_api;
GRANT EXECUTE ON FUNCTION app.banking_finish(uuid,uuid,boolean,integer),app.banking_reconcile(),app.banking_work_diagnostics() TO kami_worker;
RESET ROLE;
