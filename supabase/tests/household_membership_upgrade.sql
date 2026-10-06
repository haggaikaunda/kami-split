-- Previous deployed data: stable owner + already admitted partner, no pair.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('a1970000-0000-4000-8000-000000000001','upgrade-partner@example.invalid'),('a1970000-0000-4000-8000-000000000002','upgrade-pending@example.invalid');
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES
('a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000001','Existing partner'),
('a1970000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000002','Pending recipient');
INSERT INTO app.memberships(id,group_id,user_id) VALUES('a1970000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000001');
INSERT INTO app.installation(household_group_id,group_creator_user_id) VALUES('a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001');
INSERT INTO app.invitations(id,group_id,creator,created_at,expires_at,token_hash,accepted_subject,membership_id,accepted_at)
VALUES('a1970000-0000-4000-8000-000000000004','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001',now()-interval '1 day',now()+interval '1 day',decode(repeat('19',32),'hex'),'a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000003',now()-interval '1 hour');
INSERT INTO app.invitation_actions(id,actor,operation,action_key,digest,digest_key,group_id,invitation_id,outcome,committed_at,committed_expiry)
VALUES('a1970000-0000-4000-8000-000000000005','a1970000-0000-4000-8000-000000000001','ACCEPT','a1970000-0000-4000-8000-000000000006',decode(repeat('20',32),'hex'),'upgrade-test','a1100000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000004','ADMITTED',now()-interval '1 hour',now()+interval '1 day');
INSERT INTO app.invitations(id,group_id,creator,created_at,expires_at,token_hash,token_cipher,token_key,recipient)
VALUES('a1970000-0000-4000-8000-000000000007','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001',now(),now()+interval '1 day',decode(repeat('21',32),'hex'),decode(repeat('22',28),'hex'),'upgrade-test','upgrade-pending@example.invalid');
RESET ROLE;
CREATE TABLE public.household_upgrade_snapshot AS SELECT name,rows FROM (
 SELECT 'users' name,jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM app.users t UNION ALL
 SELECT 'memberships',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.memberships t UNION ALL
 SELECT 'groups',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.groups t UNION ALL
 SELECT 'expenses',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.expenses t UNION ALL
 SELECT 'allocations',jsonb_agg(to_jsonb(t) ORDER BY expense_id,participant_id) FROM app.allocations t UNION ALL
 SELECT 'audit',jsonb_agg(to_jsonb(t) ORDER BY expense_id) FROM app.expense_audit t UNION ALL
 SELECT 'operations',jsonb_agg(to_jsonb(t) ORDER BY key) FROM app.expense_operations t UNION ALL
 SELECT 'invitations',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.invitations t UNION ALL
 SELECT 'admission',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.invitation_actions t UNION ALL
 SELECT 'designation',jsonb_agg(to_jsonb(t)) FROM app.household_designation_guard t UNION ALL
 SELECT 'designation_audit',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.household_designation_audit t
) snapshot;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','a1970000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF app.household_dashboard_scope()->>'state'<>'UNAVAILABLE' THEN RAISE EXCEPTION 'fixture did not reproduce old missing-pair gate'; END IF;
END $$;
COMMIT;
