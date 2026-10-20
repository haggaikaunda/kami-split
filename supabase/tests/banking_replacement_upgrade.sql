DO $$ BEGIN
 IF (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261020030000'
  OR to_regclass('app.banking_account_identities') IS NOT NULL THEN
  RAISE EXCEPTION 'replacement upgrade requires the landed lifecycle/timezone base';
 END IF;
END $$;
SET ROLE kami_migrator;
INSERT INTO app.banking_enrollment_accounts(binding_id,owner_id,environment,institution_id,stable_id,display_name,currency,requested_history_days)
 VALUES('b3290000-0000-4000-8000-000000000032','b3290000-0000-4000-8000-000000000001','sandbox','upgrade-institution','upgrade-stable','Upgrade savings','USD',365);
RESET ROLE;
