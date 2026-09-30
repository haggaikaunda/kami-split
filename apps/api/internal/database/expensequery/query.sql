-- name: FinancialOperation :one
SELECT canonical, canonical_hash, outcome FROM app.expense_operations
WHERE group_id=$1 AND key=$2 AND operation_kind=$3;

-- name: StoreFinancialOperation :exec
INSERT INTO app.expense_operations(actor_user_id,group_id,operation_kind,key,canonical_version,canonical,canonical_hash,expense_id,repayment_id,outcome)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);

-- name: InsertExpense :one
INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING created_at;

-- name: InsertAllocation :exec
INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES($1,$2,$3,$4);

-- name: InsertAudit :exec
INSERT INTO app.expense_audit(expense_id,group_id,actor_user_id,creator_id,event,committed_at) VALUES($1,$2,$3,$4,'CREATE_EXPENSE',$5);

-- name: InsertRepayment :one
INSERT INTO app.repayments(id,group_id,creator_id,sender_id,recipient_id,amount_minor,currency,effective_date,note,revision)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING created_at;

-- name: InsertRepaymentAudit :exec
INSERT INTO app.repayment_audit(repayment_id,group_id,actor_user_id,creator_id,event,committed_at)
VALUES($1,$2,$3,$4,'RECORD_REPAYMENT',$5);
