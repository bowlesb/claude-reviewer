'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  GitPullRequest,
  CheckCircle,
  XCircle,
  Clock,
  GitMerge,
  MessageSquare,
  File,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-react';

interface PullRequest {
  id: number;
  uuid: string;
  repo_path: string;
  title: string;
  description: string;
  base_ref: string;
  head_ref: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'merged' | 'closed';
  created_at: string;
  updated_at: string;
}

interface CommentReply {
  id: number;
  uuid: string;
  author: string;
  content: string;
  created_at: string;
}

interface Comment {
  id: number;
  uuid: string;
  file_path: string;
  line_number: number;
  content: string;
  resolved: boolean;
  created_at: string;
}

interface CommentWithReplies {
  comment: Comment;
  replies: CommentReply[];
}

interface FileInfo {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

interface PRData {
  pr: PullRequest;
  diff: string;
  files: FileInfo[];
  comments: CommentWithReplies[];
}

const statusConfig = {
  pending: { icon: Clock, color: '#f0ad4e', label: 'Pending Review' },
  approved: { icon: CheckCircle, color: '#5cb85c', label: 'Approved' },
  changes_requested: { icon: XCircle, color: '#d9534f', label: 'Changes Requested' },
  merged: { icon: GitMerge, color: '#6f42c1', label: 'Merged' },
  closed: { icon: XCircle, color: '#6c757d', label: 'Closed' },
};

export default function PRPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PRData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [commentingAt, setCommentingAt] = useState<{ file: string; line: number } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState<{ uuid: string; content: string } | null>(null);
  const [reviewSummary, setReviewSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPR();
  }, [id]);

  const fetchPR = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prs/${id}`);
      if (!res.ok) throw new Error('PR not found');
      const prData = await res.json();
      setData(prData);
      // Expand all files by default
      setExpandedFiles(new Set(prData.files.map((f: FileInfo) => f.path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading PR');
    } finally {
      setLoading(false);
    }
  };

  const toggleFile = (path: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFiles(newExpanded);
  };

  const addComment = async () => {
    if (!commentingAt || !newComment.trim() || !data) return;

    const tempUuid = `temp-${Date.now()}`;
    const newCommentObj: CommentWithReplies = {
      comment: {
        id: Date.now(),
        uuid: tempUuid,
        file_path: commentingAt.file,
        line_number: commentingAt.line,
        content: newComment,
        resolved: false,
        created_at: new Date().toISOString(),
      },
      replies: [],
    };

    // Optimistically update local state
    setData({
      ...data,
      comments: [...data.comments, newCommentObj],
    });
    setNewComment('');
    setCommentingAt(null);

    try {
      const res = await fetch(`/api/prs/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: commentingAt.file,
          lineNumber: commentingAt.line,
          content: newComment,
        }),
      });
      const result = await res.json();
      // Update with real UUID from server
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((c) =>
                c.comment.uuid === tempUuid ? { ...c, comment: { ...c.comment, uuid: result.uuid } } : c
              ),
            }
          : prev
      );
    } catch (e) {
      alert('Error adding comment');
      // Revert on error
      setData((prev) => (prev ? { ...prev, comments: prev.comments.filter((c) => c.comment.uuid !== tempUuid) } : prev));
    }
  };

  const editComment = async () => {
    if (!editingComment || !editingComment.content.trim() || !data) return;

    const originalCommentWithReplies = data.comments.find((c) => c.comment.uuid === editingComment.uuid);

    // Optimistically update local state
    setData({
      ...data,
      comments: data.comments.map((c) =>
        c.comment.uuid === editingComment.uuid
          ? { ...c, comment: { ...c.comment, content: editingComment.content } }
          : c
      ),
    });
    setEditingComment(null);

    try {
      await fetch(`/api/prs/${id}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentUuid: editingComment.uuid,
          content: editingComment.content,
        }),
      });
    } catch (e) {
      alert('Error updating comment');
      // Revert on error
      if (originalCommentWithReplies) {
        setData((prev) =>
          prev
            ? { ...prev, comments: prev.comments.map((c) => (c.comment.uuid === editingComment.uuid ? originalCommentWithReplies : c)) }
            : prev
        );
      }
    }
  };

  const resolveComment = async (commentUuid: string, resolved: boolean) => {
    if (!data) return;

    // Optimistically update local state
    setData({
      ...data,
      comments: data.comments.map((c) =>
        c.comment.uuid === commentUuid ? { ...c, comment: { ...c.comment, resolved } } : c
      ),
    });

    try {
      await fetch(`/api/prs/${id}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentUuid, resolved }),
      });
    } catch (e) {
      alert('Error updating comment');
      // Revert on error
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((c) =>
                c.comment.uuid === commentUuid ? { ...c, comment: { ...c.comment, resolved: !resolved } } : c
              ),
            }
          : prev
      );
    }
  };

  const submitReview = async (action: 'approve' | 'request_changes') => {
    setSubmitting(true);
    try {
      await fetch(`/api/prs/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, summary: reviewSummary }),
      });
      setReviewSummary('');
      fetchPR();
    } catch (e) {
      alert('Error submitting review');
    } finally {
      setSubmitting(false);
    }
  };


  // Parse diff into file chunks
  const parseFileDiff = (diff: string, filePath: string): string[] => {
    const fileMatch = diff.match(
      new RegExp(`diff --git a/${escapeRegex(filePath)} b/${escapeRegex(filePath)}[\\s\\S]*?(?=diff --git|$)`)
    );
    if (!fileMatch) return [];

    const lines = fileMatch[0].split('\n');
    return lines.filter(
      (l) => !l.startsWith('diff --git') && !l.startsWith('index ') && !l.startsWith('---') && !l.startsWith('+++')
    );
  };

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Get comments for a specific file
  const getFileComments = (filePath: string): CommentWithReplies[] => {
    if (!data) return [];
    return data.comments.filter((c) => c.comment.file_path === filePath);
  };

  if (loading) {
    return (
      <main className="container">
        <div className="loading">Loading PR...</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="container">
        <div className="error">{error || 'PR not found'}</div>
        <Link href="/">Back to list</Link>
      </main>
    );
  }

  const { pr, diff, files, comments } = data;
  const config = statusConfig[pr.status];
  const StatusIcon = config.icon;
  const unresolvedCount = comments.filter((c) => !c.comment.resolved).length;

  return (
    <main className="container pr-detail">
      {/* Header */}
      <div className="pr-header">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} />
          Back
        </Link>

        <div className="pr-title-row">
          <GitPullRequest size={24} className="pr-icon" />
          <h1>{pr.title}</h1>
          <span className="status-badge" style={{ backgroundColor: config.color }}>
            <StatusIcon size={14} />
            {config.label}
          </span>
        </div>

        <div className="pr-meta">
          <span>#{pr.uuid}</span>
          <span className="branch-info">
            {pr.head_ref} → {pr.base_ref}
          </span>
        </div>

        {pr.description && <p className="pr-description">{pr.description}</p>}
      </div>

      {/* Layout: Sidebar + Main */}
      <div className="pr-layout">
        {/* Sidebar */}
        <aside className="pr-sidebar">
          <div className="sidebar-section">
            <h3>Files Changed ({files.length})</h3>
            <div className="file-list">
              {files.map((file) => (
                <a
                  key={file.path}
                  className={`file-item ${expandedFiles.has(file.path) ? 'active' : ''}`}
                  href={`#file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`}
                  onClick={() => {
                    if (!expandedFiles.has(file.path)) {
                      toggleFile(file.path);
                    }
                  }}
                >
                  <File size={14} />
                  <span className="file-name">{file.path.split('/').pop()}</span>
                  <span className="file-stats">
                    <span className="additions">+{file.additions}</span>
                    <span className="deletions">-{file.deletions}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Review Panel */}
          {pr.status !== 'merged' && (
            <div className="sidebar-section review-panel">
              <h3>Submit Review</h3>
              <textarea
                placeholder="Leave a comment (optional)"
                value={reviewSummary}
                onChange={(e) => setReviewSummary(e.target.value)}
                rows={3}
              />
              <div className="review-actions">
                <button
                  className="btn-approve"
                  onClick={() => submitReview('approve')}
                  disabled={submitting}
                >
                  <CheckCircle size={16} />
                  Approve
                </button>
                <button
                  className="btn-request-changes"
                  onClick={() => submitReview('request_changes')}
                  disabled={submitting}
                >
                  <XCircle size={16} />
                  Request Changes
                </button>
              </div>
              {pr.status === 'approved' && (
                <div className="approved-notice">
                  <CheckCircle size={16} />
                  Approved - Ready for merge
                </div>
              )}
            </div>
          )}

          {unresolvedCount > 0 && (
            <div className="sidebar-section">
              <div className="comment-count">
                <MessageSquare size={16} />
                {unresolvedCount} unresolved comment{unresolvedCount !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </aside>

        {/* Main Diff View */}
        <div className="pr-main">
          {files.map((file) => {
            const isExpanded = expandedFiles.has(file.path);
            const fileComments = getFileComments(file.path);
            const diffLines = parseFileDiff(diff, file.path);

            let lineNum = 0;

            return (
              <div key={file.path} id={`file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`} className="file-diff">
                <div className="file-header" onClick={() => toggleFile(file.path)}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="file-path">{file.path}</span>
                  <span className="file-badge">{file.changeType}</span>
                </div>

                {isExpanded && (
                  <div className="diff-content">
                    {diffLines.map((line, idx) => {
                      // Track line numbers for + lines
                      if (line.startsWith('+') && !line.startsWith('@@')) {
                        lineNum++;
                      } else if (line.startsWith('@@')) {
                        const match = line.match(/@@ .* \+(\d+)/);
                        if (match) lineNum = parseInt(match[1]) - 1;
                      } else if (!line.startsWith('-')) {
                        lineNum++;
                      }

                      const currentLine = lineNum;
                      const lineClasses = line.startsWith('+')
                        ? 'line-add'
                        : line.startsWith('-')
                        ? 'line-del'
                        : line.startsWith('@@')
                        ? 'line-hunk'
                        : 'line-ctx';

                      // Find comments for this line
                      const lineComments = fileComments.filter(
                        (c) => c.comment.line_number === currentLine && !line.startsWith('-') && !line.startsWith('@@')
                      );

                      return (
                        <div key={idx}>
                          <div className={`diff-line ${lineClasses}`}>
                            <span
                              className="line-num"
                              onClick={() => {
                                if (!line.startsWith('-') && !line.startsWith('@@')) {
                                  setCommentingAt({ file: file.path, line: currentLine });
                                }
                              }}
                            >
                              {!line.startsWith('-') && !line.startsWith('@@') ? currentLine : ''}
                              <Plus size={12} className="add-comment-icon" />
                            </span>
                            <span className="line-content">
                              {line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}
                            </span>
                          </div>

                          {/* Inline comments with replies */}
                          {lineComments.map(({ comment: c, replies }) => (
                            <div key={c.uuid} className={`inline-comment ${c.resolved ? 'resolved' : ''}`}>
                              {editingComment?.uuid === c.uuid ? (
                                <div className="edit-comment-form">
                                  <textarea
                                    autoFocus
                                    value={editingComment.content}
                                    onChange={(e) => setEditingComment({ ...editingComment, content: e.target.value })}
                                    rows={3}
                                  />
                                  <div className="comment-actions">
                                    <button onClick={editComment}>Save</button>
                                    <button className="cancel" onClick={() => setEditingComment(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="comment-content">{c.content}</div>
                                  <div className="comment-buttons">
                                    <button
                                      className="edit-btn"
                                      onClick={() => setEditingComment({ uuid: c.uuid, content: c.content })}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="resolve-btn"
                                      onClick={() => resolveComment(c.uuid, !c.resolved)}
                                    >
                                      {c.resolved ? 'Unresolve' : 'Resolve'}
                                    </button>
                                  </div>
                                  {/* Replies */}
                                  {replies.length > 0 && (
                                    <div className="comment-replies">
                                      {replies.map((r) => (
                                        <div key={r.uuid} className={`comment-reply ${r.author === 'claude' ? 'reply-claude' : 'reply-user'}`}>
                                          <span className="reply-author">{r.author}:</span>
                                          <span className="reply-content">{r.content}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ))}

                          {/* New comment form */}
                          {commentingAt?.file === file.path && commentingAt?.line === currentLine && (
                            <div className="new-comment-form">
                              <textarea
                                autoFocus
                                placeholder="Write a comment..."
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                rows={3}
                              />
                              <div className="comment-actions">
                                <button onClick={addComment}>Add Comment</button>
                                <button className="cancel" onClick={() => setCommentingAt(null)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .pr-detail {
          padding-bottom: 4rem;
        }

        .pr-header {
          margin-bottom: 2rem;
        }

        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          color: #8b949e;
          text-decoration: none;
          margin-bottom: 1rem;
        }

        .back-link:hover {
          color: #58a6ff;
        }

        .pr-title-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .pr-title-row h1 {
          font-size: 1.5rem;
          margin: 0;
          flex: 1;
        }

        .pr-icon {
          color: #3fb950;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: 500;
          color: white;
        }

        .pr-meta {
          display: flex;
          gap: 1rem;
          color: #8b949e;
          font-size: 0.875rem;
        }

        .branch-info {
          font-family: monospace;
          background: #21262d;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
        }

        .pr-description {
          margin-top: 1rem;
          color: #c9d1d9;
        }

        .pr-layout {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 1.5rem;
        }

        .pr-sidebar {
          position: sticky;
          top: 1rem;
          height: fit-content;
        }

        .sidebar-section {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .sidebar-section h3 {
          font-size: 0.875rem;
          margin: 0 0 0.75rem;
          color: #8b949e;
        }

        .file-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .file-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          background: transparent;
          border: none;
          color: #c9d1d9;
          cursor: pointer;
          border-radius: 4px;
          text-align: left;
          font-size: 0.8rem;
          text-decoration: none;
        }

        .file-item:hover,
        .file-item.active {
          background: #21262d;
        }

        .file-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-stats {
          font-family: monospace;
          font-size: 0.75rem;
        }

        .additions {
          color: #3fb950;
        }
        .deletions {
          color: #f85149;
          margin-left: 0.25rem;
        }

        .review-panel textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #30363d;
          border-radius: 6px;
          background: #0d1117;
          color: #c9d1d9;
          resize: vertical;
          margin-bottom: 0.75rem;
        }

        .review-actions {
          display: flex;
          gap: 0.5rem;
        }

        .btn-approve,
        .btn-request-changes {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.375rem;
          padding: 0.5rem;
          border: none;
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
        }

        .btn-approve {
          background: #238636;
          color: white;
        }

        .btn-request-changes {
          background: #21262d;
          color: #f85149;
          border: 1px solid #30363d;
        }

        .approved-notice {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.75rem;
          padding: 0.5rem;
          background: rgba(35, 134, 54, 0.15);
          border: 1px solid #238636;
          border-radius: 6px;
          color: #3fb950;
          font-size: 0.85rem;
        }

        .comment-count {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #f0ad4e;
        }

        /* Diff styles */
        .file-diff {
          border: 1px solid #30363d;
          border-radius: 8px;
          margin-bottom: 1rem;
          overflow: hidden;
        }

        .file-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: #161b22;
          border-bottom: 1px solid #30363d;
          cursor: pointer;
        }

        .file-path {
          flex: 1;
          font-family: monospace;
          font-size: 0.875rem;
        }

        .file-badge {
          font-size: 0.7rem;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          background: #21262d;
          color: #8b949e;
        }

        .diff-content {
          font-family: monospace;
          font-size: 0.8rem;
          overflow-x: auto;
        }

        .diff-line {
          display: flex;
          min-height: 1.5rem;
        }

        .line-num {
          width: 50px;
          padding: 0 0.5rem;
          text-align: right;
          color: #484f58;
          background: #161b22;
          user-select: none;
          cursor: pointer;
          position: relative;
        }

        .line-num:hover .add-comment-icon {
          opacity: 1;
        }

        .add-comment-icon {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0;
          color: #58a6ff;
        }

        .line-content {
          flex: 1;
          padding: 0 1rem;
          white-space: pre;
        }

        .line-add {
          background: rgba(46, 160, 67, 0.15);
        }
        .line-add .line-content {
          background: rgba(46, 160, 67, 0.15);
        }

        .line-del {
          background: rgba(248, 81, 73, 0.15);
        }
        .line-del .line-content {
          background: rgba(248, 81, 73, 0.15);
        }

        .line-hunk {
          background: rgba(56, 139, 253, 0.1);
          color: #8b949e;
        }

        .inline-comment {
          margin: 0.5rem 1rem;
          padding: 0.75rem;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          margin-left: 60px;
        }

        .inline-comment.resolved {
          opacity: 0.6;
        }

        .comment-content {
          margin-bottom: 0.5rem;
        }

        .comment-buttons {
          display: flex;
          gap: 0.5rem;
        }

        .edit-btn,
        .resolve-btn {
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          background: #21262d;
          border: 1px solid #30363d;
          color: #8b949e;
          border-radius: 4px;
          cursor: pointer;
        }

        .edit-btn:hover,
        .resolve-btn:hover {
          background: #30363d;
          color: #c9d1d9;
        }

        .edit-comment-form {
          width: 100%;
        }

        .comment-replies {
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid #30363d;
        }

        .comment-reply {
          padding: 0.5rem;
          margin-bottom: 0.5rem;
          border-radius: 4px;
          font-size: 0.9rem;
        }

        .reply-claude {
          background: rgba(35, 134, 54, 0.15);
          border-left: 3px solid #3fb950;
        }

        .reply-user {
          background: rgba(56, 139, 253, 0.15);
          border-left: 3px solid #58a6ff;
        }

        .reply-author {
          font-weight: 600;
          margin-right: 0.5rem;
        }

        .reply-claude .reply-author {
          color: #3fb950;
        }

        .reply-user .reply-author {
          color: #58a6ff;
        }

        .reply-content {
          color: #c9d1d9;
        }

        .edit-comment-form textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #30363d;
          border-radius: 4px;
          background: #161b22;
          color: #c9d1d9;
          resize: vertical;
          margin-bottom: 0.5rem;
        }

        .new-comment-form {
          margin: 0.5rem 1rem;
          margin-left: 60px;
          padding: 0.75rem;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
        }

        .new-comment-form textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #30363d;
          border-radius: 4px;
          background: #161b22;
          color: #c9d1d9;
          resize: vertical;
          margin-bottom: 0.5rem;
        }

        .comment-actions {
          display: flex;
          gap: 0.5rem;
        }

        .comment-actions button {
          padding: 0.375rem 0.75rem;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 0.8rem;
        }

        .comment-actions button:first-child {
          background: #238636;
          color: white;
        }

        .comment-actions button.cancel {
          background: #21262d;
          color: #8b949e;
        }

        .loading,
        .error {
          text-align: center;
          padding: 4rem;
          color: #8b949e;
        }

        @media (max-width: 900px) {
          .pr-layout {
            grid-template-columns: 1fr;
          }

          .pr-sidebar {
            position: static;
            order: 1;
          }

          .pr-main {
            order: 2;
          }
        }
      `}</style>
    </main>
  );
}
