-- Account appearance is private profile metadata; no arbitrary table grants.
SET ROLE kami_migrator;
ALTER TABLE app.users ADD COLUMN appearance text NOT NULL DEFAULT 'LIGHT'
  CHECK (appearance IN ('LIGHT', 'SYSTEM', 'DARK'));

CREATE FUNCTION app.my_profile()
RETURNS TABLE(id uuid, display_name text, appearance text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT u.id, u.display_name, u.appearance FROM app.users u
  WHERE u.auth_subject = app.verified_subject() AND u.enabled
    AND u.live_auth_id = u.auth_subject;
$$;
CREATE FUNCTION app.update_my_appearance(requested text, expected text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor app.users%ROWTYPE;
BEGIN
  SELECT u.* INTO actor FROM app.users u
    WHERE u.auth_subject = app.verified_subject() FOR UPDATE;
  IF NOT FOUND OR NOT actor.enabled OR actor.live_auth_id IS DISTINCT FROM actor.auth_subject THEN
    RETURN 'FORBIDDEN';
  END IF;
  IF requested IS NULL OR requested NOT IN ('LIGHT','SYSTEM','DARK')
     OR expected IS NULL OR expected NOT IN ('LIGHT','SYSTEM','DARK') THEN
    RETURN 'INVALID_INPUT';
  END IF;
  IF actor.appearance = requested THEN RETURN 'READY'; END IF;
  IF actor.appearance IS DISTINCT FROM expected THEN RETURN 'CONFLICT'; END IF;
  UPDATE app.users SET appearance = requested WHERE id = actor.id;
  RETURN 'READY';
END $$;
REVOKE ALL ON FUNCTION app.my_profile(), app.update_my_appearance(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.my_profile(), app.update_my_appearance(text,text) TO kami_api;
RESET ROLE;
