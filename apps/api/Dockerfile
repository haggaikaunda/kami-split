FROM golang:1.27.1-bookworm AS dependencies
WORKDIR /workspace/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download && go mod verify
# Keep compilation output in an ordinary layer: exported BuildKit caches do not
# persist cache mounts. Seed only runtime library imports before copying source.
RUN CGO_ENABLED=0 go build -trimpath \
    github.com/99designs/gqlgen/graphql \
    github.com/99designs/gqlgen/graphql/handler \
    github.com/99designs/gqlgen/graphql/handler/extension \
    github.com/99designs/gqlgen/graphql/handler/transport \
    github.com/99designs/gqlgen/graphql/introspection \
    github.com/MicahParks/keyfunc/v3 \
    github.com/golang-jwt/jwt/v5 \
    github.com/google/uuid \
    github.com/jackc/pgx/v5 \
    github.com/jackc/pgx/v5/pgconn \
    github.com/jackc/pgx/v5/pgtype \
    github.com/jackc/pgx/v5/pgxpool \
    github.com/vektah/gqlparser/v2 \
    github.com/vektah/gqlparser/v2/ast \
    github.com/vektah/gqlparser/v2/gqlerror

FROM dependencies AS source
COPY apps/api/ ./
COPY packages/schema/ /workspace/packages/schema/

FROM source AS verify
RUN test -z "$(gofmt -l .)" && go vet ./... && go test -race ./... && go build ./...
RUN cp go.mod /tmp/go.mod && cp go.sum /tmp/go.sum && cp -R internal/graph /tmp/graph && \
    go tool gqlgen generate && diff -r /tmp/graph internal/graph && \
    cmp /tmp/go.mod go.mod && cmp /tmp/go.sum go.sum

FROM source AS build
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

FROM alpine:3.23.3 AS runtime
RUN apk add --no-cache ca-certificates
COPY --from=build /out/server /usr/local/bin/server
COPY --from=build /out/worker /usr/local/bin/worker
USER 65532:65532
EXPOSE 8080 8081
ENTRYPOINT ["/usr/local/bin/server"]
