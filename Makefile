APP ?= slok-dashboard
ADDR ?= :8080

.PHONY: run
run:
	go run ./cmd/dashboard --addr $(ADDR)

.PHONY: test
test:
	go test ./...

.PHONY: build
build:
	go build -o bin/$(APP) ./cmd/dashboard
