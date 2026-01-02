'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { Highlight, themes } from 'prism-react-renderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  GitPullRequest,
  CheckCircle,
  XCircle,
  Clock,
  GitMerge,
  MessageSquare,
  File,
  FileText,
  Eye,
  Code,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-react';

// Map file extensions to Prism language identifiers
const getLanguage = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    rb: 'ruby',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    html: 'markup',
    xml: 'markup',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    toml: 'toml',
    dockerfile: 'docker',
  };
  return langMap[ext] || 'plaintext';
};

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

// GitHub-style status colors
const statusConfig = {
  pending: { icon: Clock, color: '#d29922', label: 'Pending Review' },
  approved: { icon: CheckCircle, color: '#238636', label: 'Approved' },
  changes_requested: { icon: XCircle, color: '#da3633', label: 'Changes Requested' },
  merged: { icon: GitMerge, color: '#8250df', label: 'Merged' },
  closed: { icon: XCircle, color: '#6e7681', label: 'Closed' },
};

// GitHub-like dark theme for syntax highlighting
const githubDarkTheme = {
  plain: {
    color: '#e6edf3',
    backgroundColor: 'transparent',
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#8b949e' } },
    { types: ['punctuation'], style: { color: '#e6edf3' } },
    { types: ['namespace'], style: { opacity: 0.7 } },
    { types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'], style: { color: '#79c0ff' } },
    { types: ['selector', 'attr-name', 'char', 'builtin', 'inserted'], style: { color: '#a5d6ff' } },
    { types: ['operator', 'entity', 'url'], style: { color: '#e6edf3' } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: '#ff7b72' } },
    { types: ['function', 'class-name'], style: { color: '#d2a8ff' } },
    { types: ['regex', 'important', 'variable'], style: { color: '#ffa657' } },
    { types: ['string'], style: { color: '#a5d6ff' } },
  ],
};

// Component to render a syntax-highlighted line
function SyntaxLine({ code, language }: { code: string; language: string }) {
  return (
    <Highlight theme={githubDarkTheme} code={code} language={language}>
      {({ tokens, getTokenProps }) => (
        <span style={{ whiteSpace: 'pre' }}>
          {tokens[0]?.map((token, i) => (
            <span key={i} {...getTokenProps({ token })} />
          ))}
        </span>
      )}
    </Highlight>
  );
}

