# Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
# SPDX-License-Identifier: 0BSD

# Force bash as a shell
SHELL := /usr/bin/env bash

# Set default goal to 'help' if no target is specified
.DEFAULT_GOAL := help

QS := bun --no-env-file cli/src/main.ts
SETUP_COMMAND := $(QS) setup
# Parent of this Makefile. package.json and bun.lock live here, and qs imports those packages.
REPO_ROOT := $(abspath $(dir $(abspath $(lastword $(MAKEFILE_LIST))))/..)
# Frozen install of that lockfile. setup and build run it before qs, which cannot start without the packages.
INSTALL_WORKSPACE := cd "$(REPO_ROOT)" && bun install --frozen-lockfile

# Build targets
.PHONY: build
build: ## Build frontend, backend, Daml model and docker images
	$(INSTALL_WORKSPACE)
	$(QS) build

.PHONY: build-frontend
build-frontend: ## Build the frontend application
	$(QS) build frontend

.PHONY: build-backend
build-backend: ## Build the backend service
	$(QS) build backend

.PHONY: build-daml
build-daml: ## Build the Daml model
	$(QS) build daml

.PHONY: docker-available
docker-available: ## Check if Docker CLI exists and is running
	$(QS) doctor

.PHONY: check-docker
check-docker: ## Check Docker and Docker Compose versions
	$(QS) doctor

.PHONY: test
test: ## Run unit tests
	$(QS) test

.PHONY: test-daml
test-daml: ## Run daml tests
	$(QS) test daml

.PHONY: build-docker-images
build-docker-images:
	$(QS) build images

.PHONY: create-app-install-request
create-app-install-request: ## Submit an App Install Request from the App User participant node
	$(QS) demo install-request

.PHONY: restart-backend
restart-backend: ## Build and start the application
	$(QS) restart backend

.PHONY: restart-frontend
restart-frontend: ## Build and start the application
	$(QS) restart frontend

.PHONY: restart-service
restart-service:
	@if [ -z "${SERVICE}" ]; then \
	  echo "Usage: make restart-service SERVICE=<service>"; exit 1; \
	fi
	$(QS) restart $(SERVICE)

# Run targets
.PHONY: start
start: ## Start the application
	$(QS) start

.PHONY: start-vite-dev
start-vite-dev: ## Start the frontend application in development mode
	$(QS) dev frontend --start

.PHONY: vite-dev
vite-dev:
	$(QS) dev frontend

.PHONY: stop
stop: ## Stop the application
	$(QS) stop

.PHONY: stop-application
stop-application: ## Stop the application containers
	$(QS) stop

.PHONY: restart
restart: ## Restart the application
	$(QS) restart

