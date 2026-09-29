-- Cluster roles survive local database resets. Never grant administrative powers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kami_migrator') THEN
    CREATE ROLE kami_migrator NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kami_api') THEN
    CREATE ROLE kami_api LOGIN NOINHERIT;
  END IF;
END $$;
-- PostgreSQL's default role attributes are non-administrative. Supabase's
-- migration login is not a superuser: do not attempt privileged ALTER flags.
-- Existing unsafe cluster roles cause failure rather than being silently reused.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('kami_api', 'kami_migrator')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'unsafe pre-existing application role';
  END IF;
END $$;
ALTER ROLE kami_migrator NOLOGIN;
ALTER ROLE kami_api LOGIN;
REVOKE kami_migrator FROM kami_api;
-- Supabase CLI migration login may explicitly assume the non-admin DDL owner.
GRANT kami_migrator TO postgres WITH INHERIT FALSE, SET TRUE;

CREATE SCHEMA app AUTHORIZATION kami_migrator;
SET ROLE kami_migrator;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app TO kami_api;

-- All future app DDL must SET ROLE kami_migrator. Grant runtime access per
-- reviewed feature migration, alongside RLS. No blanket table privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, kami_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, kami_api;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, kami_api;
RESET ROLE;
