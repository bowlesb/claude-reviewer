"""CLI commands for Claude Reviewer."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
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


def get_review_url(pr_uuid: str, port: int = 41729) -> str:
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
@click.option("--base", "-b", default=None, help="Base branch (default: auto-detect main/master)")
@click.option("--head", "-h", default=None, help="Head branch (default: current branch)")
@click.option("--repo", "-r", default=".", help="Path to git repository")
@click.option("--port", "-p", default=41729, help="Port for review URL (default: 41729)")
def create(
    title: str,
    description: str,
    base: str | None,
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

        # Auto-detect base branch if not provided
        if not base:
            # Try to find the default branch
            possible_defaults = ["main", "master", "trunk", "development"]
            
            # 1. Try to get semantic default from remote
            remote_info = subprocess.run(
                ["git", "remote", "show", "origin"], 
                cwd=repo_path, 
                capture_output=True, 
                text=True,
                check=False  # Don't raise on error, just continue to next method
            ).stdout
            for line in remote_info.split("\n"):
                if "HEAD branch:" in line:
                    remote_default = line.split(":")[1].strip()
                    if remote_default:
                        base = remote_default
                        break

            # 2. If remote detection failed, check local branches for common names
            if not base:
                local_branches = git.get_branches()
                for name in possible_defaults:
                    if name in local_branches:
                        base = name
                        break
            
            # 3. Fallback
            if not base:
                base = "main"
                
            console.print(f"[dim]Auto-detected base branch: {base}[/dim]")

        if head_ref == base:
            console.print(
                f"[red]Error: Head branch '{head_ref}' is the same as base branch '{base}'[/red]"
            )
            sys.exit(1)

        # Get commit SHAs
        base_commit = git.get_commit_sha(base)
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

        # Check if web UI is running and add appropriate message
        web_ui_status = ""
        if not is_web_ui_running(port):
            web_ui_status = (
                "\n\n[yellow]⚠ Web UI is not running.[/yellow]\n"
                "[dim]Start it with: claude-reviewer serve[/dim]"
            )

        console.print(
            Panel(
                f"[green]PR #{pr_uuid} created successfully[/green]\n\n"
                f"Title: {title}\n"
                f"Branch: {head_ref} -> {base}\n"
                f"\n[bold]Review URL:[/bold] {review_url}"
                f"{web_ui_status}",
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

    # GitHub-style status colors
    status_colors = {
        PRStatus.PENDING: "#d29922",  # GitHub yellow
        PRStatus.APPROVED: "#3fb950",  # GitHub green
        PRStatus.CHANGES_REQUESTED: "#f85149",  # GitHub red
        PRStatus.MERGED: "#a371f7",  # GitHub purple
        PRStatus.CLOSED: "#8b949e",  # GitHub gray
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
    """Get comments for a PR with file/line references.

    Shows both review summaries (from Submit Review) and inline comments.
    """
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    reviews = db.get_reviews(pr_id)
    comments_with_replies = db.get_comments_with_replies(pr_id, unresolved_only=unresolved)

    if output_format == "json":
        output = {
            "pr_id": pr_id,
            "reviews": [
                {
                    "action": r["action"],
                    "summary": r["summary"],
                    "created_at": r["created_at"],
                }
                for r in reviews
            ],
            "comments": [
                {
                    "uuid": c.uuid,
                    "file": c.file_path,
                    "line": c.line_number,
                    "text": c.content,
                    "resolved": c.resolved,
                    "replies": [{"author": r.author, "text": r.content} for r in replies],
                }
                for c, replies in comments_with_replies
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        # Show review summaries first (these are always important)
        if reviews:
            console.print("[bold]Review Summary:[/bold]")
            for r in reviews:
                action_color = "green" if r["action"] == "approve" else "yellow"
                action_label = "Approved" if r["action"] == "approve" else "Changes Requested"
                console.print(f"  [{action_color}]{action_label}[/{action_color}]", end="")
                if r["summary"]:
                    console.print(f": {r['summary']}")
                else:
                    console.print()
            console.print()

        # Show inline comments
        if comments_with_replies:
            console.print("[bold]Inline Comments:[/bold]")
            for c, replies in comments_with_replies:
                resolved_mark = "[dim](resolved)[/dim] " if c.resolved else ""
                console.print(
                    f"  {resolved_mark}[cyan][{c.file_path}:{c.line_number}][/cyan] "
                    f"[dim]({c.uuid})[/dim] {c.content}"
                )
                for reply in replies:
                    author_color = "green" if reply.author == "claude" else "blue"
                    console.print(
                        f"    [{author_color}]↳ {reply.author}:[/{author_color}] {reply.content}"
                    )
        elif not reviews:
            console.print("[dim]No comments or reviews found[/dim]")


@main.command("list")
@click.option("--repo", "-r", default=None, help="Filter by repository path")
@click.option(
    "--status",
    "-s",
    type=click.Choice(["pending", "approved", "changes_requested", "merged", "closed"]),
    default=None,
)
@click.option("--limit", "-l", default=20, help="Maximum number of PRs to show")
@click.option("--all", "-a", "show_all", is_flag=True, help="Show PRs from all repositories")
def list_prs(repo: str | None, status: str | None, limit: int, show_all: bool) -> None:
    """List PRs.

    By default, shows PRs for the current repository only.
    Use --all to show PRs from all repositories.
    """
    status_filter = PRStatus(status) if status else None
    
    # Determine repo path filter
    repo_path = None
    if repo:
        repo_path = str(Path(repo).resolve())
    elif not show_all:
        # Try to detect current git repo scope
        cwd = Path.cwd()
        # Use simple git check without invoking subprocess if possible or just let it fail
        # But we need to be safe if git is not installed or not in repo
        try:
            git_root = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False
            ).stdout.strip()
            
            if git_root:
                repo_path = str(Path(git_root).resolve())
        except FileNotFoundError:
            # Git executable not found
            pass

    prs = db.list_prs(repo_path=repo_path, status=status_filter, limit=limit)

    if not prs:
        if repo_path:
            console.print(f"[dim]No PRs found for repository: {repo_path}[/dim]")
            console.print("[dim]Use --all to see PRs from other repositories[/dim]")
        else:
            console.print("[dim]No PRs found[/dim]")
        return

    title_text = "Pull Requests" if show_all or not repo_path else f"Pull Requests ({Path(repo_path).name})"
    table = Table(title=title_text)
    table.add_column("ID", style="cyan")
    table.add_column("Title", style="white")
    table.add_column("Branch", style="dim")
    table.add_column("Status", style="bold")
    table.add_column("Updated", style="dim")

    # GitHub-style status colors
    status_colors = {
        PRStatus.PENDING: "#d29922",  # GitHub yellow
        PRStatus.APPROVED: "#3fb950",  # GitHub green
        PRStatus.CHANGES_REQUESTED: "#f85149",  # GitHub red
        PRStatus.MERGED: "#a371f7",  # GitHub purple
        PRStatus.CLOSED: "#8b949e",  # GitHub gray
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
def close(pr_id: str) -> None:
    """Close a PR without merging."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    if pr.status == PRStatus.MERGED:
        console.print(f"[yellow]Warning: PR '{pr_id}' is already merged[/yellow]")
        return
        
    if pr.status == PRStatus.CLOSED:
        console.print(f"[yellow]PR '{pr_id}' is already closed[/yellow]")
        return

    if click.confirm(f"Are you sure you want to close PR #{pr_id} '{pr.title}'?"):
        db.update_pr_status(pr_id, PRStatus.CLOSED)
        console.print(f"[green]PR #{pr_id} closed[/green]")


