import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Types
export interface PullRequest {
  id: number;
  uuid: string;
  repo_path: string;
  title: string;
  description: string;
  base_ref: string;
  head_ref: string;
  base_commit: string;
  head_commit: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'merged' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  uuid: string;
  pr_id: number;
  file_path: string;
  line_number: number;
  line_type: 'old' | 'new' | 'context';
  content: string;
  resolved: boolean;
  created_at: string;
}

export interface Review {
  id: number;
  pr_id: number;
  action: 'approve' | 'request_changes' | 'comment';
  summary: string | null;
  created_at: string;
}

export interface DiffSnapshot {
  id: number;
  pr_id: number;
  revision: number;
  diff_content: string;
  head_commit: string;
  created_at: string;
}

// Database path - shared with Python CLI
const DB_DIR = process.env.DATABASE_DIR || path.join(os.homedir(), '.claude-reviewer');
const DB_PATH = process.env.DATABASE_PATH || path.join(DB_DIR, 'data.db');

// Database instance with modification tracking
let db: Database.Database | null = null;
let dbMtime: number = 0;

/**
 * Get database connection, automatically reconnecting if the file was modified
 * by an external process (e.g., the Python CLI).
 */
export function getDatabase(): Database.Database {
  // Ensure directory exists
  fs.mkdirSync(DB_DIR, { recursive: true });

  // Check if database file was modified externally
  let currentMtime = 0;
  try {
    const stats = fs.statSync(DB_PATH);
    currentMtime = stats.mtimeMs;
  } catch {
    // File doesn't exist yet, will be created
  }

  // Reconnect if file was modified or no connection exists
  if (!db || (currentMtime > 0 && currentMtime !== dbMtime)) {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    // Initialize schema if needed
    initSchema(db);

    dbMtime = currentMtime || Date.now();
  }

  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

// Generate short UUID
function generateUuid(): string {
  return Math.random().toString(36).substring(2, 10);
}

// =============================================================================
// Pull Request Operations
// =============================================================================

export function createPR(
  repoPath: string,
  title: string,
  baseRef: string,
  headRef: string,
  baseCommit: string,
  headCommit: string,
  diff: string,
  description: string = ''
): string {
  const db = getDatabase();
  const uuid = generateUuid();

  const insertPR = db.prepare(`
    INSERT INTO pull_requests
    (uuid, repo_path, title, description, base_ref, head_ref, base_commit, head_commit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDiff = db.prepare(`
    INSERT INTO diff_snapshots (pr_id, revision, diff_content, head_commit)
    VALUES (?, 1, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertPR.run(uuid, repoPath, title, description, baseRef, headRef, baseCommit, headCommit);
    insertDiff.run(result.lastInsertRowid, diff, headCommit);
  });

  transaction();
  return uuid;
}

export function getPRByUuid(uuid: string): PullRequest | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM pull_requests WHERE uuid = ?').get(uuid);
  return row as PullRequest | null;
}

export function getPRById(id: number): PullRequest | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM pull_requests WHERE id = ?').get(id);
  return row as PullRequest | null;
}

export function listPRs(options: {
  repoPath?: string;
  status?: string;
  limit?: number;
} = {}): PullRequest[] {
  const db = getDatabase();
  const { repoPath, status, limit = 50 } = options;

  let query = 'SELECT * FROM pull_requests WHERE 1=1';
  const params: (string | number)[] = [];

  if (repoPath) {
    query += ' AND repo_path = ?';
    params.push(repoPath);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params) as PullRequest[];
}

