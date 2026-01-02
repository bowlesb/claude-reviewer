# Claude Reviewer

A local PR review system for Claude Code. Create pull requests, review diffs with inline comments, and merge changes—all without leaving your terminal.

[![PyPI version](https://badge.fury.io/py/claude-reviewer.svg)](https://badge.fury.io/py/claude-reviewer)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why Claude Reviewer?

When working with AI coding assistants like Claude, you often want to review changes before merging them. Claude Reviewer provides:

- **GitHub-like code review** - View diffs, add inline comments, approve or request changes
- **CLI-first workflow** - Perfect for AI agents that work in the terminal
- **Local & private** - All data stays on your machine
- **No external dependencies** - Just SQLite for storage

## Installation

```bash
pip install claude-reviewer
```

## Quick Start

### 1. Create a PR

```bash
# On your feature branch with changes
claude-reviewer create --title "Add new feature"

# Output:
# PR #a1b2c3d4 created successfully
# Review URL: http://localhost:3456/prs/a1b2c3d4
```

### 2. Start the Web UI

```bash
# Start the review interface
claude-reviewer serve
```

### 3. Review & Merge

```bash
# Check status
claude-reviewer status a1b2c3d4
# Output: changes_requested

# See comments
claude-reviewer comments a1b2c3d4
# Output: [src/app.py:42] Please add error handling here

# After addressing feedback, update the PR
claude-reviewer update a1b2c3d4

# Once approved, merge
claude-reviewer merge a1b2c3d4 --push
```

## Commands

| Command | Description |
|---------|-------------|
| `create` | Create a new PR from current branch |
| `list` | List all PRs |
| `status` | Check PR status |
| `comments` | Get inline comments with file:line references |
| `show` | Show detailed PR information |
| `update` | Update PR diff after making changes |
| `merge` | Merge an approved PR |
| `serve` | Start the web UI |
| `stop` | Stop the web UI |

## CLI Reference

### Create a PR

```bash
claude-reviewer create \
  --title "Feature: Add user authentication" \
  --description "Implements OAuth2 login flow" \
  --base main \
  --head feature/auth
```

### List PRs

```bash
# All PRs
claude-reviewer list

# Filter by status
claude-reviewer list --status pending
claude-reviewer list --status approved
claude-reviewer list --status changes_requested
```

### Get Comments

```bash
# Human-readable format
claude-reviewer comments a1b2c3d4

# JSON format (for automation)
claude-reviewer comments a1b2c3d4 -f json

# Only unresolved comments
claude-reviewer comments a1b2c3d4 --unresolved
```

### Merge

```bash
# Merge locally
claude-reviewer merge a1b2c3d4

# Merge and push to remote
claude-reviewer merge a1b2c3d4 --push

# Merge and delete source branch
claude-reviewer merge a1b2c3d4 --delete-branch
```

## Web UI

The web interface provides:

- **Diff viewer** - Side-by-side or unified view
- **Inline comments** - Click any line to add a comment
- **File tree** - Navigate between changed files
- **Review actions** - Approve or request changes

Start it with:

```bash
claude-reviewer serve
```

This automatically pulls the Docker image from Docker Hub and starts the web UI.
Open http://localhost:3456 to view your PRs.

### Serve Options

```bash
# Use a different port
claude-reviewer serve --port 8080

# Skip pulling latest image (use cached)
claude-reviewer serve --no-pull

# Development mode (uses local docker-compose)
claude-reviewer serve --dev
```

## Configuration

### Default Port

The web UI runs on port **3456** by default (chosen to avoid conflicts with common dev servers like React on 3000).

To use a different port:

```bash
# Via environment variable
PORT=8080 claude-reviewer serve

# Or via CLI flag
claude-reviewer serve --port 8080
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port for web UI | `3456` |
| `CLAUDE_REVIEWER_HOST` | Host for review URLs | `localhost` |
| `CLAUDE_REVIEWER_WEB_DIR` | Path to web app | (auto-detected) |

### Database Location

Data is stored in `~/.claude-reviewer/data.db`

### CLAUDE.md Integration

Add claude-reviewer to your project's `CLAUDE.md` file so Claude Code knows how to use it:

```markdown
## Code Review Workflow

When making significant changes, use the local review system:

1. Create a PR for review:
   ```bash
   claude-reviewer create --title "Description of changes"
   ```

2. Wait for review:
   ```bash
   claude-reviewer watch <pr-id> --until changes_requested
   ```

3. Address feedback by replying to comments:
   ```bash
   claude-reviewer comments <pr-id>
   claude-reviewer reply <pr-id> <comment-uuid> "Fixed by doing X"
   ```

4. Update the PR after fixes:
   ```bash
   claude-reviewer update <pr-id>
   ```

5. Merge when approved:
   ```bash
   claude-reviewer merge <pr-id>
   ```
```

## Docker

The `claude-reviewer serve` command automatically pulls and runs the Docker image.
You don't need to manually manage Docker - just run:

```bash
claude-reviewer serve   # Pulls image and starts container
claude-reviewer stop    # Stops the container
```

### Manual Docker Usage

If you prefer to run Docker manually:

```bash
# Pull and run (using host user for proper file permissions)
docker run -d \
  --name claude-reviewer-web \
  --user "$(id -u):$(id -g)" \
  -p 3456:3000 \
  -v ~/.claude-reviewer:/data \
  -v ~:/host-home:ro \
  bowles/claude-reviewer:latest
```

### Development with Docker Compose

For local development:

```bash
git clone https://github.com/bowlesb/claude-reviewer
cd claude-reviewer
pip install -e claude-reviewer-cli
claude-reviewer serve --dev
```

## Integration with Claude Code

Claude Reviewer is designed to work seamlessly with Claude Code:

```bash
# Claude makes changes
git checkout -b feature/new-thing
# ... Claude writes code ...
git commit -m "Add new feature"

# Claude creates PR
claude-reviewer create --title "Add new feature"
# Output: Review URL: http://localhost:3456/prs/abc123

# User reviews in browser, requests changes

# Claude checks for feedback
claude-reviewer status abc123  # "changes_requested"
claude-reviewer comments abc123
# [src/api.py:45] Add input validation

# Claude addresses feedback
# ... makes fixes ...
git commit -m "Add input validation"
claude-reviewer update abc123

# User approves

# Claude merges
claude-reviewer merge abc123 --push
```

## Development

```bash
# Clone the repo
git clone https://github.com/benbowles/claude-reviewer
cd claude-reviewer/claude-reviewer-cli

# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
make test

# Type checking
make typecheck

# Format code
make format
```

## License

MIT
