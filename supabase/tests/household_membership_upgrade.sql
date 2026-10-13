-- Previous deployed data: stable owner + already admitted partner, no pair.
BEGIN;
INSERT INTO auth.users(id, email)
VALUES('a1970000-0000-4000-8000-000000000001', 'upgrade-partner@example.invalid'),
('a1970000-0000-4000-8000-000000000002', 'upgrade-pending@example.invalid');
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES
('a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000001','Existing partner'),
('a1970000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000002','Pending recipient');
INSERT INTO app.memberships(id, group_id, user_id)
VALUES(
  'a1970000-0000-4000-8000-000000000003', 'a1100000-0000-4000-8000-000000000002',
  'a1970000-0000-4000-8000-000000000001'
);
INSERT INTO app.installation(household_group_id, group_creator_user_id)
VALUES('a1100000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000001');
INSERT INTO app.invitations(id,group_id,creator,created_at,expires_at,token_hash,accepted_subject,membership_id,accepted_at)
VALUES('a1970000-0000-4000-8000-000000000004','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001',now()-interval '1 day',now()+interval '1 day',decode(repeat('19',32),'hex'),'a1970000-0000-4000-8000-000000000001','a1970000-0000-4000-8000-000000000003',now()-interval '1 hour');
INSERT INTO app.invitation_actions(
  id, actor, operation, action_key, digest, digest_key, group_id, invitation_id,
  outcome, committed_at, committed_expiry
)
VALUES('a1970000-0000-4000-8000-000000000005','a1970000-0000-4000-8000-000000000001','ACCEPT','a1970000-0000-4000-8000-000000000006',decode(repeat('20',32),'hex'),'upgrade-test','a1100000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000004','ADMITTED',now()-interval '1 hour',now()+interval '1 day');
INSERT INTO app.invitations(id,group_id,creator,created_at,expires_at,token_hash,token_cipher,token_key,recipient)
VALUES('a1970000-0000-4000-8000-000000000007','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001',now(),now()+interval '1 day',decode(repeat('21',32),'hex'),decode(repeat('22',28),'hex'),'upgrade-test','upgrade-pending@example.invalid');
RESET ROLE;
SELECT set_config('app.verified_sub','a1100000-0000-4000-8000-000000000001',true);
INSERT INTO app.expenses(
  id, group_id, creator_id, payer_id, total_minor, currency, description, effective_date,
  category, note, split, revision
)
VALUES('a1970000-0000-4000-8000-000000000008','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000003',200,'USD','Shared history','2026-01-02','OTHER','','EXACT',2);
INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor)
VALUES('a1970000-0000-4000-8000-000000000008','a1100000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000003',200);
INSERT INTO app.expense_audit
SELECT id, group_id, 'a1100000-0000-4000-8000-000000000001', creator_id, 'CREATE_EXPENSE',
created_at
FROM app.expenses
WHERE id = 'a1970000-0000-4000-8000-000000000008';
INSERT INTO app.expense_operations(
  actor_user_id, group_id, operation_kind, key, canonical_version, canonical, canonical_hash,
  expense_id, outcome
)
SELECT 'a1100000-0000-4000-8000-000000000001', group_id, 'CREATE_EXPENSE', 'a1970000-0000-4000-8000-000000000009',
'create-expense-v1', convert_to('["upgrade-expense"]', 'UTF8'), decode(repeat('23', 32), 'hex'),
id, jsonb_build_object(
  'Kind', 'COMMITTED',
  'Record', jsonb_build_object('ExpenseID', 'ks1:Expense:' || id::text)
)
FROM app.expenses
WHERE id = 'a1970000-0000-4000-8000-000000000008';
COMMIT;
BEGIN;
SELECT set_config('app.verified_sub','a1970000-0000-4000-8000-000000000001',true);
INSERT INTO app.repayments(id,group_id,creator_id,sender_id,recipient_id,amount_minor,currency,effective_date,note,revision)
VALUES('a1970000-0000-4000-8000-000000000010','a1100000-0000-4000-8000-000000000002','a1970000-0000-4000-8000-000000000003','a1970000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000003',100,'USD','2026-01-03','Existing repayment',3);
INSERT INTO app.repayment_audit
SELECT id, group_id, 'a1970000-0000-4000-8000-000000000001', creator_id, 'RECORD_REPAYMENT',
created_at
FROM app.repayments
WHERE id = 'a1970000-0000-4000-8000-000000000010';
INSERT INTO app.expense_operations(
  actor_user_id, group_id, operation_kind, key, canonical_version, canonical, canonical_hash,
  repayment_id, outcome
)
SELECT 'a1970000-0000-4000-8000-000000000001', group_id, 'RECORD_REPAYMENT',
'a1970000-0000-4000-8000-000000000011', 'record-repayment-v1', convert_to('["upgrade-repayment"]', 'UTF8'),
decode(repeat('24', 32), 'hex'), id, jsonb_build_object ('Kind', 'COMMITTED',
'Repayment', jsonb_build_object (
'RepaymentID','ks1:Repayment:'||id::text,'GroupID','ks1:Group:'||group_id::text,
'CreatorMembershipID','ks1:Membership:'||creator_id::text,'SenderMembershipID','ks1:Membership:'||sender_id::text,
'RecipientMembershipID','ks1:Membership:'||recipient_id::text,'AmountMinor',amount_minor,'Currency',currency,
'EffectiveDate',to_char(effective_date,'YYYY-MM-DD'),'Note',note,'Revision',revision,
'CommittedAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) FROM app.repayments WHERE id='a1970000-0000-4000-8000-000000000010';
COMMIT;
BEGIN;
CREATE TABLE public.household_upgrade_snapshot AS SELECT name,rows FROM (
 SELECT 'users' name,jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM app.users t UNION ALL
 SELECT 'memberships',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.memberships t UNION ALL
 SELECT 'groups',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.groups t UNION ALL
 SELECT 'expenses',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.expenses t UNION ALL
 SELECT 'allocations',jsonb_agg(to_jsonb(t) ORDER BY expense_id,participant_id) FROM app.allocations t UNION ALL
 SELECT 'audit',jsonb_agg(to_jsonb(t) ORDER BY expense_id) FROM app.expense_audit t UNION ALL
 SELECT 'operations',jsonb_agg(to_jsonb(t) ORDER BY key) FROM app.expense_operations t UNION ALL
 SELECT 'repayments',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.repayments t UNION ALL
 SELECT 'repayment_audit',jsonb_agg(to_jsonb(t) ORDER BY repayment_id) FROM app.repayment_audit t UNION ALL
 SELECT 'financial_records',jsonb_agg(to_jsonb(t) ORDER BY group_id,revision) FROM app.financial_records t UNION ALL
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
