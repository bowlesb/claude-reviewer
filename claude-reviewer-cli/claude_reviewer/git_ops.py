"""Git operations for Claude Reviewer."""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import TypedDict

from git import GitCommandError, Repo


class GitResult(TypedDict, total=False):
    """Result of a git operation."""

    success: bool
    message: str
    previous_branch: str


class FileStats(TypedDict):
    """Statistics for a file in a diff."""

    path: str
    additions: int
    deletions: int


class DiffStats(TypedDict):
    """Statistics for a diff."""

    files: list[FileStats]
    stat: str


class CommitInfo(TypedDict):
    """Information about a commit."""

    sha: str
    short_sha: str
    message: str
    author: str
    date: str


class GitOps:
    """Git operations wrapper using GitPython."""

    def __init__(self, repo_path: str) -> None:
        """Initialize with a repository path."""
        self.repo_path = Path(repo_path).resolve()
        if not (self.repo_path / ".git").exists():
            raise ValueError(f"Not a git repository: {self.repo_path}")
        self.repo = Repo(self.repo_path)

    def get_current_branch(self) -> str:
        """Get the current branch name."""
        return str(self.repo.active_branch.name)

    def get_current_commit(self) -> str:
        """Get the current commit SHA."""
        return str(self.repo.head.commit.hexsha)

    def get_commit_sha(self, ref: str) -> str:
        """Get the SHA for a reference (branch, tag, or commit)."""
        return str(self.repo.commit(ref).hexsha)

    def get_diff(self, base: str, head: str) -> str:
        """Get unified diff between two refs."""
        result: str = self.repo.git.diff(f"{base}...{head}")
        return result

    def get_diff_stat(self, base: str, head: str) -> DiffStats:
        """Get diff statistics between two refs."""
        stat: str = self.repo.git.diff(f"{base}...{head}", "--stat")
        numstat: str = self.repo.git.diff(f"{base}...{head}", "--numstat")

        files: list[FileStats] = []
        for line in numstat.strip().split("\n"):
            if line:
                parts = line.split("\t")
                if len(parts) >= 3:
                    additions = int(parts[0]) if parts[0] != "-" else 0
                    deletions = int(parts[1]) if parts[1] != "-" else 0
                    filepath = parts[2]
                    files.append(
                        {
                            "path": filepath,
                            "additions": additions,
                            "deletions": deletions,
                        }
                    )

        return {"files": files, "stat": stat}

    def get_branches(self) -> list[str]:
        """Get list of all local branches."""
        return [str(b.name) for b in self.repo.heads]

    def get_remote_branches(self, remote: str = "origin") -> list[str]:
        """Get list of remote branches."""
        try:
            remote_obj = self.repo.remote(remote)
            return [ref.name.replace(f"{remote}/", "") for ref in remote_obj.refs]
        except ValueError:
            return []

    def branch_exists(self, branch: str) -> bool:
        """Check if a branch exists."""
        return branch in [str(b.name) for b in self.repo.heads]

    def merge(
        self,
        head_branch: str,
        base_branch: str = "main",
        message: str | None = None,
    ) -> GitResult:
        """Merge head branch into base branch."""
        try:
            original_branch = self.get_current_branch()

            # Checkout base branch
            self.repo.git.checkout(base_branch)

            # Merge with no-ff
            merge_msg = message or f"Merge branch '{head_branch}' into {base_branch}"
            self.repo.git.merge(head_branch, "--no-ff", "-m", merge_msg)

            return {
                "success": True,
                "message": f"Merged {head_branch} into {base_branch}",
                "previous_branch": original_branch,
            }
        except GitCommandError as e:
            # Try to abort merge if it failed
            # Try to abort merge if it failed
            with contextlib.suppress(GitCommandError):
                self.repo.git.merge("--abort")
            return {
                "success": False,
                "message": str(e),
            }

    def push(
        self,
        remote: str = "origin",
        branch: str | None = None,
        set_upstream: bool = False,
    ) -> GitResult:
        """Push to remote."""
        try:
            target_branch = branch or self.get_current_branch()
            args: list[str] = [remote, target_branch]
            if set_upstream:
                args = ["-u", *args]
            self.repo.git.push(*args)
            return {
                "success": True,
                "message": f"Pushed {target_branch} to {remote}",
            }
        except GitCommandError as e:
            return {
                "success": False,
                "message": str(e),
            }

    def delete_branch(self, branch: str, force: bool = False) -> GitResult:
        """Delete a local branch."""
        try:
            flag = "-D" if force else "-d"
            self.repo.git.branch(flag, branch)
            return {
                "success": True,
                "message": f"Deleted branch {branch}",
            }
        except GitCommandError as e:
            return {
                "success": False,
                "message": str(e),
            }

    def checkout(self, ref: str) -> GitResult:
        """Checkout a branch or commit."""
        try:
            self.repo.git.checkout(ref)
            return {
                "success": True,
                "message": f"Checked out {ref}",
            }
        except GitCommandError as e:
            return {
                "success": False,
                "message": str(e),
            }

    def has_uncommitted_changes(self) -> bool:
        """Check if there are uncommitted changes."""
        return bool(self.repo.is_dirty(untracked_files=True))

    def get_remote_url(self, remote: str = "origin") -> str | None:
        """Get the URL of a remote."""
        try:
            remote_obj = self.repo.remote(remote)
            urls = list(remote_obj.urls)
            return urls[0] if urls else None
        except ValueError:
            return None

    def get_commits_between(self, base: str, head: str) -> list[CommitInfo]:
        """Get list of commits between two refs."""
        commits = list(self.repo.iter_commits(f"{base}..{head}"))
        return [
            {
                "sha": str(c.hexsha),
                "short_sha": str(c.hexsha)[:7],
                "message": str(c.message).strip(),
                "author": str(c.author.name) if c.author.name else "",
                "date": c.committed_datetime.isoformat(),
            }
            for c in commits
        ]
