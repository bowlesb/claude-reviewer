/**
 * Tests for the database module.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Set up test database path before importing database module
const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-reviewer-test-"));
const testDbPath = path.join(testDbDir, "test.db");
process.env.DATABASE_DIR = testDbDir;
process.env.DATABASE_PATH = testDbPath;

import {
  createPR,
  getPRByUuid,
  getPRById,
  listPRs,
  updatePRStatus,
  getLatestDiff,
  updatePRDiff,
  addComment,
  getComments,
  resolveComment,
  deleteComment,
  submitReview,
  getReviews,
  closeDatabase,
} from "../lib/database";

describe("Database Module", () => {
  afterAll(() => {
    closeDatabase();
    // Clean up test database
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Pull Request Operations", () => {
    let testPRUuid: string;

    test("createPR creates a new PR and returns UUID", () => {
      testPRUuid = createPR(
        "/path/to/repo",
        "Test PR",
        "main",
        "feature",
        "abc123",
        "def456",
        "diff content",
        "Test description"
      );

      expect(testPRUuid).toBeDefined();
      expect(testPRUuid.length).toBe(8);
    });

    test("getPRByUuid retrieves PR by UUID", () => {
      const pr = getPRByUuid(testPRUuid);

      expect(pr).not.toBeNull();
      expect(pr?.title).toBe("Test PR");
      expect(pr?.base_ref).toBe("main");
      expect(pr?.head_ref).toBe("feature");
      expect(pr?.status).toBe("pending");
      expect(pr?.description).toBe("Test description");
    });

    test("getPRByUuid returns undefined for non-existent UUID", () => {
      const pr = getPRByUuid("nonexistent");
      expect(pr).toBeUndefined();
    });

    test("getPRById retrieves PR by ID", () => {
      const prByUuid = getPRByUuid(testPRUuid);
      expect(prByUuid).not.toBeNull();

      const pr = getPRById(prByUuid!.id);
      expect(pr).not.toBeNull();
      expect(pr?.uuid).toBe(testPRUuid);
    });

    test("listPRs returns all PRs", () => {
      // Create another PR
      createPR("/repo2", "PR 2", "main", "f2", "a", "b", "d2");

      const prs = listPRs();
      expect(prs.length).toBeGreaterThanOrEqual(2);
    });

    test("listPRs filters by repo path", () => {
      const prs = listPRs({ repoPath: "/path/to/repo" });
      expect(prs.length).toBeGreaterThanOrEqual(1);
      const foundPr = prs.find((pr) => pr.uuid === testPRUuid);
      expect(foundPr).toBeDefined();
    });

    test("listPRs filters by status", () => {
      const prs = listPRs({ status: "pending" });
      expect(prs.length).toBeGreaterThanOrEqual(1);
      prs.forEach((pr) => expect(pr.status).toBe("pending"));
    });

    test("updatePRStatus updates PR status", () => {
      const result = updatePRStatus(testPRUuid, "approved");
      expect(result).toBe(true);

      const pr = getPRByUuid(testPRUuid);
      expect(pr?.status).toBe("approved");
    });

    test("getLatestDiff returns diff content", () => {
      const diff = getLatestDiff(testPRUuid);
      expect(diff).toBe("diff content");
    });

    test("getLatestDiff returns null for non-existent PR", () => {
      const diff = getLatestDiff("nonexistent");
      expect(diff).toBeNull();
    });

    test("updatePRDiff adds new revision", () => {
      const newRevision = updatePRDiff(testPRUuid, "new diff content", "newcommit");
      expect(newRevision).toBe(2);

      const diff = getLatestDiff(testPRUuid);
      expect(diff).toBe("new diff content");
    });

    test("updatePRDiff throws for non-existent PR", () => {
      expect(() => {
        updatePRDiff("nonexistent", "diff", "commit");
      }).toThrow("PR nonexistent not found");
    });
  });

  describe("Comment Operations", () => {
    let prUuid: string;
    let commentUuid: string;

    beforeAll(() => {
      prUuid = createPR(
        "/repo/comments",
        "Comment Test PR",
        "main",
        "feature",
        "a",
        "b",
        "diff"
      );
    });

    test("addComment creates a comment and returns UUID", () => {
      commentUuid = addComment(prUuid, "src/app.py", 42, "Fix this issue");

      expect(commentUuid).toBeDefined();
      expect(commentUuid.length).toBe(8);
    });

    test("addComment throws for non-existent PR", () => {
      expect(() => {
        addComment("nonexistent", "file.py", 1, "comment");
      }).toThrow("PR nonexistent not found");
    });

    test("getComments retrieves comments for PR", () => {
      addComment(prUuid, "file2.py", 20, "Comment 2");

      const comments = getComments(prUuid);
      expect(comments.length).toBe(2);
    });

    test("getComments filters by file path", () => {
      const comments = getComments(prUuid, { filePath: "src/app.py" });
      expect(comments.length).toBe(1);
      expect(comments[0].content).toBe("Fix this issue");
    });

    test("getComments returns empty for non-existent PR", () => {
      const comments = getComments("nonexistent");
      expect(comments).toEqual([]);
    });

    test("resolveComment marks comment as resolved", () => {
      const result = resolveComment(commentUuid, true);
      expect(result).toBe(true);

      const comments = getComments(prUuid);
      const resolved = comments.find((c) => c.uuid === commentUuid);
      expect(resolved?.resolved).toBe(1); // SQLite stores booleans as integers
    });

    test("getComments filters unresolved only", () => {
      const unresolved = getComments(prUuid, { unresolvedOnly: true });
      expect(unresolved.length).toBe(1);
      expect(unresolved[0].content).toBe("Comment 2");
    });

    test("deleteComment removes comment", () => {
      const newComment = addComment(prUuid, "temp.py", 1, "To delete");
      const result = deleteComment(newComment);
      expect(result).toBe(true);

      const comments = getComments(prUuid, { filePath: "temp.py" });
      expect(comments.length).toBe(0);
    });
  });

  describe("Review Operations", () => {
    let prUuid: string;

    beforeAll(() => {
      prUuid = createPR(
        "/repo/reviews",
        "Review Test PR",
        "main",
        "feature",
        "a",
        "b",
        "diff"
      );
    });

    test("submitReview approves PR", () => {
      const result = submitReview(prUuid, "approve", "LGTM!");
      expect(result).toBe(true);

      const pr = getPRByUuid(prUuid);
      expect(pr?.status).toBe("approved");
    });

    test("submitReview requests changes", () => {
      const result = submitReview(prUuid, "request_changes", "Needs work");
      expect(result).toBe(true);

      const pr = getPRByUuid(prUuid);
      expect(pr?.status).toBe("changes_requested");
    });

    test("submitReview throws for non-existent PR", () => {
      expect(() => {
        submitReview("nonexistent", "approve");
      }).toThrow("PR nonexistent not found");
    });

    test("getReviews retrieves all reviews", () => {
      const reviews = getReviews(prUuid);
      expect(reviews.length).toBe(2);

      // Check both actions are present (order may vary due to fast insertion)
      const actions = reviews.map((r) => r.action);
      expect(actions).toContain("approve");
      expect(actions).toContain("request_changes");
    });

    test("getReviews returns empty for non-existent PR", () => {
      const reviews = getReviews("nonexistent");
      expect(reviews).toEqual([]);
    });
  });
});
