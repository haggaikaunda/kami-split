SET ROLE kami_migrator;

-- Retained revisions have unknown primary taxonomy until a provider refresh.
ALTER TABLE app.banking_source_revisions ADD COLUMN provider_primary_category text;

CREATE OR REPLACE FUNCTION app.banking_sync_valid_page(payload jsonb, account text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE change jsonb; value text; day date;
BEGIN
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR jsonb_typeof(payload->'changes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(payload->'changes')>20 OR octet_length(payload::text)>65536
  OR jsonb_typeof(payload->'from_cursor') IS DISTINCT FROM 'string' OR length(payload->>'from_cursor')>256
  OR jsonb_typeof(payload->'next_cursor') IS DISTINCT FROM 'string' OR length(payload->>'next_cursor') NOT BETWEEN 1 AND 256 OR payload->>'next_cursor'='now'
  OR jsonb_typeof(payload->'has_more') IS DISTINCT FROM 'boolean' OR ((payload->>'has_more')::boolean AND payload->>'next_cursor'=payload->>'from_cursor') THEN RETURN false; END IF;
 IF payload->>'update_status' IS NOT NULL AND (jsonb_typeof(payload->'update_status')<>'string' OR length(payload->>'update_status')>256) THEN RETURN false; END IF;
 FOREACH value IN ARRAY ARRAY['provider_success_at','provider_failed_at'] LOOP
  IF payload->>value IS NOT NULL THEN
   IF jsonb_typeof(payload->value)<>'string' THEN RETURN false; END IF;
   PERFORM (payload->>value)::timestamptz;
  END IF;
 END LOOP;
 FOR change IN SELECT * FROM jsonb_array_elements(payload->'changes') LOOP
  IF jsonb_typeof(change)<>'object' OR jsonb_typeof(change->'id') IS DISTINCT FROM 'string' OR length(change->>'id') NOT BETWEEN 1 AND 256
   OR coalesce(change->>'operation','') NOT IN('added','modified','removed') THEN RETURN false; END IF;
  IF change ? 'account_id' AND change->>'account_id' IS DISTINCT FROM account THEN RETURN false; END IF;
  IF change->>'operation'='removed' THEN CONTINUE; END IF;
  IF change->>'account_id' IS DISTINCT FROM account OR change->>'currency' IS DISTINCT FROM 'USD'
   OR jsonb_typeof(change->'amount_minor') IS DISTINCT FROM 'string'
   OR (change->>'amount_minor') !~ '^(0|-?[1-9][0-9]*)$' OR length(change->>'amount_minor')>20
   OR jsonb_typeof(change->'pending') IS DISTINCT FROM 'boolean'
   OR coalesce(change->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  PERFORM (change->>'amount_minor')::bigint; day:=(change->>'date')::date;
  IF day NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RETURN false; END IF;
  FOREACH value IN ARRAY ARRAY['pending_transaction_id','authorized_date','name','merchant_name','transaction_code','provider_primary_category','provider_category','provider_confidence'] LOOP
   IF change ? value AND jsonb_typeof(change->value) NOT IN('string','null') THEN RETURN false; END IF;
  END LOOP;
  IF change->>'pending_transaction_id' IS NOT NULL AND (length(change->>'pending_transaction_id') NOT BETWEEN 1 AND 256 OR change->>'pending_transaction_id'=change->>'id' OR (change->>'pending')::boolean) THEN RETURN false; END IF;
  IF change->>'authorized_date' IS NOT NULL THEN
   IF change->>'authorized_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
   day:=(change->>'authorized_date')::date;
   IF day NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION app.banking_sync_apply(target uuid, owner uuid, change jsonb, initial boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE source app.banking_sources; old app.banking_source_revisions; annotation app.banking_annotations;
 linked uuid; next_revision bigint; processing text; mapping text:='plaid-pfc-v2'; material boolean; conflict boolean; notice text:='none'; lower_bound date; upper_bound date; outside_old boolean; outside_new boolean;
BEGIN
 SELECT s.* INTO source FROM app.banking_source_identities i JOIN app.banking_sources s ON s.id=i.source_id WHERE i.binding_id=target AND i.provider_transaction_id=change->>'id';
 IF source.id IS NULL THEN SELECT s.* INTO source FROM app.banking_sources s WHERE s.binding_id=target AND s.provider_transaction_id=change->>'id'; END IF;
 IF change->>'pending_transaction_id' IS NOT NULL THEN
  SELECT s.id INTO linked FROM app.banking_sources s
   LEFT JOIN app.banking_source_identities i ON i.source_id=s.id
   WHERE s.binding_id=target AND (i.provider_transaction_id=change->>'pending_transaction_id' OR s.provider_transaction_id=change->>'pending_transaction_id') LIMIT 1;
  IF linked IS NOT NULL THEN
   IF NOT EXISTS(SELECT FROM app.banking_source_revisions prior JOIN app.banking_sources s ON s.id=prior.source_id WHERE s.id=linked AND prior.processing_state='pending' AND coalesce(prior.provider_transaction_id,s.provider_transaction_id)=change->>'pending_transaction_id')
    OR (source.id IS NOT NULL AND source.id<>linked)
    OR (source.id IS NULL AND EXISTS(SELECT FROM app.banking_source_revisions r WHERE r.source_id=linked AND r.processing_state='posted')) THEN
    RAISE EXCEPTION 'conflicting explicit source identity' USING ERRCODE='23514';
   END IF;
   IF source.id IS NULL THEN SELECT * INTO source FROM app.banking_sources WHERE id=linked; END IF;
  END IF;
 END IF;
 IF source.id IS NOT NULL THEN SELECT * INTO old FROM app.banking_source_revisions WHERE source_id=source.id AND revision=source.revision; END IF;
 IF change->>'operation'='removed' THEN
  IF old.source_id IS NULL OR coalesce(old.provider_transaction_id,source.provider_transaction_id)<>change->>'id' OR old.processing_state='removed' THEN RETURN; END IF;
  change:=jsonb_build_object('id',change->>'id','amount_minor',old.amount_minor::text,'currency',old.currency,'date',old.bank_date::text,'authorized_date',old.authorization_date::text,'pending_transaction_id',old.pending_transaction_id,'name',old.name,'merchant_name',old.merchant_name,'transaction_code',old.provider_code,'provider_primary_category',old.provider_primary_category,'provider_category',old.provider_category,'provider_confidence',old.provider_confidence,'operation','removed');
  mapping:=old.mapping_version;
  processing:='removed';
 ELSE processing:=CASE WHEN (change->>'pending')::boolean THEN 'pending' ELSE 'posted' END;
 END IF;
 -- Exact duplicate facts do not create extra source or annotation versions.
 IF old.source_id IS NOT NULL AND (old.amount_minor,old.currency,old.bank_date,old.authorization_date,old.processing_state,old.provider_code,old.provider_primary_category,old.provider_category,old.provider_confidence,old.mapping_version,old.pending_transaction_id,old.name,old.merchant_name,coalesce(old.provider_transaction_id,source.provider_transaction_id))
  IS NOT DISTINCT FROM ((change->>'amount_minor')::bigint,change->>'currency',(change->>'date')::date,(change->>'authorized_date')::date,processing,change->>'transaction_code',change->>'provider_primary_category',change->>'provider_category',change->>'provider_confidence',mapping,change->>'pending_transaction_id',change->>'name',change->>'merchant_name',change->>'id') THEN RETURN; END IF;
 SELECT i.after_date,i.through_date INTO lower_bound,upper_bound FROM app.banking_plan_intervals i JOIN app.banking_plans p ON p.id=i.plan_id WHERE p.account_id=(SELECT account_id FROM app.banking_bindings WHERE id=target) AND i.binding_id=target ORDER BY p.revision DESC LIMIT 1;
 outside_new:=coalesce((change->>'date')::date<=lower_bound,false) OR coalesce((change->>'date')::date>upper_bound,false);
 outside_old:=coalesce(old.bank_date<=lower_bound,false) OR coalesce(old.bank_date>upper_bound,false);
 IF old.source_id IS NOT NULL AND old.bank_date<>(change->>'date')::date AND outside_old<>outside_new THEN notice:='cross_boundary_change';
 ELSIF NOT initial AND outside_new THEN notice:='historical_discrepancy';
 END IF;
 IF source.id IS NULL THEN
  source.id:=gen_random_uuid(); source.revision:=0;
  INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision,discrepancy) VALUES(source.id,owner,target,change->>'id',1,notice);
 END IF;
 next_revision:=source.revision+1;
 material:=(old.amount_minor,old.currency,old.bank_date,old.processing_state,old.provider_code,old.provider_primary_category,old.provider_category,old.provider_confidence,old.mapping_version) IS DISTINCT FROM ((change->>'amount_minor')::bigint,'USD',(change->>'date')::date,processing,change->>'transaction_code',change->>'provider_primary_category',change->>'provider_category',change->>'provider_confidence',mapping);
 INSERT INTO app.banking_source_identities VALUES(target,change->>'id',source.id) ON CONFLICT DO NOTHING;
 INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,authorization_date,processing_state,provider_code,provider_primary_category,provider_category,provider_confidence,mapping_version,stage,provider_transaction_id,pending_transaction_id,name,merchant_name,material_revision)
 VALUES(source.id,owner,next_revision,(change->>'amount_minor')::bigint,'USD',(change->>'date')::date,(change->>'authorized_date')::date,processing,change->>'transaction_code',change->>'provider_primary_category',change->>'provider_category',change->>'provider_confidence',mapping,'current',change->>'id',change->>'pending_transaction_id',change->>'name',change->>'merchant_name',CASE WHEN material THEN next_revision ELSE coalesce(old.material_revision,old.revision) END);
 UPDATE app.banking_sources s SET revision=next_revision,discrepancy=CASE WHEN s.discrepancy='none' OR notice='cross_boundary_change' THEN notice ELSE s.discrepancy END WHERE s.id=source.id;
 SELECT * INTO annotation FROM app.banking_annotations WHERE source_id=source.id ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN
  conflict:=annotation.material_conflict OR (material AND annotation.activity IS NOT NULL AND (processing<>'posted' OR
   (annotation.activity IN('purchase','bank_fee','debit_interest','cash_withdrawal') AND (change->>'amount_minor')::bigint<0) OR
   (annotation.activity IN('refund','income','loan_proceeds') AND (change->>'amount_minor')::bigint>0)));
  -- A previously stale annotation never regains acknowledgement on ingestion.
  INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed,material_conflict,applies_to_source_revision)
  VALUES(source.id,owner,annotation.revision+1,annotation.material_source_revision,annotation.category,annotation.activity,annotation.note,annotation.excluded,annotation.reviewed AND NOT material AND annotation.material_source_revision=coalesce(old.material_revision,old.revision),conflict,next_revision);
 END IF;
END $$;

RESET ROLE;
