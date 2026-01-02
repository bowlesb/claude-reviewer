"""Tests for the git_ops module."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from git import Repo

from claude_reviewer.git_ops import GitOps


@pytest.fixture
def temp_git_repo() -> Path:
    """Create a temporary git repository for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_path = Path(tmpdir)
        repo = Repo.init(repo_path)

        # Create an initial commit
        test_file = repo_path / "test.txt"
        test_file.write_text("initial content")
        repo.index.add(["test.txt"])
        repo.index.commit("Initial commit")

        yield repo_path


@pytest.fixture
def git_ops(temp_git_repo: Path) -> GitOps:
    """Create a GitOps instance for testing."""
    return GitOps(str(temp_git_repo))


class TestGitOpsInit:
    """Tests for GitOps initialization."""

    def test_init_valid_repo(self, temp_git_repo: Path) -> None:
        """Test initializing with a valid repository."""
        git = GitOps(str(temp_git_repo))
        # Compare resolved paths due to macOS symlinks (/var -> /private/var)
        assert git.repo_path.resolve() == temp_git_repo.resolve()

    def test_init_invalid_repo(self) -> None:
        """Test initializing with an invalid repository."""
        with (
            tempfile.TemporaryDirectory() as tmpdir,
            pytest.raises(ValueError, match="Not a git repository"),
        ):
            GitOps(tmpdir)


class TestBranchOperations:
    """Tests for branch-related operations."""

    def test_get_current_branch(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test getting current branch."""
        branch = git_ops.get_current_branch()
        # Default branch could be 'main' or 'master' depending on git config
        assert branch in ["main", "master"]

    def test_get_current_commit(self, git_ops: GitOps) -> None:
        """Test getting current commit SHA."""
        commit = git_ops.get_current_commit()
        assert len(commit) == 40  # Full SHA length
        assert all(c in "0123456789abcdef" for c in commit)

    def test_get_commit_sha(self, git_ops: GitOps) -> None:
        """Test getting commit SHA for a ref."""
        sha = git_ops.get_commit_sha("HEAD")
        assert len(sha) == 40

    def test_get_branches(self, git_ops: GitOps) -> None:
        """Test listing branches."""
        branches = git_ops.get_branches()
        assert len(branches) >= 1
        assert any(b in ["main", "master"] for b in branches)

    def test_branch_exists(self, git_ops: GitOps) -> None:
        """Test checking if branch exists."""
        current = git_ops.get_current_branch()
        assert git_ops.branch_exists(current) is True
        assert git_ops.branch_exists("nonexistent-branch") is False


class TestDiffOperations:
    """Tests for diff-related operations."""

    def test_get_diff(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test getting diff between refs."""
        # Create a new branch with changes
        repo = git_ops.repo
        original_branch = git_ops.get_current_branch()
        repo.git.checkout("-b", "feature")

        # Make a change
        test_file = temp_git_repo / "test.txt"
        test_file.write_text("modified content")
        repo.index.add(["test.txt"])
        repo.index.commit("Feature commit")

        # Get diff
        diff = git_ops.get_diff(original_branch, "feature")
        assert "modified content" in diff or "-initial content" in diff

    def test_get_diff_stat(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test getting diff statistics."""
        repo = git_ops.repo
        original_branch = git_ops.get_current_branch()
        repo.git.checkout("-b", "feature-stats")

        # Make changes
        new_file = temp_git_repo / "new_file.txt"
        new_file.write_text("new content\n")
        repo.index.add(["new_file.txt"])
        repo.index.commit("Add new file")

        stats = git_ops.get_diff_stat(original_branch, "feature-stats")
        assert "files" in stats
        assert "stat" in stats


class TestMergeOperations:
    """Tests for merge operations."""

    def test_merge_success(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test successful merge."""
        repo = git_ops.repo
        original_branch = git_ops.get_current_branch()

        # Create feature branch
        repo.git.checkout("-b", "feature-merge")
        new_file = temp_git_repo / "feature.txt"
        new_file.write_text("feature content")
        repo.index.add(["feature.txt"])
        repo.index.commit("Feature commit")

        # Go back to main and merge
        repo.git.checkout(original_branch)
        result = git_ops.merge("feature-merge", original_branch)

        assert result["success"] is True
        assert "Merged" in result["message"]

    def test_has_uncommitted_changes(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test detecting uncommitted changes."""
        assert git_ops.has_uncommitted_changes() is False

        # Make uncommitted change
        test_file = temp_git_repo / "test.txt"
        test_file.write_text("uncommitted change")

        assert git_ops.has_uncommitted_changes() is True


class TestRemoteOperations:
    """Tests for remote operations."""

    def test_get_remote_branches_no_remote(self, git_ops: GitOps) -> None:
        """Test getting remote branches when no remote exists."""
        branches = git_ops.get_remote_branches()
        assert branches == []

    def test_get_remote_url_no_remote(self, git_ops: GitOps) -> None:
        """Test getting remote URL when no remote exists."""
        url = git_ops.get_remote_url()
        assert url is None


class TestCommitHistory:
    """Tests for commit history operations."""

    def test_get_commits_between(self, git_ops: GitOps, temp_git_repo: Path) -> None:
        """Test getting commits between refs."""
        repo = git_ops.repo
        original_branch = git_ops.get_current_branch()

        # Create branch with commits
        repo.git.checkout("-b", "feature-commits")

        for i in range(3):
            file_path = temp_git_repo / f"file{i}.txt"
            file_path.write_text(f"content {i}")
            repo.index.add([f"file{i}.txt"])
            repo.index.commit(f"Commit {i}")

        commits = git_ops.get_commits_between(original_branch, "feature-commits")
        assert len(commits) == 3

        for commit in commits:
            assert "sha" in commit
            assert "short_sha" in commit
            assert "message" in commit
            assert "author" in commit
            assert "date" in commit
