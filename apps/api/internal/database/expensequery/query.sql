-- name: ExpenseOperation :one
SELECT canonical, canonical_hash, outcome FROM app.expense_operations
WHERE group_id=$1 AND key=$2 AND operation_kind='CREATE_EXPENSE';

-- name: StoreExpenseOperation :exec
INSERT INTO app.expense_operations(actor_user_id,group_id,operation_kind,key,canonical_version,canonical,canonical_hash,expense_id,outcome)
VALUES($1,$2,'CREATE_EXPENSE',$3,'create-expense-v1',$4,$5,$6,$7);

-- name: InsertExpense :one
INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING created_at;

-- name: InsertAllocation :exec
INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES($1,$2,$3,$4);

-- name: InsertAudit :exec
INSERT INTO app.expense_audit(expense_id,group_id,actor_user_id,creator_id,event,committed_at) VALUES($1,$2,$3,$4,'CREATE_EXPENSE',$5);
