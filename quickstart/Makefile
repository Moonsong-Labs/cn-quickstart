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
