.PHONY: install install-dev lint format typecheck test test-cov clean all check

# Install production dependencies
install:
	pip install -e .

# Install development dependencies
install-dev:
	pip install -e ".[dev]"

# Run all linters
lint:
	ruff check claude_reviewer tests
	black --check claude_reviewer tests
	isort --check-only claude_reviewer tests

# Format code
format:
	autoflake --in-place --remove-all-unused-imports --recursive claude_reviewer tests
	isort claude_reviewer tests
	black claude_reviewer tests

# Run type checker
typecheck:
	mypy claude_reviewer

# Run tests
test:
	pytest tests/

# Run tests with coverage
test-cov:
	pytest tests/ --cov=claude_reviewer --cov-report=term-missing --cov-report=html

# Run all checks (lint, typecheck, test)
check: lint typecheck test

# Run all checks and format
all: format check

# Clean up generated files
clean:
	rm -rf .pytest_cache .mypy_cache .coverage htmlcov build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
