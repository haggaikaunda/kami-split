-- A self-only preference and immutable write outcomes; independent of banking enrollment.
SET ROLE kami_migrator;
CREATE TABLE app.reporting_timezones (
  owner_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  timezone text NOT NULL,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991)
);
CREATE TABLE app.reporting_timezone_attempts (
  owner_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('INITIALIZE','UPDATE')),
  attempt_id uuid NOT NULL,
  requested_timezone text,
  expected_version bigint,
  result_code text NOT NULL CHECK (result_code IN ('READY','INVALID_INPUT','CONFLICT','NOT_INITIALIZED')),
  result_timezone text,
  result_version bigint,
  PRIMARY KEY (owner_id,operation,attempt_id),
  CHECK ((result_code='READY') = (result_timezone IS NOT NULL AND result_version IS NOT NULL))
);
ALTER TABLE app.reporting_timezones ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reporting_timezone_attempts ENABLE ROW LEVEL SECURITY;
-- No runtime table grants: narrowly scoped functions derive the owner themselves.
CREATE FUNCTION app.read_reporting_timezone()
RETURNS TABLE(code text, timezone text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT u.id INTO actor FROM app.users u WHERE u.auth_subject=app.verified_subject()
    AND u.enabled AND u.live_auth_id=u.auth_subject FOR SHARE;
  IF actor IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text,NULL::text,NULL::bigint; RETURN;
  END IF;
  RETURN QUERY SELECT 'READY'::text,p.timezone,p.version FROM app.reporting_timezones p WHERE p.owner_id=actor;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_INITIALIZED'::text,NULL::text,NULL::bigint; END IF;
END $$;
CREATE FUNCTION app.read_reporting_timezone_attempt(kind text, attempt uuid)
RETURNS TABLE(code text, timezone text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT u.id INTO actor FROM app.users u WHERE u.auth_subject=app.verified_subject()
    AND u.enabled AND u.live_auth_id=u.auth_subject FOR SHARE;
  IF actor IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text,NULL::text,NULL::bigint; RETURN;
  END IF;
  IF kind IS NULL OR kind NOT IN ('INITIALIZE','UPDATE') OR attempt IS NULL THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text,NULL::text,NULL::bigint; RETURN;
  END IF;
  RETURN QUERY SELECT a.result_code,a.result_timezone,a.result_version FROM app.reporting_timezone_attempts a
    WHERE a.owner_id=actor AND a.operation=kind AND a.attempt_id=attempt;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text,NULL::text,NULL::bigint; END IF;
END $$;
CREATE FUNCTION app.write_reporting_timezone(kind text, attempt uuid, requested text, expected bigint)
RETURNS TABLE(code text, timezone text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; saved app.reporting_timezones%ROWTYPE; receipt app.reporting_timezone_attempts%ROWTYPE;
  zone text; outcome text; result_zone text; result_revision bigint;
BEGIN
  -- The actor lock serializes initialization/attempt insertion and fences identity
  -- revocation. Name and appearance updates also take this lock but touch no preference columns.
  SELECT u.id INTO actor FROM app.users u WHERE u.auth_subject=app.verified_subject()
    AND u.enabled AND u.live_auth_id=u.auth_subject FOR UPDATE;
  IF actor IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text,NULL::text,NULL::bigint; RETURN;
  END IF;
  IF kind IS NULL OR kind NOT IN ('INITIALIZE','UPDATE') OR attempt IS NULL
    OR attempt='00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text,NULL::text,NULL::bigint; RETURN;
  END IF;
  zone := CASE WHEN kind='INITIALIZE' THEN coalesce(requested,'UTC') ELSE requested END;
  SELECT a.* INTO receipt FROM app.reporting_timezone_attempts a
    WHERE a.owner_id=actor AND a.operation=kind AND a.attempt_id=attempt;
  IF FOUND THEN
    IF receipt.requested_timezone IS DISTINCT FROM zone OR receipt.expected_version IS DISTINCT FROM expected THEN
      RETURN QUERY SELECT 'ATTEMPT_MISMATCH'::text,NULL::text,NULL::bigint; RETURN;
    END IF;
    RETURN QUERY SELECT receipt.result_code,receipt.result_timezone,receipt.result_version; RETURN;
  END IF;
  SELECT p.* INTO saved FROM app.reporting_timezones p WHERE p.owner_id=actor;
  IF zone IS NULL OR octet_length(zone) NOT BETWEEN 1 AND 128 OR zone IN ('localtime','posixrules','Local')
    OR zone LIKE 'posix/%' OR zone LIKE 'right/%'
    OR NOT EXISTS (SELECT FROM pg_timezone_names z WHERE z.name=zone)
    OR (kind='INITIALIZE' AND expected IS NOT NULL)
    OR (kind='UPDATE' AND (expected IS NULL OR expected NOT BETWEEN 1 AND 9007199254740991)) THEN
    outcome := 'INVALID_INPUT';
  ELSIF kind='INITIALIZE' THEN
    IF saved.owner_id IS NULL THEN
      INSERT INTO app.reporting_timezones VALUES(actor,zone,1);
      result_zone := zone; result_revision := 1;
    ELSE
      result_zone := saved.timezone; result_revision := saved.version;
    END IF;
    outcome := 'READY';
  ELSIF saved.owner_id IS NULL THEN outcome := 'NOT_INITIALIZED';
  ELSIF saved.version <> expected OR saved.version=9007199254740991 THEN outcome := 'CONFLICT';
  ELSE
    UPDATE app.reporting_timezones p SET timezone=zone,version=p.version+1 WHERE p.owner_id=actor
      RETURNING p.timezone,p.version INTO result_zone,result_revision;
    outcome := 'READY';
  END IF;
  INSERT INTO app.reporting_timezone_attempts VALUES(actor,kind,attempt,zone,expected,outcome,result_zone,result_revision);
  RETURN QUERY SELECT outcome,result_zone,result_revision;
END $$;
REVOKE ALL ON FUNCTION app.read_reporting_timezone(),app.read_reporting_timezone_attempt(text,uuid),
  app.write_reporting_timezone(text,uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.read_reporting_timezone(),app.read_reporting_timezone_attempt(text,uuid),
  app.write_reporting_timezone(text,uuid,text,bigint) TO kami_api;
RESET ROLE;
