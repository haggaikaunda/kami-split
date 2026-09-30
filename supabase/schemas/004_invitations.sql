-- Targeted capabilities only; shared links belong to #108.
SET ROLE kami_migrator;
CREATE SEQUENCE app.invitation_order;
ALTER TABLE app.memberships ADD COLUMN departed_order bigint NOT NULL DEFAULT 0;
CREATE FUNCTION app.record_departure() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN NEW.departed_order := nextval('app.invitation_order');
  ELSE NEW.departed_order := OLD.departed_order;
 END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_departure BEFORE UPDATE ON app.memberships
FOR EACH ROW EXECUTE FUNCTION app.record_departure();
CREATE FUNCTION app.invitation_email_valid(email text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT email=lower(email COLLATE "C") AND octet_length(email) BETWEEN 3 AND 254
 AND length(email)-length(replace(email,'@',''))=1
 AND length(split_part(email,'@',1)) BETWEEN 1 AND 64
 AND split_part(email,'@',1) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+$'
 AND split_part(email,'@',1) !~ '(^\.|\.$|\.\.)'
 AND split_part(email,'@',2) ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';
$$;
CREATE TABLE app.invitations (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES app.groups(id),
 creator uuid NOT NULL REFERENCES app.users(id), kind text NOT NULL DEFAULT 'TARGETED' CHECK(kind='TARGETED'),
 created_order bigint NOT NULL DEFAULT nextval('app.invitation_order'), created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 token_cipher bytea, token_key text, recipient text COLLATE "C",
 accepted_subject uuid, membership_id uuid, accepted_at timestamptz, revoked_at timestamptz,
 FOREIGN KEY(membership_id,group_id) REFERENCES app.memberships(id,group_id),
 CHECK ((accepted_at IS NULL) = (accepted_subject IS NULL)),
 CHECK ((accepted_at IS NULL) = (membership_id IS NULL)),
 CHECK (accepted_at IS NULL OR revoked_at IS NULL),
 CHECK ((accepted_at IS NULL AND revoked_at IS NULL) = (token_cipher IS NOT NULL AND token_key IS NOT NULL AND recipient IS NOT NULL)),
 CHECK ((accepted_at IS NULL AND revoked_at IS NULL) OR
        (token_cipher IS NULL AND token_key IS NULL AND recipient IS NULL)),
 CHECK (recipient IS NULL OR app.invitation_email_valid(recipient)),
 CHECK(token_cipher IS NULL OR octet_length(token_cipher)>=28),
 CHECK(token_key IS NULL OR length(token_key) BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX one_outstanding_target ON app.invitations(group_id,recipient) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE TABLE app.invitation_actions (
 id uuid PRIMARY KEY, actor uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('CREATE','RESEND','REVOKE','ACCEPT')),
 action_key uuid NOT NULL, digest bytea NOT NULL CHECK(octet_length(digest)=32), digest_key text NOT NULL,
 group_id uuid NOT NULL REFERENCES app.groups(id), invitation_id uuid NOT NULL REFERENCES app.invitations(id),
 outcome text NOT NULL, committed_at timestamptz NOT NULL, committed_expiry timestamptz NOT NULL, UNIQUE(actor,operation,action_key)
);
CREATE TABLE app.invitation_delivery (
 action_id uuid PRIMARY KEY REFERENCES app.invitation_actions(id),
 state text NOT NULL CHECK(state IN ('PENDING','UNKNOWN','PROVIDER_ACCEPTED','FAILED_DEFINITE','SUPPRESSED_TERMINAL','WINDOW_ENDED')),
 payload bytea, payload_key text, created_at timestamptz NOT NULL,
 first_submission timestamptz, lease_id uuid, lease_until timestamptz,
 CHECK((payload IS NULL) = (payload_key IS NULL))
);
ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_delivery ENABLE ROW LEVEL SECURITY;

-- Caller identity comes exclusively from the verified-request transaction setting.
CREATE FUNCTION app.invitation_owner_lock(target uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_id uuid;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000';
 END IF;
 SELECT id INTO actor_id FROM app.users WHERE auth_subject=app.verified_subject() AND enabled AND live_auth_id=auth_subject FOR SHARE;
 IF actor_id IS NULL THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM app.groups WHERE id=target FOR UPDATE;
 IF NOT EXISTS(SELECT FROM app.groups g JOIN app.memberships m ON m.id=g.owner_membership_id
   WHERE g.id=target AND m.user_id=actor_id AND m.active) THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 RETURN actor_id;
END $$;
CREATE FUNCTION app.invitation_result(action app.invitation_actions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('actionId',action.id,'invitationId',action.invitation_id,'groupId',action.group_id,'outcome',action.outcome,
 'expiresAt',action.committed_expiry, 'currentExpiresAt',i.expires_at,
 'lifecycle',CASE
   WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
   WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
   WHEN clock_timestamp()>=i.expires_at THEN 'EXPIRED'
   ELSE 'OUTSTANDING' END,
 'delivery',coalesce(d.state,'NOT_REQUESTED'),'membershipId',CASE WHEN action.operation='ACCEPT' THEN i.membership_id END,
 'hasAccess',CASE WHEN action.operation='ACCEPT' THEN app.can_read_group(i.group_id) ELSE false END)
 FROM app.invitations i LEFT JOIN app.invitation_delivery d ON d.action_id=action.id WHERE i.id=action.invitation_id;
$$;
-- Replay input comparison uses a keyed digest; email never survives in audit rows.
CREATE FUNCTION app.invitation_action_lookup(op text, key uuid) RETURNS TABLE(digest bytea,digest_key text,result jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a app.invitation_actions;
BEGIN
 SELECT * INTO a FROM app.invitation_actions WHERE actor=app.verified_subject() AND operation=op AND action_key=key;
 IF NOT FOUND THEN RETURN;
 END IF;
 IF op <> 'ACCEPT' THEN PERFORM app.invitation_owner_lock(a.group_id);
 ELSE
  PERFORM u.id FROM app.users u WHERE u.auth_subject=app.verified_subject() FOR SHARE;
  PERFORM g.id FROM app.groups g WHERE g.id=a.group_id FOR SHARE;
 END IF;
 RETURN QUERY SELECT a.digest,a.digest_key,app.invitation_result(a);
END $$;
CREATE FUNCTION app.invitation_owner_action(op text,target uuid,invite uuid,key uuid,input_digest bytea,input_digest_key text,
 new_id uuid,hash bytea,cipher bytea,cipher_key text,email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_id uuid; i app.invitations; a app.invitation_actions; decision timestamptz; result_code text; send boolean := false;
BEGIN
 IF op NOT IN ('CREATE','RESEND','REVOKE') OR key IS NULL THEN
  RAISE EXCEPTION 'invalid operation' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app.verified_subject()::text||op||key::text,80));
 actor_id:=app.invitation_owner_lock(target);
 SELECT * INTO a FROM app.invitation_actions WHERE actor=app.verified_subject() AND operation=op AND action_key=key;
 IF FOUND THEN
  IF a.group_id<>target OR a.digest<>input_digest OR a.digest_key<>input_digest_key THEN
  RETURN jsonb_build_object('outcome','KEY_REUSED');
 END IF;
  RETURN app.invitation_result(a);
 END IF;
 IF op='CREATE' THEN
  SELECT * INTO i FROM app.invitations WHERE group_id=target AND recipient=email AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
   result_code:='EXISTING'; ELSE send:=true; result_code:='SAVED';
 END IF;
 ELSE
  SELECT * INTO i FROM app.invitations WHERE id=invite AND group_id=target FOR UPDATE;
  IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
  IF i.accepted_at IS NOT NULL THEN
   result_code:='ALREADY_ACCEPTED';
  ELSIF i.revoked_at IS NOT NULL THEN
   result_code:='ALREADY_REVOKED';
  ELSE result_code:='APPLIED'; send:=(op='RESEND');
 END IF;
 END IF;
 decision:=clock_timestamp();
 IF send AND (EXISTS(SELECT FROM app.invitation_actions x JOIN app.invitation_delivery d ON d.action_id=x.id
    WHERE x.invitation_id=i.id AND x.committed_at>decision-interval '1 minute') OR
    (SELECT count(*) FROM app.invitation_actions x
      JOIN app.invitation_delivery d ON d.action_id=x.id
      WHERE x.group_id=target AND x.committed_at>decision-interval '1 hour')>=10) THEN
  RETURN jsonb_build_object('outcome','RATE_LIMITED');
 END IF;
 IF op='CREATE' AND send THEN
  INSERT INTO app.invitations(id,group_id,creator,created_at,expires_at,token_hash,token_cipher,token_key,recipient)
   VALUES(new_id,target,actor_id,decision,decision+interval '7 days',hash,cipher,cipher_key,email) RETURNING * INTO i;
 ELSIF op='RESEND' AND send THEN
  UPDATE app.invitations SET expires_at=decision+interval '7 days' WHERE id=i.id RETURNING * INTO i;
 ELSIF op='REVOKE' AND result_code='APPLIED' THEN
  UPDATE app.invitations SET revoked_at=decision,token_cipher=NULL,token_key=NULL,recipient=NULL WHERE id=i.id RETURNING * INTO i;
  UPDATE app.invitation_delivery d SET state=CASE
    WHEN d.state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') THEN 'SUPPRESSED_TERMINAL'
    ELSE d.state END,
    payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL
   FROM app.invitation_actions x WHERE d.action_id=x.id AND x.invitation_id=i.id;
 END IF;
 INSERT INTO app.invitation_actions(id,actor,operation,action_key,digest,digest_key,group_id,invitation_id,outcome,committed_at,committed_expiry)
 VALUES(gen_random_uuid(),app.verified_subject(),op,key,input_digest,input_digest_key,target,i.id,result_code,decision,i.expires_at) RETURNING * INTO a;
 IF send THEN
  INSERT INTO app.invitation_delivery(action_id,state,created_at) VALUES(a.id,'PENDING',decision);
 END IF;
 RETURN app.invitation_result(a);
END $$;
CREATE FUNCTION app.invitation_list(target uuid,after_id uuid,limit_count integer)
RETURNS TABLE(id uuid,recipient text,expires_at timestamptz,lifecycle text,action_id uuid,delivery text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM app.invitation_owner_lock(target);
 RETURN QUERY
 SELECT i.id, i.recipient, i.expires_at,
   CASE
     WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
     WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
     WHEN clock_timestamp()>=i.expires_at THEN 'EXPIRED'
     ELSE 'OUTSTANDING'
   END,
   recent.id, coalesce(recent.state,'NOT_REQUESTED')
 FROM app.invitations i
 LEFT JOIN LATERAL (
   SELECT a.id, d.state
   FROM app.invitation_actions a
   JOIN app.invitation_delivery d ON d.action_id=a.id
   WHERE a.invitation_id=i.id
   ORDER BY a.committed_at DESC, a.id DESC LIMIT 1
 ) recent ON true
 WHERE i.group_id=target AND (after_id IS NULL OR i.id>after_id)
 ORDER BY i.id LIMIT least(greatest(limit_count,1),50);
END $$;
CREATE FUNCTION app.invitation_preview(hash bytea) RETURNS TABLE(group_name text,inviter_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT g.name,u.display_name FROM app.invitations i JOIN app.groups g ON g.id=i.group_id JOIN app.users u ON u.id=i.creator
 WHERE i.token_hash=hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND clock_timestamp()<i.expires_at;
$$;
-- Eligibility is capability-only, and reveals neither recipient nor account existence.
CREATE FUNCTION app.invitation_eligible(hash bytea,email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM app.invitations i WHERE i.token_hash=hash AND i.recipient=email AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND clock_timestamp()<i.expires_at);
$$;
-- Prepare holds locks; the Go service checks monotonic evidence freshness after
-- this call, then commits acceptance on the same transaction/connection.
CREATE FUNCTION app.invitation_admission_lock(hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE subject uuid:=app.verified_subject(); actor_id uuid; target uuid;
BEGIN
 IF subject IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 SELECT group_id INTO target FROM app.invitations WHERE token_hash=hash;
 IF target IS NULL THEN RETURN NULL;
 END IF;
 -- Subject advisory lock serializes first provisioning before acquiring group locks.
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,79));
 SELECT id INTO actor_id FROM app.users WHERE auth_subject=subject FOR SHARE;
 IF actor_id IS NULL THEN
  INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES(gen_random_uuid(),subject,subject,'Member') RETURNING id INTO actor_id;
 END IF;
 IF NOT EXISTS(SELECT FROM app.users WHERE id=actor_id AND enabled AND live_auth_id=subject) THEN
  RAISE EXCEPTION 'access disabled' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM app.groups WHERE id=target FOR UPDATE;
 PERFORM id FROM app.invitations WHERE token_hash=hash FOR UPDATE;
 RETURN target;
END $$;
CREATE FUNCTION app.invitation_accept(hash bytea,email text,key uuid,input_digest bytea,input_digest_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; actor_id uuid; i app.invitations; m app.memberships; a app.invitation_actions; decision timestamptz; result_code text;
BEGIN
 SELECT * INTO a FROM app.invitation_actions WHERE actor=app.verified_subject() AND operation='ACCEPT' AND action_key=key;
 IF FOUND THEN
  IF a.digest<>input_digest OR a.digest_key<>input_digest_key THEN
  RETURN jsonb_build_object('outcome','KEY_REUSED');
 END IF;
  RETURN app.invitation_result(a);
 END IF;
 target:=app.invitation_admission_lock(hash);
 SELECT * INTO a FROM app.invitation_actions WHERE actor=app.verified_subject() AND operation='ACCEPT' AND action_key=key;
 IF FOUND THEN
  IF a.digest<>input_digest OR a.digest_key<>input_digest_key THEN
  RETURN jsonb_build_object('outcome','KEY_REUSED');
 END IF;
  RETURN app.invitation_result(a);
 END IF;
 IF target IS NULL THEN
  RETURN jsonb_build_object('outcome','UNAVAILABLE_LINK');
 END IF;
 SELECT * INTO i FROM app.invitations WHERE token_hash=hash;
 IF i.accepted_at IS NOT NULL THEN
  IF i.accepted_subject=app.verified_subject() THEN
   RETURN jsonb_build_object('outcome','HISTORICAL_ACCEPTANCE',
     'membershipId',i.membership_id,'hasAccess',app.can_read_group(target));
  END IF;
  RETURN jsonb_build_object('outcome','UNAVAILABLE_LINK');
 END IF;
 decision:=clock_timestamp();
 IF i.revoked_at IS NOT NULL OR decision>=i.expires_at THEN
  RETURN jsonb_build_object('outcome','UNAVAILABLE_LINK');
 END IF;
 IF i.recipient<>email THEN
  RETURN jsonb_build_object('outcome','WRONG_ACCOUNT');
 END IF;
 SELECT id INTO actor_id FROM app.users WHERE auth_subject=app.verified_subject();
 SELECT * INTO m FROM app.memberships WHERE group_id=target AND user_id=actor_id FOR UPDATE;
 IF FOUND AND NOT m.active AND m.departed_order>=i.created_order THEN
  RETURN jsonb_build_object('outcome','NEW_TARGETED_INVITATION_REQUIRED');
 END IF;
 IF m.id IS NULL THEN
  INSERT INTO app.memberships(id,group_id,user_id) VALUES(gen_random_uuid(),target,actor_id) RETURNING * INTO m; result_code:='ADMITTED';
 ELSIF m.active THEN
   result_code:='ALREADY_MEMBER';
 ELSE UPDATE app.memberships SET active=true WHERE id=m.id RETURNING * INTO m; result_code:='ADMITTED';
 END IF;
 UPDATE app.invitations SET accepted_subject=app.verified_subject(),membership_id=m.id,accepted_at=decision,token_cipher=NULL,token_key=NULL,recipient=NULL WHERE id=i.id;
 UPDATE app.invitation_delivery d SET state=CASE
    WHEN d.state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') THEN 'SUPPRESSED_TERMINAL'
    ELSE d.state END,
    payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL
 FROM app.invitation_actions x WHERE d.action_id=x.id AND x.invitation_id=i.id;
 INSERT INTO app.invitation_actions(id,actor,operation,action_key,digest,digest_key,group_id,invitation_id,outcome,committed_at,committed_expiry)
 VALUES(gen_random_uuid(),app.verified_subject(),'ACCEPT',key,input_digest,input_digest_key,target,i.id,result_code,decision,i.expires_at) RETURNING * INTO a;
 RETURN app.invitation_result(a);
END $$;
-- Only current owner can materialize delivery; ciphertext never appears in lists.
CREATE FUNCTION app.invitation_material(target uuid)
RETURNS TABLE(recipient text,token_cipher bytea,token_key text,invitation_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a app.invitation_actions;
BEGIN
 SELECT * INTO a FROM app.invitation_actions WHERE id=target AND actor=app.verified_subject();
 IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 PERFORM app.invitation_owner_lock(a.group_id);
 RETURN QUERY SELECT i.recipient,i.token_cipher,i.token_key,i.id,i.expires_at FROM app.invitations i JOIN app.invitation_delivery d ON d.action_id=a.id
 WHERE i.id=a.invitation_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND clock_timestamp()<i.expires_at
 AND d.payload IS NULL AND d.state='PENDING' AND d.first_submission IS NULL;
END $$;
CREATE FUNCTION app.invitation_attach_delivery(target uuid,cipher bytea,key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a app.invitation_actions;
BEGIN
 SELECT * INTO a FROM app.invitation_actions WHERE id=target AND actor=app.verified_subject();
 IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 PERFORM app.invitation_owner_lock(a.group_id);
 UPDATE app.invitation_delivery SET payload=cipher,payload_key=key WHERE action_id=target AND state='PENDING' AND payload IS NULL AND first_submission IS NULL;
END $$;
CREATE FUNCTION app.invitation_purge() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 UPDATE app.invitation_delivery SET payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL,state='WINDOW_ENDED'
 WHERE state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') AND coalesce(first_submission,created_at)+interval '23 hours'<=clock_timestamp();
$$;
CREATE FUNCTION app.invitation_claim(target uuid,lease uuid)
RETURNS TABLE(payload bytea,payload_key text,provider_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a app.invitation_actions; i app.invitations; decision timestamptz;
BEGIN
 SELECT * INTO a FROM app.invitation_actions WHERE id=target AND actor=app.verified_subject();
 IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 PERFORM app.invitation_owner_lock(a.group_id);
 SELECT * INTO i FROM app.invitations WHERE id=a.invitation_id FOR UPDATE;
 UPDATE app.invitation_delivery SET payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL,state='WINDOW_ENDED'
 WHERE action_id=target AND state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') AND coalesce(first_submission,created_at)+interval '23 hours'<=clock_timestamp();
 decision:=clock_timestamp();
 IF i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR decision>=i.expires_at THEN RETURN;
 END IF;
 RETURN QUERY UPDATE app.invitation_delivery d SET state='UNKNOWN',lease_id=lease,lease_until=decision+interval '30 seconds',first_submission=coalesce(d.first_submission,decision)
 WHERE d.action_id=target AND d.payload IS NOT NULL AND d.state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') AND (d.lease_until IS NULL OR d.lease_until<=decision)
 AND decision<coalesce(d.first_submission,d.created_at)+interval '23 hours' RETURNING d.payload,d.payload_key,d.action_id;
END $$;
CREATE FUNCTION app.invitation_complete(target uuid,lease uuid,outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a app.invitation_actions; updated integer;
BEGIN
 IF outcome NOT IN ('UNKNOWN','PROVIDER_ACCEPTED','FAILED_DEFINITE') THEN
  RAISE EXCEPTION 'invalid outcome' USING ERRCODE='22023';
 END IF;
 SELECT * INTO a FROM app.invitation_actions WHERE id=target AND actor=app.verified_subject();
 IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
 PERFORM app.invitation_owner_lock(a.group_id);
 UPDATE app.invitation_delivery SET payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL,state='WINDOW_ENDED'
 WHERE action_id=target AND state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') AND coalesce(first_submission,created_at)+interval '23 hours'<=clock_timestamp();
 UPDATE app.invitation_delivery SET state=outcome,lease_id=NULL,lease_until=NULL,
 payload=CASE WHEN outcome<>'PROVIDER_ACCEPTED' THEN payload END,payload_key=CASE WHEN outcome<>'PROVIDER_ACCEPTED' THEN payload_key END
 WHERE action_id=target AND lease_id=lease AND state='UNKNOWN' AND lease_until>clock_timestamp();
 GET DIAGNOSTICS updated=ROW_COUNT;
 RETURN updated=1;
END $$;
GRANT EXECUTE ON FUNCTION app.invitation_action_lookup(text,uuid),
 app.invitation_owner_action(text,uuid,uuid,uuid,bytea,text,uuid,bytea,bytea,text,text),
 app.invitation_list(uuid,uuid,integer),app.invitation_preview(bytea),app.invitation_eligible(bytea,text),
 app.invitation_admission_lock(bytea),app.invitation_accept(bytea,text,uuid,bytea,text),
 app.invitation_material(uuid),app.invitation_attach_delivery(uuid,bytea,text),app.invitation_purge(),
 app.invitation_claim(uuid,uuid),app.invitation_complete(uuid,uuid,text) TO kami_api;
RESET ROLE;
