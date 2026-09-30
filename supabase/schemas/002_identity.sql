-- #75 / ADR-005. The managed Auth FK is created by the existing migration
-- login, then immediately transferred; no provider object is altered.
SET ROLE kami_migrator;
GRANT USAGE, CREATE ON SCHEMA app TO postgres;
RESET ROLE;
CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  auth_subject uuid NOT NULL UNIQUE,
  live_auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (live_auth_id IS NULL OR live_auth_id = auth_subject),
  CHECK (NOT enabled OR live_auth_id IS NOT NULL)
);
ALTER TABLE app.users OWNER TO kami_migrator;
SET ROLE kami_migrator;
REVOKE USAGE, CREATE ON SCHEMA app FROM postgres;
REVOKE ALL ON app.users FROM PUBLIC, anon, authenticated, service_role, kami_api;
CREATE TABLE app.groups (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  owner_membership_id uuid NOT NULL,
  owner_active boolean NOT NULL DEFAULT true CHECK (owner_active),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES app.groups(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id),
  UNIQUE (id, group_id, active),
  UNIQUE (id, group_id)
);
ALTER TABLE app.groups ADD CONSTRAINT exactly_one_active_owner
  FOREIGN KEY (owner_membership_id, id, owner_active)
  REFERENCES app.memberships(id, group_id, active)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE app.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  household_group_id uuid NOT NULL UNIQUE REFERENCES app.groups(id),
  group_creator_user_id uuid NOT NULL UNIQUE REFERENCES app.users(id)
);

CREATE FUNCTION app.preserve_user_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.auth_subject, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.auth_subject, OLD.created_at)
     OR (OLD.live_auth_id IS NULL AND NEW.live_auth_id IS NOT NULL)
     OR (NOT OLD.enabled AND NEW.enabled) THEN
    RAISE EXCEPTION 'immutable identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_identity BEFORE UPDATE ON app.users
FOR EACH ROW EXECUTE FUNCTION app.preserve_user_identity();
CREATE FUNCTION app.preserve_membership_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.group_id, NEW.user_id, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.group_id, OLD.user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'immutable membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_identity BEFORE UPDATE ON app.memberships
FOR EACH ROW EXECUTE FUNCTION app.preserve_membership_identity();
CREATE FUNCTION app.preserve_group_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.currency, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.currency, OLD.created_at) THEN
    RAISE EXCEPTION 'immutable group' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_identity BEFORE UPDATE ON app.groups
FOR EACH ROW EXECUTE FUNCTION app.preserve_group_identity();

-- Context is supplied only by the trusted server after #78 verification.
-- A custom setting is not cryptographic proof against compromised credentials.
CREATE FUNCTION app.verified_subject() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN nullif(current_setting('app.verified_sub', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
CREATE FUNCTION app.viewer_identity()
RETURNS TABLE(status text, id uuid, display_name text, can_create_groups boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN u.id IS NULL THEN 'UNPROVISIONED'
         WHEN NOT u.enabled OR u.live_auth_id IS NULL THEN 'DISABLED' ELSE 'READY' END,
    CASE WHEN u.enabled AND u.live_auth_id IS NOT NULL THEN u.id END,
    CASE WHEN u.enabled AND u.live_auth_id IS NOT NULL THEN u.display_name END,
    CASE WHEN u.enabled AND u.live_auth_id IS NOT NULL THEN
      EXISTS (SELECT FROM app.installation i WHERE i.group_creator_user_id = u.id) ELSE false END
  FROM (SELECT app.verified_subject() AS subject) s
  LEFT JOIN app.users u ON u.auth_subject = s.subject;
$$;
CREATE FUNCTION app.can_read_group(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT FROM app.users u JOIN app.memberships m ON m.user_id = u.id
    WHERE u.auth_subject = app.verified_subject() AND u.live_auth_id = u.auth_subject
      AND u.enabled AND m.active AND m.group_id = target);
$$;
CREATE FUNCTION app.group_members(target uuid)
RETURNS TABLE(id uuid, display_name text, status text, role text, can_participate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, u.display_name, CASE WHEN m.active THEN 'ACTIVE' ELSE 'INACTIVE' END,
    CASE WHEN m.id = g.owner_membership_id THEN 'OWNER' ELSE 'MEMBER' END,
    m.active AND u.enabled AND u.live_auth_id IS NOT NULL
  FROM app.memberships m JOIN app.users u ON u.id = m.user_id
  JOIN app.groups g ON g.id = m.group_id
  WHERE m.group_id = target AND app.can_read_group(target) ORDER BY m.id;
$$;
-- VOLATILE PL/pgSQL statements obtain fresh READ COMMITTED snapshots after waits.
-- Callers also recheck in their subsequent projection statement.
CREATE FUNCTION app.lock_group_read(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = '25000';
  END IF;
  PERFORM u.id FROM app.users u WHERE u.auth_subject = app.verified_subject()
    AND u.live_auth_id = u.auth_subject AND u.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE = '42501'; END IF;
  PERFORM g.id FROM app.groups g WHERE g.id = target FOR SHARE;
  IF NOT app.can_read_group(target) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE FUNCTION app.lock_group_write(target uuid, affected_members uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = '25000';
  END IF;
  SELECT u.id INTO actor FROM app.users u WHERE u.auth_subject = app.verified_subject()
    AND u.live_auth_id = u.auth_subject AND u.enabled;
  IF actor IS NULL OR affected_members IS NULL OR EXISTS (
    SELECT FROM unnest(affected_members) a(id) WHERE a.id IS NULL OR NOT EXISTS (
      SELECT FROM app.memberships m WHERE m.id = a.id AND m.group_id = target)) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM u.id FROM app.users u WHERE u.id = actor OR u.id IN (
    SELECT m.user_id FROM app.memberships m WHERE m.group_id = target AND m.id = ANY(affected_members))
    ORDER BY u.id FOR SHARE;
  PERFORM g.id FROM app.groups g WHERE g.id = target FOR UPDATE;
  IF NOT app.can_read_group(target) OR EXISTS (
    SELECT FROM app.memberships m JOIN app.users u ON u.id = m.user_id
    WHERE m.group_id = target AND m.id = ANY(affected_members)
      AND (NOT m.active OR NOT u.enabled OR u.live_auth_id IS NULL)) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
END $$;
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.installation ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_read ON app.groups FOR SELECT TO kami_api USING (app.can_read_group(id));
CREATE POLICY membership_read ON app.memberships FOR SELECT TO kami_api USING (app.can_read_group(group_id));
GRANT SELECT (id, name, currency, owner_membership_id) ON app.groups TO kami_api;
GRANT SELECT (id, group_id, active) ON app.memberships TO kami_api;
GRANT EXECUTE ON FUNCTION app.viewer_identity(), app.can_read_group(uuid),
  app.group_members(uuid), app.lock_group_read(uuid), app.lock_group_write(uuid, uuid[]) TO kami_api;
RESET ROLE;
