-- Fail loudly: assertions apply to migrations, never manufacture privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kami_api' AND rolcanlogin
    AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe runtime role';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kami_migrator' AND NOT rolcanlogin
    AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe migration owner';
  END IF;
  IF pg_has_role('kami_api', 'kami_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'runtime inherits owner';
  END IF;
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'app' AND nspowner <> 'kami_migrator'::regrole) THEN
    RAISE EXCEPTION 'wrong schema owner';
  END IF;
  IF has_schema_privilege('kami_api', 'app', 'CREATE') OR
     NOT has_schema_privilege('kami_api', 'app', 'USAGE') THEN
    RAISE EXCEPTION 'wrong runtime schema grants';
  END IF;
END $$;
