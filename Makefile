.PHONY: up down reset test test-api e2e e2e-web logs

up: ## Build and start the full stack
	docker compose up --build -d

down: ## Stop the stack, keep the data
	docker compose down

reset: ## Stop the stack and delete the database volume (re-seeds on next `up`)
	docker compose down -v

test: test-api e2e e2e-web ## Run every test suite in Docker (starts the stack)

test-api: ## API integration tests against the compose Postgres
	docker compose --profile test run --rm --build api-test

e2e: up ## HTTP end-to-end flows against the running stack (through nginx)
	docker compose --profile test run --rm --build -e E2E=1 -e E2E_BASE_URL=http://web api-test

e2e-web: up ## Browser tests (Playwright) against the running stack
	docker compose --profile test run --rm --build web-e2e

logs:
	docker compose logs -f api
