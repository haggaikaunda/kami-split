DO $$ BEGIN
 IF EXISTS(SELECT name,rows FROM public.household_retirement_snapshot EXCEPT SELECT name,rows FROM (
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
 ) snapshot) THEN RAISE EXCEPTION 'retirement rewrote stable identities, financial history, admission or legacy history'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('household_designation','household_invalidate','household_audit')) THEN RAISE EXCEPTION 'obsolete relation operations remain'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','a1970000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF app.household_dashboard_lock()->>'state'<>'COMPLETE' OR NOT app.can_read_group('a1100000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'retirement changed admitted membership access'; END IF;
 BEGIN
  PERFORM app.household_designation('CONSENT',0,NULL,NULL);
  RAISE EXCEPTION 'retired consent command executed';
 EXCEPTION WHEN undefined_function THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM app.household_designation_audit;
  RAISE EXCEPTION 'runtime read historical pair audit';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
COMMIT;
-- Current lifecycle transitions leave genuine historical events untouched.
BEGIN;
SET LOCAL ROLE kami_migrator;
SELECT app.household_lifecycle_lock(ARRAY['a1970000-0000-4000-8000-000000000001']::uuid[]);
UPDATE app.memberships SET active=false WHERE id='a1970000-0000-4000-8000-000000000003';
UPDATE app.memberships SET active=true WHERE id='a1970000-0000-4000-8000-000000000003';
UPDATE app.groups SET owner_membership_id='a1970000-0000-4000-8000-000000000003' WHERE id='a1100000-0000-4000-8000-000000000002';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT rows FROM public.household_retirement_snapshot WHERE name='designation') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t)) FROM app.household_designation_guard t)
 OR (SELECT rows FROM public.household_retirement_snapshot WHERE name='designation_audit') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.household_designation_audit t) THEN RAISE EXCEPTION 'lifecycle changed archived pair history'; END IF;
END $$;
ROLLBACK;
DROP TABLE public.household_retirement_snapshot;