@main.command()
@click.argument("pr_id")
@click.option("--force", "-f", is_flag=True, help="Force delete without confirmation")
def delete(pr_id: str, force: bool) -> None:
    """Delete a PR and all associated data."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    if not force:
        console.print(f"[bold red]Warning: This will permanently delete PR #{pr_id} and all its comments/reviews.[/bold red]")
        if not click.confirm(f"Are you sure you want to delete PR #{pr_id} '{pr.title}'?"):
            console.print("[dim]Aborted[/dim]")
            return

    if db.delete_pr(pr_id):
        console.print(f"[green]PR #{pr_id} deleted[/green]")
    else:
        console.print(f"[red]Failed to delete PR #{pr_id}[/red]")


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


@main.command()
@click.argument("pr_id")
def show(pr_id: str) -> None:
    """Show detailed information about a PR."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    # GitHub-style status colors
    status_colors = {
        PRStatus.PENDING: "#d29922",  # GitHub yellow
        PRStatus.APPROVED: "#3fb950",  # GitHub green
        PRStatus.CHANGES_REQUESTED: "#f85149",  # GitHub red
        PRStatus.MERGED: "#a371f7",  # GitHub purple
        PRStatus.CLOSED: "#8b949e",  # GitHub gray
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


def is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("localhost", port)) == 0


