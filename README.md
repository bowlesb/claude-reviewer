# Claude Reviewer

A local PR review system for Claude Code. Create pull requests, review diffs with inline comments, and merge changes—all without leaving your local environment.

## Overview

Claude Reviewer provides a GitHub-like code review experience for local development:

- **Python CLI** (`claude-reviewer`) - Create and manage PRs from the command line
- **Web UI** - Review diffs, add inline comments, approve or request changes
- **SQLite Database** - Persistent storage shared between CLI and web app

```
┌─────────────────┐          ┌─────────────────┐
│  Claude (CLI)   │          │  User (Browser) │
└────────┬────────┘          └────────┬────────┘
         │                            │
         │ claude-reviewer create     │ http://localhost:3000
         │ claude-reviewer status     │
         │ claude-reviewer comments   │
         v                            v
┌────────────────────────────────────────────────┐
│              SQLite Database                   │
│           ~/.claude-reviewer/data.db           │
└────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install the CLI

```bash
cd claude-reviewer-cli
pip install -e .
```

### 2. Start the Web UI

**Option A: Using npm (development)**
```bash
npm install
npm run dev
```

**Option B: Using Docker**
```bash
# From the claude_reviewer directory
claude-reviewer serve

# Or specify the directory explicitly
claude-reviewer serve --dir /path/to/claude_reviewer
```

### 3. Create Your First PR

```bash
# From your project directory, on a feature branch
claude-reviewer create --title "Add new feature"

# Output:
# PR #a1b2c3d4 created successfully
# Review URL: http://localhost:3000/prs/a1b2c3d4
```

### 4. Review and Merge

1. Open the review URL in your browser
2. Review the diff and add inline comments
3. Approve or request changes
4. Once approved, merge via CLI:

```bash
claude-reviewer merge a1b2c3d4
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `claude-reviewer create -t "Title"` | Create a new PR for the current branch |
| `claude-reviewer list` | List all PRs |
| `claude-reviewer status <id>` | Check PR status (pending/approved/changes_requested) |
| `claude-reviewer comments <id>` | Get inline comments with file:line references |
| `claude-reviewer show <id>` | Show detailed PR information |
| `claude-reviewer update <id>` | Update PR diff after making changes |
| `claude-reviewer merge <id>` | Merge an approved PR |
| `claude-reviewer serve` | Start the web UI (Docker) |
| `claude-reviewer stop` | Stop the web UI |

### CLI Examples

```bash
# Create a PR comparing current branch to main
claude-reviewer create --title "Fix authentication bug" --base main

# Create with description
claude-reviewer create -t "Add user settings" -d "Implements user preferences page"

# Get comments in JSON format (useful for automation)
claude-reviewer comments a1b2c3d4 --json

# List only pending PRs
claude-reviewer list --status pending

# Merge and push to remote
claude-reviewer merge a1b2c3d4 --push

# Merge and delete the source branch
claude-reviewer merge a1b2c3d4 --delete-branch
```

## Web UI Features

- **PR List Dashboard** - View all PRs with status filtering
- **Diff Viewer** - Side-by-side or unified diff view
- **Inline Comments** - Click any line to add a comment
- **File Tree** - Navigate between changed files
- **Review Actions** - Approve or request changes with summary

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_DIR` | Directory for SQLite database | `~/.claude-reviewer` |
| `DATABASE_PATH` | Full path to database file | `~/.claude-reviewer/data.db` |
| `CLAUDE_REVIEWER_HOST` | Host for review URLs | `localhost` |
| `CLAUDE_REVIEWER_WEB_DIR` | Path to web app directory | (auto-detected) |
| `ANTHROPIC_API_KEY` | API key for preference learning | (optional) |

### Docker Configuration

The web UI runs in Docker with the following volume mounts:

```yaml
volumes:
  - ~/.claude-reviewer:/data:rw      # Database access
  - /Users:/host-users:ro            # Repository access (read-only)
```

## Development

### Prerequisites

- Python 3.10+
- Node.js 20+
- Docker (optional, for containerized web UI)

### Python CLI Development

```bash
cd claude-reviewer-cli

# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
make test

# Type checking
make typecheck

# Linting
make lint

# Format code
make format

# Run all checks
make all
```

### Web App Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run unit tests
npm test

# Run E2E tests
npm run test:e2e

# Build for production
npm run build
```

### Project Structure

```
claude_reviewer/
├── claude-reviewer-cli/          # Python CLI package
│   ├── claude_reviewer/
│   │   ├── cli.py               # CLI commands
│   │   ├── database.py          # SQLite operations
│   │   ├── git_ops.py           # Git operations
│   │   └── models.py            # Data models
│   ├── tests/                   # Python tests
│   └── pyproject.toml
├── app/                         # Next.js pages
│   ├── page.tsx                 # PR list
│   ├── prs/[id]/page.tsx        # PR review page
│   └── api/                     # API routes
├── lib/                         # Shared utilities
│   ├── database.ts              # TypeScript DB layer
│   └── git.ts                   # Git operations
├── components/                  # React components
├── __tests__/                   # TypeScript tests
├── Dockerfile
└── docker-compose.yml
```

## Typical Workflow

1. **Create a feature branch and make changes**
   ```bash
   git checkout -b feature/new-thing
   # ... make changes ...
   git commit -m "Add new feature"
   ```

2. **Create a PR for review**
   ```bash
   claude-reviewer create --title "Add new feature"
   ```

3. **Review in the web UI**
   - Open the review URL
   - Examine the diff
   - Add inline comments on specific lines
   - Submit review (approve or request changes)

4. **Address feedback (if changes requested)**
   ```bash
   # Check what needs to be fixed
   claude-reviewer comments <id>

   # Make fixes and commit
   git commit -m "Address review feedback"

   # Update the PR
   claude-reviewer update <id>
   ```

5. **Merge when approved**
   ```bash
   claude-reviewer merge <id> --push
   ```

## Troubleshooting

### "Not a git repository" error
Make sure you're running commands from within a git repository.

### "docker-compose.yml not found" error
Either:
- Run `claude-reviewer serve` from the claude_reviewer directory
- Use `--dir` flag: `claude-reviewer serve --dir /path/to/claude_reviewer`
- Set environment variable: `export CLAUDE_REVIEWER_WEB_DIR=/path/to/claude_reviewer`

### Web UI not starting
Check if Docker is running and port 3000 is available:
```bash
docker ps
lsof -i :3000
```

### Database locked
The SQLite database uses WAL mode for concurrent access. If you see lock errors, ensure no stale processes are accessing the database.

## License

MIT
