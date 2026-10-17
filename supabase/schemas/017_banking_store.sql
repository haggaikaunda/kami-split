SET ROLE kami_migrator;

-- Banking ownership is independent of every shared group and membership.
CREATE FUNCTION app.banking_owner() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT id FROM app.users WHERE auth_subject = app.verified_subject()
    AND live_auth_id = auth_subject AND enabled;
$$;
CREATE FUNCTION app.lock_banking_owner() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = '25000';
  END IF;
  SELECT id INTO actor FROM app.users WHERE auth_subject = app.verified_subject()
    AND live_auth_id = auth_subject AND enabled FOR SHARE;
  IF actor IS NULL THEN RAISE EXCEPTION 'access denied' USING ERRCODE = '42501'; END IF;
  RETURN actor;
END $$;

CREATE TABLE app.banking_connections (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users(id),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  provider text NOT NULL CHECK (provider = 'plaid'),
  provider_item_id text NOT NULL CHECK (char_length(provider_item_id) BETWEEN 1 AND 256),
  permission_state text NOT NULL DEFAULT 'unknown' CHECK (permission_state IN ('unknown','granted','revoked')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','stopped','deleted')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  deletion_generation bigint NOT NULL DEFAULT 0 CHECK (deletion_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  UNIQUE (owner_id, environment, provider, provider_item_id)
);
CREATE TABLE app.banking_credentials (
  connection_id uuid PRIMARY KEY REFERENCES app.banking_connections(id),
  owner_id uuid NOT NULL,
  key_version text NOT NULL CHECK (key_version <> ''),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) >= 28),
  FOREIGN KEY (connection_id,owner_id) REFERENCES app.banking_connections(id,owner_id)
);
CREATE TABLE app.banking_accounts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users(id),
  kind text NOT NULL CHECK (kind IN ('checking','savings','credit_card')),
  selected boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  UNIQUE (id,owner_id)
);
CREATE TABLE app.banking_bindings (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  account_id uuid NOT NULL,
  provider_account_id text NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 256),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  sync_cursor text,
  staged_batch_id uuid,
  UNIQUE (id,owner_id),
  UNIQUE (connection_id,provider_account_id),
  FOREIGN KEY (connection_id,owner_id) REFERENCES app.banking_connections(id,owner_id),
  FOREIGN KEY (account_id,owner_id) REFERENCES app.banking_accounts(id,owner_id)
);
CREATE TABLE app.banking_sources (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  provider_transaction_id text NOT NULL CHECK (char_length(provider_transaction_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK (revision > 0),
  UNIQUE (binding_id,provider_transaction_id),
  UNIQUE (id,owner_id),
  FOREIGN KEY (binding_id,owner_id) REFERENCES app.banking_bindings(id,owner_id)
);
CREATE TABLE app.banking_source_revisions (
  source_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  amount_minor bigint NOT NULL,
  currency text NOT NULL CHECK (currency = 'USD'),
  bank_date date NOT NULL CHECK (bank_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  authorization_date date CHECK (authorization_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  processing_state text NOT NULL CHECK (processing_state IN ('pending','posted','removed')),
  provider_category text,
  provider_confidence text,
  provider_code text,
  mapping_version text NOT NULL CHECK (mapping_version <> ''),
  stage text NOT NULL CHECK (stage IN ('current','staged')),
  batch_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id,revision),
  UNIQUE (source_id,revision,owner_id),
  FOREIGN KEY (source_id,owner_id) REFERENCES app.banking_sources(id,owner_id),
  CHECK ((stage = 'staged') = (batch_id IS NOT NULL))
);
ALTER TABLE app.banking_sources ADD CONSTRAINT banking_current_revision
  FOREIGN KEY (id,revision,owner_id) REFERENCES app.banking_source_revisions(source_id,revision,owner_id) DEFERRABLE INITIALLY DEFERRED;
-- Source facts and annotation versions have separate identities and provenance.
CREATE TABLE app.banking_annotations (
  source_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  material_source_revision bigint NOT NULL,
  category text,
  activity text,
  note text CHECK (char_length(note) <= 2000),
  excluded boolean NOT NULL DEFAULT false,
  reviewed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_id,revision),
  UNIQUE (source_id,revision,owner_id),
  FOREIGN KEY (source_id,material_source_revision,owner_id)
    REFERENCES app.banking_source_revisions(source_id,revision,owner_id)
);
CREATE TABLE app.banking_plans (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  account_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  predecessor_id uuid,
  UNIQUE (id,owner_id),
  UNIQUE (account_id,revision),
  FOREIGN KEY (account_id,owner_id) REFERENCES app.banking_accounts(id,owner_id),
  FOREIGN KEY (predecessor_id,owner_id) REFERENCES app.banking_plans(id,owner_id)
);
CREATE TABLE app.banking_plan_intervals (
  plan_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  after_date date,
  through_date date,
  PRIMARY KEY (plan_id,binding_id),
  FOREIGN KEY (plan_id,owner_id) REFERENCES app.banking_plans(id,owner_id),
  FOREIGN KEY (binding_id,owner_id) REFERENCES app.banking_bindings(id,owner_id),
  CHECK (after_date IS NULL OR through_date IS NULL OR after_date < through_date),
  CHECK (after_date IS NULL OR after_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  CHECK (through_date IS NULL OR through_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
);
CREATE TABLE app.banking_plan_sources (
  plan_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_revision bigint NOT NULL,
  PRIMARY KEY (plan_id,source_id),
  FOREIGN KEY (plan_id,owner_id) REFERENCES app.banking_plans(id,owner_id),
  FOREIGN KEY (source_id,source_revision,owner_id) REFERENCES app.banking_source_revisions(source_id,revision,owner_id)
);
CREATE TABLE app.banking_archives (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  boundary_date date NOT NULL CHECK (boundary_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  UNIQUE (id,owner_id),
  FOREIGN KEY (plan_id,owner_id) REFERENCES app.banking_plans(id,owner_id)
);
CREATE TABLE app.banking_captures (
  archive_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_revision bigint NOT NULL,
  annotation_revision bigint,
  PRIMARY KEY (archive_id,source_id),
  FOREIGN KEY (archive_id,owner_id) REFERENCES app.banking_archives(id,owner_id),
  FOREIGN KEY (source_id,source_revision,owner_id) REFERENCES app.banking_source_revisions(source_id,revision,owner_id),
  FOREIGN KEY (source_id,annotation_revision,owner_id) REFERENCES app.banking_annotations(source_id,revision,owner_id)
);
-- Receipts retain only authenticated digests and opaque identifiers, never tokens,
-- source facts or annotations. They remain safe after private history is hidden.
CREATE TABLE app.banking_operations (
  owner_id uuid NOT NULL REFERENCES app.users(id),
  attempt_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create_connection','record_source','stop','delete_history')),
  input_digest bytea NOT NULL CHECK (octet_length(input_digest) = 32),
  key_version text NOT NULL CHECK (key_version <> ''),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','complete')),
  result_code text,
  result_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,attempt_id),
  CHECK ((state = 'complete') = (result_code IS NOT NULL))
);
CREATE TABLE app.banking_deletion_barriers (
  connection_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users(id),
  generation bigint NOT NULL CHECK (generation > 0),
  cleanup_state text NOT NULL DEFAULT 'pending' CHECK (cleanup_state IN ('pending','complete')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Historical snapshots are append-only; DELETE remains available to the DDL
-- owner for the later bounded purge, never to the request role.
CREATE FUNCTION app.banking_immutable_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'immutable banking snapshot' USING ERRCODE = '23514';
END $$;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['source_revisions','annotations','plans','plan_intervals','plan_sources','archives','captures'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON app.banking_%I FOR EACH ROW EXECUTE FUNCTION app.banking_immutable_snapshot()',relation);
  END LOOP;
END $$;
-- Serialize plan interval construction, enforce disjoint (after,through] dates
-- and reject mixing a sibling account's binding into an otherwise private plan.
CREATE FUNCTION app.banking_check_interval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE account uuid;
BEGIN
  SELECT p.account_id INTO account FROM app.banking_plans p WHERE p.id=NEW.plan_id AND p.owner_id=NEW.owner_id FOR UPDATE;
  IF account IS NULL OR NOT EXISTS (SELECT FROM app.banking_bindings b WHERE b.id=NEW.binding_id AND b.account_id=account AND b.owner_id=NEW.owner_id)
    OR EXISTS (SELECT FROM app.banking_plan_intervals i WHERE i.plan_id=NEW.plan_id
      AND daterange(i.after_date,i.through_date,'(]') && daterange(NEW.after_date,NEW.through_date,'(]')) THEN
    RAISE EXCEPTION 'invalid banking interval' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valid_interval BEFORE INSERT ON app.banking_plan_intervals FOR EACH ROW EXECUTE FUNCTION app.banking_check_interval();
CREATE FUNCTION app.banking_check_plan_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM app.banking_plans p JOIN app.banking_sources s ON s.id=NEW.source_id
    JOIN app.banking_bindings b ON b.id=s.binding_id
    WHERE p.id=NEW.plan_id AND p.owner_id=NEW.owner_id AND s.owner_id=NEW.owner_id AND b.account_id=p.account_id) THEN
    RAISE EXCEPTION 'invalid banking provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION app.banking_check_archive_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM app.banking_archives a JOIN app.banking_plans p ON p.id=a.plan_id
    JOIN app.banking_sources s ON s.id=NEW.source_id JOIN app.banking_bindings b ON b.id=s.binding_id
    WHERE a.id=NEW.archive_id AND a.owner_id=NEW.owner_id AND s.owner_id=NEW.owner_id AND b.account_id=p.account_id) THEN
    RAISE EXCEPTION 'invalid banking provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valid_capture BEFORE INSERT ON app.banking_plan_sources FOR EACH ROW EXECUTE FUNCTION app.banking_check_plan_capture();
CREATE TRIGGER valid_capture BEFORE INSERT ON app.banking_captures FOR EACH ROW EXECUTE FUNCTION app.banking_check_archive_capture();

CREATE FUNCTION app.banking_visible_connection(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT FROM app.banking_connections WHERE id = target
    AND owner_id = app.banking_owner() AND state <> 'deleted');
$$;
CREATE FUNCTION app.banking_visible_source(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id
    WHERE s.id=target AND s.owner_id=app.banking_owner() AND app.banking_visible_connection(b.connection_id));
$$;
-- No browser or provider-service role receives table access. Runtime writes are
-- narrowly granted below; historical fixture/plan publication is migration-owned.
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['connections','credentials','accounts','bindings','sources','source_revisions','annotations','plans','plan_intervals','plan_sources','archives','captures','operations','deletion_barriers'] LOOP
    EXECUTE format('ALTER TABLE app.banking_%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('REVOKE ALL ON app.banking_%I FROM PUBLIC,anon,authenticated,service_role,kami_api', relation);
  END LOOP;
END $$;
CREATE POLICY owner_read ON app.banking_connections FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND state <> 'deleted');
CREATE POLICY owner_read ON app.banking_accounts FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND EXISTS (SELECT FROM app.banking_bindings b WHERE b.account_id=banking_accounts.id));
CREATE POLICY owner_read ON app.banking_bindings FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_connection(connection_id));
CREATE POLICY owner_read ON app.banking_sources FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_source(id));
CREATE POLICY owner_read ON app.banking_source_revisions FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_source(source_id));
CREATE POLICY owner_read ON app.banking_annotations FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_source(source_id));
CREATE POLICY owner_read ON app.banking_plans FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND EXISTS (SELECT FROM app.banking_accounts a WHERE a.id=account_id));
CREATE POLICY owner_read ON app.banking_plan_intervals FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND EXISTS (SELECT FROM app.banking_plans p WHERE p.id=plan_id));
CREATE POLICY owner_read ON app.banking_plan_sources FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_source(source_id) AND EXISTS (SELECT FROM app.banking_plans p WHERE p.id=plan_id));
CREATE POLICY owner_read ON app.banking_archives FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND EXISTS (SELECT FROM app.banking_plans p WHERE p.id=plan_id));
CREATE POLICY owner_read ON app.banking_captures FOR SELECT TO kami_api USING (owner_id=app.banking_owner() AND app.banking_visible_source(source_id));
CREATE POLICY owner_access ON app.banking_operations TO kami_api USING (owner_id=app.banking_owner()) WITH CHECK (owner_id=app.banking_owner());
CREATE POLICY owner_read ON app.banking_deletion_barriers FOR SELECT TO kami_api USING (owner_id=app.banking_owner());
GRANT SELECT ON app.banking_connections,app.banking_accounts,app.banking_bindings,app.banking_sources,
  app.banking_source_revisions,app.banking_annotations,app.banking_plans,app.banking_plan_intervals,
  app.banking_plan_sources,app.banking_archives,app.banking_captures,app.banking_operations,app.banking_deletion_barriers TO kami_api;
