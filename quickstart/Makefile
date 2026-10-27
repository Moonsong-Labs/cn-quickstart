# Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
# SPDX-License-Identifier: 0BSD

# Force bash as a shell
SHELL := /usr/bin/env bash

# Set default goal to 'help' if no target is specified
.DEFAULT_GOAL := help

ifneq (,$(wildcard .env))
    include .env
endif

# export SPLICE_VERSION as IMAGE_TAG mandatory for Splice LocalNet
export IMAGE_TAG=$(SPLICE_VERSION)

ifneq (,$(wildcard .env.local))
    include .env.local
endif

ifndef MODULES_DIR
  export MODULES_DIR=$(shell pwd)/docker/modules
endif

ifndef LOCALNET_DIR
  export LOCALNET_DIR=$(MODULES_DIR)/localnet
endif

# Print out info about paths:
ifdef PATH_DEBUG_INFO
  $(warning MODULES_DIR=$(MODULES_DIR))
  $(warning LOCALNET_DIR=$(LOCALNET_DIR))
endif

# Default to adding resource constraints for Quickstart compose stack.
RESOURCE_CONSTRAINTS_ENABLED ?= true

# project main compose file
DOCKER_COMPOSE_FILES := -f compose.yaml

############################################################################
####  Setup Splice LocalNet
############################################################################
DOCKER_COMPOSE_FILES += -f ${LOCALNET_DIR}/compose.yaml
DOCKER_COMPOSE_PROFILES := --profile app-provider --profile app-user --profile sv --profile swagger-ui
DOCKER_COMPOSE_ENVFILE := --env-file .env --env-file .env.local --env-file ${LOCALNET_DIR}/compose.env --env-file ${LOCALNET_DIR}/env/common.env
ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
  RESOURCE_CONSTRAINT_CONFIG := -f ${LOCALNET_DIR}/resource-constraints.yaml
endif

############################################################################
####  Keycloak (optional)
############################################################################
ifeq ($(AUTH_MODE),oauth2)
    DOCKER_COMPOSE_FILES += -f ${MODULES_DIR}/keycloak/compose.yaml
    DOCKER_COMPOSE_PROFILES += --profile keycloak
    DOCKER_COMPOSE_ENVFILE += --env-file ${MODULES_DIR}/keycloak/compose.env

    ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
      RESOURCE_CONSTRAINT_CONFIG += -f ${MODULES_DIR}/keycloak/resource-constraints.yaml
    endif
endif

############################################################################
####  Splice Onboarding
############################################################################
DOCKER_COMPOSE_FILES += -f ${MODULES_DIR}/splice-onboarding/compose.yaml
ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
  RESOURCE_CONSTRAINT_CONFIG += -f ${MODULES_DIR}/splice-onboarding/resource-constraints.yaml
endif

############################################################################
####  PQS
############################################################################
DOCKER_COMPOSE_FILES += -f ${MODULES_DIR}/pqs/compose.yaml
DOCKER_COMPOSE_PROFILES += --profile pqs-app-provider
ifeq ($(PQS_APP_USER_PROFILE),on)
  DOCKER_COMPOSE_PROFILES += --profile pqs-app-user
endif
ifeq ($(PQS_SV_PROFILE),on)
  DOCKER_COMPOSE_PROFILES += --profile pqs-sv
endif
DOCKER_COMPOSE_ENVFILE += --env-file ${MODULES_DIR}/pqs/compose.env
ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
  RESOURCE_CONSTRAINT_CONFIG += -f ${MODULES_DIR}/pqs/resource-constraints.yaml
endif

############################################################################
####  backend-service
############################################################################
ifeq ($(RESOURCE_CONSTRAINTS_ENABLED),true)
  RESOURCE_CONSTRAINT_CONFIG += -f ./docker/backend-service/resource-constraints.yaml
endif
ifeq ($(DEBUG_ENABLED),true)
  DOCKER_COMPOSE_FILES += -f ./docker/backend-service/debug.yaml
endif

# Custom overrides if needed
#DOCKER_COMPOSE_FILES += -f <your_custom_compose_overrides.yaml>
#DOCKER_COMPOSE_ENVFILE += --env-file <your_custom_env_overrides_file>

# Function to run docker-compose with default files and environment
define docker-compose
	docker compose $(DOCKER_COMPOSE_FILES) $(DOCKER_COMPOSE_ENVFILE) $(DOCKER_COMPOSE_PROFILES) $(1)
endef

QS := bun --no-env-file cli/src/main.ts
SETUP_COMMAND := $(QS) setup

# Build targets
.PHONY: build
build: ## Build frontend, backend, Daml model and docker images
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
test: test-daml ## Run unit tests

.PHONY: test-daml
test-daml: ## Run daml tests
test-daml: build-daml
	./gradlew :daml:testDaml

