-- ADR-008: one persistent serialization point, separate from ledger revisions.
SET ROLE kami_migrator;
CREATE TABLE app.household_designation_guard (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 state text NOT NULL DEFAULT 'EMPTY' CHECK(state IN ('EMPTY','PENDING','ACTIVE','SUSPENDED','ENDED','CANCELLED')),
 first_user_id uuid REFERENCES app.users(id), second_user_id uuid REFERENCES app.users(id),
 proposer_user_id uuid REFERENCES app.users(id),
 first_consented boolean NOT NULL DEFAULT false, second_consented boolean NOT NULL DEFAULT false,
 CHECK ((first_user_id IS NULL AND second_user_id IS NULL AND proposer_user_id IS NULL AND state='EMPTY') OR (state<>'EMPTY' AND first_user_id IS NOT NULL AND second_user_id IS NOT NULL AND proposer_user_id IS NOT NULL AND first_user_id<second_user_id)),
 CHECK(state<>'ACTIVE' OR (first_consented AND second_consented))
);
INSERT INTO app.household_designation_guard DEFAULT VALUES;
CREATE TABLE app.household_designation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version bigint NOT NULL, actor_user_id uuid REFERENCES app.users(id),
 event text NOT NULL, previous_state text NOT NULL, new_state text NOT NULL,
 first_user_id uuid REFERENCES app.users(id), second_user_id uuid REFERENCES app.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.household_designation_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.household_designation_audit ENABLE ROW LEVEL SECURITY;
-- Pair history belongs to the installation's original Household. Replacing the
-- pointer is not a supported lifecycle operation and must not move consent.
CREATE FUNCTION app.household_pointer_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.household_group_id<>OLD.household_group_id THEN RAISE EXCEPTION 'immutable household' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_pointer_immutable BEFORE UPDATE ON app.installation FOR EACH ROW EXECUTE FUNCTION app.household_pointer_immutable();
CREATE FUNCTION app.household_audit(actor uuid,event_name text,previous text) RETURNS void
LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO app.household_designation_audit(version,actor_user_id,event,previous_state,new_state,first_user_id,second_user_id)
 SELECT version,actor,event_name,previous,state,first_user_id,second_user_id FROM app.household_designation_guard;
