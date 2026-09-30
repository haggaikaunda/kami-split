-- name: ListGroups :many
-- RLS checks the current enabled identity and active membership per group.
SELECT id, name, currency FROM app.groups ORDER BY id;
