-- Generate real deployed pair events before retiring commands. The previous
-- upgrade fixture supplies the stable owner and admitted recipient.
BEGIN;
SET LOCAL ROLE kami_migrator;
DO $$
DECLARE first_id uuid:='a1100000-0000-4000-8000-000000000001'; second_id uuid:='a1970000-0000-4000-8000-000000000001'; result jsonb; version bigint;
BEGIN
 IF (SELECT state FROM app.household_designation_guard)<>'EMPTY' THEN RAISE EXCEPTION 'unexpected legacy fixture state'; END IF;
 PERFORM set_config('app.verified_sub',first_id::text,true);
 result:=app.household_designation('PROPOSE',0,first_id,second_id);
 IF result->>'state'<>'PENDING' THEN RAISE EXCEPTION 'legacy proposal failed'; END IF;
 version:=(result->>'version')::bigint;
 result:=app.household_designation('CONSENT',version,first_id,second_id);
 IF result->>'state'<>'PENDING' THEN RAISE EXCEPTION 'legacy first consent failed'; END IF;
 PERFORM set_config('app.verified_sub',second_id::text,true);
 result:=app.household_designation('CONSENT',version,first_id,second_id);
 IF result->>'state'<>'ACTIVE' THEN RAISE EXCEPTION 'legacy finalization failed'; END IF;
 PERFORM app.household_lifecycle_lock(ARRAY[first_id,second_id]);
 UPDATE app.memberships SET active=false WHERE id='a1970000-0000-4000-8000-000000000003';
 IF (SELECT state FROM app.household_designation_guard)<>'SUSPENDED' THEN RAISE EXCEPTION 'legacy suspension failed'; END IF;
 UPDATE app.memberships SET active=true WHERE id='a1970000-0000-4000-8000-000000000003';
 SELECT d.version INTO version FROM app.household_designation_guard d;
 PERFORM set_config('app.verified_sub',first_id::text,true);
 result:=app.household_designation('END',version,NULL,NULL);
 IF result->>'state'<>'ENDED' THEN RAISE EXCEPTION 'legacy termination failed'; END IF;
 IF (SELECT count(*) FROM app.household_designation_audit)<5 THEN RAISE EXCEPTION 'empty historical audit fixture'; END IF;
END $$;
RESET ROLE;
CREATE TABLE public.household_retirement_snapshot AS SELECT name,rows FROM (
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
COMMIT;