export default function PRPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PRData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [commentingAt, setCommentingAt] = useState<{ file: string; line: number } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState<{ uuid: string; content: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [reviewSummary, setReviewSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState<Set<string>>(new Set());

  const isMarkdownFile = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'markdown';
  };

  const togglePreview = (path: string) => {
    const newPreview = new Set(previewMode);
    if (newPreview.has(path)) {
      newPreview.delete(path);
    } else {
      newPreview.add(path);
    }
    setPreviewMode(newPreview);
  };

  // Extract full file content from diff for markdown preview
  const getFileContentFromDiff = (diffContent: string, filePath: string): string => {
    const fileMatch = diffContent.match(
      new RegExp(`diff --git a/${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} b/${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=diff --git|$)`)
    );
    if (!fileMatch) return '';

    const lines = fileMatch[0].split('\n');
    const contentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('index ') ||
          line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
        continue;
      }
      if (line.startsWith('-')) continue; // Skip deleted lines
      if (line.startsWith('+')) {
        contentLines.push(line.slice(1)); // Add new lines without +
      } else if (line.startsWith(' ')) {
        contentLines.push(line.slice(1)); // Context lines have leading space
      } else {
        contentLines.push(line); // Empty lines or other
      }
    }
    return contentLines.join('\n');
  };

  // Custom code block renderer for markdown with syntax highlighting
  const CodeBlock = ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const code = String(children).replace(/\n$/, '');

    if (!className) {
      // Inline code
      return <code className="inline-code" {...props}>{children}</code>;
    }

    return (
      <Highlight theme={githubDarkTheme} code={code} language={language || 'plaintext'}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre style={{ ...style, background: '#161b22', padding: '16px', borderRadius: '6px', overflow: 'auto' }}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    );
  };

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

  const addReply = async (commentUuid: string) => {
    if (!replyContent.trim() || !data) return;

    const tempReply: CommentReply = {
      id: Date.now(),
      uuid: `temp-${Date.now()}`,
      author: 'ben',
      content: replyContent,
      created_at: new Date().toISOString(),
    };

    // Optimistically update local state
    setData({
      ...data,
      comments: data.comments.map((c) =>
        c.comment.uuid === commentUuid
          ? { ...c, replies: [...c.replies, tempReply] }
          : c
      ),
    });
    setReplyContent('');
    setReplyingTo(null);

    try {
      const res = await fetch(`/api/prs/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentUuid,
          content: replyContent,
          author: 'ben',
        }),
      });
      const result = await res.json();
      // Update with real UUID from server
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((c) =>
                c.comment.uuid === commentUuid
                  ? {
                      ...c,
                      replies: c.replies.map((r) =>
                        r.uuid === tempReply.uuid ? { ...r, uuid: result.uuid } : r
                      ),
                    }
                  : c
              ),
            }
          : prev
      );
    } catch (e) {
      alert('Error adding reply');
      // Revert on error
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((c) =>
                c.comment.uuid === commentUuid
                  ? { ...c, replies: c.replies.filter((r) => r.uuid !== tempReply.uuid) }
                  : c
              ),
            }
          : prev
      );
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

            const isPreview = previewMode.has(file.path);
            const isMd = isMarkdownFile(file.path);

            return (
              <div key={file.path} id={`file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`} className="file-diff">
                <div className="file-header">
                  <div className="file-header-left" onClick={() => toggleFile(file.path)}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="file-path">{file.path}</span>
                    <span className="file-badge">{file.changeType}</span>
                  </div>
                  {isMd && isExpanded && (
                    <button
                      className={`preview-toggle ${isPreview ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePreview(file.path);
                      }}
                    >
                      {isPreview ? <Code size={14} /> : <Eye size={14} />}
                      {isPreview ? 'Raw' : 'Preview'}
                    </button>
                  )}
                </div>

                {isExpanded && isPreview && isMd && (
                  <div className="markdown-preview">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: CodeBlock,
                      }}
                    >
                      {getFileContentFromDiff(diff, file.path)}
                    </ReactMarkdown>
                  </div>
                )}

                {isExpanded && !isPreview && (
                  <div className="diff-content">
                    {(() => {
                      let oldLineNum = 0;
                      let newLineNum = 0;

                      return diffLines.map((line, idx) => {
                        // Parse hunk header for line numbers
                        if (line.startsWith('@@')) {
                          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
                          if (match) {
                            oldLineNum = parseInt(match[1]) - 1;
                            newLineNum = parseInt(match[2]) - 1;
                          }
                        }

                        // Track line numbers based on line type
                        let displayOldLine = '';
                        let displayNewLine = '';
                        let indicator = ' ';

                        if (line.startsWith('@@')) {
                          // Hunk header - no line numbers
                        } else if (line.startsWith('+')) {
                          newLineNum++;
                          displayNewLine = String(newLineNum);
                          indicator = '+';
                        } else if (line.startsWith('-')) {
                          oldLineNum++;
                          displayOldLine = String(oldLineNum);
                          indicator = '-';
                        } else {
                          // Context line
                          oldLineNum++;
                          newLineNum++;
                          displayOldLine = String(oldLineNum);
                          displayNewLine = String(newLineNum);
                        }

                        const currentLine = newLineNum;
                        const lineClasses = line.startsWith('+')
                          ? 'line-add'
                          : line.startsWith('-')
                          ? 'line-del'
                          : line.startsWith('@@')
                          ? 'line-hunk'
                          : 'line-ctx';

                        // Find comments for this line (only for new/context lines)
                        const lineComments = fileComments.filter(
                          (c) => c.comment.line_number === currentLine && !line.startsWith('-') && !line.startsWith('@@')
                        );

                        return (
                          <div key={idx}>
                            <div className={`diff-line ${lineClasses}`}>
                              <span className={`line-num line-num-old ${lineClasses}`}>{displayOldLine}</span>
                              <span className={`line-num line-num-new ${lineClasses}`}>{displayNewLine}</span>
                              <span className={`line-indicator ${lineClasses}`}>{indicator}</span>
                              <span
                                className={`line-content ${lineClasses}`}
                                onClick={() => {
                                  if (!line.startsWith('-') && !line.startsWith('@@')) {
                                    setCommentingAt({ file: file.path, line: currentLine });
                                  }
                                }}
                              >
                                {line.startsWith('@@') ? (
                                  <span className="hunk-info">{line}</span>
                                ) : (
                                  <SyntaxLine
                                    code={line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}
                                    language={getLanguage(file.path)}
                                  />
                                )}
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
                                    {replies.length === 0 && (
                                      <button
                                        className="edit-btn"
                                        onClick={() => setEditingComment({ uuid: c.uuid, content: c.content })}
                                      >
                                        Edit
                                      </button>
                                    )}
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
                                        <div key={r.uuid} className={`comment-reply ${r.author === 'claude' ? 'reply-claude' : 'reply-ben'}`}>
                                          <span className="reply-author">{r.author}:</span>
                                          <span className="reply-content">{r.content}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Reply form */}
                                  {replyingTo === c.uuid ? (
                                    <div className="reply-form">
                                      <textarea
                                        autoFocus
                                        placeholder="Write a reply..."
                                        value={replyContent}
                                        onChange={(e) => setReplyContent(e.target.value)}
                                        rows={2}
                                      />
                                      <div className="comment-actions">
                                        <button onClick={() => addReply(c.uuid)}>Reply</button>
                                        <button className="cancel" onClick={() => { setReplyingTo(null); setReplyContent(''); }}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button className="reply-btn" onClick={() => setReplyingTo(c.uuid)}>
                                      Reply
                                    </button>
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
                    });
                  })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </main>
  );
}
