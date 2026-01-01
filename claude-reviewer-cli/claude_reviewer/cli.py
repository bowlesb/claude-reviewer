"""CLI commands for Claude Reviewer."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from . import database as db
from .git_ops import GitOps
from .models import PRStatus

console = Console()


def get_review_url(pr_uuid: str, port: int = 3000) -> str:
    """Generate the review URL for a PR."""
    host = os.environ.get("CLAUDE_REVIEWER_HOST", "localhost")
    return f"http://{host}:{port}/prs/{pr_uuid}"


@click.group()
@click.version_option()
def main() -> None:
    """Claude Reviewer - Local PR review system for Claude Code."""
    # Initialize database on first run
    db.init_db()


@main.command()
@click.option("--title", "-t", required=True, help="PR title")
@click.option("--description", "-d", default="", help="PR description")
@click.option("--base", "-b", default="main", help="Base branch to compare against")
@click.option("--head", "-h", default=None, help="Head branch (default: current branch)")
@click.option("--repo", "-r", default=".", help="Path to git repository")
@click.option("--port", "-p", default=3000, help="Port for review URL")
def create(
    title: str,
    description: str,
    base: str,
    head: str | None,
    repo: str,
    port: int,
) -> None:
    """Create a new PR for review."""
    try:
        repo_path = Path(repo).resolve()
        git = GitOps(str(repo_path))

        # Get head branch (default to current)
        head_ref = head or git.get_current_branch()

        if head_ref == base:
            console.print(
                f"[red]Error: Head branch '{head_ref}' is the same as base branch '{base}'[/red]"
            )
            sys.exit(1)

        # Get commit SHAs
        try:
            base_commit = git.get_commit_sha(base)
        except Exception:
            console.print(f"[red]Error: Base branch '{base}' not found[/red]")
            sys.exit(1)

        head_commit = git.get_commit_sha(head_ref)

        # Get diff
        diff = git.get_diff(base, head_ref)
        if not diff.strip():
            console.print(f"[yellow]Warning: No changes between {base} and {head_ref}[/yellow]")

        # Create PR in database
        pr_uuid = db.create_pr(
            repo_path=str(repo_path),
            title=title,
            description=description,
            base_ref=base,
            head_ref=head_ref,
            base_commit=base_commit,
            head_commit=head_commit,
            diff=diff,
        )

        review_url = get_review_url(pr_uuid, port)

        console.print(
            Panel(
                f"[green]PR #{pr_uuid} created successfully[/green]\n\n"
                f"Title: {title}\n"
                f"Branch: {head_ref} -> {base}\n"
                f"\n[bold]Review URL:[/bold] {review_url}",
                title="New PR Created",
            )
        )

    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@main.command()
@click.argument("pr_id")
def status(pr_id: str) -> None:
    """Check the status of a PR."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    status_colors = {
        PRStatus.PENDING: "yellow",
        PRStatus.APPROVED: "green",
        PRStatus.CHANGES_REQUESTED: "red",
        PRStatus.MERGED: "blue",
        PRStatus.CLOSED: "dim",
    }

    color = status_colors.get(pr.status, "white")
    console.print(f"[{color}]{pr.status.value}[/{color}]")


