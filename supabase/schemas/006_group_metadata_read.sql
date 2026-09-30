-- Reveal designation only on a currently accessible group, never installation IDs.
SET ROLE kami_migrator;
CREATE FUNCTION app.is_household_group(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT app.can_read_group(target) AND EXISTS(
  SELECT FROM app.installation WHERE household_group_id=target
 )
$$;
REVOKE ALL ON FUNCTION app.is_household_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.is_household_group(uuid) TO kami_api;
RESET ROLE;
