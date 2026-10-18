-- A pre-worker deletion retained history and only its connection barrier.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('b3290000-0000-4000-8000-000000000001','worker-upgrade@example.invalid');
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES('b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000001','Upgrade fixture');
INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id,state,generation,deletion_generation) VALUES
 ('b3290000-0000-4000-8000-000000000010','b3290000-0000-4000-8000-000000000001','sandbox','plaid','old-item','deleted',2,1),
 ('b3290000-0000-4000-8000-000000000011','b3290000-0000-4000-8000-000000000001','sandbox','plaid','sibling-item','active',1,0);
INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES
 ('b3290000-0000-4000-8000-000000000020','b3290000-0000-4000-8000-000000000001','checking',true),
 ('b3290000-0000-4000-8000-000000000021','b3290000-0000-4000-8000-000000000001','savings',true);
INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES
 ('b3290000-0000-4000-8000-000000000030','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000010','b3290000-0000-4000-8000-000000000020','old-account'),
 ('b3290000-0000-4000-8000-000000000031','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000011','b3290000-0000-4000-8000-000000000020','replacement-account'),
 ('b3290000-0000-4000-8000-000000000032','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000011','b3290000-0000-4000-8000-000000000021','sibling-account');
INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES
 ('b3290000-0000-4000-8000-000000000040','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000031','replacement-source',1),
 ('b3290000-0000-4000-8000-000000000041','b3290000-0000-4000-8000-000000000001','b3290000-0000-4000-8000-000000000032','sibling-source',1);
INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage)
 SELECT id,owner_id,1,1234,'USD','2026-01-01','posted','fixture','current' FROM app.banking_sources WHERE id IN('b3290000-0000-4000-8000-000000000040','b3290000-0000-4000-8000-000000000041');
INSERT INTO app.banking_deletion_barriers(connection_id,owner_id,generation) VALUES('b3290000-0000-4000-8000-000000000010','b3290000-0000-4000-8000-000000000001',1);
COMMIT;
