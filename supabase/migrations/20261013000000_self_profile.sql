-- Self-only metadata mutation: no runtime table UPDATE privilege and no Auth writes.
SET ROLE kami_migrator;
CREATE FUNCTION app.update_my_profile(requested_name text, expected_name text)
RETURNS TABLE(status text, id uuid, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor app.users%ROWTYPE; canonical_name text;
BEGIN
  -- Unicode White_Space, shared with Go unicode.IsSpace and the browser validator.
  canonical_name := btrim(requested_name,
    U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000');
  SELECT u.* INTO actor FROM app.users u
    WHERE u.auth_subject = app.verified_subject() FOR UPDATE;
  IF NOT FOUND OR NOT actor.enabled OR actor.live_auth_id IS DISTINCT FROM actor.auth_subject THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  IF canonical_name IS NULL OR char_length(canonical_name) NOT BETWEEN 1 AND 120 OR expected_name IS NULL THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  -- Same-value retries remain harmless after a committed response was lost.
  IF actor.display_name = canonical_name THEN
    RETURN QUERY SELECT 'READY'::text, actor.id, actor.display_name; RETURN;
  END IF;
  IF actor.display_name IS DISTINCT FROM expected_name THEN
    RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  UPDATE app.users u SET display_name = canonical_name WHERE u.id = actor.id;
  RETURN QUERY SELECT 'READY'::text, actor.id, canonical_name;
END $$;
REVOKE ALL ON FUNCTION app.update_my_profile(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.update_my_profile(text,text) TO kami_api;
RESET ROLE;
