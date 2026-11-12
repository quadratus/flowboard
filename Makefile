.PHONY: up down reset test test-api logs

up: ## Build and start the full stack
	docker compose up --build -d

down: ## Stop the stack, keep the data
	docker compose down

reset: ## Stop the stack and delete the database volume (re-seeds on next `up`)
	docker compose down -v

test: test-api ## Run every test suite in Docker

test-api: ## API integration tests against the compose Postgres
	docker compose --profile test run --rm --build api-test

logs:
	docker compose logs -f api
