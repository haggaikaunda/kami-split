SET ROLE kami_migrator;
ALTER TABLE app.banking_connections ADD COLUMN enrollment_pending boolean NOT NULL DEFAULT false;
CREATE TABLE app.banking_enrollments (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES app.users(id),
  environment text NOT NULL CHECK(environment IN('sandbox','production')),
  input_digest bytea NOT NULL CHECK(octet_length(input_digest)=32), key_version text NOT NULL,
  intent text NOT NULL CHECK(intent IN('different','existing')),
  state text NOT NULL CHECK(state IN('preparing','prepared','exchanging','ready','exchange_unknown','cleanup_pending','retry_allowed','needs_attention')),
  result_code text NOT NULL, user_id text NOT NULL DEFAULT '', webhook_url text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '4 hours',
  link_ciphertext bytea, public_ciphertext bytea, public_expires_at timestamptz, token_key_version text,
  prepare_claimed boolean NOT NULL DEFAULT false, force_discovery boolean NOT NULL DEFAULT false,
  preserved_item_id text NOT NULL DEFAULT '', restore_ready boolean NOT NULL DEFAULT false,
  finish_digest bytea, connection_id uuid REFERENCES app.banking_connections(id),
  cancelled boolean NOT NULL DEFAULT false, blocks_enrollment boolean NOT NULL DEFAULT true, lease_token uuid, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX banking_one_enrollment ON app.banking_enrollments(owner_id,environment)
  WHERE blocks_enrollment;
CREATE TABLE app.banking_enrollment_accounts (
  binding_id uuid PRIMARY KEY REFERENCES app.banking_bindings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL, environment text NOT NULL, institution_id text NOT NULL,
  stable_id text NOT NULL, display_name text NOT NULL, currency text NOT NULL CHECK(currency='USD'),
  requested_history_days integer NOT NULL CHECK(requested_history_days=365)
);
CREATE UNIQUE INDEX banking_exact_account ON app.banking_enrollment_accounts(owner_id,environment,institution_id,stable_id) WHERE stable_id<>'';
CREATE TABLE app.banking_enrollment_receipts (
  attempt_id uuid NOT NULL REFERENCES app.banking_enrollments(id), body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32),
  hint_item_id text NOT NULL CHECK(char_length(hint_item_id)<=256),
  received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(attempt_id,body_digest)
);
CREATE TABLE app.banking_enrollment_jobs (
  attempt_id uuid PRIMARY KEY REFERENCES app.banking_enrollments(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','complete','needs_attention')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  due_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
  hint_items text[] NOT NULL DEFAULT '{}', correlated_items text[] NOT NULL DEFAULT '{}',
  removed_items text[] NOT NULL DEFAULT '{}'
);
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['enrollments','enrollment_accounts','enrollment_jobs','enrollment_receipts'] LOOP
    EXECUTE format('ALTER TABLE app.banking_%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('REVOKE ALL ON app.banking_%I FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker',relation);
  END LOOP;
END $$;
CREATE POLICY owner_read ON app.banking_enrollments FOR SELECT TO kami_api USING(owner_id=app.banking_owner());
CREATE POLICY owner_read ON app.banking_enrollment_accounts FOR SELECT TO kami_api USING(owner_id=app.banking_owner() AND EXISTS(SELECT FROM app.banking_bindings b WHERE b.id=binding_id));
GRANT SELECT ON app.banking_enrollments,app.banking_enrollment_accounts TO kami_api;
CREATE FUNCTION app.banking_enrollment_enqueue(target uuid, delay_seconds integer DEFAULT 0) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  INSERT INTO app.banking_enrollment_jobs(attempt_id,due_at) VALUES(target,clock_timestamp()+make_interval(secs=>delay_seconds))
    ON CONFLICT(attempt_id) DO UPDATE SET state='pending',due_at=EXCLUDED.due_at
      WHERE banking_enrollment_jobs.state='complete';
END $$;
CREATE FUNCTION app.banking_enrollment_start(target uuid, env text, digest bytea, version text, selected_intent text, webhook text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); e app.banking_enrollments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||'/banking/'||env,0));
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target FOR UPDATE;
  IF FOUND THEN
    IF e.owner_id<>actor THEN RETURN 'NOT_FOUND'; END IF;
    IF e.input_digest<>digest THEN RETURN 'CONFLICT'; END IF;
    RETURN e.result_code;
  END IF;
  IF EXISTS(SELECT FROM app.banking_enrollments WHERE owner_id=actor AND environment=env AND state NOT IN('ready','retry_allowed')) THEN RETURN 'ATTEMPT_IN_PROGRESS'; END IF;
  INSERT INTO app.banking_enrollments(id,owner_id,environment,input_digest,key_version,intent,state,result_code,webhook_url)
    VALUES(target,actor,env,digest,version,selected_intent,'preparing','PREPARING',webhook);
  PERFORM app.banking_enrollment_enqueue(target,120);
  RETURN 'PREPARING';
