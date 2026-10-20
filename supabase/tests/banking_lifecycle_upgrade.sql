-- Model the deployed base: timezone is already recorded, lifecycle is absent.
DO $$ BEGIN
 IF (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261020020000'
   OR to_regclass('app.banking_repairs') IS NOT NULL THEN
   RAISE EXCEPTION 'lifecycle upgrade did not start from deployed timezone base';
 END IF;
END $$;
BEGIN;
SELECT set_config('app.verified_sub','b3290000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE kami_api;
SELECT * FROM app.write_reporting_timezone('INITIALIZE','b3320000-0000-4000-8000-000000000001','Pacific/Honolulu',NULL);
SELECT * FROM app.write_reporting_timezone('UPDATE','b3320000-0000-4000-8000-000000000002','America/New_York',1);
COMMIT;
-- Existing attention must become visible without changing stream/history IDs.
SET ROLE kami_migrator;
-- Carry available positive secondary-removal proof across this upgrade.
INSERT INTO app.banking_enrollments(id,owner_id,environment,input_digest,key_version,intent,state,result_code,webhook_url,blocks_enrollment)
 VALUES('b3320000-0000-4000-8000-000000000010','b3290000-0000-4000-8000-000000000001','sandbox',decode(repeat('01',32),'hex'),'fixture','different','retry_allowed','RETRY_ALLOWED','https://api.example.invalid/banking/webhooks/b3320000-0000-4000-8000-000000000010',false);
INSERT INTO app.banking_enrollment_jobs(attempt_id,state,correlated_items,removed_items)
 VALUES('b3320000-0000-4000-8000-000000000010','complete',ARRAY['confirmed-upgrade-secondary'],ARRAY['confirmed-upgrade-secondary']);
SELECT app.banking_enqueue('b3290000-0000-4000-8000-000000000011',1,'reconcile');
UPDATE app.banking_work SET state='needs_attention',attempts=1
 WHERE connection_id='b3290000-0000-4000-8000-000000000011' AND kind='reconcile';
RESET ROLE;
CREATE VIEW public.banking_lifecycle_upgrade_observation AS SELECT
 (SELECT to_jsonb(p) FROM app.reporting_timezones p WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS preference,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY operation,attempt_id) FROM app.reporting_timezone_attempts a WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS receipts,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app.banking_accounts a WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS accounts,
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM app.banking_bindings b WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS bindings,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app.banking_sources s WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS sources,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY source_id,revision) FROM app.banking_source_revisions r WHERE owner_id='b3290000-0000-4000-8000-000000000001') AS revisions;
CREATE TABLE public.banking_lifecycle_upgrade_snapshot AS SELECT * FROM public.banking_lifecycle_upgrade_observation;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.banking_lifecycle_upgrade_snapshot WHERE preference->>'version'='2'
   AND preference->>'timezone'='America/New_York' AND jsonb_array_length(receipts)=2
   AND jsonb_array_length(sources)=2 AND jsonb_array_length(revisions)=2) THEN
   RAISE EXCEPTION 'nonempty deployed-base upgrade fixture missing';
 END IF;
END $$;
