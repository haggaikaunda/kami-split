-- Opaque eligibility binding, never a public user/designation directory.
SET ROLE kami_migrator;
CREATE FUNCTION app.household_expense_scope() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; fingerprint text;
BEGIN
 scope:=app.household_dashboard_scope();
 IF scope->>'state'<>'COMPLETE' THEN RETURN scope; END IF;
 SELECT encode(sha256(convert_to(jsonb_build_array(
  (SELECT id FROM app.users WHERE auth_subject=app.verified_subject()),
  d.version,d.first_user_id,d.second_user_id,scope->'groups')::text,'UTF8')),'hex') INTO fingerprint
 FROM app.household_designation_guard d WHERE singleton;
 RETURN scope||jsonb_build_object('anchor',fingerprint);
END $$;
GRANT EXECUTE ON FUNCTION app.household_expense_scope() TO kami_api;
RESET ROLE;