def find_web_dir() -> Path | None:
    """Find the claude-reviewer web app directory for development.

    IMPORTANT: Does NOT check current working directory to avoid
    accidentally using a project's own docker-compose.yml.

    This is only used when --dev flag is passed or CLAUDE_REVIEWER_WEB_DIR is set.
    """
    # Check environment variable first
    if env_dir := os.environ.get("CLAUDE_REVIEWER_WEB_DIR"):
        path = Path(env_dir)
        if (path / "docker-compose.yml").exists():
            return path

    # Check relative to source file (for development installs)
    cli_dir = Path(__file__).parent.parent
    web_dir = cli_dir.parent
    if (web_dir / "docker-compose.yml").exists():
        # Verify it's actually the claude-reviewer compose file
        compose_content = (web_dir / "docker-compose.yml").read_text()
        if "claude-reviewer" in compose_content or "claude_reviewer" in compose_content:
            return web_dir

    # Check common install locations
    home = Path.home()
    common_paths = [
        home / ".claude-reviewer" / "web",
        home / "claude-reviewer",
        Path("/opt/claude-reviewer"),
    ]
    for path in common_paths:
        if (path / "docker-compose.yml").exists():
            return path

    return None


# Docker image to use
DOCKER_IMAGE = "bowles/claude-reviewer:latest"
# Container name for running the web UI
CONTAINER_NAME = "claude-reviewer-web"
# Unique project name to avoid conflicts with other docker-compose projects (for dev mode)
COMPOSE_PROJECT_NAME = "claude-reviewer"


def verify_docker_container(container_name: str) -> bool:
    """Check if a container is running."""
    result = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", container_name],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def is_docker_running() -> bool:
    """Check if Docker daemon is running."""
    result = subprocess.run(["docker", "info"], capture_output=True, text=True)
    return result.returncode == 0


def is_web_ui_running(port: int = 41729) -> bool:
    """Check if the web UI is running (either via Docker or locally)."""
    # Check if our Docker container is running
    if verify_docker_container(CONTAINER_NAME):
        return True
    # Check if port is in use (could be local dev server)
    if is_port_in_use(port):
        return True
    return False


def run_local_server(port: int, web_dir: Path) -> None:
    """Run the web server locally using npm."""
    console.print(f"[bold]Starting local web server on port {port}...[/bold]")
    console.print(f"[dim]Working directory: {web_dir}[/dim]")

    # Check for node_modules
    if not (web_dir / "node_modules").exists():
        console.print("[yellow]Installing dependencies...[/yellow]")
        subprocess.run(["npm", "ci"], cwd=web_dir, check=True)

    # Build if needed (simple check for .next)
    if not (web_dir / ".next").exists():
        console.print("[yellow]Building application...[/yellow]")
        subprocess.run(["npm", "run", "build"], cwd=web_dir, check=True)

    env = os.environ.copy()
    env["PORT"] = str(port)

    console.print(f"[green]Starting server at http://localhost:{port}[/green]")
    try:
        subprocess.run(["npm", "run", "start"], cwd=web_dir, env=env)
    except KeyboardInterrupt:
        console.print("\n[yellow]Server stopped[/yellow]")