GRANT INSERT ON app.banking_operations TO kami_api;
GRANT UPDATE (state,result_code,result_id) ON app.banking_operations TO kami_api;

CREATE FUNCTION app.banking_create_connection(target uuid, target_environment text, item text, version text, protected bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := app.lock_banking_owner();
BEGIN
  INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id)
    VALUES(target,actor,target_environment,'plaid',item)
    ON CONFLICT (owner_id,environment,provider,provider_item_id) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO app.banking_credentials VALUES(target,actor,version,protected);
  RETURN target;
END $$;
CREATE FUNCTION app.banking_credential(target uuid)
RETURNS TABLE(environment text,key_version text,ciphertext bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := app.lock_banking_owner();
BEGIN
  RETURN QUERY SELECT c.environment,k.key_version,k.ciphertext FROM app.banking_connections c
    JOIN app.banking_credentials k ON k.connection_id=c.id
    WHERE c.id=target AND c.owner_id=actor AND c.state <> 'deleted';
END $$;
-- The connection row is the serialization point for every source write and fence.
CREATE FUNCTION app.banking_record_source(target uuid, proposed uuid, provider_id text,
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
    OR binding.generation <> expected_binding_generation THEN
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
CREATE FUNCTION app.banking_fence(target uuid, expected_generation bigint, erase boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := app.lock_banking_owner(); connection app.banking_connections;
BEGIN
  SELECT c.* INTO connection FROM app.banking_connections c WHERE c.id=target AND c.owner_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF connection.generation <> expected_generation OR connection.state='deleted' THEN RETURN 'CONFLICT'; END IF;
  UPDATE app.banking_connections SET generation=generation+1,
    state=CASE WHEN erase THEN 'deleted' ELSE 'stopped' END,
    deletion_generation=deletion_generation+CASE WHEN erase THEN 1 ELSE 0 END WHERE id=target;
  UPDATE app.banking_bindings SET generation=generation+1 WHERE connection_id=target;
  IF erase THEN
    INSERT INTO app.banking_deletion_barriers(connection_id,owner_id,generation)
      VALUES(target,actor,connection.deletion_generation+1);
  END IF;
  RETURN 'READY';
END $$;
GRANT EXECUTE ON FUNCTION app.banking_owner(),app.lock_banking_owner(),app.banking_visible_connection(uuid),app.banking_visible_source(uuid),
  app.banking_create_connection(uuid,text,text,text,bytea),app.banking_credential(uuid),
  app.banking_record_source(uuid,uuid,text,bigint,bigint,bigint,text,text,date,text,text),app.banking_fence(uuid,bigint,boolean) TO kami_api;
RESET ROLE;
