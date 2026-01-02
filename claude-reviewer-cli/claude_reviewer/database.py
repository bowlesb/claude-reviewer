"""SQLite database operations for Claude Reviewer."""

from __future__ import annotations

import sqlite3
import uuid as uuid_lib
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .models import Comment, CommentReply, PRStatus, PullRequest, ReviewAction

if TYPE_CHECKING:
    pass


# Default database path
DEFAULT_DB_DIR = Path.home() / ".claude-reviewer"
DEFAULT_DB_PATH = DEFAULT_DB_DIR / "data.db"

# Schema SQL
SCHEMA_SQL = """
-- Pull Requests table
CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    repo_path TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    base_ref TEXT NOT NULL,
    head_ref TEXT NOT NULL,
    base_commit TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pr_uuid ON pull_requests(uuid);
CREATE INDEX IF NOT EXISTS idx_pr_repo ON pull_requests(repo_path);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pull_requests(status);

-- Diff snapshots
CREATE TABLE IF NOT EXISTS diff_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1,
    diff_content TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pr_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_diff_pr ON diff_snapshots(pr_id);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    line_type TEXT DEFAULT 'new',
    content TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_pr ON comments(pr_id);
CREATE INDEX IF NOT EXISTS idx_comments_file ON comments(pr_id, file_path);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(pr_id);

-- Comment replies table
CREATE TABLE IF NOT EXISTS comment_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'user',
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_replies_comment ON comment_replies(comment_id);
"""


def get_db_path() -> Path:
    """Get the database path, creating directory if needed."""
    DEFAULT_DB_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_DB_PATH


def generate_uuid() -> str:
    """Generate a short UUID for URLs."""
    return str(uuid_lib.uuid4())[:8]


@contextmanager
def get_connection(db_path: Path | None = None) -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections."""
    path = db_path or get_db_path()
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        yield conn
        conn.commit()
        # Checkpoint WAL to ensure data is written to main db file
        # This prevents corruption when other processes read the database
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | None = None) -> None:
    """Initialize database schema."""
    with get_connection(db_path) as conn:
        conn.executescript(SCHEMA_SQL)


def _row_to_pr(row: sqlite3.Row) -> PullRequest:
    """Convert a database row to a PullRequest object."""
    return PullRequest(
        id=row["id"],
        uuid=row["uuid"],
        repo_path=row["repo_path"],
        title=row["title"],
        description=row["description"] or "",
        base_ref=row["base_ref"],
        head_ref=row["head_ref"],
        base_commit=row["base_commit"],
        head_commit=row["head_commit"],
        status=PRStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_comment(row: sqlite3.Row) -> Comment:
    """Convert a database row to a Comment object."""
    return Comment(
        id=row["id"],
        uuid=row["uuid"],
        pr_id=row["pr_id"],
        file_path=row["file_path"],
        line_number=row["line_number"],
        line_type=row["line_type"],
        content=row["content"],
        resolved=bool(row["resolved"]),
        created_at=row["created_at"],
    )


# =============================================================================
# Pull Request Operations
# =============================================================================


def create_pr(
    repo_path: str,
    title: str,
    base_ref: str,
    head_ref: str,
    base_commit: str,
    head_commit: str,
    diff: str,
    description: str = "",
) -> str:
    """Create a new PR and return its UUID."""
    pr_uuid = generate_uuid()

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO pull_requests
            (uuid, repo_path, title, description, base_ref, head_ref, base_commit, head_commit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (pr_uuid, repo_path, title, description, base_ref, head_ref, base_commit, head_commit),
        )
        pr_id = cursor.lastrowid

        # Store initial diff snapshot
        conn.execute(
            """
            INSERT INTO diff_snapshots (pr_id, revision, diff_content, head_commit)
            VALUES (?, 1, ?, ?)
            """,
            (pr_id, diff, head_commit),
        )

    return pr_uuid


def get_pr_by_uuid(pr_uuid: str) -> PullRequest | None:
    """Get a PR by its UUID."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if row:
            return _row_to_pr(row)
    return None


