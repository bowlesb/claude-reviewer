# Claude Code Guidelines

## Code Style

- **Do not put imports inside functions.** All imports should be at the top of the file.
- Follow PEP 8 and the project's existing style.
- Use type hints consistently.

## Code Review Workflow

When making significant changes, use the local review system:

1. Create a PR for review:
   ```bash
   claude-reviewer create --title "Description of changes"
   ```

2. Wait for review:
   ```bash
   claude-reviewer watch <pr-id>
   ```
   (Default waits for any feedback - approval or changes_requested)

3. Address feedback by replying to comments:
   ```bash
   claude-reviewer comments <pr-id>
   claude-reviewer reply <pr-id> <comment-uuid> "Fixed by doing X"
   ```

4. Update the PR after fixes:
   ```bash
   claude-reviewer update <pr-id>
   ```

5. If approved, merge:
   ```bash
   claude-reviewer merge <pr-id>
   ```

## Development

- Start web UI: `claude-reviewer serve --dev`
- Stop web UI: `claude-reviewer stop`
- Run tests: `cd claude-reviewer-cli && make test`
- Type checking: `cd claude-reviewer-cli && make typecheck`
