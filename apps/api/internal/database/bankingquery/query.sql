-- name: ReadOperation :one
SELECT kind,input_digest,key_version,state,result_code,result_id
FROM app.banking_operations WHERE owner_id=app.banking_owner() AND attempt_id=$1 FOR UPDATE;

-- name: StartOperation :exec
INSERT INTO app.banking_operations(owner_id,attempt_id,kind,input_digest,key_version)
VALUES(app.banking_owner(),$1,$2,$3,$4);

-- name: CompleteOperation :exec
UPDATE app.banking_operations SET state='complete',result_code=$2,result_id=$3
WHERE owner_id=app.banking_owner() AND attempt_id=$1;

-- name: ReadConnection :one
SELECT id,environment,state,generation,deletion_generation FROM app.banking_connections WHERE id=$1;

-- name: ReadSource :one
SELECT s.id,s.binding_id,s.provider_transaction_id,s.revision,r.amount_minor,r.currency,r.bank_date,r.processing_state,r.stage
FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision
WHERE s.id=$1;
