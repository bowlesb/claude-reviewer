IMAGE_NAME := bowles/claude-reviewer
TAG := latest

.PHONY: docker-build docker-push release

docker-build:
	docker build -t $(IMAGE_NAME):$(TAG) .

docker-push:
	docker push $(IMAGE_NAME):$(TAG)

release:
	@echo "Ensuring git is clean..."
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Uncommitted changes found."; \
		exit 1; \
	fi
	$(MAKE) docker-build
	$(MAKE) docker-push
	@echo "Docker release complete!"
