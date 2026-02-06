import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Set AGENT_CWD to a temp directory for tests
const TEST_WORKSPACE_ROOT = join(tmpdir(), `workspace-test-${randomUUID()}`);

describe("workspace", () => {
  beforeEach(() => {
    // Set env var for tests
    process.env.AGENT_CWD = TEST_WORKSPACE_ROOT;
    // Clean up before each test
    if (existsSync(TEST_WORKSPACE_ROOT)) {
      rmSync(TEST_WORKSPACE_ROOT, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_WORKSPACE_ROOT)) {
      rmSync(TEST_WORKSPACE_ROOT, { recursive: true });
    }
    delete process.env.AGENT_CWD;
  });

  describe("getWorkspaceRoot", () => {
    it("should return AGENT_CWD when set", async () => {
      const { getWorkspaceRoot } = await import("./workspace");
      const root = getWorkspaceRoot();
      expect(root).toBe(TEST_WORKSPACE_ROOT);
    });

    it("should return temp dir fallback when AGENT_CWD is not set", async () => {
      delete process.env.AGENT_CWD;
      // Re-import to get fresh module
      const mod = await import("./workspace");
      const root = mod.getWorkspaceRoot();
      expect(root).toContain("claude-agent-workspaces");
    });
  });

  describe("initWorkspace", () => {
    it("should create workspace directory structure", async () => {
      const { initWorkspace } = await import("./workspace");
      const sessionId = "test-session-123";
      const workspacePath = initWorkspace(sessionId);

      expect(existsSync(workspacePath)).toBe(true);
      expect(existsSync(join(workspacePath, "files"))).toBe(true);
      expect(existsSync(join(workspacePath, "logs"))).toBe(true);
    });

    it("should generate random UUID when no sessionId provided", async () => {
      const { initWorkspace } = await import("./workspace");
      const workspacePath = initWorkspace();
      expect(existsSync(workspacePath)).toBe(true);
    });
  });

  describe("getOrCreateWorkspace", () => {
    it("should create workspace if not exists", async () => {
      const { getOrCreateWorkspace } = await import("./workspace");
      const sessionId = "new-session";
      const workspacePath = getOrCreateWorkspace(sessionId);
      expect(existsSync(workspacePath)).toBe(true);
    });

    it("should return existing workspace", async () => {
      const { getOrCreateWorkspace } = await import("./workspace");
      const sessionId = "existing-session";
      const path1 = getOrCreateWorkspace(sessionId);
      const path2 = getOrCreateWorkspace(sessionId);
      expect(path1).toBe(path2);
    });
  });

  describe("listWorkspaceFiles", () => {
    it("should list files in workspace", async () => {
      const { initWorkspace, listWorkspaceFiles } = await import("./workspace");
      const sessionId = "list-test";
      const workspacePath = initWorkspace(sessionId);

      // Create test files
      writeFileSync(join(workspacePath, "test.txt"), "hello");
      writeFileSync(join(workspacePath, "data.json"), '{"a":1}');

      const files = listWorkspaceFiles(workspacePath);
      expect(files.length).toBeGreaterThanOrEqual(2);

      const testFile = files.find((f) => f.name === "test.txt");
      expect(testFile).toBeDefined();
      expect(testFile!.isDirectory).toBe(false);
      expect(testFile!.size).toBeGreaterThan(0);
    });

    it("should list subdirectory contents", async () => {
      const { initWorkspace, listWorkspaceFiles } = await import("./workspace");
      const sessionId = "subdir-test";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "files", "report.md"), "# Report");

      const files = listWorkspaceFiles(workspacePath, "files");
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.name === "report.md")).toBe(true);
    });

    it("should return empty array for non-existent path", async () => {
      const { listWorkspaceFiles } = await import("./workspace");
      const files = listWorkspaceFiles("/non/existent/path");
      expect(files).toEqual([]);
    });

    it("should sort directories before files", async () => {
      const { initWorkspace, listWorkspaceFiles } = await import("./workspace");
      const sessionId = "sort-test";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "z-file.txt"), "content");

      const files = listWorkspaceFiles(workspacePath);
      const dirIndex = files.findIndex((f) => f.isDirectory);
      const fileIndex = files.findIndex((f) => !f.isDirectory);
      if (dirIndex !== -1 && fileIndex !== -1) {
        expect(dirIndex).toBeLessThan(fileIndex);
      }
    });
  });

  describe("deleteWorkspaceFile", () => {
    it("should delete a file", async () => {
      const { initWorkspace, deleteWorkspaceFile } = await import("./workspace");
      const sessionId = "delete-test";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "to-delete.txt"), "bye");
      expect(existsSync(join(workspacePath, "to-delete.txt"))).toBe(true);

      const result = deleteWorkspaceFile(workspacePath, "to-delete.txt");
      expect(result).toBe(true);
      expect(existsSync(join(workspacePath, "to-delete.txt"))).toBe(false);
    });

    it("should return false for non-existent file", async () => {
      const { initWorkspace, deleteWorkspaceFile } = await import("./workspace");
      const sessionId = "delete-noexist";
      const workspacePath = initWorkspace(sessionId);

      const result = deleteWorkspaceFile(workspacePath, "ghost.txt");
      expect(result).toBe(false);
    });

    it("should reject path traversal", async () => {
      const { initWorkspace, deleteWorkspaceFile } = await import("./workspace");
      const sessionId = "delete-traversal";
      const workspacePath = initWorkspace(sessionId);

      expect(() => {
        deleteWorkspaceFile(workspacePath, "../../etc/passwd");
      }).toThrow("Path traversal not allowed");
    });
  });

  describe("moveWorkspaceFile", () => {
    it("should move a file", async () => {
      const { initWorkspace, moveWorkspaceFile } = await import("./workspace");
      const sessionId = "move-test";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "original.txt"), "content");

      const result = moveWorkspaceFile(workspacePath, "original.txt", "renamed.txt");
      expect(result).toBe(true);
      expect(existsSync(join(workspacePath, "original.txt"))).toBe(false);
      expect(existsSync(join(workspacePath, "renamed.txt"))).toBe(true);
    });

    it("should move file to subdirectory", async () => {
      const { initWorkspace, moveWorkspaceFile } = await import("./workspace");
      const sessionId = "move-subdir";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "file.txt"), "content");

      const result = moveWorkspaceFile(workspacePath, "file.txt", "files/file.txt");
      expect(result).toBe(true);
      expect(existsSync(join(workspacePath, "files", "file.txt"))).toBe(true);
    });

    it("should reject path traversal", async () => {
      const { initWorkspace, moveWorkspaceFile } = await import("./workspace");
      const sessionId = "move-traversal";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "file.txt"), "content");

      expect(() => {
        moveWorkspaceFile(workspacePath, "file.txt", "../../outside.txt");
      }).toThrow("Path traversal not allowed");
    });
  });

  describe("writeWorkspaceFile", () => {
    it("should write file to workspace", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "write-test";
      const workspacePath = initWorkspace(sessionId);

      const content = Buffer.from("hello world");
      writeWorkspaceFile(workspacePath, "test.txt", content);

      expect(existsSync(join(workspacePath, "test.txt"))).toBe(true);
    });

    it("should create parent directories", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "write-nested";
      const workspacePath = initWorkspace(sessionId);

      const content = Buffer.from("nested content");
      writeWorkspaceFile(workspacePath, "deep/nested/file.txt", content);

      expect(existsSync(join(workspacePath, "deep", "nested", "file.txt"))).toBe(true);
    });

    it("should reject path traversal", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "write-traversal";
      const workspacePath = initWorkspace(sessionId);

      expect(() => {
        writeWorkspaceFile(workspacePath, "../../etc/evil", Buffer.from("bad"));
      }).toThrow("Path traversal not allowed");
    });
  });
});
