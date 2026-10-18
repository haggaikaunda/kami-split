.PHONY: banking-worker-run banking-worker-smoke api-run api-generate api-format api-format-check api-test api-build api-check

banking-worker-run:
	cd apps/api && go run ./cmd/worker

# Requires an explicitly supplied disposable restricted-role database URL.
banking-worker-smoke:
	./scripts/banking-worker-smoke.sh

api-run:
	cd apps/api && go run ./cmd/server

api-generate:
	cd apps/api && go tool gqlgen generate

api-format:
	gofmt -w apps/api

api-format-check:
	@test -z "$$(gofmt -l apps/api)" || (gofmt -l apps/api; exit 1)

api-test:
	cd apps/api && go test -race ./...

api-build:
	cd apps/api && go build ./...

api-check: api-format-check
	cd apps/api && go mod verify
	cd apps/api && go vet ./...
	cd apps/api && go test ./...
	$(MAKE) api-test
	$(MAKE) api-build
	$(MAKE) api-generate
	git diff --exit-code -- apps/api packages/schema
	@test -z "$$(git ls-files --others --exclude-standard -- apps/api packages/schema)" || (echo "Untracked API/schema files; commit generated artifacts before drift verification"; exit 1)

.PHONY: db-tools db-start db-stop dev-up dev-down db-test db-generate db-generation-check

db-tools:
	./scripts/install-db-tools.sh

db-start:
	./scripts/db-tool.sh supabase start

db-stop:
	./scripts/db-tool.sh supabase stop

# CI reuses its already-built production image; local startup builds by default.
DEV_BUILD_FLAG ?= --build

dev-up: db-start
	docker compose -f compose.yaml -f compose.database.yaml up $(DEV_BUILD_FLAG) --wait api

dev-down:
	docker compose -f compose.yaml -f compose.database.yaml down
	$(MAKE) db-stop

db-test:
	./scripts/db-test.sh

db-generate:
	./scripts/db-tool.sh sqlc generate

db-generation-check:
	./scripts/check-sqlc.sh
