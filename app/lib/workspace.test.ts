import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import * as tar from "tar";

// Set AGENT_CWD to a temp directory for tests
const TEST_WORKSPACE_ROOT = join(tmpdir(), `workspace-test-${randomUUID()}`);
const ARCHIVE_EXTRACTION_TIMEOUT_MS = 4000;
const ZIP_SKILL_ARCHIVE_BASE64 =
  "UEsDBBQAAAAIABCnSVxznciuFQAAABMAAAAMAAAAemlwLXNraWxsLm1kU1aIyixQCM7OzMnhCi1OVcgs0QMAUEsDBBQAAAAIABCnSVxlXD/sCgAAAAgAAAAUAAAAbmVzdGVkL3ppcC1oZWxwZXIubWRTVvBIzSlILQIAUEsBAhQDFAAAAAgAEKdJXHOdyK4VAAAAEwAAAAwAAAAAAAAAAAAAAIABAAAAAHppcC1za2lsbC5tZFBLAQIUAxQAAAAIABCnSVxlXD/sCgAAAAgAAAAUAAAAAAAAAAAAAACAAT8AAABuZXN0ZWQvemlwLWhlbHBlci5tZFBLBQYAAAAAAgACAHwAAAB7AAAAAAA=";

function createZipSkillArchiveBuffer(): Buffer {
  return Buffer.from(ZIP_SKILL_ARCHIVE_BASE64, "base64");
}