END $$;
CREATE FUNCTION app.banking_enrollment_prepare_claim(target uuid, authority uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  PERFORM app.lock_banking_owner();
  UPDATE app.banking_enrollments SET prepare_claimed=true,lease_token=authority,lease_until=clock_timestamp()+interval '2 minutes'
    WHERE id=target AND owner_id=app.banking_owner() AND state='preparing' AND NOT prepare_claimed AND NOT cancelled
      AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND expires_at>clock_timestamp();
  RETURN FOUND;
END $$;
CREATE FUNCTION app.banking_enrollment_prepared(target uuid, authority uuid, provider_user text, token bytea, version text, expiration timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  PERFORM app.lock_banking_owner();
  UPDATE app.banking_enrollments SET user_id=provider_user WHERE id=target AND owner_id=app.banking_owner()
    AND lease_token=authority AND state='preparing' AND user_id IN('',provider_user);
  IF token IS NULL THEN RETURN FOUND; END IF;
  UPDATE app.banking_enrollments SET state='prepared',result_code='PREPARED',link_ciphertext=token,token_key_version=version,
    expires_at=least(expires_at,expiration),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE id=target AND owner_id=app.banking_owner() AND lease_token=authority AND state='preparing' AND NOT cancelled AND expires_at>clock_timestamp();
  RETURN FOUND;
END $$;
CREATE FUNCTION app.banking_enrollment_exchange_claim(target uuid, digest bytea, token bytea, version text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); e app.banking_enrollments;
BEGIN
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target AND owner_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF e.finish_digest IS NOT NULL AND e.finish_digest<>digest THEN RETURN 'CONFLICT'; END IF;
  IF e.state='prepared' AND NOT e.cancelled AND e.expires_at>clock_timestamp() THEN
    UPDATE app.banking_enrollments SET state='exchanging',result_code='EXCHANGING',finish_digest=digest,
      public_ciphertext=token,public_expires_at=least(expires_at,clock_timestamp()+interval '30 minutes'),token_key_version=version,link_ciphertext=NULL,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE id=target;
    UPDATE app.banking_enrollment_jobs SET state='pending',due_at=clock_timestamp()+interval '2 minutes' WHERE attempt_id=target;
    RETURN 'CLAIMED';
  END IF;
  RETURN e.result_code;
END $$;
CREATE FUNCTION app.banking_enrollment_exchange_saved(target uuid, item text, connection uuid, token bytea, version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); e app.banking_enrollments;
BEGIN
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target AND owner_id=actor FOR UPDATE;
  IF NOT FOUND OR e.state NOT IN('exchanging','exchange_unknown','cleanup_pending','needs_attention') OR e.connection_id IS NOT NULL THEN RETURN false; END IF;
  INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id,state,enrollment_pending)
    VALUES(connection,actor,e.environment,'plaid',item,'stopped',true);
  INSERT INTO app.banking_credentials VALUES(connection,actor,version,token);
  UPDATE app.banking_enrollments SET connection_id=connection,public_ciphertext=NULL,link_ciphertext=NULL WHERE id=target;
  RETURN true;
END $$;
CREATE FUNCTION app.banking_enrollment_activate(target uuid, accounts jsonb, institution text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); e app.banking_enrollments; connection app.banking_connections; a jsonb; account uuid; binding uuid;
BEGIN
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
  IF e.intent='existing' THEN RETURN 'REPLACEMENT_REQUIRED'; END IF;
  IF jsonb_typeof(accounts)<>'array' OR jsonb_array_length(accounts) NOT BETWEEN 1 AND 100 OR institution='' THEN RETURN 'INVALID_SELECTION'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||'/banking/'||e.environment,0));
  FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
    IF a->>'Kind' NOT IN('checking','savings','credit_card') OR a->>'Currency'<>'USD' OR coalesce(a->>'ID','')='' THEN RETURN 'INVALID_SELECTION'; END IF;
    IF coalesce(a->>'StableID','')<>'' AND EXISTS(SELECT FROM app.banking_enrollment_accounts WHERE owner_id=actor AND environment=e.environment AND institution_id=institution AND stable_id=a->>'StableID') THEN RETURN 'DUPLICATE_ACCOUNT'; END IF;
  END LOOP;
  UPDATE app.banking_connections SET state='active',permission_state='granted',enrollment_pending=false
    WHERE id=e.connection_id AND state='stopped' AND generation=1 AND deletion_generation=0 AND enrollment_pending AND NOT provider_removed;
  IF NOT FOUND THEN RETURN 'CLEANUP_PENDING'; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(accounts) LOOP
    account:=gen_random_uuid(); binding:=gen_random_uuid();
    INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES(account,actor,a->>'Kind',true);
    INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES(binding,actor,e.connection_id,account,a->>'ID');
    INSERT INTO app.banking_enrollment_accounts VALUES(binding,actor,e.environment,institution,coalesce(a->>'StableID',''),a->>'Name','USD',365);
  END LOOP;
  INSERT INTO app.banking_webhook_correlations VALUES(target,e.connection_id,1);
  UPDATE app.banking_enrollments SET state='ready',blocks_enrollment=false,result_code='AWAITING_INITIAL_IMPORT',link_ciphertext=NULL,public_ciphertext=NULL,lease_until=NULL WHERE id=target;
  UPDATE app.banking_enrollment_jobs SET state='complete' WHERE attempt_id=target;
  RETURN 'AWAITING_INITIAL_IMPORT';
