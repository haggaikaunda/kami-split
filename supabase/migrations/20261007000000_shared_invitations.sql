-- Reuse the existing invitation capability, audit, locking and admission model.
SET ROLE kami_migrator;
ALTER TABLE app.invitations DROP CONSTRAINT invitations_kind_check;
ALTER TABLE app.invitations ADD CONSTRAINT invitations_kind_check CHECK(kind IN ('TARGETED','SHARED'));
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.invitations'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%token_cipher IS NOT NULL%' LOOP
 EXECUTE format('ALTER TABLE app.invitations DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.invitations ADD CONSTRAINT invitation_live_material CHECK
 ((accepted_at IS NULL AND revoked_at IS NULL) = (token_cipher IS NOT NULL AND token_key IS NOT NULL AND (kind='SHARED' OR recipient IS NOT NULL)));
ALTER TABLE app.invitations ADD CONSTRAINT shared_not_consumed CHECK(kind<>'SHARED' OR (recipient IS NULL AND accepted_at IS NULL));
CREATE UNIQUE INDEX one_outstanding_shared ON app.invitations(group_id) WHERE kind='SHARED' AND revoked_at IS NULL;
ALTER TABLE app.invitation_actions DROP CONSTRAINT invitation_actions_operation_check;
ALTER TABLE app.invitation_actions ADD CONSTRAINT invitation_actions_operation_check CHECK(operation IN ('CREATE','RESEND','REVOKE','ACCEPT','CREATE_SHARED','RENEW_SHARED'));
CREATE OR REPLACE FUNCTION app.invitation_owner_action(op text,target uuid,invite uuid,key uuid,input_digest bytea,input_digest_key text,
 new_id uuid,hash bytea,cipher bytea,cipher_key text,email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_id uuid; i app.invitations; a app.invitation_actions; decision timestamptz; result_code text; send boolean := false;
BEGIN
 IF op NOT IN ('CREATE','RESEND','REVOKE','CREATE_SHARED','RENEW_SHARED') OR key IS NULL THEN
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
 IF op='CREATE_SHARED' THEN
  SELECT * INTO i FROM app.invitations WHERE group_id=target AND kind='SHARED' AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN result_code:='EXISTING'; ELSE result_code:='SAVED'; END IF;
 ELSIF op='CREATE' THEN
  SELECT * INTO i FROM app.invitations WHERE group_id=target AND recipient=email AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
   result_code:='EXISTING'; ELSE send:=true; result_code:='SAVED';
 END IF;
 ELSE
  SELECT * INTO i FROM app.invitations WHERE id=invite AND group_id=target FOR UPDATE;
  IF NOT FOUND THEN
  RAISE EXCEPTION 'access denied' USING ERRCODE='42501';
 END IF;
  IF (op='RESEND' AND i.kind<>'TARGETED') OR (op='RENEW_SHARED' AND i.kind<>'SHARED') THEN
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
 IF op='CREATE_SHARED' AND result_code='SAVED' THEN
  INSERT INTO app.invitations(id,group_id,creator,kind,created_at,expires_at,token_hash,token_cipher,token_key)
  VALUES(new_id,target,actor_id,'SHARED',decision,decision+interval '7 days',hash,cipher,cipher_key) RETURNING * INTO i;
 ELSIF op='RENEW_SHARED' AND result_code='APPLIED' THEN
  UPDATE app.invitations SET expires_at=decision+interval '7 days' WHERE id=i.id RETURNING * INTO i;
 ELSIF op='CREATE' AND send THEN
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
CREATE OR REPLACE FUNCTION app.invitation_accept(hash bytea,email text,key uuid,input_digest bytea,input_digest_key text)
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
 IF i.kind='TARGETED' AND i.recipient<>email THEN
  RETURN jsonb_build_object('outcome','WRONG_ACCOUNT');
 END IF;
 SELECT id INTO actor_id FROM app.users WHERE auth_subject=app.verified_subject();
 SELECT * INTO m FROM app.memberships WHERE group_id=target AND user_id=actor_id FOR UPDATE;
 IF FOUND AND NOT m.active AND (i.kind='SHARED' OR m.departed_order>=i.created_order) THEN
  RETURN jsonb_build_object('outcome','NEW_TARGETED_INVITATION_REQUIRED');
 END IF;
 IF m.id IS NULL THEN
  INSERT INTO app.memberships(id,group_id,user_id) VALUES(gen_random_uuid(),target,actor_id) RETURNING * INTO m; result_code:='ADMITTED';
 ELSIF m.active THEN
   result_code:='ALREADY_MEMBER';
 ELSE UPDATE app.memberships SET active=true WHERE id=m.id RETURNING * INTO m; result_code:='ADMITTED';
 END IF;
 IF i.kind='TARGETED' THEN
 UPDATE app.invitations SET accepted_subject=app.verified_subject(),membership_id=m.id,accepted_at=decision,token_cipher=NULL,token_key=NULL,recipient=NULL WHERE id=i.id;
 UPDATE app.invitation_delivery d SET state=CASE
    WHEN d.state IN ('PENDING','UNKNOWN','FAILED_DEFINITE') THEN 'SUPPRESSED_TERMINAL'
    ELSE d.state END,
    payload=NULL,payload_key=NULL,lease_id=NULL,lease_until=NULL
 FROM app.invitation_actions x WHERE d.action_id=x.id AND x.invitation_id=i.id;
 END IF;
 INSERT INTO app.invitation_actions(id,actor,operation,action_key,digest,digest_key,group_id,invitation_id,outcome,committed_at,committed_expiry)
 VALUES(gen_random_uuid(),app.verified_subject(),'ACCEPT',key,input_digest,input_digest_key,target,i.id,result_code,decision,i.expires_at) RETURNING * INTO a;
 RETURN app.invitation_result(a);
END $$;
CREATE OR REPLACE FUNCTION app.invitation_result(action app.invitation_actions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('actionId',action.id,'invitationId',action.invitation_id,'groupId',action.group_id,'outcome',action.outcome,
 'expiresAt',action.committed_expiry, 'currentExpiresAt',i.expires_at,
 'lifecycle',CASE
   WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
   WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
   WHEN clock_timestamp()>=i.expires_at THEN 'EXPIRED'
   ELSE 'OUTSTANDING' END,
 'delivery',coalesce(d.state,'NOT_REQUESTED'),'membershipId',CASE WHEN action.operation='ACCEPT' THEN (SELECT m.id FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.group_id=i.group_id AND u.auth_subject=action.actor) END,
 'hasAccess',CASE WHEN action.operation='ACCEPT' THEN app.can_read_group(i.group_id) ELSE false END)
 FROM app.invitations i LEFT JOIN app.invitation_delivery d ON d.action_id=action.id WHERE i.id=action.invitation_id;
$$;
-- Sensitive retrieval is separate from safe list and action receipts. Expired
-- links remain recoverable, and copying never extends validity.
CREATE FUNCTION app.shared_invitation_material(target uuid,invite uuid)
RETURNS TABLE(token_cipher bytea,token_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM app.invitation_owner_lock(target);
 RETURN QUERY SELECT i.token_cipher,i.token_key FROM app.invitations i
 WHERE i.id=invite AND i.group_id=target AND i.kind='SHARED' AND i.revoked_at IS NULL;
END $$;
GRANT EXECUTE ON FUNCTION app.shared_invitation_material(uuid,uuid) TO kami_api;
DROP FUNCTION app.invitation_list(uuid,uuid,integer);
CREATE FUNCTION app.invitation_list(target uuid,after_id uuid,limit_count integer)
RETURNS TABLE(id uuid,recipient text,expires_at timestamptz,lifecycle text,action_id uuid,delivery text,kind text)
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
   recent.id, coalesce(recent.state,'NOT_REQUESTED'), i.kind
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
GRANT EXECUTE ON FUNCTION app.invitation_list(uuid,uuid,integer) TO kami_api;
RESET ROLE;