@main.command()
@click.argument("pr_id")
@click.option(
    "--format", "-f", "output_format", type=click.Choice(["text", "json"]), default="text"
)
@click.option("--unresolved", "-u", is_flag=True, help="Show only unresolved comments")
def comments(pr_id: str, output_format: str, unresolved: bool) -> None:
    """Get comments for a PR with file/line references."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    comment_list = db.get_comments(pr_id, unresolved_only=unresolved)

    if output_format == "json":
        output = {
            "pr_id": pr_id,
            "comments": [
                {
                    "file": c.file_path,
                    "line": c.line_number,
                    "text": c.content,
                    "resolved": c.resolved,
                }
                for c in comment_list
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        if not comment_list:
            console.print("[dim]No comments found[/dim]")
            return

        for c in comment_list:
            resolved_mark = "[dim](resolved)[/dim] " if c.resolved else ""
            console.print(
                f"{resolved_mark}[cyan][{c.file_path}:{c.line_number}][/cyan] {c.content}"
            )


@main.command("list")
@click.option("--repo", "-r", default=None, help="Filter by repository path")
@click.option(
    "--status",
    "-s",
    type=click.Choice(["pending", "approved", "changes_requested", "merged", "closed"]),
    default=None,
)
@click.option("--limit", "-l", default=20, help="Maximum number of PRs to show")
def list_prs(repo: str | None, status: str | None, limit: int) -> None:
    """List all PRs."""
    status_filter = PRStatus(status) if status else None
    repo_path = str(Path(repo).resolve()) if repo else None

    prs = db.list_prs(repo_path=repo_path, status=status_filter, limit=limit)

    if not prs:
        console.print("[dim]No PRs found[/dim]")
        return

    table = Table(title="Pull Requests")
    table.add_column("ID", style="cyan")
    table.add_column("Title", style="white")
    table.add_column("Branch", style="dim")
    table.add_column("Status", style="bold")
    table.add_column("Updated", style="dim")

    status_colors = {
        PRStatus.PENDING: "yellow",
        PRStatus.APPROVED: "green",
        PRStatus.CHANGES_REQUESTED: "red",
        PRStatus.MERGED: "blue",
        PRStatus.CLOSED: "dim",
    }

    for pr in prs:
        color = status_colors.get(pr.status, "white")
        table.add_row(
            pr.uuid,
            pr.title[:40] + ("..." if len(pr.title) > 40 else ""),
            pr.head_ref,
            f"[{color}]{pr.status.value}[/{color}]",
            str(pr.updated_at)[:16] if pr.updated_at else "-",
        )

    console.print(table)


@main.command()
@click.argument("pr_id")
@click.option(
    "--repo", "-r", default=None, help="Path to git repository (uses PR's repo by default)"
)
def update(pr_id: str, repo: str | None) -> None:
    """Update PR diff after making changes."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    try:
        repo_path = repo or pr.repo_path
        git = GitOps(repo_path)

        # Get new diff
        diff = git.get_diff(pr.base_ref, pr.head_ref)
        head_commit = git.get_commit_sha(pr.head_ref)

        # Update in database
        new_revision = db.update_pr_diff(pr_id, diff, head_commit)

        # Reset status to pending for re-review
        db.update_pr_status(pr_id, PRStatus.PENDING)

        console.print(
            Panel(
                f"[green]PR #{pr_id} updated to revision {new_revision}[/green]\n\n"
                f"Status reset to [yellow]pending[/yellow] for re-review",
                title="PR Updated",
            )
        )

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@main.command()
@click.argument("pr_id")
@click.option("--push/--no-push", default=True, help="Push to remote after merge")
@click.option(
    "--delete-branch/--keep-branch", default=False, help="Delete source branch after merge"
)
@click.option("--repo", "-r", default=None, help="Path to git repository")
def merge(pr_id: str, push: bool, delete_branch: bool, repo: str | None) -> None:
    """Merge an approved PR."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    if pr.status != PRStatus.APPROVED:
        console.print(f"[red]Error: PR is not approved (current status: {pr.status.value})[/red]")
        console.print("[dim]Only approved PRs can be merged[/dim]")
        sys.exit(1)

    try:
        repo_path = repo or pr.repo_path
        git = GitOps(repo_path)

        # Check for uncommitted changes
        if git.has_uncommitted_changes():
            console.print("[red]Error: Repository has uncommitted changes[/red]")
            console.print("[dim]Please commit or stash changes before merging[/dim]")
            sys.exit(1)

        # Perform merge
        merge_result = git.merge(pr.head_ref, pr.base_ref)

        if not merge_result["success"]:
            console.print(f"[red]Merge failed: {merge_result['message']}[/red]")
            sys.exit(1)

        console.print(f"[green]{merge_result['message']}[/green]")

        # Push if requested
        if push:
            push_result = git.push()
            if push_result["success"]:
                console.print(f"[green]{push_result['message']}[/green]")
            else:
                console.print(f"[yellow]Warning: Push failed: {push_result['message']}[/yellow]")

        # Delete source branch if requested
        if delete_branch:
            delete_result = git.delete_branch(pr.head_ref)
            if delete_result["success"]:
                console.print(f"[dim]{delete_result['message']}[/dim]")

        # Update PR status
        db.update_pr_status(pr_id, PRStatus.MERGED)

        console.print(
            Panel(
                f"[green]PR #{pr_id} merged successfully![/green]",
                title="Merge Complete",
            )
        )

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@main.command()
@click.argument("pr_id")
def show(pr_id: str) -> None:
    """Show detailed information about a PR."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    status_colors = {
        PRStatus.PENDING: "yellow",
        PRStatus.APPROVED: "green",
        PRStatus.CHANGES_REQUESTED: "red",
        PRStatus.MERGED: "blue",
        PRStatus.CLOSED: "dim",
    }
    color = status_colors.get(pr.status, "white")

    info = f"""[bold]Title:[/bold] {pr.title}
[bold]Status:[/bold] [{color}]{pr.status.value}[/{color}]
[bold]Repository:[/bold] {pr.repo_path}
[bold]Branch:[/bold] {pr.head_ref} -> {pr.base_ref}
[bold]Created:[/bold] {pr.created_at}
[bold]Updated:[/bold] {pr.updated_at}"""

    if pr.description:
        info += f"\n\n[bold]Description:[/bold]\n{pr.description}"

    console.print(Panel(info, title=f"PR #{pr.uuid}"))

    # Show comments count
    comments_list = db.get_comments(pr_id)
    unresolved_count = len([c for c in comments_list if not c.resolved])
    if comments_list:
        console.print(
            f"\n[bold]Comments:[/bold] {len(comments_list)} ({unresolved_count} unresolved)"
        )

    # Show diff preview
    diff = db.get_latest_diff(pr_id)
    if diff:
        console.print("\n[bold]Diff preview:[/bold]")
        lines = diff.split("\n")[:20]
        preview = "\n".join(lines)
        if len(diff.split("\n")) > 20:
            preview += "\n... (truncated)"
        console.print(Syntax(preview, "diff", theme="monokai"))