# LocalNet only: the Splice LocalNet network without the Quickstart application.
# Needs only Docker and git: no `make setup`, no `make build`, and no Bun, JDK, or Node.js.
# Don't run it at the same time as `make start`; both bind the same ports.
# The application constraint files also list application modules, so use LocalNet's file only.
QUICKSTART_DIR := $(abspath $(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
LOCALNET_ROW := $(shell awk -F, '/^[[:space:]]*\043/ || /^[[:space:]]*$$/ { next } { s = $$3; gsub(/^[[:space:]]+|[[:space:]]+$$/, "", s); sub(/\/+$$/, "", s); n = split(s, p, "/"); if (p[n] == "localnet") { print; exit } }' "$(QUICKSTART_DIR)/links.csv")
LOCALNET_REPO := $(shell printf '%s\n' '$(LOCALNET_ROW)' | awk -F, '{ gsub(/^[[:space:]]+|[[:space:]]+$$/, "", $$1); print $$1 }')
LOCALNET_SHA := $(shell printf '%s\n' '$(LOCALNET_ROW)' | awk -F, '{ gsub(/^[[:space:]]+|[[:space:]]+$$/, "", $$2); print $$2 }')
LOCALNET_SOURCE := $(shell printf '%s\n' '$(LOCALNET_ROW)' | awk -F, '{ gsub(/^[[:space:]]+|[[:space:]]+$$/, "", $$3); sub(/\/+$$/, "", $$3); print $$3 }')
LOCALNET_DEST := $(shell printf '%s\n' '$(LOCALNET_ROW)' | awk -F, '{ gsub(/^[[:space:]]+|[[:space:]]+$$/, "", $$4); sub(/\/+$$/, "", $$4); print $$4 }')
LOCALNET_CACHE_DIR := $(QUICKSTART_DIR)/$(LOCALNET_DEST)/localnet/$(LOCALNET_SHA)
LOCALNET_DIR ?= $(LOCALNET_CACHE_DIR)
LOCALNET_OVERRIDES_DIR := $(QUICKSTART_DIR)/docker/modules/localnet-overrides
SPLICE_VERSION := $(shell sed -n 's/^SPLICE_VERSION=//p' .env)
IMAGE_TAG ?= $(SPLICE_VERSION)
RESOURCE_CONSTRAINTS_ENABLED ?= true
ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
  LOCALNET_ONLY_RESOURCE_CONSTRAINTS := -f $(LOCALNET_DIR)/resource-constraints.yaml
endif
LOCALNET_ONLY_COMPOSE = LOCALNET_DIR="$(LOCALNET_DIR)" IMAGE_TAG="$(IMAGE_TAG)" docker compose \
	--env-file $(LOCALNET_DIR)/compose.env \
	--env-file $(LOCALNET_DIR)/env/common.env \
	--env-file $(LOCALNET_OVERRIDES_DIR)/localnet.env \
	-f $(LOCALNET_DIR)/compose.yaml \
	-f $(LOCALNET_OVERRIDES_DIR)/compose.yaml $(LOCALNET_ONLY_RESOURCE_CONSTRAINTS) \
	--profile sv --profile app-provider --profile app-user

# Fetch the pinned Splice LocalNet tree into the cache when using the default LOCALNET_DIR.
# Refreshes when the cache directory is missing or when localnet-overrides/patches/*.patch changed.
# Uses the same git commands and arguments as `qs vendor` so this path stays free of Bun.
.PHONY: ensure-localnet
ensure-localnet:
	@if [ "$(LOCALNET_DIR)" = "$(LOCALNET_CACHE_DIR)" ]; then \
	  set -euo pipefail; \
	  LC_ALL=C; export LC_ALL; shopt -s nullglob; \
	  patch_stamp=""; \
	  for patch in "$(LOCALNET_OVERRIDES_DIR)"/patches/*.patch; do \
	    patch_stamp+="$$(basename "$$patch"):$$(git hash-object "$$patch")"$$'\n'; \
	  done; \
	  recorded_stamp=""; \
	  if [ -f "$(LOCALNET_DIR).patches" ]; then \
	    recorded_stamp="$$(cat "$(LOCALNET_DIR).patches")"; \
	    if [ -n "$$recorded_stamp" ]; then recorded_stamp+=$$'\n'; fi; \
	  fi; \
	  if [ ! -d "$(LOCALNET_DIR)" ] || [ "$$recorded_stamp" != "$$patch_stamp" ]; then \
	    if ! [[ "$(LOCALNET_SHA)" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$$ ]]; then \
	      echo "Invalid LocalNet commit SHA in links.csv: $(LOCALNET_SHA)" >&2; exit 1; \
	    fi; \
	    if [ -z "$(LOCALNET_REPO)" ] || [[ "$(LOCALNET_REPO)" == -* ]]; then \
	      echo "Invalid LocalNet repo in links.csv: $(LOCALNET_REPO)" >&2; exit 1; \
	    fi; \
	    if [ -z "$(LOCALNET_SOURCE)" ] || [[ "$(LOCALNET_SOURCE)" == -* ]] || [[ "$(LOCALNET_SOURCE)" == /* ]] || [[ "/$(LOCALNET_SOURCE)/" == */../* ]]; then \
	      echo "Invalid LocalNet source path in links.csv: $(LOCALNET_SOURCE)" >&2; exit 1; \
	    fi; \
	    if [ -z "$(LOCALNET_DEST)" ] || [[ "$(LOCALNET_DEST)" == -* ]] || [[ "$(LOCALNET_DEST)" == /* ]] || [[ "/$(LOCALNET_DEST)/" == */../* ]]; then \
	      echo "Invalid LocalNet destination path in links.csv: $(LOCALNET_DEST)" >&2; exit 1; \
	    fi; \
	    cache_parent="$$(dirname "$(LOCALNET_DIR)")"; \
	    mkdir -p "$$cache_parent"; \
	    tmp=$$(mktemp -d "$$cache_parent/.qs-vendor-XXXXXX"); \
	    trap 'rm -rf "$$tmp"' EXIT; \
	    git init --quiet "$$tmp"; \
	    git -C "$$tmp" remote add origin "$(LOCALNET_REPO)"; \
	    git -C "$$tmp" sparse-checkout set --cone "$(LOCALNET_SOURCE)"; \
	    git -C "$$tmp" fetch --depth 1 --filter=blob:none origin "$(LOCALNET_SHA)"; \
	    git -C "$$tmp" checkout --quiet --detach FETCH_HEAD; \
	    if [ ! -d "$$tmp/$(LOCALNET_SOURCE)" ]; then \
	      echo "Checkout has no '$(LOCALNET_SOURCE)' at $(LOCALNET_SHA)." >&2; exit 1; \
	    fi; \
	    for patch in "$(LOCALNET_OVERRIDES_DIR)"/patches/*.patch; do \
	      git -C "$$tmp" apply --directory="$(LOCALNET_SOURCE)" "$$patch"; \
	    done; \
	    if [ -d "$(LOCALNET_DIR)" ]; then \
	      mv "$(LOCALNET_DIR)" "$$tmp/.old"; \
	    fi; \
	    if ! mv "$$tmp/$(LOCALNET_SOURCE)" "$(LOCALNET_DIR)"; then \
	      if [ -d "$$tmp/.old" ]; then mv "$$tmp/.old" "$(LOCALNET_DIR)"; fi; \
	      exit 1; \
	    fi; \
	    printf '%s' "$$patch_stamp" > "$(LOCALNET_DIR).patches"; \
	  fi; \
	fi

.PHONY: start-localnet
start-localnet: ensure-localnet ## Start only Splice LocalNet, without building or starting the application
	@docker info >/dev/null
	$(LOCALNET_ONLY_COMPOSE) up -d

.PHONY: stop-localnet
stop-localnet: ensure-localnet ## Stop LocalNet started with start-localnet, keeping its data
	@docker info >/dev/null
	$(LOCALNET_ONLY_COMPOSE) down

.PHONY: clean-localnet
clean-localnet: ensure-localnet ## Stop LocalNet started with start-localnet and remove its data
	@docker info >/dev/null
	$(LOCALNET_ONLY_COMPOSE) down -v

.PHONY: status-localnet
status-localnet: ensure-localnet ## Show status of LocalNet started with start-localnet
	@docker info >/dev/null
	$(LOCALNET_ONLY_COMPOSE) ps

# Utility targets
.PHONY: status
status: ## Show status of Docker containers
	$(QS) status

.PHONY: compose-config
compose-config:
	$(QS) compose config

.PHONY: logs
logs: ## Show logs of Docker containers
	$(QS) logs

.PHONY: tail
tail: ## Tail logs of Docker containers
	$(QS) logs -f

.PHONY: capture-logs
capture-logs: ## Monitor docker events and capture logs
	$(QS) logs --capture

# Development environment
.PHONY: setup
setup: ## Configure the local development environment
	$(INSTALL_WORKSPACE)
	$(SETUP_COMMAND)

.PHONY: integration-test
integration-test: ## Run integration tests
	$(QS) test integration

.PHONY: show-integration-test-report
show-integration-test-report: ## Show the integration test report
	$(QS) test report

# Console
.PHONY: canton-console
canton-console: ## Start the Canton console
	$(QS) console

.PHONY: clean-canton-console
clean-canton-console: ## Stop and remove the Canton console container
	$(QS) clean console

# Shell
.PHONY: shell
shell: ## Start Daml Shell
	$(QS) shell

.PHONY: clean-shell
clean-shell: ## Stop and remove the Daml Shell container
	$(QS) clean shell

# Clean targets
.PHONY: clean
clean: ## Clean the build artifacts
	$(QS) clean build

.PHONY: clean-docker
clean-docker: ## Stop and remove application Docker containers and volumes
	$(QS) clean docker

.PHONY: clean-application
clean-application: ## Stop and remove the application containers and volumes
	$(QS) clean docker

.PHONY: clean-all
clean-all: ## Stop and remove all build artifacts, Docker containers and volumes
	$(QS) clean all --yes

.PHONY: clean-all-docker
clean-all-docker: ## Stop and remove leftover containers, the project network, and its volumes
	$(QS) clean sweep

.PHONY: generate-NOTICES
generate-NOTICES: ## Generate the NOTICES.txt file
	./gradlew generateNotices

# Help target
.PHONY: help
help: ## Show this help message
	@echo "Usage: make [target]"
	@echo
	@echo "Available targets:"
	@grep -E '^(# )?[a-zA-Z_-]+:.*?## .*$$' Makefile | sed -e 's/^# //' | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

## Conditional targets for CI/CD, only available if CI == true
ifeq ($(CI),true)

# Populate .env.local for CI/CD purposes
.PHONY: ci-create-env-local
ci-create-env-local:
	$(QS) setup --auth-mode oauth2 --party-hint quickstart-ci-1 --test-mode on --yes

# Install playwright dependencies in CI/CD
.PHONY: ci-install-playwright
ci-install-playwright:
	$(QS) test browsers --with-deps

endif

.PHONY: open-app-ui
open-app-ui: ## Open the Application UI in the active browser
	$(QS) open app

.PHONY: open-sv-wallet
open-sv-wallet: ## Open the Super Validator wallet UI in the active browser
	$(QS) open sv-wallet

.PHONY: open-sv-interface
open-sv-interface: ## Open the Super Validator interface UI in the active browser
	$(QS) open sv

.PHONY: open-sv-scan
open-sv-scan: ## Open the Super Validator Scan UI in the active browser
	$(QS) open scan

.PHONY: open-app-user-wallet
open-app-user-wallet: ## Open the App User wallet UI in the active browser
	$(QS) open app-user-wallet

.PHONY: open-swagger-ui
open-swagger-ui: ## Open Swagger UI to view Canton JSON API V2 Open API in the active browser
	$(QS) open swagger
