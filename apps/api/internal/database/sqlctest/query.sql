-- name: GetFixture :one
SELECT id, label FROM fixture WHERE id = $1;
