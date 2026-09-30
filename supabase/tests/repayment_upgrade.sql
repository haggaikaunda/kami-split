-- Existing financial history must retain exact values and recoverability.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('a1100000-0000-4000-8000-000000000001','upgrade-110@example.invalid');
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES('a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','Upgrade');
INSERT INTO app.groups(id,name,owner_membership_id) VALUES('a1100000-0000-4000-8000-000000000002','Existing ledger','a1100000-0000-4000-8000-000000000003');
INSERT INTO app.memberships(id,group_id,user_id) VALUES('a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001');
RESET ROLE;
SELECT set_config('app.verified_sub','a1100000-0000-4000-8000-000000000001',true);
INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision)
VALUES('a1100000-0000-4000-8000-000000000004','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000003',100,'USD','Existing','2026-01-01','OTHER','','EXACT',1);
INSERT INTO app.allocations SELECT id,group_id,payer_id,total_minor FROM app.expenses WHERE id='a1100000-0000-4000-8000-000000000004';
INSERT INTO app.expense_audit SELECT id,group_id,'a1100000-0000-4000-8000-000000000001',creator_id,'CREATE_EXPENSE',created_at FROM app.expenses WHERE id='a1100000-0000-4000-8000-000000000004';
INSERT INTO app.expense_operations(actor_user_id,group_id,operation_kind,key,canonical_version,canonical,canonical_hash,expense_id,outcome)
SELECT 'a1100000-0000-4000-8000-000000000001',group_id,'CREATE_EXPENSE','a1100000-0000-4000-8000-000000000005','create-expense-v1',convert_to('["old-versioned-input"]','UTF8'),decode(repeat('00',32),'hex'),id,jsonb_build_object('Kind','COMMITTED','Record',jsonb_build_object('ExpenseID','ks1:Expense:'||id::text)) FROM app.expenses WHERE id='a1100000-0000-4000-8000-000000000004';
CREATE TABLE public.repayment_upgrade_snapshot AS SELECT to_jsonb(e) expense,to_jsonb(o) operation,to_jsonb(a) audit FROM app.expenses e JOIN app.expense_operations o ON o.expense_id=e.id JOIN app.expense_audit a ON a.expense_id=e.id;
COMMIT;