@main.command()
@click.option("--port", "-p", default=41729, help="Port for web UI (default: 41729)")
@click.option("--detach/--no-detach", "-d", default=True, help="Run in background (Docker only)")
@click.option("--dev", is_flag=True, help="Use local docker-compose for development")
@click.option("--pull/--no-pull", default=True, help="Pull latest image before starting")
@click.option("--local", is_flag=True, help="Run locally using npm (requires source)")
def serve(port: int, detach: bool, dev: bool, pull: bool, local: bool) -> None:
    """Start the web UI server.

    By default, pulls and runs the Docker image from Docker Hub.
    Use --local to run with npm start (requires source code).
    Use --dev for local development with docker-compose.
    """
    # Check if port is already in use
    if is_port_in_use(port):
        console.print(f"[red]Error: Port {port} is already in use[/red]")
        console.print("[dim]Try a different port: claude-reviewer serve --port 3457[/dim]")
        sys.exit(1)

    # Handle local mode first
    if local:
        web_dir = find_web_dir()
        if not web_dir:
            console.print("[red]Error: Local mode requires claude-reviewer source[/red]")
            # Fallback check
            cwd = Path.cwd()
            if (cwd / "package.json").exists() and (cwd / "next.config.ts").exists():
                web_dir = cwd
            else:
                sys.exit(1)

        run_local_server(port, web_dir)
        return

    # Check if docker is available
    docker_check = subprocess.run(["docker", "info"], capture_output=True, text=True)
    if docker_check.returncode != 0:
        console.print("[yellow]Warning: Docker is not running or not installed[/yellow]")

        # Try finding web dir for fallback
        web_dir = find_web_dir()
        if web_dir and click.confirm("Do you want to run locally with npm instead?"):
            run_local_server(port, web_dir)
            return

        console.print(
            "[red]Error: Docker required. Install Docker or run from source with --local[/red]"
        )
        sys.exit(1)

    # Development mode: use docker-compose
    if dev or os.environ.get("CLAUDE_REVIEWER_WEB_DIR"):
        web_dir = find_web_dir()
        if not web_dir:
            console.print("[red]Error: Development mode requires claude-reviewer source[/red]")
            console.print("")
            console.print("[bold]Clone the repository:[/bold]")
            console.print("  [cyan]git clone https://github.com/bowlesb/claude-reviewer[/cyan]")
            console.print("  [cyan]cd claude-reviewer[/cyan]")
            console.print("  [cyan]pip install -e claude-reviewer-cli[/cyan]")
            sys.exit(1)

        compose_file = web_dir / "docker-compose.yml"
        console.print(f"[bold]Starting Claude Reviewer (dev mode) on port {port}...[/bold]")
        console.print(f"[dim]Using: {compose_file}[/dim]")

        cmd = ["docker", "compose", "-f", str(compose_file), "-p", COMPOSE_PROJECT_NAME]
        up_cmd = cmd + ["up", "--build"] if dev else cmd + ["up"]
        if detach:
            up_cmd.append("-d")

        env = os.environ.copy()
        env["PORT"] = str(port)

        result = subprocess.run(up_cmd, cwd=web_dir, env=env)

        if result.returncode == 0 and detach:
            console.print(
                Panel(
                    f"[green]Web UI started (dev mode)![/green]\n\n"
                    f"[bold]URL:[/bold] http://localhost:{port}\n\n"
                    f"[dim]Stop with: claude-reviewer stop[/dim]",
                    title="Claude Reviewer",
                )
            )
        elif result.returncode != 0:
            console.print("[red]Failed to start web UI[/red]")
            sys.exit(1)
        return

    # Production mode: pull and run from Docker Hub
    console.print(f"[bold]Starting Claude Reviewer web UI on port {port}...[/bold]")

    # Stop existing container if running
    subprocess.run(
        ["docker", "rm", "-f", CONTAINER_NAME],
        capture_output=True,
    )

    # Pull latest image
    if pull:
        console.print(f"[dim]Pulling {DOCKER_IMAGE}...[/dim]")
        pull_result = subprocess.run(
            ["docker", "pull", DOCKER_IMAGE],
            capture_output=True,
            text=True,
        )
        if pull_result.returncode != 0:
            console.print("[yellow]Warning: Could not pull latest image[/yellow]")
            console.print(f"[dim]{pull_result.stderr}[/dim]")

    # Ensure data directory exists
    data_dir = Path.home() / ".claude-reviewer"
    data_dir.mkdir(exist_ok=True)

    # Run the container as the host user to ensure proper file permissions
    # This fixes "attempt to write a readonly database" errors
    run_cmd = [
        "docker",
        "run",
        "--name",
        CONTAINER_NAME,
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-p",
        f"{port}:3000",
        "-v",
        f"{data_dir}:/data",
        "-v",
        f"{Path.home()}:/host-home:ro",
        "-e",
        "DATABASE_PATH=/data/data.db",
        "-e",
        "DATABASE_DIR=/data",
    ]

    if detach:
        run_cmd.append("-d")

    run_cmd.append(DOCKER_IMAGE)

    run_result = subprocess.run(run_cmd, capture_output=True, text=True)

    if run_result.returncode == 0:
        # Verify it's actually running
        time.sleep(1)  # Give it a moment to potentially crash
        if verify_docker_container(CONTAINER_NAME):
            if detach:
                console.print(
                    Panel(
                        f"[green]Web UI started successfully![/green]\n\n"
                        f"[bold]URL:[/bold] http://localhost:{port}\n\n"
                        f"[dim]Stop with: claude-reviewer stop[/dim]",
                        title="Claude Reviewer",
                    )
                )
        else:
            # It crashed immediately
            console.print("[red]Error: Container started but exited immediately[/red]")
            logs = subprocess.run(
                ["docker", "logs", CONTAINER_NAME], capture_output=True, text=True
            )
            console.print(f"[dim]Logs:\n{logs.stderr}\n{logs.stdout}[/dim]")
            sys.exit(1)
    else:
        console.print("[red]Failed to start web UI[/red]")
        console.print(f"[dim]{run_result.stderr}[/dim]")
        sys.exit(1)


