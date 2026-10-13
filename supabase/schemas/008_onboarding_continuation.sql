-- #164: one explicit Auth attempt per targeted capability, independent of
-- delivery retries/resends. No provider material or recipient copy is retained.
SET ROLE kami_migrator;
CREATE TABLE app.invitation_auth_claims (
 invitation_id uuid PRIMARY KEY REFERENCES app.invitations(id) ON DELETE CASCADE,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON app.invitation_auth_claims FROM PUBLIC, anon, authenticated, service_role, kami_api;
ALTER TABLE app.invitation_auth_claims ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app.onboarding_preview(hash bytea)
RETURNS TABLE(group_name text,inviter_name text,kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT g.name,u.display_name,i.kind FROM app.invitations i
 JOIN app.groups g ON g.id=i.group_id JOIN app.users u ON u.id=i.creator
 WHERE i.token_hash=hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND clock_timestamp()<i.expires_at;
$$;
-- Only the trusted server calls this private capability method. It is never a
-- public preview projection. The recipient comes from invitation state.
CREATE FUNCTION app.onboarding_target(hash bytea,consume boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i app.invitations; claimed uuid;
BEGIN
 SELECT * INTO i FROM app.invitations WHERE token_hash=hash FOR UPDATE;
 IF NOT FOUND OR i.kind<>'TARGETED' OR i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR clock_timestamp()>=i.expires_at THEN RETURN NULL; END IF;
 IF NOT EXISTS(
   SELECT
   FROM app.invitation_actions a
   JOIN app.invitation_delivery d ON d.action_id = a.id
   WHERE a.invitation_id = i.id
   AND d.state IN('PROVIDER_ACCEPTED', 'UNKNOWN')
 ) THEN RETURN NULL;
 END IF;
 IF consume THEN
  INSERT INTO app.invitation_auth_claims(invitation_id) VALUES(i.id) ON CONFLICT DO NOTHING RETURNING invitation_id INTO claimed;
  IF claimed IS NULL THEN RETURN NULL; END IF;
 END IF;
 RETURN i.recipient;
END $$;
-- Provider subject is obtained from generate_link, never a browser field.
CREATE FUNCTION app.onboarding_subject_allowed(subject uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT NOT EXISTS(SELECT FROM app.users u WHERE u.auth_subject=subject AND (NOT u.enabled OR u.live_auth_id IS NULL));
$$;
-- Shared possession authorizes sending verification only; it is not email proof.
CREATE OR REPLACE FUNCTION app.invitation_eligible(hash bytea,email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM app.invitations i WHERE i.token_hash=hash AND i.kind='SHARED'
 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND clock_timestamp()<i.expires_at);
$$;
GRANT EXECUTE ON FUNCTION app.onboarding_preview(bytea),app.onboarding_target(bytea,boolean),app.onboarding_subject_allowed(uuid) TO kami_api;
RESET ROLE;
