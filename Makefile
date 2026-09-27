.PHONY: api-run api-generate api-format api-format-check api-test api-build api-check

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