@main.command()
def stop() -> None:
    """Stop the web UI server.

    This only stops claude-reviewer containers, not other Docker services.
    """
    console.print("[bold]Stopping Claude Reviewer web UI...[/bold]")

    stopped = False

    # Try to stop the standalone container first (production mode)
    result = subprocess.run(
        ["docker", "rm", "-f", CONTAINER_NAME],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        stopped = True

    # Also try to stop docker-compose containers (dev mode)
    compose_result = subprocess.run(
        ["docker", "compose", "-p", COMPOSE_PROJECT_NAME, "down"],
        capture_output=True,
        text=True,
    )
    if compose_result.returncode == 0 and "Removed" in compose_result.stderr:
        stopped = True

    if stopped:
        console.print("[green]Stopped[/green]")
    else:
        console.print("[yellow]No claude-reviewer containers were running[/yellow]")


@main.command()
@click.argument("pr_id")
@click.argument("comment_uuid")
@click.argument("message")
@click.option("--author", "-a", default="claude", help="Author name (default: claude)")
def reply(pr_id: str, comment_uuid: str, message: str, author: str) -> None:
    """Reply to a comment explaining what was done to address it."""
    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    comment = db.get_comment_by_uuid(comment_uuid)
    if not comment:
        console.print(f"[red]Error: Comment '{comment_uuid}' not found[/red]")
        sys.exit(1)

    try:
        reply_uuid = db.add_reply(comment_uuid, message, author)
        console.print(f"[green]Reply added to comment {comment_uuid}[/green]")
        console.print(f"[dim]Reply ID: {reply_uuid}[/dim]")
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@main.command()
@click.argument("pr_id")
@click.option(
    "--until",
    "-u",
    type=click.Choice(["approved", "changes_requested", "feedback_given", "pending", "any_change"]),
    default="feedback_given",
    help="Wait until this status (default: feedback_given = approved or changes_requested)",
)
@click.option("--interval", "-i", default=2, help="Polling interval in seconds (default: 2)")
@click.option("--timeout", "-t", default=0, help="Timeout in seconds (0 = no timeout)")
def watch(pr_id: str, until: str, interval: int, timeout: int) -> None:
    """Watch a PR and wait for status changes.

    Useful for waiting after creating a PR to see reviewer feedback.
    Uses a spinner animation while waiting.

    The default --until feedback_given waits for either approval or changes_requested.
    """
    from rich.live import Live
    from rich.spinner import Spinner
    from rich.text import Text

    pr = db.get_pr_by_uuid(pr_id)
    if not pr:
        console.print(f"[red]Error: PR '{pr_id}' not found[/red]")
        sys.exit(1)

    initial_status = pr.status.value
    initial_updated = pr.updated_at

    console.print(f"[bold]Watching PR #{pr_id}[/bold]")
    console.print(f"Current status: [yellow]{initial_status}[/yellow]")
    console.print(f"Waiting for: [cyan]{until}[/cyan]")
    console.print(f"[dim]Polling every {interval}s... (Ctrl+C to stop)[/dim]\n")

    start_time = time.time()

    def make_spinner_text(elapsed: int) -> Text:
        text = Text()
        text.append("⏳ Watching... ", style="cyan")
        text.append(f"{elapsed}s", style="dim")
        return text

    try:
        with Live(Spinner("dots", text=make_spinner_text(0)), refresh_per_second=10) as live:
            while True:
                time.sleep(interval)

                # Check timeout
                elapsed = int(time.time() - start_time)
                if timeout > 0 and elapsed > timeout:
                    live.stop()
                    console.print("[yellow]Timeout reached[/yellow]")
                    sys.exit(1)

                # Update spinner
                live.update(Spinner("dots", text=make_spinner_text(elapsed)))

                # Refresh PR data
                pr = db.get_pr_by_uuid(pr_id)
                if not pr:
                    live.stop()
                    console.print("[red]PR no longer exists[/red]")
                    sys.exit(1)

                current_status = pr.status.value

                # Check for any change
                if until == "any_change":
                    if current_status != initial_status or pr.updated_at != initial_updated:
                        live.stop()
                        console.print("[green]✓ Change detected![/green]")
                        console.print(f"Status: [bold]{current_status}[/bold]")

                        # Show new comments if any
                        comments_list = db.get_comments(pr_id, unresolved_only=True)
                        if comments_list:
                            console.print(
                                f"\n[bold]Unresolved comments ({len(comments_list)}):[/bold]"
                            )
                            for c in comments_list:
                                console.print(
                                    f"  [cyan][{c.file_path}:{c.line_number}][/cyan] {c.content}"
                                )
                        sys.exit(0)
                elif until == "feedback_given":
                    # Wait for either approved or changes_requested
                    if current_status in ("approved", "changes_requested"):
                        live.stop()
                        if current_status == "approved":
                            console.print("[#3fb950]✓ PR approved![/#3fb950]")
                        else:
                            console.print("[#f85149]✓ Changes requested[/#f85149]")
                            # Show the comments
                            comments_list = db.get_comments(pr_id, unresolved_only=True)
                            if comments_list:
                                console.print("\n[bold]Review comments:[/bold]")
                                for c in comments_list:
                                    console.print(
                                        f"  [cyan][{c.file_path}:{c.line_number}][/cyan] "
                                        f"[dim]({c.uuid})[/dim] {c.content}"
                                    )
                        sys.exit(0)
                else:
                    # Check for specific status
                    if current_status == until:
                        live.stop()
                        # GitHub-style status colors
                        status_colors = {
                            "approved": "#3fb950",
                            "changes_requested": "#f85149",
                            "pending": "#d29922",
                        }
                        color = status_colors.get(until, "white")
                        console.print(f"[{color}]✓ PR is now {until}![/{color}]")

                        if until == "changes_requested":
                            # Show the comments
                            comments_list = db.get_comments(pr_id, unresolved_only=True)
                            if comments_list:
                                console.print("\n[bold]Review comments:[/bold]")
                                for c in comments_list:
                                    console.print(
                                        f"  [cyan][{c.file_path}:{c.line_number}][/cyan] "
                                        f"[dim]({c.uuid})[/dim] {c.content}"
                                    )
                        sys.exit(0)

    except KeyboardInterrupt:
        console.print("\n[yellow]Stopped watching[/yellow]")
        sys.exit(0)


if __name__ == "__main__":
    main()