def find_web_dir() -> Path | None:
    """Find the web app directory containing docker-compose.yml."""
    # Check environment variable first
    if env_dir := os.environ.get("CLAUDE_REVIEWER_WEB_DIR"):
        path = Path(env_dir)
        if (path / "docker-compose.yml").exists():
            return path

    # Check current working directory
    cwd = Path.cwd()
    if (cwd / "docker-compose.yml").exists():
        return cwd

    # Check parent directories (up to 3 levels)
    for parent in [cwd.parent, cwd.parent.parent, cwd.parent.parent.parent]:
        if (parent / "docker-compose.yml").exists():
            return parent

    # Check relative to source file (for development)
    cli_dir = Path(__file__).parent.parent
    web_dir = cli_dir.parent
    if (web_dir / "docker-compose.yml").exists():
        return web_dir

    return None


@main.command()
@click.option("--port", "-p", default=3000, help="Port for web UI")
@click.option("--detach/--no-detach", "-d", default=True, help="Run in background")
@click.option("--build/--no-build", default=False, help="Rebuild Docker image")
@click.option("--dir", "web_dir_opt", default=None, help="Path to claude-reviewer web directory")
def serve(port: int, detach: bool, build: bool, web_dir_opt: str | None) -> None:
    """Start the web UI server (Docker)."""
    # Find the web app directory
    if web_dir_opt:
        web_dir = Path(web_dir_opt)
    else:
        web_dir = find_web_dir()

    if not web_dir or not (web_dir / "docker-compose.yml").exists():
        console.print("[red]Error: docker-compose.yml not found[/red]")
        console.print("[dim]Run this command from the claude-reviewer directory,[/dim]")
        console.print("[dim]or use --dir to specify the path, or set CLAUDE_REVIEWER_WEB_DIR[/dim]")
        sys.exit(1)

    compose_file = web_dir / "docker-compose.yml"

    console.print(f"[bold]Starting Claude Reviewer web UI on port {port}...[/bold]")

    cmd = ["docker", "compose", "-f", str(compose_file)]

    if build:
        console.print("[dim]Building Docker image...[/dim]")
        subprocess.run(cmd + ["build"], cwd=web_dir, check=True)

    up_cmd = cmd + ["up"]
    if detach:
        up_cmd.append("-d")

    env = os.environ.copy()
    env["PORT"] = str(port)

    result = subprocess.run(up_cmd, cwd=web_dir, env=env)

    if result.returncode == 0 and detach:
        console.print(
            Panel(
                f"[green]Web UI started successfully![/green]\n\n"
                f"[bold]URL:[/bold] http://localhost:{port}",
                title="Claude Reviewer",
            )
        )
    elif result.returncode != 0:
        console.print("[red]Failed to start web UI[/red]")
        sys.exit(1)


@main.command()
@click.option("--dir", "web_dir_opt", default=None, help="Path to claude-reviewer web directory")
def stop(web_dir_opt: str | None) -> None:
    """Stop the web UI server."""
    if web_dir_opt:
        web_dir = Path(web_dir_opt)
    else:
        web_dir = find_web_dir()

    if not web_dir or not (web_dir / "docker-compose.yml").exists():
        console.print("[red]Error: docker-compose.yml not found[/red]")
        console.print("[dim]Run this command from the claude-reviewer directory,[/dim]")
        console.print("[dim]or use --dir to specify the path, or set CLAUDE_REVIEWER_WEB_DIR[/dim]")
        sys.exit(1)

    compose_file = web_dir / "docker-compose.yml"

    console.print("[bold]Stopping Claude Reviewer web UI...[/bold]")
    subprocess.run(
        ["docker", "compose", "-f", str(compose_file), "down"],
        cwd=web_dir,
    )
    console.print("[green]Stopped[/green]")


if __name__ == "__main__":
    main()