$$;
-- All callers acquire user locks before entering this helper. This helper never
-- acquires users, and is not granted to the runtime role.
CREATE FUNCTION app.household_invalidate(actor uuid,owner_change boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE d app.household_designation_guard;
BEGIN
 SELECT * INTO d FROM app.household_designation_guard WHERE singleton FOR UPDATE;
 PERFORM g.id FROM app.groups g JOIN app.installation i ON i.household_group_id=g.id ORDER BY g.id FOR UPDATE OF g;
 IF (owner_change AND d.state='PENDING') OR
    (NOT owner_change AND (actor IN (d.first_user_id,d.second_user_id) OR (d.state='PENDING' AND actor=d.proposer_user_id)) AND d.state IN ('PENDING','ACTIVE','SUSPENDED')) THEN
  UPDATE app.household_designation_guard SET version=version+1,
   state=CASE WHEN d.state='PENDING' THEN 'CANCELLED' ELSE 'SUSPENDED' END,
   first_consented=false,second_consented=false WHERE singleton;
  PERFORM app.household_audit((SELECT id FROM app.users WHERE auth_subject=app.verified_subject()),CASE WHEN owner_change THEN 'OWNER_CHANGED' ELSE 'ELIGIBILITY_LOST' END,d.state);
 END IF;
END $$;
-- Administrative membership/ownership lifecycle uses this before any group
-- locks. Discovery changes force a full transaction restart, never extra locks.
CREATE FUNCTION app.household_lifecycle_lock(affected uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE discovered uuid[]; d app.household_designation_guard;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT array_remove(ARRAY[first_user_id,second_user_id,proposer_user_id]||coalesce(affected,'{}'),NULL) INTO discovered FROM app.household_designation_guard;
 PERFORM id FROM app.users WHERE id=ANY(discovered) ORDER BY id FOR SHARE;
 SELECT * INTO d FROM app.household_designation_guard WHERE singleton FOR UPDATE;
 IF NOT array_remove(ARRAY[d.first_user_id,d.second_user_id,d.proposer_user_id],NULL)<@discovered THEN
  RAISE EXCEPTION 'restart required' USING ERRCODE='40001';
 END IF;
 PERFORM g.id FROM app.groups g JOIN app.installation i ON i.household_group_id=g.id ORDER BY g.id FOR UPDATE OF g;
 PERFORM set_config('app.household_lifecycle',txid_current()::text,true);
END $$;
CREATE FUNCTION app.household_membership_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.active IS DISTINCT FROM OLD.active AND EXISTS(SELECT FROM app.installation WHERE household_group_id=NEW.group_id) THEN
  IF current_setting('app.household_lifecycle',true) IS DISTINCT FROM txid_current()::text THEN
   RAISE EXCEPTION 'lifecycle preparation required' USING ERRCODE='55000';
  END IF;
  IF NOT NEW.active THEN PERFORM app.household_invalidate(NEW.user_id,false); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_membership_transition BEFORE UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION app.household_membership_transition();
CREATE FUNCTION app.household_owner_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.owner_membership_id<>OLD.owner_membership_id AND EXISTS(SELECT FROM app.installation WHERE household_group_id=NEW.id) THEN
  IF current_setting('app.household_lifecycle',true) IS DISTINCT FROM txid_current()::text THEN
   RAISE EXCEPTION 'lifecycle preparation required' USING ERRCODE='55000';
  END IF;
  PERFORM app.household_invalidate((SELECT user_id FROM app.memberships WHERE id=NEW.owner_membership_id),true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_owner_transition BEFORE UPDATE ON app.groups FOR EACH ROW EXECUTE FUNCTION app.household_owner_transition();
-- Privileged bulk account transitions have no target-row set available to a
-- BEFORE STATEMENT trigger. Lock the finite application-user set in canonical
-- order before PostgreSQL starts locking UPDATE rows. This intentionally favors
-- correctness over concurrency for rare administrative lifecycle operations.
CREATE FUNCTION app.household_account_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE locked uuid[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 IF current_setting('app.household_account_transaction',true)=txid_current()::text THEN RETURN NULL; END IF;
 IF current_setting('app.household_lifecycle',true)=txid_current()::text THEN RAISE EXCEPTION 'account lifecycle must precede group locks' USING ERRCODE='55000'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO locked FROM (SELECT id FROM app.users ORDER BY id FOR UPDATE) users_locked;
 PERFORM set_config('app.household_account_users',locked::text,true);
 PERFORM set_config('app.household_account_transaction',txid_current()::text,true);
 RETURN NULL;
END $$;
CREATE TRIGGER household_account_lock BEFORE UPDATE OF enabled, live_auth_id ON app.users FOR EACH STATEMENT EXECUTE FUNCTION app.household_account_lock();
-- UPDATE has already locked the affected user. FK-driven managed Auth unlink
-- takes this same path; enabled users still cannot lose their required Auth link.
CREATE FUNCTION app.household_account_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (OLD.enabled AND NOT NEW.enabled) OR (OLD.live_auth_id IS NOT NULL AND NEW.live_auth_id IS NULL) THEN
  IF NOT coalesce(NEW.id=ANY(current_setting('app.household_account_users',true)::uuid[]),false) THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
  PERFORM app.household_invalidate(NEW.id,false);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_account_transition BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.household_account_transition();
CREATE FUNCTION app.household_designation(action text,expected bigint,first_id uuid,second_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; household uuid; owner_id uuid; discovered uuid[]; d app.household_designation_guard; previous text; changed boolean:=false;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject();
 IF actor IS NULL THEN RETURN jsonb_build_object('state','NOT_FOUND'); END IF;
 SELECT array_remove(ARRAY[first_user_id,second_user_id,proposer_user_id,actor,first_id,second_id],NULL) INTO discovered FROM app.household_designation_guard;
 PERFORM id FROM app.users WHERE id=ANY(discovered) ORDER BY id FOR SHARE;
 SELECT * INTO d FROM app.household_designation_guard WHERE singleton FOR UPDATE;
 IF NOT array_remove(ARRAY[d.first_user_id,d.second_user_id,d.proposer_user_id],NULL)<@discovered THEN
  RAISE EXCEPTION 'restart required' USING ERRCODE='40001';
 END IF;
 SELECT household_group_id INTO household FROM app.installation;
 PERFORM id FROM app.groups WHERE id=household FOR UPDATE;
 SELECT m.user_id INTO owner_id FROM app.groups g JOIN app.memberships m ON m.id=g.owner_membership_id WHERE g.id=household;
 IF NOT coalesce(app.can_read_group(household),false) OR NOT coalesce(actor=owner_id OR actor IN(d.first_user_id,d.second_user_id,d.proposer_user_id),false) THEN
  RETURN jsonb_build_object('state','NOT_FOUND');
 END IF;
 IF action='READ' THEN RETURN jsonb_build_object('state',d.state,'version',d.version); END IF;
 IF action IS NULL OR action NOT IN ('PROPOSE','CONSENT','CANCEL','END') OR expected IS NULL OR expected<0 THEN RAISE EXCEPTION 'invalid input' USING ERRCODE='22023'; END IF;
 -- Authorize the action before exposing a conflict/current version.
 IF (action='PROPOSE' AND actor<>owner_id) OR
    (action IN ('CONSENT','END') AND NOT coalesce(actor IN(d.first_user_id,d.second_user_id),false)) OR
    (action='CANCEL' AND NOT coalesce(actor IN(d.first_user_id,d.second_user_id,d.proposer_user_id),false)) THEN
  RETURN jsonb_build_object('state','NOT_FOUND');
 END IF;
 IF expected<>d.version THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
 previous:=d.state;
 IF action='PROPOSE' THEN
  IF d.state IN ('ACTIVE','SUSPENDED') THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
  IF first_id IS NULL OR second_id IS NULL OR first_id>=second_id OR
   (SELECT count(*) FROM app.users u JOIN app.memberships m ON m.user_id=u.id WHERE u.id IN(first_id,second_id) AND u.enabled AND u.live_auth_id=u.auth_subject AND m.group_id=household AND m.active)<>2 THEN
   RETURN jsonb_build_object('state','NOT_FOUND');
  END IF;
  UPDATE app.household_designation_guard SET version=version+1,state='PENDING',first_user_id=first_id,second_user_id=second_id,proposer_user_id=actor,first_consented=false,second_consented=false WHERE singleton;
  changed:=true;
 ELSIF action='CONSENT' THEN
  IF first_id IS DISTINCT FROM d.first_user_id OR second_id IS DISTINCT FROM d.second_user_id THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
  IF d.state NOT IN ('PENDING','SUSPENDED','ACTIVE') THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
  IF (SELECT count(*) FROM app.users u JOIN app.memberships m ON m.user_id=u.id WHERE u.id IN(d.first_user_id,d.second_user_id) AND u.enabled AND u.live_auth_id=u.auth_subject AND m.group_id=household AND m.active)<>2 THEN RETURN jsonb_build_object('state','NOT_FOUND'); END IF;
  changed:=CASE WHEN actor=d.first_user_id THEN NOT d.first_consented ELSE NOT d.second_consented END;
  UPDATE app.household_designation_guard SET first_consented=first_consented OR actor=first_user_id,second_consented=second_consented OR actor=second_user_id WHERE singleton;
 ELSIF action='CANCEL' THEN
  IF d.state='CANCELLED' THEN RETURN jsonb_build_object('state',d.state,'version',d.version); END IF;
  IF d.state<>'PENDING' THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
  UPDATE app.household_designation_guard SET state='CANCELLED',first_consented=false,second_consented=false WHERE singleton; changed:=true;
 ELSE
  IF d.state='ENDED' THEN RETURN jsonb_build_object('state',d.state,'version',d.version); END IF;
  IF d.state NOT IN ('ACTIVE','SUSPENDED') THEN RETURN jsonb_build_object('state','CONFLICT','version',d.version); END IF;
  UPDATE app.household_designation_guard SET state='ENDED',first_consented=false,second_consented=false WHERE singleton; changed:=true;
 END IF;
 IF changed THEN PERFORM app.household_audit(actor,action,previous); END IF;
 IF action='CONSENT' AND previous<>'ACTIVE' AND EXISTS(SELECT FROM app.household_designation_guard WHERE first_consented AND second_consented) THEN
  UPDATE app.household_designation_guard SET state='ACTIVE' WHERE singleton;
  PERFORM app.household_audit(actor,'FINALIZED',previous);
 END IF;
 SELECT * INTO d FROM app.household_designation_guard;
 RETURN jsonb_build_object('state',d.state,'version',d.version);
END $$;
GRANT EXECUTE ON FUNCTION app.household_designation(text,bigint,uuid,uuid) TO kami_api;
CREATE OR REPLACE FUNCTION app.invitation_admission_lock(hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE subject uuid:=app.verified_subject(); actor_id uuid; target uuid;
BEGIN
 IF subject IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 SELECT group_id INTO target FROM app.invitations WHERE token_hash=hash;
 IF target IS NULL THEN RETURN NULL;
 END IF;
 -- Subject advisory lock serializes first provisioning before acquiring group locks.
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,79));
 SELECT id INTO actor_id FROM app.users WHERE auth_subject=subject;
 IF actor_id IS NULL THEN
  INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES(gen_random_uuid(),subject,subject,'Member') RETURNING id INTO actor_id;
 END IF;
 IF EXISTS(SELECT FROM app.installation WHERE household_group_id=target) THEN
  PERFORM app.household_lifecycle_lock(ARRAY[actor_id]);
 ELSE
  PERFORM id FROM app.users WHERE id=actor_id FOR SHARE;
 END IF;
 IF NOT EXISTS(SELECT FROM app.users WHERE id=actor_id AND enabled AND live_auth_id=subject) THEN
  RAISE EXCEPTION 'access disabled' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM app.groups WHERE id=target FOR UPDATE;
 PERFORM id FROM app.invitations WHERE token_hash=hash FOR UPDATE;
 RETURN target;
END $$;
RESET ROLE;
