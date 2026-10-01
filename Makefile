GO ?= go
COMPOSE = docker compose -f deploy/compose.yaml --env-file deploy/.env

.PHONY: generate vet lint test test-short sqlc-check check run migrate compose-up compose-down

generate:
	$(GO) tool sqlc generate

vet:
	$(GO) vet ./...

lint: vet
	$(GO) tool staticcheck ./...

test:
	$(GO) test ./...

test-short:
	$(GO) test -short ./...

sqlc-check:
	$(GO) tool sqlc diff

check: sqlc-check lint test

run:
	$(GO) run ./cmd/snuarchive serve

migrate:
	$(GO) run ./cmd/snuarchive migrate up

compose-up:
	$(COMPOSE) up -d --build

compose-down:
	$(COMPOSE) down
