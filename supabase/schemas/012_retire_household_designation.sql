-- Membership is the sole sharing relationship. Keep the singleton lock and
-- historical rows, but retire commands and hooks that mutate pair consent.
SET ROLE kami_migrator;
CREATE OR REPLACE FUNCTION app.household_lifecycle_lock(affected uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE discovered uuid[]; current_users uuid[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 -- Include historical memberships so prepared reactivation locks its user even
 -- when callers provide only the directly affected actor.
 SELECT coalesce(array_agg(m.user_id ORDER BY m.user_id),'{}')||coalesce(affected,'{}') INTO discovered
 FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id;
 PERFORM id FROM app.users WHERE id=ANY(discovered) ORDER BY id FOR SHARE;
 PERFORM singleton FROM app.household_designation_guard WHERE singleton FOR UPDATE;
 SELECT coalesce(array_agg(m.user_id ORDER BY m.user_id),'{}') INTO current_users
 FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id;
 IF NOT current_users<@discovered THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 PERFORM g.id FROM app.groups g JOIN app.installation i ON i.household_group_id=g.id ORDER BY g.id FOR UPDATE OF g;
 PERFORM set_config('app.household_lifecycle',txid_current()::text,true);
END $$;
CREATE OR REPLACE FUNCTION app.household_membership_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.active IS DISTINCT FROM OLD.active AND EXISTS(SELECT FROM app.installation WHERE household_group_id=NEW.group_id)
 AND current_setting('app.household_lifecycle',true) IS DISTINCT FROM txid_current()::text THEN
  RAISE EXCEPTION 'lifecycle preparation required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.household_owner_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.owner_membership_id<>OLD.owner_membership_id AND EXISTS(SELECT FROM app.installation WHERE household_group_id=NEW.id)
 AND current_setting('app.household_lifecycle',true) IS DISTINCT FROM txid_current()::text THEN
  RAISE EXCEPTION 'lifecycle preparation required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
-- Keep the row-level discovery check: a newly inserted user may not be among
-- the canonical statement-trigger locks already acquired in this transaction.
CREATE OR REPLACE FUNCTION app.household_account_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (OLD.enabled AND NOT NEW.enabled) OR (OLD.live_auth_id IS NOT NULL AND NEW.live_auth_id IS NULL) THEN
  IF NOT coalesce(NEW.id=ANY(current_setting('app.household_account_users',true)::uuid[]),false) THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.household_designation(text,bigint,uuid,uuid) FROM kami_api;
DROP FUNCTION app.household_designation(text,bigint,uuid,uuid);
DROP FUNCTION app.household_invalidate(uuid,boolean);
DROP FUNCTION app.household_audit(uuid,text,text);
RESET ROLE;
