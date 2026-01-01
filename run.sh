#!/bin/bash

# Check for claude CLI
if ! command -v claude &> /dev/null; then
    echo "Error: 'claude' command not found."
    echo "Please install Claude Code CLI: https://docs.anthropic.com/claude/docs/claude-code"
    exit 1
fi

echo "Starting PR Buddy (using local Claude CLI)..."
npm run dev