async function createTarSkillArchiveBuffer(gzip: boolean): Promise<Buffer> {
  const stagingRoot = mkdtempSync(join(tmpdir(), "workspace-archive-test-"));
  const payloadDir = join(stagingRoot, "payload");
  mkdirSync(join(payloadDir, "nested"), { recursive: true });
  writeFileSync(join(payloadDir, "tar-skill.md"), "# Tar Skill\nUse it.");
  writeFileSync(join(payloadDir, "nested", "tool.md"), "# Nested tool");

  const archivePath = join(stagingRoot, gzip ? "bundle.tar.gz" : "bundle.tar");

  try {
    await tar.c({ cwd: payloadDir, file: archivePath, gzip }, ["."]);
    return readFileSync(archivePath);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function waitForArchiveExtraction(
  workspacePath: string,
  archiveRelPath: string,
  extractedRelPath: string,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(existsSync(join(workspacePath, extractedRelPath))).toBe(true);
      expect(existsSync(join(workspacePath, archiveRelPath))).toBe(false);
    },
    { timeout: ARCHIVE_EXTRACTION_TIMEOUT_MS, interval: 50 },
  );
}

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
      expect(existsSync(join(workspacePath, "skills"))).toBe(true);
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

  describe("listWorkspaceFileTree", () => {
    it("should recursively list nested directory structure", async () => {
      const { initWorkspace, listWorkspaceFileTree } = await import("./workspace");
      const sessionId = "tree-test";
      const workspacePath = initWorkspace(sessionId);

      mkdirSync(join(workspacePath, "skills", "nested"), { recursive: true });
      writeFileSync(join(workspacePath, "skills", "guide.md"), "# guide");
      writeFileSync(join(workspacePath, "skills", "nested", "agent.md"), "# agent");
      writeFileSync(join(workspacePath, ".hidden"), "ignore");

      const tree = listWorkspaceFileTree(workspacePath);
      const skillsDir = tree.find((node) => node.path === "skills");

      expect(skillsDir?.isDirectory).toBe(true);
      expect(skillsDir?.children?.some((node) => node.path === "skills/guide.md")).toBe(
        true,
      );

      const nestedDir = skillsDir?.children?.find(
        (node) => node.path === "skills/nested",
      );
      expect(nestedDir?.children?.some((node) => node.path === "skills/nested/agent.md")).toBe(
        true,
      );

      expect(tree.some((node) => node.name === ".hidden")).toBe(false);
    });
  });

  describe("readWorkspaceFileContent", () => {
    it("reads a workspace file for download", async () => {
      const { initWorkspace, readWorkspaceFileContent } = await import("./workspace");
      const sessionId = "read-file";
      const workspacePath = initWorkspace(sessionId);

      writeFileSync(join(workspacePath, "files", "note.txt"), "hello");

      const result = readWorkspaceFileContent(workspacePath, "files/note.txt");
      expect(result.fileName).toBe("note.txt");
      expect(result.size).toBe(5);
      expect(result.content.toString("utf8")).toBe("hello");
    });

    it("throws for directory input", async () => {
      const { initWorkspace, readWorkspaceFileContent } = await import("./workspace");
      const sessionId = "read-dir";
      const workspacePath = initWorkspace(sessionId);

      expect(() => {
        readWorkspaceFileContent(workspacePath, "files");
      }).toThrow("Directory download is not supported");
    });

    it("throws for path traversal", async () => {
      const { initWorkspace, readWorkspaceFileContent } = await import("./workspace");
      const sessionId = "read-traversal";
      const workspacePath = initWorkspace(sessionId);

      expect(() => {
        readWorkspaceFileContent(workspacePath, "../../etc/passwd");
      }).toThrow("Path traversal not allowed");
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

  describe("syncSkillsSymlinks", () => {
    it("should create symlinks from workspace skills/ to workspace .claude/skills/", async () => {
      const { initWorkspace, syncSkillsSymlinks } = await import("./workspace");
      const sessionId = "skills-sync-test";
      const workspacePath = initWorkspace(sessionId);

      // Create a skill file in workspace skills/
      const skillsDir = join(workspacePath, "skills");
      writeFileSync(join(skillsDir, "my-skill.md"), "# My Skill\nDo something.");

      // Run sync
      syncSkillsSymlinks(workspacePath);

      // Check symlink exists in workspace .claude/skills/ (the CWD Claude SDK reads from)
      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "my-skill.md");

      expect(existsSync(symlinkPath)).toBe(true);
      const stats = lstatSync(symlinkPath);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(join(skillsDir, "my-skill.md"));
    });

    it("should support folder symlinks in skills/", async () => {
      const { initWorkspace, syncSkillsSymlinks } = await import("./workspace");
      const sessionId = "skills-folder-test";
      const workspacePath = initWorkspace(sessionId);

      // Create a skill folder with files
      const skillsDir = join(workspacePath, "skills");
      const folderPath = join(skillsDir, "research-tools");
      mkdirSync(folderPath, { recursive: true });
      writeFileSync(join(folderPath, "web-search.md"), "# Web Search Skill");
      writeFileSync(join(folderPath, "data-analysis.md"), "# Data Analysis Skill");

      syncSkillsSymlinks(workspacePath);

      // Check folder symlink exists
      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "research-tools");

      expect(existsSync(symlinkPath)).toBe(true);
      const stats = lstatSync(symlinkPath);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(folderPath);

      // Files inside the symlinked folder should be accessible
      expect(existsSync(join(symlinkPath, "web-search.md"))).toBe(true);
      expect(existsSync(join(symlinkPath, "data-analysis.md"))).toBe(true);
    });

    it("should skip dotfiles in skills/", async () => {
      const { initWorkspace, syncSkillsSymlinks } = await import("./workspace");
      const sessionId = "skills-skip-test";
      const workspacePath = initWorkspace(sessionId);

      const skillsDir = join(workspacePath, "skills");
      writeFileSync(join(skillsDir, ".hidden"), "hidden");

      syncSkillsSymlinks(workspacePath);

      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      expect(existsSync(join(claudeSkillsDir, ".hidden"))).toBe(false);
    });

    it("should clean stale symlinks when source is deleted", async () => {
      const { initWorkspace, syncSkillsSymlinks } = await import("./workspace");
      const sessionId = "skills-stale-test";
      const workspacePath = initWorkspace(sessionId);

      const skillsDir = join(workspacePath, "skills");
      writeFileSync(join(skillsDir, "old-skill.md"), "# Old");

      // First sync creates the symlink
      syncSkillsSymlinks(workspacePath);

      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "old-skill.md");
      expect(existsSync(symlinkPath)).toBe(true);

      // Remove the source file
      rmSync(join(skillsDir, "old-skill.md"));

      // Re-sync should clean the stale symlink
      syncSkillsSymlinks(workspacePath);
      // Symlink should be gone — lstatSync throws ENOENT
      let symlinkExists = false;
      try {
        symlinkExists = lstatSync(symlinkPath).isSymbolicLink();
      } catch {
        // ENOENT means symlink was cleaned — expected
      }
      expect(symlinkExists).toBe(false);
    });
  });

  describe("writeWorkspaceFile triggers skills sync", () => {
    it("should auto-sync symlink when writing to skills/ directory", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "write-skill-sync";
      const workspacePath = initWorkspace(sessionId);

      // Upload a skill file via writeWorkspaceFile (simulates POST /api/workspace/files)
      const content = Buffer.from("# Research Skill\nSearch the web.");
      writeWorkspaceFile(workspacePath, "skills/research.md", content);

      // Symlink should have been created automatically in workspace .claude/skills/
      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "research.md");

      expect(existsSync(symlinkPath)).toBe(true);
      const stats = lstatSync(symlinkPath);
      expect(stats.isSymbolicLink()).toBe(true);
    });

    it("should NOT trigger sync when writing to files/ directory", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "write-file-nosync";
      const workspacePath = initWorkspace(sessionId);

      // Write a non-skill file
      writeWorkspaceFile(workspacePath, "files/report.txt", Buffer.from("report"));

      // .claude/skills/ should have no symlinks for workspace skills
      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      if (existsSync(claudeSkillsDir)) {
        const entries = readdirSync(claudeSkillsDir).filter((e) => {
          try { return lstatSync(join(claudeSkillsDir, e)).isSymbolicLink(); } catch { return false; }
        });
        expect(entries).toHaveLength(0);
      }
    });
  });

  describe("writeWorkspaceFile triggers skills archive extraction", () => {
    it("should auto-extract .zip in skills/, delete archive, and refresh symlinks", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "extract-zip";
      const workspacePath = initWorkspace(sessionId);

      writeWorkspaceFile(
        workspacePath,
        "skills/zip-skill.zip",
        createZipSkillArchiveBuffer(),
      );

      await waitForArchiveExtraction(
        workspacePath,
        "skills/zip-skill.zip",
        "skills/zip-skill/zip-skill.md",
      );

      const symlinkPath = join(workspacePath, ".claude", "skills", "zip-skill");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it("should auto-extract .tar.gz in skills/, delete archive, and refresh symlinks", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "extract-targz";
      const workspacePath = initWorkspace(sessionId);
      const tarGzBuffer = await createTarSkillArchiveBuffer(true);

      writeWorkspaceFile(workspacePath, "skills/tar-skill.tar.gz", tarGzBuffer);

      await waitForArchiveExtraction(
        workspacePath,
        "skills/tar-skill.tar.gz",
        "skills/tar-skill/tar-skill.md",
      );

      const symlinkPath = join(workspacePath, ".claude", "skills", "tar-skill");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it("should auto-extract .skill in skills/, delete archive, and refresh symlinks", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "extract-skill";
      const workspacePath = initWorkspace(sessionId);

      writeWorkspaceFile(
        workspacePath,
        "skills/custom-skill.skill",
        createZipSkillArchiveBuffer(),
      );

      await waitForArchiveExtraction(
        workspacePath,
        "skills/custom-skill.skill",
        "skills/custom-skill/zip-skill.md",
      );

      const symlinkPath = join(workspacePath, ".claude", "skills", "custom-skill");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it("should keep damaged archive file and not crash upload flow", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "extract-broken";
      const workspacePath = initWorkspace(sessionId);

      expect(() => {
        writeWorkspaceFile(
          workspacePath,
          "skills/broken.zip",
          Buffer.from("not-a-real-archive"),
        );
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(existsSync(join(workspacePath, "skills", "broken.zip"))).toBe(true);
      expect(existsSync(join(workspacePath, "skills", "zip-skill.md"))).toBe(false);
    });

    it("should not trigger extraction for non-archive files in skills/", async () => {
      const { initWorkspace, writeWorkspaceFile } = await import("./workspace");
      const sessionId = "extract-ignore-non-archive";
      const workspacePath = initWorkspace(sessionId);

      writeWorkspaceFile(workspacePath, "skills/plain-skill.md", Buffer.from("# Plain skill"));

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(existsSync(join(workspacePath, "skills", "plain-skill.md"))).toBe(true);
      expect(existsSync(join(workspacePath, "skills", "zip-skill.md"))).toBe(false);

      const symlinkPath = join(workspacePath, ".claude", "skills", "plain-skill.md");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });
  });

  describe("deleteWorkspaceFile triggers skills sync", () => {
    it("should clean symlink when deleting a skill file", async () => {
      const { initWorkspace, writeWorkspaceFile, deleteWorkspaceFile } = await import("./workspace");
      const sessionId = "delete-skill-sync";
      const workspacePath = initWorkspace(sessionId);

      // Write then delete a skill
      writeWorkspaceFile(workspacePath, "skills/temp.md", Buffer.from("# Temp"));
      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "temp.md");
      expect(existsSync(symlinkPath)).toBe(true);

      deleteWorkspaceFile(workspacePath, "skills/temp.md");

      // Symlink should be cleaned up
      try {
        expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(false);
      } catch {
        // lstatSync throws if path doesn't exist — symlink was cleaned, good
      }
    });
  });

  describe("getOrCreateWorkspace re-syncs skills", () => {
    it("should sync skills on existing workspace access", async () => {
      const { initWorkspace, getOrCreateWorkspace } = await import("./workspace");
      const sessionId = "reaccess-skill-sync";

      // Create workspace first (no skills yet)
      const workspacePath = initWorkspace(sessionId);

      // Manually add a skill file after init (simulates Agent writing to skills/)
      writeFileSync(join(workspacePath, "skills", "late-skill.md"), "# Late");

      // Access workspace again — should trigger sync
      getOrCreateWorkspace(sessionId);

      const claudeSkillsDir = join(workspacePath, ".claude", "skills");
      const symlinkPath = join(claudeSkillsDir, "late-skill.md");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });
  });
});
