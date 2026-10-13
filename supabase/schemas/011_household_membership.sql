-- Household membership is the sharing relationship. Legacy designation rows and
-- audits remain historical; their singleton is retained only for lock ordering.
SET ROLE kami_migrator;
ALTER TABLE app.memberships ADD COLUMN eligibility_revision bigint NOT NULL DEFAULT 0 CHECK(eligibility_revision>=0);
ALTER TABLE app.users ADD COLUMN eligibility_revision bigint NOT NULL DEFAULT 0 CHECK(eligibility_revision>=0);
CREATE FUNCTION app.membership_eligibility_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 NEW.eligibility_revision:=OLD.eligibility_revision+CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN 1 ELSE 0 END;
 RETURN NEW;
END $$;
CREATE TRIGGER membership_eligibility_revision BEFORE UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION app.membership_eligibility_revision();
CREATE FUNCTION app.account_eligibility_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 NEW.eligibility_revision:=OLD.eligibility_revision+CASE WHEN (NEW.enabled,NEW.live_auth_id) IS DISTINCT FROM (OLD.enabled,OLD.live_auth_id) THEN 1 ELSE 0 END;
 RETURN NEW;
END $$;
CREATE TRIGGER account_eligibility_revision BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.account_eligibility_revision();
CREATE OR REPLACE FUNCTION app.household_dashboard_scope() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE household uuid; members uuid[]; ids uuid[];
BEGIN
 SELECT household_group_id INTO household FROM app.installation;
 IF NOT coalesce(app.can_read_group(household),false) THEN
  RETURN jsonb_build_object('state','NOT_FOUND','groups','[]'::jsonb);
 END IF;
 SELECT coalesce(array_agg(user_id ORDER BY user_id),'{}') INTO members FROM app.memberships WHERE group_id=household AND active;
 -- Do not silently shrink the intersection when an active member loses account
 -- eligibility. The Household ledger remains governed by ordinary group access.
 IF cardinality(members) < 2
 OR EXISTS(
   SELECT
   FROM app.users
   WHERE id = ANY(members)
   AND (NOT enabled OR live_auth_id IS DISTINCT FROM auth_subject)
 ) THEN
  ids:=ARRAY[household];
 ELSE
  SELECT coalesce(array_agg(g.id ORDER BY g.id),'{}') INTO ids FROM app.groups g
  WHERE app.can_read_group(g.id) AND (g.id=household OR NOT EXISTS(
   SELECT FROM unnest(members) AS required(user_id) WHERE NOT EXISTS(
    SELECT FROM app.memberships m WHERE m.group_id=g.id AND m.active AND m.user_id=required.user_id)));
 END IF;
 RETURN jsonb_build_object('state','COMPLETE','groups',to_jsonb(ids));
END $$;
CREATE OR REPLACE FUNCTION app.household_dashboard_lock() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; household uuid; discovered uuid[]; current_users uuid[]; scope jsonb; locked uuid[]; fresh jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject();
 SELECT household_group_id INTO household FROM app.installation;
 SELECT coalesce(array_agg(user_id ORDER BY user_id), '{}') || array_remove(ARRAY[actor], NULL) INTO discovered
 FROM app.memberships
 WHERE group_id = household
 AND active;
 PERFORM id FROM app.users WHERE id=ANY(discovered) ORDER BY id FOR SHARE;
 PERFORM singleton FROM app.household_designation_guard WHERE singleton FOR SHARE;
 -- Admission/removal uses the singleton before taking the Household group lock.
 -- Re-discover after waits; missed users require a fresh canonical transaction.
 SELECT coalesce(array_agg(user_id ORDER BY user_id), '{}') INTO current_users
 FROM app.memberships
 WHERE group_id = household
 AND active;
 IF NOT current_users<@discovered THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 scope:=app.household_dashboard_scope();
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}') INTO locked FROM jsonb_array_elements_text(scope->'groups');
 PERFORM id FROM app.groups WHERE id=ANY(locked) ORDER BY id FOR SHARE;
 fresh:=app.household_dashboard_scope();
 IF NOT (fresh->'groups') <@ (scope->'groups') THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 RETURN fresh;
END $$;
CREATE OR REPLACE FUNCTION app.household_expense_scope() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; fingerprint text;
BEGIN
 scope:=app.household_dashboard_scope();
 IF scope->>'state'<>'COMPLETE' THEN RETURN scope; END IF;
 SELECT encode(sha256(convert_to(jsonb_build_array('membership-v1',
  (SELECT id FROM app.users WHERE auth_subject=app.verified_subject()),
  (
  SELECT jsonb_agg(
    jsonb_build_array(
      m.id, m.user_id, m.active, m.eligibility_revision, u.enabled, u.live_auth_id = u.auth_subject,
      u.eligibility_revision
    )
    ORDER BY m.id
  )
   FROM app.memberships m JOIN app.users u ON u.id=m.user_id JOIN app.installation i ON i.household_group_id=m.group_id),
  scope->'groups',
  (SELECT jsonb_agg(jsonb_build_array(m.id,m.group_id,m.user_id,m.active,m.eligibility_revision) ORDER BY m.id)
   FROM app.memberships m WHERE m.group_id IN(SELECT value::uuid FROM jsonb_array_elements_text(scope->'groups')))
 )::text,'UTF8')),'hex') INTO fingerprint;
 RETURN scope||jsonb_build_object('anchor',fingerprint);
END $$;
RESET ROLE;
