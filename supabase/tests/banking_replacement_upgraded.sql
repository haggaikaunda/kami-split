DO $$ BEGIN
 IF (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261020040000'
  OR NOT EXISTS(SELECT FROM app.banking_account_identities WHERE owner_id='b3290000-0000-4000-8000-000000000001'
   AND environment='sandbox' AND institution_id='upgrade-institution' AND stable_id='upgrade-stable'
   AND account_id='b3290000-0000-4000-8000-000000000021')
  OR NOT EXISTS(SELECT FROM app.banking_sources WHERE id='b3290000-0000-4000-8000-000000000041' AND revision=1)
  OR NOT EXISTS(SELECT FROM app.reporting_timezones WHERE owner_id='b3290000-0000-4000-8000-000000000001' AND version=2 AND timezone='America/New_York') THEN
  RAISE EXCEPTION 'replacement upgrade lost exact account identity or existing history/preference';
 END IF;
 IF has_table_privilege('kami_api','app.banking_account_identities','SELECT')
  OR has_table_privilege('kami_worker','app.banking_account_identities','SELECT')
  OR has_table_privilege('authenticated','app.banking_account_identities','SELECT') THEN
  RAISE EXCEPTION 'exact banking identity registry grants were widened';
 END IF;
END $$;
