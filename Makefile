IMAGE_NAME := bowles/claude-reviewer
TAG := latest
PLATFORMS := linux/amd64,linux/arm64

.PHONY: docker-build docker-push release buildx-setup

# Setup buildx builder for multi-arch builds
buildx-setup:
	@docker buildx inspect multiarch >/dev/null 2>&1 || \
		docker buildx create --name multiarch --use
	@docker buildx use multiarch

# Build for local architecture only (faster for development)
docker-build:
	docker build -t $(IMAGE_NAME):$(TAG) .

# Build and push multi-architecture image
docker-buildx: buildx-setup
	docker buildx build --platform $(PLATFORMS) \
		-t $(IMAGE_NAME):$(TAG) \
		--push .

release:
	@echo "Ensuring git is clean..."
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Uncommitted changes found."; \
		exit 1; \
	fi
	$(MAKE) docker-buildx
	@echo "Docker release complete!"
