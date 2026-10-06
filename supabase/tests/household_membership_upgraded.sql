DO $$ BEGIN
 IF EXISTS(SELECT name,rows FROM public.household_upgrade_snapshot EXCEPT SELECT name,rows FROM (
 SELECT 'users' name,jsonb_agg(to_jsonb(t)-'eligibility_revision' ORDER BY id) rows FROM app.users t UNION ALL
 SELECT 'memberships',jsonb_agg(to_jsonb(t)-'eligibility_revision' ORDER BY id) FROM app.memberships t UNION ALL
 SELECT 'groups',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.groups t UNION ALL
 SELECT 'expenses',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.expenses t UNION ALL
 SELECT 'allocations',jsonb_agg(to_jsonb(t) ORDER BY expense_id,participant_id) FROM app.allocations t UNION ALL
 SELECT 'audit',jsonb_agg(to_jsonb(t) ORDER BY expense_id) FROM app.expense_audit t UNION ALL
 SELECT 'operations',jsonb_agg(to_jsonb(t) ORDER BY key) FROM app.expense_operations t UNION ALL
 SELECT 'invitations',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.invitations t UNION ALL
 SELECT 'admission',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.invitation_actions t UNION ALL
 SELECT 'designation',jsonb_agg(to_jsonb(t)) FROM app.household_designation_guard t UNION ALL
 SELECT 'designation_audit',jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.household_designation_audit t
 ) snapshot) THEN RAISE EXCEPTION 'membership upgrade rewrote stable identities, history or admission'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','a1970000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF app.household_dashboard_lock()->>'state'<>'COMPLETE' OR NOT app.can_read_group('a1100000-0000-4000-8000-000000000002') OR app.household_expense_scope()->>'anchor' IS NULL THEN RAISE EXCEPTION 'existing partner not authorized after upgrade'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','a1100000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF app.household_dashboard_lock()->>'state'<>'COMPLETE' THEN RAISE EXCEPTION 'owner denied'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','a1970000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF app.household_dashboard_lock()->>'state'<>'NOT_FOUND' THEN RAISE EXCEPTION 'pending recipient automatically admitted'; END IF;
END $$;
COMMIT;
DROP TABLE public.household_upgrade_snapshot;