def get_pr_by_id(pr_id: int) -> PullRequest | None:
    """Get a PR by its ID."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM pull_requests WHERE id = ?",
            (pr_id,),
        ).fetchone()

        if row:
            return _row_to_pr(row)
    return None


def list_prs(
    repo_path: str | None = None,
    status: PRStatus | None = None,
    limit: int = 50,
) -> list[PullRequest]:
    """List PRs with optional filters."""
    query = "SELECT * FROM pull_requests WHERE 1=1"
    params: list[Any] = []

    if repo_path:
        query += " AND repo_path = ?"
        params.append(repo_path)

    if status:
        query += " AND status = ?"
        params.append(status.value)

    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_pr(row) for row in rows]


def update_pr_status(pr_uuid: str, status: PRStatus) -> bool:
    """Update PR status."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE pull_requests
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE uuid = ?
            """,
            (status.value, pr_uuid),
        )
        return bool(cursor.rowcount > 0)


def delete_pr(pr_uuid: str) -> bool:
    """Delete a PR and all associated data."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        )
        return bool(cursor.rowcount > 0)


def update_pr_diff(pr_uuid: str, diff: str, head_commit: str) -> int:
    """Add a new diff snapshot and return the new revision number."""
    with get_connection() as conn:
        # Get PR ID and current max revision
        pr = conn.execute(
            "SELECT id FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            raise ValueError(f"PR {pr_uuid} not found")

        pr_id = pr["id"]

        # Get max revision
        max_rev = conn.execute(
            "SELECT MAX(revision) as max_rev FROM diff_snapshots WHERE pr_id = ?",
            (pr_id,),
        ).fetchone()

        new_revision = (max_rev["max_rev"] or 0) + 1

        # Insert new snapshot
        conn.execute(
            """
            INSERT INTO diff_snapshots (pr_id, revision, diff_content, head_commit)
            VALUES (?, ?, ?, ?)
            """,
            (pr_id, new_revision, diff, head_commit),
        )

        # Update PR head commit and timestamp
        conn.execute(
            """
            UPDATE pull_requests
            SET head_commit = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (head_commit, pr_id),
        )

        return new_revision


def get_latest_diff(pr_uuid: str) -> str | None:
    """Get the latest diff content for a PR."""
    with get_connection() as conn:
        pr = conn.execute(
            "SELECT id FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            return None

        row = conn.execute(
            """
            SELECT diff_content FROM diff_snapshots
            WHERE pr_id = ? ORDER BY revision DESC LIMIT 1
            """,
            (pr["id"],),
        ).fetchone()

        return row["diff_content"] if row else None


# =============================================================================
# Comment Operations
# =============================================================================


def add_comment(
    pr_uuid: str,
    file_path: str,
    line_number: int,
    content: str,
    line_type: str = "new",
) -> str:
    """Add a comment to a PR and return its UUID."""
    comment_uuid = generate_uuid()

    with get_connection() as conn:
        pr = conn.execute(
            "SELECT id, status FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            raise ValueError(f"PR {pr_uuid} not found")

        conn.execute(
            """
            INSERT INTO comments (uuid, pr_id, file_path, line_number, line_type, content)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (comment_uuid, pr["id"], file_path, line_number, line_type, content),
        )

        # Update PR timestamp
        conn.execute(
            "UPDATE pull_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pr["id"],),
        )

    return comment_uuid


def get_comments(
    pr_uuid: str,
    unresolved_only: bool = False,
    file_path: str | None = None,
) -> list[Comment]:
    """Get comments for a PR."""
    with get_connection() as conn:
        pr = conn.execute(
            "SELECT id FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            return []

        query = "SELECT * FROM comments WHERE pr_id = ?"
        params: list[Any] = [pr["id"]]

        if unresolved_only:
            query += " AND resolved = FALSE"

        if file_path:
            query += " AND file_path = ?"
            params.append(file_path)

        query += " ORDER BY file_path, line_number"

        rows = conn.execute(query, params).fetchall()
        return [_row_to_comment(row) for row in rows]


def resolve_comment(comment_uuid: str, resolved: bool = True) -> bool:
    """Mark a comment as resolved or unresolved."""
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE comments SET resolved = ? WHERE uuid = ?",
            (resolved, comment_uuid),
        )
        return bool(cursor.rowcount > 0)


# =============================================================================
# Review Operations
# =============================================================================


def submit_review(
    pr_uuid: str,
    action: ReviewAction,
    summary: str | None = None,
) -> bool:
    """Submit a review for a PR."""
    with get_connection() as conn:
        pr = conn.execute(
            "SELECT id FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            raise ValueError(f"PR {pr_uuid} not found")

        # Insert review record
        conn.execute(
            """
            INSERT INTO reviews (pr_id, action, summary)
            VALUES (?, ?, ?)
            """,
            (pr["id"], action.value, summary),
        )

        # Update PR status
        new_status = (
            PRStatus.APPROVED if action == ReviewAction.APPROVE else PRStatus.CHANGES_REQUESTED
        )
        conn.execute(
            """
            UPDATE pull_requests
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_status.value, pr["id"]),
        )

        return True


def get_reviews(pr_uuid: str) -> list[dict[str, Any]]:
    """Get all reviews for a PR."""
    with get_connection() as conn:
        pr = conn.execute(
            "SELECT id FROM pull_requests WHERE uuid = ?",
            (pr_uuid,),
        ).fetchone()

        if not pr:
            return []

        rows = conn.execute(
            """
            SELECT * FROM reviews WHERE pr_id = ? ORDER BY created_at DESC
            """,
            (pr["id"],),
        ).fetchall()

        return [dict(row) for row in rows]


# =============================================================================
# Comment Reply Operations
# =============================================================================


def _row_to_reply(row: sqlite3.Row) -> CommentReply:
    """Convert a database row to a CommentReply object."""
    return CommentReply(
        id=row["id"],
        uuid=row["uuid"],
        comment_id=row["comment_id"],
        author=row["author"],
        content=row["content"],
        created_at=row["created_at"],
    )


def add_reply(
    comment_uuid: str,
    content: str,
    author: str = "claude",
) -> str:
    """Add a reply to a comment and return its UUID."""
    reply_uuid = generate_uuid()

    with get_connection() as conn:
        comment = conn.execute(
            "SELECT id, pr_id FROM comments WHERE uuid = ?",
            (comment_uuid,),
        ).fetchone()

        if not comment:
            raise ValueError(f"Comment {comment_uuid} not found")

        conn.execute(
            """
            INSERT INTO comment_replies (uuid, comment_id, author, content)
            VALUES (?, ?, ?, ?)
            """,
            (reply_uuid, comment["id"], author, content),
        )

        # Update PR timestamp
        conn.execute(
            "UPDATE pull_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (comment["pr_id"],),
        )

    return reply_uuid


def get_replies(comment_uuid: str) -> list[CommentReply]:
    """Get all replies for a comment."""
    with get_connection() as conn:
        comment = conn.execute(
            "SELECT id FROM comments WHERE uuid = ?",
            (comment_uuid,),
        ).fetchone()

        if not comment:
            return []

        rows = conn.execute(
            """
            SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at
            """,
            (comment["id"],),
        ).fetchall()

        return [_row_to_reply(row) for row in rows]


def get_comment_by_uuid(comment_uuid: str) -> Comment | None:
    """Get a comment by its UUID."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM comments WHERE uuid = ?",
            (comment_uuid,),
        ).fetchone()

        if row:
            return _row_to_comment(row)
    return None


def get_comments_with_replies(
    pr_uuid: str,
    unresolved_only: bool = False,
) -> list[tuple[Comment, list[CommentReply]]]:
    """Get comments for a PR with their replies."""
    comments_list = get_comments(pr_uuid, unresolved_only=unresolved_only)
    result = []
    for comment in comments_list:
        replies = get_replies(comment.uuid)
        result.append((comment, replies))
    return result
