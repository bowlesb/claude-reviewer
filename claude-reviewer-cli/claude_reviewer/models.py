"""Data models for Claude Reviewer."""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional


class PRStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    MERGED = "merged"
    CLOSED = "closed"


class ReviewAction(str, Enum):
    APPROVE = "approve"
    REQUEST_CHANGES = "request_changes"
    COMMENT = "comment"


@dataclass
class PullRequest:
    id: int
    uuid: str
    repo_path: str
    title: str
    base_ref: str
    head_ref: str
    status: PRStatus = PRStatus.PENDING
    description: str = ""
    base_commit: str = ""
    head_commit: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class Comment:
    id: int
    uuid: str
    pr_id: int
    file_path: str
    line_number: int
    content: str
    resolved: bool = False
    line_type: str = "new"
    created_at: Optional[datetime] = None


@dataclass
class Review:
    id: int
    pr_id: int
    action: ReviewAction
    summary: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class DiffSnapshot:
    id: int
    pr_id: int
    revision: int
    diff_content: str
    head_commit: str
    created_at: Optional[datetime] = None


@dataclass
class CommentReply:
    id: int
    uuid: str
    comment_id: int
    author: str
    content: str
    created_at: Optional[datetime] = None
