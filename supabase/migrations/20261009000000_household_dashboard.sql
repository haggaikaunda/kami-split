-- Complete authorized discovery; no runtime access to private designation rows.
SET ROLE kami_migrator;
CREATE FUNCTION app.household_dashboard_scope() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; household uuid; d app.household_designation_guard; ids uuid[];
BEGIN
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject() AND enabled AND live_auth_id=auth_subject;
 SELECT household_group_id INTO household FROM app.installation;
 IF actor IS NULL OR NOT coalesce(app.can_read_group(household),false) THEN
  RETURN jsonb_build_object('state','NOT_FOUND','groups','[]'::jsonb);
 END IF;
 SELECT * INTO d FROM app.household_designation_guard WHERE singleton;
 IF d.state<>'ACTIVE' OR NOT d.first_consented OR NOT d.second_consented OR
  (SELECT count(*) FROM app.users u JOIN app.memberships m ON m.user_id=u.id WHERE u.id IN(d.first_user_id,d.second_user_id) AND u.enabled AND u.live_auth_id=u.auth_subject AND m.group_id=household AND m.active)<>2 THEN
  RETURN jsonb_build_object('state','UNAVAILABLE','groups',jsonb_build_array(household));
 END IF;
 IF actor NOT IN(d.first_user_id,d.second_user_id) THEN RETURN jsonb_build_object('state','NOT_FOUND','groups','[]'::jsonb); END IF;
 SELECT coalesce(array_agg(g.id ORDER BY g.id),'{}') INTO ids FROM app.groups g
 WHERE app.can_read_group(g.id) AND (SELECT count(*) FROM app.memberships m WHERE m.group_id=g.id AND m.active AND m.user_id IN(d.first_user_id,d.second_user_id))=2;
 RETURN jsonb_build_object('state','COMPLETE','groups',to_jsonb(ids));
END $$;
CREATE FUNCTION app.household_dashboard_lock() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; discovered uuid[]; d app.household_designation_guard; scope jsonb; locked uuid[]; fresh jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject();
 SELECT array_remove(ARRAY[first_user_id,second_user_id,actor],NULL) INTO discovered FROM app.household_designation_guard;
 PERFORM id FROM app.users WHERE id=ANY(discovered) ORDER BY id FOR SHARE;
 SELECT * INTO d FROM app.household_designation_guard WHERE singleton FOR SHARE;
 IF NOT array_remove(ARRAY[d.first_user_id,d.second_user_id],NULL)<@discovered THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 scope:=app.household_dashboard_scope();
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}') INTO locked FROM jsonb_array_elements_text(scope->'groups');
 PERFORM id FROM app.groups WHERE id=ANY(locked) ORDER BY id FOR SHARE;
 fresh:=app.household_dashboard_scope();
 IF NOT (fresh->'groups') <@ (scope->'groups') THEN RAISE EXCEPTION 'restart required' USING ERRCODE='40001'; END IF;
 RETURN fresh;
END $$;
GRANT EXECUTE ON FUNCTION app.household_dashboard_scope(),app.household_dashboard_lock() TO kami_api;
RESET ROLE;
