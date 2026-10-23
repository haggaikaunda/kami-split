SET ROLE kami_migrator;

-- Display metadata follows the existing connection's owner/deletion boundary.
ALTER TABLE app.banking_connections ADD COLUMN institution_name text
 CHECK (institution_name IS NULL OR (length(institution_name) BETWEEN 1 AND 512 AND institution_name !~ '[[:cntrl:]]'));

CREATE FUNCTION app.banking_institution_name(target uuid, institution text, display_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := app.banking_owner();
BEGIN
 PERFORM app.lock_banking_owner();
 UPDATE app.banking_connections c SET institution_name=display_name
 WHERE c.id=target AND c.owner_id=actor AND c.state='active'
  AND display_name<>'' AND length(display_name)<=512
  AND EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_enrollment_accounts m ON m.binding_id=b.id
    WHERE b.connection_id=c.id AND m.institution_id=institution)
  AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id);
END $$;
REVOKE ALL ON FUNCTION app.banking_institution_name(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_institution_name(uuid,text,text) TO kami_api;

CREATE FUNCTION app.banking_clear_institution_name() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.state='deleted' THEN NEW.institution_name:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.banking_clear_institution_name() FROM PUBLIC,anon,authenticated,service_role,kami_api,kami_worker;
CREATE TRIGGER banking_clear_institution_name BEFORE UPDATE OF state ON app.banking_connections
 FOR EACH ROW EXECUTE FUNCTION app.banking_clear_institution_name();

-- A single statement owns the entire read snapshot. The wrapper exposes neither
-- provider payloads/checkpoints nor worker leases, and grants no inventory API.
CREATE OR REPLACE FUNCTION app.banking_connection_status(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH connection AS (
  SELECT c.* FROM app.banking_connections c
  WHERE c.id=target AND c.owner_id=app.banking_owner()
 ), accounts AS (
  SELECT a.kind,a.selected,a.generation AS account_generation,a.reporting_revision,b.*,m.display_name,m.currency,m.requested_history_days
  FROM connection c JOIN app.banking_bindings b ON b.connection_id=c.id
  JOIN app.banking_accounts a ON a.id=b.account_id AND a.owner_id=c.owner_id
  JOIN app.banking_enrollment_accounts m ON m.binding_id=b.id
  WHERE c.state<>'deleted'
   AND NOT EXISTS(SELECT FROM app.banking_deletion_barriers d WHERE d.connection_id=c.id)
   AND NOT EXISTS(SELECT FROM app.banking_account_barriers d WHERE d.account_id=a.id)
 ), payload AS (
  SELECT jsonb_build_object(
   'id',c.id,'institutionName',CASE WHEN c.state<>'deleted' THEN c.institution_name END,'state',c.state,'generation',c.generation::text,
   'deletionGeneration',c.deletion_generation::text,'permission',c.permission_state,
   'enrollmentPending',c.enrollment_pending,'providerRemoved',c.provider_removed,
   'health',c.health,'cleanup',l.cleanup,'purge',l.purge,
   'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',b.account_id,'streamId',b.id,'name',b.display_name,'kind',b.kind,
    'currency',b.currency,'requestedHistoryDays',b.requested_history_days,
    'providerAccountId',b.provider_account_id,
    'selected',b.selected AND b.reporting_state IN('current','staged') AND NOT b.collection_stopped,
    'status',jsonb_build_object(
     'reportingState',b.reporting_state,'collectionStopped',b.collection_stopped,
     'importState',b.import_state,'importRevision',b.import_revision::text,
     'dataRevision',b.data_revision::text,'bindingGeneration',b.generation::text,
     'accountGeneration',b.account_generation::text,'reportingRevision',b.reporting_revision::text,
     'planRevision',(SELECT p.revision::text FROM app.banking_plans p WHERE p.account_id=b.account_id ORDER BY p.revision DESC LIMIT 1),
     'intervals',coalesce((SELECT jsonb_agg(jsonb_build_object('bindingId',i.binding_id,'afterDate',i.after_date,'throughDate',i.through_date) ORDER BY i.after_date NULLS FIRST)
       FROM app.banking_plan_intervals i WHERE i.plan_id=(SELECT p.id FROM app.banking_plans p WHERE p.account_id=b.account_id ORDER BY p.revision DESC LIMIT 1)),
       (SELECT coalesce(jsonb_agg(jsonb_build_object('bindingId',original.id,'afterDate',NULL,'throughDate',NULL) ORDER BY original.id),'[]'::jsonb)
        FROM app.banking_bindings original WHERE original.account_id=b.account_id AND original.reporting_state='current')),
     'historyAvailability',b.history_availability,'coverageAfter',b.coverage_after,'coverageThrough',b.coverage_through,
     'lastLocalCommit',b.last_local_commit,'providerUpdateStatus',b.provider_update_status,
     'providerSuccessAt',b.provider_success_at,'providerFailedAt',b.provider_failed_at,
     'historicalUpdateAt',b.provider_historical_update_at,
     'discrepancyCount',(SELECT count(*)::text FROM app.banking_sources s WHERE s.binding_id=b.id AND s.discrepancy<>'none'),
     'work',(SELECT jsonb_build_object('state',w.state,'code',w.import_code,'attempts',w.attempts,
       'retryAt',CASE WHEN w.state='pending' THEN w.due_at END)
       FROM app.banking_work w WHERE w.binding_id=b.id AND w.kind='initial_sync'
        AND w.generation=c.generation AND w.binding_generation=b.generation),
     'requestedAfter',(SELECT w.requested_after FROM app.banking_work w WHERE w.binding_id=b.id AND w.kind='initial_sync' ORDER BY w.created_at,w.id LIMIT 1),
     'requestedThrough',(SELECT w.requested_through FROM app.banking_work w WHERE w.binding_id=b.id AND w.kind='initial_sync' ORDER BY w.created_at,w.id LIMIT 1)
    )) ORDER BY b.account_id,b.id) FROM accounts b),'[]'::jsonb)
  ) AS body
  FROM connection c CROSS JOIN LATERAL app.banking_lifecycle_status(c.id) l
 ) SELECT body || jsonb_build_object('snapshotRevision',encode(sha256(convert_to(body::text,'UTF8')),'hex')) FROM payload;
$$;
REVOKE ALL ON FUNCTION app.banking_connection_status(uuid) FROM PUBLIC,anon,authenticated,service_role,kami_worker;
GRANT EXECUTE ON FUNCTION app.banking_connection_status(uuid) TO kami_api;
RESET ROLE;