export function updatePRStatus(uuid: string, status: PullRequest['status']): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE pull_requests
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE uuid = ?
  `).run(status, uuid);
  return result.changes > 0;
}

export function getLatestDiff(uuid: string): string | null {
  const db = getDatabase();
  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(uuid) as { id: number } | undefined;
  if (!pr) return null;

  const row = db.prepare(`
    SELECT diff_content FROM diff_snapshots
    WHERE pr_id = ? ORDER BY revision DESC LIMIT 1
  `).get(pr.id) as { diff_content: string } | undefined;

  return row?.diff_content || null;
}

export function updatePRDiff(uuid: string, diff: string, headCommit: string): number {
  const db = getDatabase();

  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(uuid) as { id: number } | undefined;
  if (!pr) throw new Error(`PR ${uuid} not found`);

  const maxRev = db.prepare(
    'SELECT MAX(revision) as max_rev FROM diff_snapshots WHERE pr_id = ?'
  ).get(pr.id) as { max_rev: number | null };

  const newRevision = (maxRev?.max_rev || 0) + 1;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO diff_snapshots (pr_id, revision, diff_content, head_commit)
      VALUES (?, ?, ?, ?)
    `).run(pr.id, newRevision, diff, headCommit);

    db.prepare(`
      UPDATE pull_requests
      SET head_commit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(headCommit, pr.id);
  });

  transaction();
  return newRevision;
}

// =============================================================================
// Comment Operations
// =============================================================================

export function addComment(
  prUuid: string,
  filePath: string,
  lineNumber: number,
  content: string,
  lineType: 'old' | 'new' | 'context' = 'new'
): string {
  const db = getDatabase();
  const commentUuid = generateUuid();

  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(prUuid) as { id: number } | undefined;
  if (!pr) throw new Error(`PR ${prUuid} not found`);

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO comments (uuid, pr_id, file_path, line_number, line_type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(commentUuid, pr.id, filePath, lineNumber, lineType, content);

    db.prepare(
      'UPDATE pull_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(pr.id);
  });

  transaction();
  return commentUuid;
}

export function getComments(
  prUuid: string,
  options: { unresolvedOnly?: boolean; filePath?: string } = {}
): Comment[] {
  const db = getDatabase();
  const { unresolvedOnly, filePath } = options;

  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(prUuid) as { id: number } | undefined;
  if (!pr) return [];

  let query = 'SELECT * FROM comments WHERE pr_id = ?';
  const params: (number | string)[] = [pr.id];

  if (unresolvedOnly) {
    query += ' AND resolved = FALSE';
  }

  if (filePath) {
    query += ' AND file_path = ?';
    params.push(filePath);
  }

  query += ' ORDER BY file_path, line_number';

  return db.prepare(query).all(...params) as Comment[];
}

export function resolveComment(commentUuid: string, resolved: boolean = true): boolean {
  const db = getDatabase();
  const result = db.prepare('UPDATE comments SET resolved = ? WHERE uuid = ?').run(resolved ? 1 : 0, commentUuid);
  return result.changes > 0;
}

export function updateCommentContent(commentUuid: string, content: string): boolean {
  const db = getDatabase();
  const result = db.prepare('UPDATE comments SET content = ? WHERE uuid = ?').run(content, commentUuid);
  return result.changes > 0;
}

export function deleteComment(commentUuid: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM comments WHERE uuid = ?').run(commentUuid);
  return result.changes > 0;
}

// =============================================================================
// Review Operations
// =============================================================================

export function submitReview(
  prUuid: string,
  action: 'approve' | 'request_changes',
  summary?: string
): boolean {
  const db = getDatabase();

  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(prUuid) as { id: number } | undefined;
  if (!pr) throw new Error(`PR ${prUuid} not found`);

  const newStatus = action === 'approve' ? 'approved' : 'changes_requested';

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO reviews (pr_id, action, summary)
      VALUES (?, ?, ?)
    `).run(pr.id, action, summary || null);

    db.prepare(`
      UPDATE pull_requests
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, pr.id);
  });

  transaction();
  return true;
}

export function getReviews(prUuid: string): Review[] {
  const db = getDatabase();

  const pr = db.prepare('SELECT id FROM pull_requests WHERE uuid = ?').get(prUuid) as { id: number } | undefined;
  if (!pr) return [];

  return db.prepare(`
    SELECT * FROM reviews WHERE pr_id = ? ORDER BY created_at DESC
  `).all(pr.id) as Review[];
}

// =============================================================================
// Utility
// =============================================================================

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