END $$;
CREATE FUNCTION app.banking_enrollment_cancel(target uuid, code text DEFAULT 'CLEANUP_PENDING') RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app.lock_banking_owner(); e app.banking_enrollments;
BEGIN
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target AND owner_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF e.state IN('ready','retry_allowed') THEN RETURN e.result_code; END IF;
  UPDATE app.banking_enrollments SET force_discovery=force_discovery OR EXISTS(SELECT FROM app.banking_enrollment_receipts r JOIN app.banking_connections c ON c.id=e.connection_id WHERE r.attempt_id=e.id AND r.hint_item_id<>c.provider_item_id),cancelled=true,state='cleanup_pending',result_code=CASE WHEN code IN('DUPLICATE_ACCOUNT','REPLACEMENT_REQUIRED','INVALID_SELECTION') THEN code ELSE 'CLEANUP_PENDING' END,
    link_ciphertext=NULL,public_ciphertext=NULL WHERE id=target;
  UPDATE app.banking_enrollment_jobs SET due_at=clock_timestamp() WHERE attempt_id=target AND state='pending';
  PERFORM app.banking_enrollment_enqueue(target);
  RETURN 'CLEANUP_PENDING';
END $$;
CREATE FUNCTION app.banking_enrollment_unknown(target uuid, targets text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e app.banking_enrollments; job app.banking_enrollment_jobs; reopen boolean;
BEGIN
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target AND owner_id=app.lock_banking_owner() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO job FROM app.banking_enrollment_jobs WHERE attempt_id=target FOR UPDATE;
  -- A slow request can learn additional positive targets after a worker has
  -- completed its earlier set. Reopen only that unresolved cleanup, preserving
  -- confirmed removal evidence and the existing attention/exhaustion boundary.
  reopen:=job.state='complete' AND NOT coalesce(targets,'{}'::text[])<@job.removed_items;
  UPDATE app.banking_enrollments SET state=CASE WHEN reopen THEN 'cleanup_pending' ELSE 'exchange_unknown' END,
    result_code=CASE WHEN reopen THEN 'CLEANUP_PENDING' ELSE 'EXCHANGE_UNKNOWN' END,
    force_discovery=force_discovery OR cardinality(coalesce(targets,'{}'::text[]))>0,link_ciphertext=NULL,public_ciphertext=NULL,
    lease_until=CASE WHEN job.state='running' THEN lease_until ELSE NULL END
    WHERE id=target AND (state IN('preparing','exchanging') OR reopen);
  UPDATE app.banking_enrollment_jobs SET correlated_items=ARRAY(SELECT DISTINCT unnest(correlated_items||coalesce(targets,'{}'::text[]))),
    state=CASE WHEN reopen THEN 'pending' ELSE state END,attempts=CASE WHEN reopen THEN 0 ELSE attempts END,
    due_at=CASE WHEN state='pending' OR reopen THEN clock_timestamp() ELSE due_at END WHERE attempt_id=target;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_unknown(uuid,text[]) TO kami_api;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_start(uuid,text,bytea,text,text,text),app.banking_enrollment_prepare_claim(uuid,uuid),
  app.banking_enrollment_prepared(uuid,uuid,text,bytea,text,timestamptz),app.banking_enrollment_exchange_claim(uuid,bytea,bytea,text),
  app.banking_enrollment_exchange_saved(uuid,text,uuid,bytea,text),app.banking_enrollment_activate(uuid,jsonb,text),app.banking_enrollment_cancel(uuid,text) TO kami_api;

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
  RETURN n;
END $$;
CREATE FUNCTION app.banking_enrollment_claim() RETURNS SETOF app.banking_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j app.banking_enrollment_jobs; e app.banking_enrollments; token uuid:=gen_random_uuid();
BEGIN
  -- Application operations lock attempt then job. Preserve that order during
  -- claims, renewal and operator resume to avoid cancellation/recovery deadlocks.
  SELECT attempt.* INTO e FROM app.banking_enrollments attempt
    JOIN app.banking_enrollment_jobs job ON job.attempt_id=attempt.id JOIN app.users u ON u.id=attempt.owner_id
    WHERE job.state IN('pending','running') AND (job.due_at<=clock_timestamp() OR
      (attempt.state IN('preparing','prepared') AND (attempt.expires_at<=clock_timestamp() OR NOT u.enabled OR u.live_auth_id IS DISTINCT FROM u.auth_subject)))
      AND (job.lease_until IS NULL OR job.lease_until<=clock_timestamp())
    ORDER BY job.due_at FOR UPDATE OF attempt SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO j FROM app.banking_enrollment_jobs WHERE attempt_id=e.id AND state IN('pending','running')
    AND (lease_until IS NULL OR lease_until<=clock_timestamp()) FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF e.state='ready' OR (e.state='prepared' AND e.expires_at>clock_timestamp() AND NOT e.cancelled
      AND EXISTS(SELECT FROM app.users WHERE id=e.owner_id AND enabled AND live_auth_id=auth_subject)) THEN
    UPDATE app.banking_enrollment_jobs SET state=CASE WHEN e.state='ready' THEN 'complete' ELSE 'pending' END,due_at=e.expires_at WHERE attempt_id=e.id;
    RETURN;
  END IF;
  IF e.lease_until>clock_timestamp() THEN
    UPDATE app.banking_enrollment_jobs SET due_at=e.lease_until WHERE attempt_id=e.id; RETURN;
  END IF;
  IF j.attempts>=10 THEN
    UPDATE app.banking_enrollment_jobs SET state='needs_attention' WHERE attempt_id=e.id;
    UPDATE app.banking_enrollments SET state='needs_attention',result_code='NEEDS_ATTENTION',link_ciphertext=NULL,public_ciphertext=NULL WHERE id=e.id; RETURN;
  END IF;
  UPDATE app.banking_enrollments SET state=CASE WHEN connection_id IS NULL THEN 'exchange_unknown' ELSE 'cleanup_pending' END,
    result_code=CASE WHEN connection_id IS NULL THEN 'EXCHANGE_UNKNOWN' ELSE 'CLEANUP_PENDING' END,
    link_ciphertext=NULL,public_ciphertext=NULL,lease_token=token,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=e.id RETURNING * INTO e;
  UPDATE app.banking_enrollment_jobs SET state='running',attempts=attempts+1,lease_token=token,lease_until=e.lease_until WHERE attempt_id=e.id;
  RETURN NEXT e;
END $$;
CREATE FUNCTION app.banking_enrollment_recovery_finish(target uuid, authority uuid, confirmed_items text[], delay_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e app.banking_enrollments; j app.banking_enrollment_jobs; finished boolean:=false;
BEGIN
  SELECT * INTO e FROM app.banking_enrollments WHERE id=target FOR UPDATE;
  SELECT * INTO j FROM app.banking_enrollment_jobs WHERE attempt_id=target FOR UPDATE;
  IF j.state<>'running' OR j.lease_token IS DISTINCT FROM authority OR j.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  IF e.connection_id IS NOT NULL AND NOT e.force_discovery THEN
    UPDATE app.banking_connections SET enrollment_pending=false WHERE id=e.connection_id AND state='stopped';
    PERFORM app.banking_enqueue(e.connection_id,(SELECT generation FROM app.banking_connections WHERE id=e.connection_id),'teardown');
    SELECT provider_removed INTO finished FROM app.banking_connections WHERE id=e.connection_id;
  ELSE
    UPDATE app.banking_enrollment_jobs SET removed_items=ARRAY(SELECT DISTINCT unnest(removed_items||confirmed_items)) WHERE attempt_id=target;
    -- Tokenless removal is also positive teardown proof for a provisional
    -- known Item. Destroy its credential without touching a preserved ready Item.
    UPDATE app.banking_connections connection SET provider_removed=true,permission_state='revoked',provider_item_id=connection.id::text,enrollment_pending=false
      FROM app.banking_enrollment_jobs job WHERE connection.id=e.connection_id AND connection.state<>'active'
        AND job.attempt_id=target AND connection.provider_item_id=ANY(job.removed_items);
    DELETE FROM app.banking_credentials credential USING app.banking_connections connection
      WHERE credential.connection_id=connection.id AND connection.id=e.connection_id AND connection.provider_removed;
    SELECT cardinality(correlated_items)>0 AND correlated_items<@removed_items AND NOT EXISTS(SELECT FROM unnest(hint_items) hint WHERE hint<>e.preserved_item_id AND NOT hint=ANY(removed_items)) INTO finished FROM app.banking_enrollment_jobs WHERE attempt_id=target;
  END IF;
  UPDATE app.banking_enrollment_jobs SET state=CASE WHEN finished THEN 'complete' WHEN delay_seconds=0 OR attempts>=10 THEN 'needs_attention' ELSE 'pending' END,
    due_at=clock_timestamp()+make_interval(secs=>greatest(60,delay_seconds)),lease_token=NULL,lease_until=NULL WHERE attempt_id=target;
  UPDATE app.banking_enrollments SET blocks_enrollment=CASE WHEN finished THEN false ELSE blocks_enrollment END,state=CASE WHEN finished AND e.restore_ready AND EXISTS(SELECT FROM app.banking_connections WHERE id=e.connection_id AND state='active') THEN 'ready' WHEN finished THEN 'retry_allowed' WHEN delay_seconds=0 OR j.attempts>=10 THEN 'needs_attention' ELSE state END,
    result_code=CASE WHEN finished AND e.restore_ready AND EXISTS(SELECT FROM app.banking_connections WHERE id=e.connection_id AND state='active') THEN 'AWAITING_INITIAL_IMPORT' WHEN finished THEN 'RETRY_ALLOWED' WHEN delay_seconds=0 OR j.attempts>=10 THEN 'NEEDS_ATTENTION' ELSE result_code END,
    lease_token=NULL,lease_until=NULL WHERE id=target;
  RETURN true;
END $$;
CREATE FUNCTION app.banking_enrollment_targets(target uuid, authority uuid, items text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  UPDATE app.banking_enrollment_jobs SET correlated_items=ARRAY(SELECT DISTINCT unnest(correlated_items||items))
    WHERE attempt_id=target AND lease_token=authority AND state='running' AND lease_until>clock_timestamp(); RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_targets(uuid,uuid,text[]) TO kami_worker;
CREATE FUNCTION app.banking_enrollment_attempts(target uuid, authority uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT attempts FROM app.banking_enrollment_jobs WHERE attempt_id=target AND lease_token=authority AND state='running' AND lease_until>clock_timestamp(); $$;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_attempts(uuid,uuid) TO kami_worker;
CREATE FUNCTION app.banking_enrollment_renew(target uuid, authority uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  PERFORM 1 FROM app.banking_enrollments WHERE id=target FOR UPDATE;
  UPDATE app.banking_enrollment_jobs SET lease_until=clock_timestamp()+interval '2 minutes'
    WHERE attempt_id=target AND lease_token=authority AND state='running' AND lease_until>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE app.banking_enrollments SET lease_until=clock_timestamp()+interval '2 minutes' WHERE id=target AND lease_token=authority;
  RETURN true;
END $$;
CREATE FUNCTION app.banking_enrollment_resume(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  PERFORM 1 FROM app.banking_enrollments WHERE id=target FOR UPDATE;
  UPDATE app.banking_enrollment_jobs SET state='pending',attempts=0,due_at=clock_timestamp(),lease_until=NULL,lease_token=NULL
    WHERE attempt_id=target AND state='needs_attention'; IF NOT FOUND THEN RETURN false; END IF;
  UPDATE app.banking_enrollments SET state='cleanup_pending',result_code='CLEANUP_PENDING' WHERE id=target AND state='needs_attention';
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_renew(uuid,uuid) TO kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_enrollment_claim(),app.banking_enrollment_recovery_finish(uuid,uuid,text[],integer) TO kami_worker;
-- Keep one verifier. A signed event is a wake-up hint; discovery must still
-- establish exact user and attempt URL correlation before removal or activation.
CREATE OR REPLACE FUNCTION app.banking_accept_webhook(correlation uuid, expected_environment text, item text, digest bytea, event_type text, event_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e app.banking_enrollments; c app.banking_connections; version bigint; has_enrollment boolean;
BEGIN
  -- Enrollment and recovery consistently acquire attempt before connection.
  SELECT * INTO e FROM app.banking_enrollments WHERE id=correlation AND environment=expected_environment FOR UPDATE;
  has_enrollment:=FOUND;
  SELECT connection.* INTO c FROM app.banking_connections connection JOIN app.banking_webhook_correlations w ON w.connection_id=connection.id WHERE w.id=correlation FOR SHARE OF connection;
  IF FOUND THEN
    IF c.environment<>expected_environment OR octet_length(digest)<>32 THEN RETURN false; END IF;
    IF c.provider_item_id=item THEN
      SELECT generation INTO version FROM app.banking_webhook_correlations WHERE id=correlation;
      INSERT INTO app.banking_webhook_receipts(correlation_id,body_digest,generation,state,event_type,event_code)
        VALUES(correlation,digest,version,CASE WHEN c.generation=version AND c.state='active' THEN 'accepted' ELSE 'terminal' END,event_type,event_code) ON CONFLICT DO NOTHING;
      RETURN true;
    END IF;
  END IF;
  IF NOT has_enrollment OR octet_length(digest)<>32 OR char_length(item) NOT BETWEEN 1 AND 256 THEN RETURN false; END IF;
  INSERT INTO app.banking_enrollment_receipts(attempt_id,body_digest,hint_item_id) VALUES(e.id,digest,item) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN true; END IF;
  IF e.state IN('ready','retry_allowed') THEN
    UPDATE app.banking_enrollments SET state='cleanup_pending',result_code='CLEANUP_PENDING',force_discovery=true,
      preserved_item_id=CASE WHEN c.state='active' THEN c.provider_item_id ELSE '' END,restore_ready=coalesce(c.state='active',false) WHERE id=e.id;
    INSERT INTO app.banking_enrollment_jobs(attempt_id,state,hint_items) VALUES(e.id,'pending',ARRAY[item])
      ON CONFLICT(attempt_id) DO UPDATE SET state='pending',due_at=clock_timestamp(),attempts=0,lease_until=NULL,lease_token=NULL,
        correlated_items='{}',removed_items='{}',hint_items=ARRAY[item];
  ELSE
    -- A hint is not removal authority. Retain it until discovery positively
    -- correlates it; this also fences callbacks racing an in-flight cleanup.
    UPDATE app.banking_enrollment_jobs SET hint_items=ARRAY(SELECT DISTINCT unnest(hint_items||ARRAY[item])) WHERE attempt_id=e.id;
    UPDATE app.banking_enrollments SET force_discovery=force_discovery OR
      (connection_id IS NOT NULL AND item IS DISTINCT FROM (SELECT provider_item_id FROM app.banking_connections WHERE id=connection_id)) WHERE id=e.id;
  END IF;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.banking_accept_webhook(uuid,text,text,bytea,text,text) TO kami_api;
CREATE OR REPLACE FUNCTION app.banking_work_status() RETURNS TABLE(operation_id uuid,kind text,state text,attempts integer,age_seconds bigint,progress bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT operation_id,kind,state,attempts,age_seconds,progress FROM (
    SELECT id AS operation_id,kind,state,attempts,greatest(0,extract(epoch FROM clock_timestamp()-created_at)::bigint) AS age_seconds,progress,created_at FROM app.banking_work
    UNION ALL
    SELECT e.id,'enrollment_recovery',j.state,j.attempts,greatest(0,extract(epoch FROM clock_timestamp()-e.created_at)::bigint),cardinality(j.removed_items)::bigint,e.created_at
      FROM app.banking_enrollment_jobs j JOIN app.banking_enrollments e ON e.id=j.attempt_id
  ) operations ORDER BY (state='complete'),created_at LIMIT 100;
$$;
RESET ROLE;
