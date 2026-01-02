"""Tests for the database module."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from claude_reviewer import database as db
from claude_reviewer.models import PRStatus, ReviewAction


@pytest.fixture
def temp_db() -> Path:
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db.init_db(db_path)
        # Temporarily override the default path
        original_path = db.DEFAULT_DB_PATH
        db.DEFAULT_DB_PATH = db_path  # type: ignore[misc]
        yield db_path
        db.DEFAULT_DB_PATH = original_path  # type: ignore[misc]


class TestPullRequests:
    """Tests for PR operations."""

    def test_create_pr(self, temp_db: Path) -> None:
        """Test creating a PR."""
        uuid = db.create_pr(
            repo_path="/path/to/repo",
            title="Test PR",
            base_ref="main",
            head_ref="feature",
            base_commit="abc123",
            head_commit="def456",
            diff="diff content",
            description="Test description",
        )

        assert uuid is not None
        assert len(uuid) == 8

    def test_get_pr_by_uuid(self, temp_db: Path) -> None:
        """Test retrieving a PR by UUID."""
        uuid = db.create_pr(
            repo_path="/path/to/repo",
            title="Test PR",
            base_ref="main",
            head_ref="feature",
            base_commit="abc123",
            head_commit="def456",
            diff="diff content",
        )

        pr = db.get_pr_by_uuid(uuid)
        assert pr is not None
        assert pr.title == "Test PR"
        assert pr.base_ref == "main"
        assert pr.head_ref == "feature"
        assert pr.status == PRStatus.PENDING

    def test_get_pr_by_uuid_not_found(self, temp_db: Path) -> None:
        """Test retrieving a non-existent PR."""
        pr = db.get_pr_by_uuid("nonexistent")
        assert pr is None

    def test_delete_pr(self, temp_db: Path) -> None:
        """Test deleting a PR."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )
        
        # Add a comment to verify cascade delete
        db.add_comment(uuid, "file.py", 1, "comment")

        result = db.delete_pr(uuid)
        assert result is True

        pr = db.get_pr_by_uuid(uuid)
        assert pr is None
        
        comments = db.get_comments(uuid)
        assert len(comments) == 0

    def test_list_prs(self, temp_db: Path) -> None:
        """Test listing PRs."""
        # Create multiple PRs
        db.create_pr(
            repo_path="/repo1",
            title="PR 1",
            base_ref="main",
            head_ref="f1",
            base_commit="a",
            head_commit="b",
            diff="d1",
        )
        db.create_pr(
            repo_path="/repo2",
            title="PR 2",
            base_ref="main",
            head_ref="f2",
            base_commit="c",
            head_commit="d",
            diff="d2",
        )

        prs = db.list_prs()
        assert len(prs) == 2

    def test_list_prs_with_filter(self, temp_db: Path) -> None:
        """Test listing PRs with filters."""
        uuid1 = db.create_pr(
            repo_path="/repo1",
            title="PR 1",
            base_ref="main",
            head_ref="f1",
            base_commit="a",
            head_commit="b",
            diff="d1",
        )
        db.create_pr(
            repo_path="/repo2",
            title="PR 2",
            base_ref="main",
            head_ref="f2",
            base_commit="c",
            head_commit="d",
            diff="d2",
        )

        # Filter by repo
        prs = db.list_prs(repo_path="/repo1")
        assert len(prs) == 1
        assert prs[0].uuid == uuid1

        # Update status and filter
        db.update_pr_status(uuid1, PRStatus.APPROVED)
        prs = db.list_prs(status=PRStatus.APPROVED)
        assert len(prs) == 1

    def test_update_pr_status(self, temp_db: Path) -> None:
        """Test updating PR status."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        result = db.update_pr_status(uuid, PRStatus.APPROVED)
        assert result is True

        pr = db.get_pr_by_uuid(uuid)
        assert pr is not None
        assert pr.status == PRStatus.APPROVED

    def test_update_pr_diff(self, temp_db: Path) -> None:
        """Test updating PR diff."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="original diff",
        )

        new_revision = db.update_pr_diff(uuid, "new diff content", "newcommit")
        assert new_revision == 2

        diff = db.get_latest_diff(uuid)
        assert diff == "new diff content"

    def test_get_latest_diff(self, temp_db: Path) -> None:
        """Test getting latest diff."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="diff content",
        )

        diff = db.get_latest_diff(uuid)
        assert diff == "diff content"


class TestComments:
    """Tests for comment operations."""

    def test_add_comment(self, temp_db: Path) -> None:
        """Test adding a comment."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        comment_uuid = db.add_comment(
            pr_uuid=uuid,
            file_path="src/app.py",
            line_number=42,
            content="Fix this issue",
        )

        assert comment_uuid is not None
        assert len(comment_uuid) == 8

    def test_get_comments(self, temp_db: Path) -> None:
        """Test retrieving comments."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        db.add_comment(uuid, "file1.py", 10, "Comment 1")
        db.add_comment(uuid, "file2.py", 20, "Comment 2")

        comments = db.get_comments(uuid)
        assert len(comments) == 2

    def test_get_comments_unresolved_only(self, temp_db: Path) -> None:
        """Test filtering unresolved comments."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        c1 = db.add_comment(uuid, "file1.py", 10, "Comment 1")
        db.add_comment(uuid, "file2.py", 20, "Comment 2")

        # Resolve first comment
        db.resolve_comment(c1, resolved=True)

        unresolved = db.get_comments(uuid, unresolved_only=True)
        assert len(unresolved) == 1
        assert unresolved[0].content == "Comment 2"

    def test_resolve_comment(self, temp_db: Path) -> None:
        """Test resolving a comment."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        comment_uuid = db.add_comment(uuid, "file.py", 10, "Fix this")

        result = db.resolve_comment(comment_uuid, resolved=True)
        assert result is True

        comments = db.get_comments(uuid)
        assert len(comments) == 1
        assert comments[0].resolved is True


class TestReviews:
    """Tests for review operations."""

    def test_submit_review_approve(self, temp_db: Path) -> None:
        """Test submitting an approval review."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        result = db.submit_review(uuid, ReviewAction.APPROVE, summary="LGTM!")
        assert result is True

        pr = db.get_pr_by_uuid(uuid)
        assert pr is not None
        assert pr.status == PRStatus.APPROVED

    def test_submit_review_request_changes(self, temp_db: Path) -> None:
        """Test submitting a request changes review."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        result = db.submit_review(uuid, ReviewAction.REQUEST_CHANGES, summary="Needs work")
        assert result is True

        pr = db.get_pr_by_uuid(uuid)
        assert pr is not None
        assert pr.status == PRStatus.CHANGES_REQUESTED

    def test_get_reviews(self, temp_db: Path) -> None:
        """Test retrieving reviews."""
        uuid = db.create_pr(
            repo_path="/repo",
            title="PR",
            base_ref="main",
            head_ref="f",
            base_commit="a",
            head_commit="b",
            diff="d",
        )

        db.submit_review(uuid, ReviewAction.REQUEST_CHANGES, "Fix issues")
        db.submit_review(uuid, ReviewAction.APPROVE, "All good now")

        reviews = db.get_reviews(uuid)
        assert len(reviews) == 2