.PHONY: build-docker-images
build-docker-images:
	$(QS) build images

.PHONY: create-app-install-request
create-app-install-request: DOCKER_COMPOSE_FILES = -f docker/create-app-install-request/compose.yaml
create-app-install-request: DOCKER_COMPOSE_PROFILES =
create-app-install-request: docker-available ## Submit an App Install Request from the App User participant node
	$(call docker-compose, run --rm container)

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
	make start vite-dev

.PHONY: vite-dev
vite-dev:
	@echo "Starting Vite frontend development server..."
	bun run --filter frontend dev

.PHONY: stop
stop: ## Stop the application
	$(QS) stop

.PHONY: stop-application
stop-application: ## Stop the application containers
	$(QS) stop

.PHONY: restart
restart: ## Restart the application
	$(QS) restart

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
capture-logs: docker-available ## Monitor docker events and capture logs
	@network_name="quickstart"; \
	canton_services=("canton" "splice" "backend-service"); \
	mkdir -p ./logs; rm -rf ./logs/*; \
	docker events -f type=container \
	    -f event=start \
	    -f event=stop \
	    -f event=restart \
	    -f event=kill \
	    -f event=die \
	    -f event=destroy \
	    -f event=health_status \
	    -f event=oom \
	    --format '{{.Actor.ID}} {{.Time}} {{.Actor.Attributes.name}} {{.Action}}' | \
	while read -r cid time service_name status; do \
	    network_attached=$$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$$cid" 2>/dev/null | \
	        jq -r 'keys[] | select(. | contains ("'"$$network_name"'"))'); \
	    if [ -z "$$network_attached" ]; then \
	        continue; \
	    fi; \
	    echo "$$(date -u -d "@$$time" +"%Y-%m-%dT%H:%M:%S") $$service_name $$status"; \
	    if [ "$$status" = "start" ]; then \
	        echo ">> $$service_name"; \
	        ext=".log"; \
	        for svc in "$${canton_services[@]}"; do \
	            if [ "$$service_name" = "$$svc" ]; then \
	                ext=".clog"; \
	                break; \
	            fi; \
	        done; \
	        docker logs -f "$$cid" >> "./logs/$$service_name$$ext" 2>&1 & \
	    fi; \
done | tee -a "logs/compose.log" 2>&1

# Development environment
.PHONY: setup
setup: ## Configure the local development environment
	@echo "Starting local environment setup tool..."
	$(SETUP_COMMAND)

.PHONY: integration-test
integration-test: docker-available ## Run integration tests
	@docker rm -f environment-init 2> /dev/null || true
	@if [ "$(TEST_MODE)" = "off" ]; then \
		echo "To run the integration tests Quickstart must be started in test mode. Please run \"make setup\" and enable TEST_MODE when prompted"; \
		exit 1; \
	fi
	@if [ "$(AUTH_MODE)" = "shared-secret" ]; then \
		echo "Integration tests supported only for AUTH_MODE=oauth2."; \
		exit 1; \
	fi
	@bun install --frozen-lockfile && \
	cd integration-test && \
	bunx playwright test

.PHONY: show-integration-test-report
show-integration-test-report: ## Show the integration test report
	@cd integration-test && \
	bunx playwright show-report --port=9323 --host=0.0.0.0

# Console
.PHONY: canton-console
canton-console: docker-available ## Start the Canton console
	$(call docker-compose, $(RESOURCE_CONSTRAINT_CONFIG) run --rm --name canton-console console)

.PHONY: clean-canton-console
clean-canton-console: docker-available ## Stop and remove the Canton console container
	docker rm -f canton-console 2> /dev/null || true

# Shell
.PHONY: shell
shell: DOCKER_COMPOSE_FILES = -f ${MODULES_DIR}/daml-shell/compose.yaml
shell: DOCKER_COMPOSE_ENVFILE += --env-file ${MODULES_DIR}/daml-shell/compose.env
shell: DOCKER_COMPOSE_PROFILES =
shell: docker-available ## Start Daml Shell
	$(call docker-compose, run --rm daml-shell)

.PHONY: clean-shell
clean-shell: docker-available ## Stop and remove the Daml Shell container
	docker rm -f quickstart-daml-shell 2> /dev/null || true

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
	echo "AUTH_MODE=oauth2" > .env.local
	echo "PARTY_HINT=quickstart-ci-1" >> .env.local
	echo "TEST_MODE=on" >> .env.local

# Install playwright dependencies in CI/CD
.PHONY: ci-install-playwright
ci-install-playwright:
	bun install --frozen-lockfile \
		&& cd integration-test \
		&& bunx playwright install chromium --with-deps

endif

# Run arbitrary command with environment variables set
ifneq ($(origin COMMAND), undefined)
.DEFAULT_GOAL := run-command
endif

.PHONY: run-command
run-command:
	$(COMMAND)

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
