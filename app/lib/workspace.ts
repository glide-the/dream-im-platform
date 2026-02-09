/**
 * Workspace initialization and management
 * 
 * Migrated from agent-sandbox sqlagent branch workspace pattern.
 * Creates isolated workspace directories for each agent session,
 * following the _init_workspace scaffolding from research_agent_processor.py.
 */
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  cpSync,
  readdirSync,
  statSync,
  rmSync,
  renameSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  readFileSync,
  createReadStream,
  createWriteStream,
} from "node:fs";
import { mkdir as mkdirAsync, unlink as unlinkAsync } from "node:fs/promises";
import {
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  relative,
} from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import unzipper from "unzipper";
import logger from "./logger";

/**
 * Workspace directory structure constants
 */
export const WORKSPACE_DIRS = {
  FILES: "files",
  LOGS: "logs",
  SKILLS: "skills",
} as const;

/**
 * Check if a relative file path is within the skills/ directory.
 */
function isSkillsPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === WORKSPACE_DIRS.SKILLS
    || normalized.startsWith(`${WORKSPACE_DIRS.SKILLS}/`);
}

type SkillsArchiveType = "zip" | "tar.gz" | "tgz" | "tar" | "skill";

function getSkillsArchiveType(filePath: string): SkillsArchiveType | null {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".tar.gz")) {
    return "tar.gz";
  }
  if (normalized.endsWith(".tgz")) {
    return "tgz";
  }
  if (normalized.endsWith(".tar")) {
    return "tar";
  }
  if (normalized.endsWith(".zip")) {
    return "zip";
  }
  if (normalized.endsWith(".skill")) {
    return "skill";
  }
  return null;
}

function isSupportedSkillsArchivePath(filePath: string): boolean {
  return getSkillsArchiveType(filePath) !== null;
}

function stripArchiveExtension(fileName: string, archiveType: SkillsArchiveType): string {
  if (archiveType === "tar.gz") {
    return fileName.replace(/\.tar\.gz$/i, "");
  }
  if (archiveType === "tgz") {
    return fileName.replace(/\.tgz$/i, "");
  }
  if (archiveType === "tar") {
    return fileName.replace(/\.tar$/i, "");
  }
  if (archiveType === "zip") {
    return fileName.replace(/\.zip$/i, "");
  }
  return fileName.replace(/\.skill$/i, "");
}

function getArchiveExtractionRoot(
  workspacePath: string,
  archiveRelPath: string,
  archiveType: SkillsArchiveType,
): string {
  const skillsDir = join(workspacePath, WORKSPACE_DIRS.SKILLS);
  const archiveRelativeName = basename(archiveRelPath);
  const extractionDirName =
    stripArchiveExtension(archiveRelativeName, archiveType) || archiveRelativeName;
  const extractionRoot = join(skillsDir, extractionDirName);

  assertArchiveEntryPathIsSafe(skillsDir, extractionRoot, archiveRelPath);
  return extractionRoot;
}

function normalizeArchiveEntryPath(entryPath: string): string {
  return entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function assertArchiveEntryPathIsSafe(
  skillsDir: string,
  candidatePath: string,
  entryPath: string,
): void {
  const resolvedSkillsDir = resolve(skillsDir);
  const resolvedCandidatePath = resolve(candidatePath);
  const relativePath = relative(resolvedSkillsDir, resolvedCandidatePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Unsafe archive entry path: ${entryPath}`);
  }
}

async function extractZipArchive(
  archivePath: string,
  skillsDir: string,
): Promise<void> {
  const zipDirectory = await unzipper.Open.file(archivePath);

  for (const entry of zipDirectory.files) {
    const normalizedEntryPath = normalizeArchiveEntryPath(entry.path);
    if (!normalizedEntryPath) {
      continue;
    }

    const outputPath = resolve(skillsDir, normalizedEntryPath);
    assertArchiveEntryPathIsSafe(skillsDir, outputPath, entry.path);

    if (entry.type === "Directory") {
      await mkdirAsync(outputPath, { recursive: true });
      continue;
    }

    await mkdirAsync(dirname(outputPath), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(outputPath));
  }
}

function validateTarEntryPath(skillsDir: string, entry: tar.ReadEntry): void {
  const normalizedEntryPath = normalizeArchiveEntryPath(entry.path);
  const outputPath = resolve(skillsDir, normalizedEntryPath);
  assertArchiveEntryPathIsSafe(skillsDir, outputPath, entry.path);

  if (entry.type === "SymbolicLink" || entry.type === "Link") {
    throw new Error(`Tar link entry is not allowed: ${entry.path}`);
  }
}

async function extractTarArchive(
  archivePath: string,
  skillsDir: string,
): Promise<void> {
  await tar.x({
    file: archivePath,
    cwd: skillsDir,
    onentry: (entry) => validateTarEntryPath(skillsDir, entry),
  });
}

async function extractTarGzArchive(
  archivePath: string,
  skillsDir: string,
): Promise<void> {
  const tarExtractor = tar.x({
    cwd: skillsDir,
    onentry: (entry) => validateTarEntryPath(skillsDir, entry),
  });

  await pipeline(createReadStream(archivePath), createGunzip(), tarExtractor);
}

/**
 * Get the base workspace root from environment or defaults.
 * Priority:
 * 1. AGENT_CWD environment variable (explicit workspace root)
 * 2. OS temp directory fallback
 */
export function getWorkspaceRoot(): string {
  const envCwd = process.env.AGENT_CWD;
  if (envCwd) {
    return isAbsolute(envCwd) ? envCwd : resolve(process.cwd(), envCwd);
  }
  return join(tmpdir(), "claude-agent-workspaces");
}

/**
 * Initialize a workspace directory for an agent session.
 * Follows the agent-sandbox _init_workspace pattern:
 * 1. Create workspace/{sessionId}/
 * 2. Create workspace/{sessionId}/files/
 * 3. Create workspace/{sessionId}/logs/
 * 4. Optionally copy .claude/ and .mcp.json from project root
 * 
 * @param sessionId - Unique session/conversation identifier
 * @returns Absolute path to the initialized workspace
 */
export function initWorkspace(sessionId?: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const workspaceId = sessionId || randomUUID();
  const workspacePath = join(workspaceRoot, workspaceId);

  // Create workspace directory and subdirectories
  mkdirSync(join(workspacePath, WORKSPACE_DIRS.FILES), { recursive: true });
  mkdirSync(join(workspacePath, WORKSPACE_DIRS.LOGS), { recursive: true });
  mkdirSync(join(workspacePath, WORKSPACE_DIRS.SKILLS), { recursive: true });

  // Copy .claude/ directory from project root if it exists
  const projectRoot = process.cwd();
  const claudeDir = join(projectRoot, ".claude");
  const targetClaudeDir = join(workspacePath, ".claude");
  if (existsSync(claudeDir) && !existsSync(targetClaudeDir)) {
    try {
      cpSync(claudeDir, targetClaudeDir, { recursive: true });
    } catch {
      // Non-critical: workspace functions without .claude config
    }
  }

  // Copy .mcp.json from project root if it exists
  const mcpJson = join(projectRoot, ".mcp.json");
  const targetMcpJson = join(workspacePath, ".mcp.json");
  if (existsSync(mcpJson) && !existsSync(targetMcpJson)) {
    try {
      copyFileSync(mcpJson, targetMcpJson);
    } catch {
      // Non-critical: workspace functions without .mcp.json
    }
  }

  // Sync skills symlinks to project-level .claude/skills/
  syncSkillsSymlinks(workspacePath);

  return workspacePath;
}

/**
 * Sync skills from a workspace's skills/ directory to the workspace's own
 * .claude/skills/ directory via symlinks.
 *
 * Claude SDK is invoked with `cwd = workspacePath` and `settingSources: ["project"]`,
 * so it reads skills from `{workspacePath}/.claude/skills/`.
 *
 * We let users/agents place skill files and folders in `{workspace}/skills/`
 * (a user-friendly top-level location), then symlink each entry into
 * `{workspace}/.claude/skills/` so Claude can discover them.
 *
 * Supports both files and directories:
 *   {workspace}/skills/my-skill.md      → {workspace}/.claude/skills/my-skill.md
 *   {workspace}/skills/research-tools/  → {workspace}/.claude/skills/research-tools/
 */
export function syncSkillsSymlinks(workspacePath: string): void {
  const claudeSkillsDir = join(workspacePath, ".claude", "skills");
  const workspaceSkillsDir = join(workspacePath, WORKSPACE_DIRS.SKILLS);

  // Ensure workspace .claude/skills/ exists
  mkdirSync(claudeSkillsDir, { recursive: true });

  if (!existsSync(workspaceSkillsDir)) {
    return;
  }

  try {
    const entries = readdirSync(workspaceSkillsDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip dotfiles/dotfolders
      if (entry.name.startsWith(".")) {
        continue;
      }

      const sourcePath = join(workspaceSkillsDir, entry.name);
      const symlinkPath = join(claudeSkillsDir, entry.name);

      try {
        // Check if symlink already exists and is correct
        const stats = lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          const currentTarget = readlinkSync(symlinkPath);
          if (currentTarget === sourcePath) {
            continue; // Already correct
          }
          // Target changed, remove and re-create
          unlinkSync(symlinkPath);
        } else {
          // A real file/dir exists at the symlink path (e.g. copied from project root)
          // Remove it to replace with our symlink
          rmSync(symlinkPath, { recursive: true });
        }
      } catch {
        // lstatSync throws if path doesn't exist — that's fine, we'll create it
      }

      try {
        symlinkSync(sourcePath, symlinkPath);
        logger.info(`Symlinked skill: ${entry.name} → ${symlinkPath}`);
      } catch (err) {
        logger.warn(`Failed to symlink skill ${entry.name}: ${err}`);
      }
    }

    // Clean up stale symlinks (source removed from skills/)
    cleanStaleSkillSymlinks(claudeSkillsDir, workspaceSkillsDir);
  } catch (err) {
    logger.warn(`Failed to sync skills symlinks: ${err}`);
  }
}

/**
 * Remove symlinks in {workspace}/.claude/skills/ whose source no longer
 * exists in the workspace skills/ directory.
 */
function cleanStaleSkillSymlinks(
  claudeSkillsDir: string,
  workspaceSkillsDir: string
): void {
  try {
    const entries = readdirSync(claudeSkillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const symlinkPath = join(claudeSkillsDir, entry.name);
      try {
        const stats = lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          const target = readlinkSync(symlinkPath);
          // Only clean links that point into our workspace skills/ dir
          if (target.startsWith(workspaceSkillsDir) && !existsSync(target)) {
            unlinkSync(symlinkPath);
            logger.info(`Removed stale skill symlink: ${entry.name}`);
          }
        }
      } catch {
        // Ignore errors during cleanup
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Get workspace path for a given session, creating if necessary.
 * This is the primary entry point used by the API route.
 * Always syncs skills symlinks to ensure project-level .claude/skills/ is up-to-date.
 */
export function getOrCreateWorkspace(sessionId: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const workspacePath = join(workspaceRoot, sessionId);

  if (existsSync(workspacePath)) {
    // Always re-sync skills — files may have been added since last init
    syncSkillsSymlinks(workspacePath);
    return workspacePath;
  }

  return initWorkspace(sessionId);
}

/**
 * List files in a workspace directory.
 * Returns relative paths from the workspace root.
 */
export interface WorkspaceFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface WorkspaceFileTreeNode extends WorkspaceFileInfo {
  children?: WorkspaceFileTreeNode[];
}

const WORKSPACE_FILE_ACCESS_ERROR_CODES = [
  "PATH_TRAVERSAL",
  "NOT_FOUND",
  "IS_DIRECTORY",
] as const;

export type WorkspaceFileAccessErrorCode =
  (typeof WORKSPACE_FILE_ACCESS_ERROR_CODES)[number];

export class WorkspaceFileAccessError extends Error {
  status: number;
  code: WorkspaceFileAccessErrorCode;

  constructor(
    code: WorkspaceFileAccessErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "WorkspaceFileAccessError";
    this.code = code;
    this.status = status;
  }
}

export interface WorkspaceFileContent {
  content: Buffer;
  fileName: string;
  size: number;
  modifiedAt: string;
}

function ensureWorkspaceSafePath(
  workspacePath: string,
  filePath: string,
): string {
  const fullPath = join(workspacePath, filePath);
  const resolvedPath = resolve(fullPath);
  const resolvedWorkspace = resolve(workspacePath);
  const pathRelative = relative(resolvedWorkspace, resolvedPath);

  if (pathRelative.startsWith("..")) {
    throw new WorkspaceFileAccessError(
      "PATH_TRAVERSAL",
      "Path traversal not allowed",
      400,
    );
  }

  return fullPath;
}

function normalizeWorkspaceSubPath(subPath: string): string {
  return subPath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function listWorkspaceFiles(
  workspacePath: string,
  subPath: string = ""
): WorkspaceFileInfo[] {
  const normalizedSubPath = normalizeWorkspaceSubPath(subPath);
  const targetDir = normalizedSubPath
    ? ensureWorkspaceSafePath(workspacePath, normalizedSubPath)
    : workspacePath;

  if (!existsSync(targetDir)) {
    return [];
  }

  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const fullPath = join(targetDir, entry.name);
        const relativePath = normalizedSubPath
          ? `${normalizedSubPath}/${entry.name}`
          : entry.name;
        const stats = statSync(fullPath);
        return {
          name: entry.name,
          path: relativePath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

export function listWorkspaceFileTree(
  workspacePath: string,
  subPath: string = "",
): WorkspaceFileTreeNode[] {
  const currentLevel = listWorkspaceFiles(workspacePath, subPath);

  return currentLevel.map((entry) => {
    if (!entry.isDirectory) {
      return entry;
    }

    return {
      ...entry,
      children: listWorkspaceFileTree(workspacePath, entry.path),
    };
  });
}

export function readWorkspaceFileContent(
  workspacePath: string,
  filePath: string,
): WorkspaceFileContent {
  const fullPath = ensureWorkspaceSafePath(workspacePath, filePath);

  if (!existsSync(fullPath)) {
    throw new WorkspaceFileAccessError("NOT_FOUND", "File not found", 404);
  }

  const stats = statSync(fullPath);
  if (stats.isDirectory()) {
    throw new WorkspaceFileAccessError(
      "IS_DIRECTORY",
      "Directory download is not supported",
      400,
    );
  }

  return {
    content: readFileSync(fullPath),
    fileName: basename(fullPath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

/**
 * Delete a file or directory in a workspace.
 * If the deleted path is in the skills/ directory, automatically cleans up symlinks.
 */
export function deleteWorkspaceFile(
  workspacePath: string,
  filePath: string
): boolean {
  const fullPath = ensureWorkspaceSafePath(workspacePath, filePath);

  if (!existsSync(fullPath)) {
    return false;
  }

  try {
    rmSync(fullPath, { recursive: true });
    // Re-sync skills symlinks to clean up stale links
    if (isSkillsPath(filePath)) {
      syncSkillsSymlinks(workspacePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Move/rename a file within a workspace.
 */
export function moveWorkspaceFile(
  workspacePath: string,
  fromPath: string,
  toPath: string
): boolean {
  const fullFromPath = ensureWorkspaceSafePath(workspacePath, fromPath);
  const fullToPath = ensureWorkspaceSafePath(workspacePath, toPath);

  if (!existsSync(fullFromPath)) {
    return false;
  }

  try {
    // Ensure target directory exists
    const targetDir = dirname(fullToPath);
    mkdirSync(targetDir, { recursive: true });
    renameSync(fullFromPath, fullToPath);
    // Re-sync skills symlinks if either path involves skills/
    if (isSkillsPath(fromPath) || isSkillsPath(toPath)) {
      syncSkillsSymlinks(workspacePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract an uploaded archive already saved under skills/.
 * On success, removes the original archive and refreshes skill symlinks.
 * On failure, logs and returns without throwing so upload flow is not blocked.
 */
export async function extractArchiveInSkills(
  workspacePath: string,
  archiveRelPath: string,
): Promise<void> {
  try {
    if (!isSkillsPath(archiveRelPath)) {
      return;
    }

    const archiveType = getSkillsArchiveType(archiveRelPath);
    if (!archiveType) {
      return;
    }

    const archivePath = ensureWorkspaceSafePath(workspacePath, archiveRelPath);
    const extractionRoot = getArchiveExtractionRoot(
      workspacePath,
      archiveRelPath,
      archiveType,
    );
    await mkdirAsync(extractionRoot, { recursive: true });

    if (!existsSync(archivePath)) {
      return;
    }

    if (archiveType === "zip" || archiveType === "skill") {
      await extractZipArchive(archivePath, extractionRoot);
    } else if (archiveType === "tar.gz" || archiveType === "tgz") {
      await extractTarGzArchive(archivePath, extractionRoot);
    } else {
      await extractTarArchive(archivePath, extractionRoot);
    }

    await unlinkAsync(archivePath);
    syncSkillsSymlinks(workspacePath);
  } catch (err) {
    logger.warn(`Failed to extract archive in skills (${archiveRelPath}): ${err}`);
  }
}

/**
 * Write uploaded file content to workspace.
 * If the file is written to the skills/ directory, automatically syncs symlinks.
 * Archive uploads are extracted asynchronously in the background.
 */
export function writeWorkspaceFile(
  workspacePath: string,
  filePath: string,
  content: Buffer
): string {
  const fullPath = ensureWorkspaceSafePath(workspacePath, filePath);

  // Ensure parent directory exists
  const parentDir = dirname(fullPath);
  mkdirSync(parentDir, { recursive: true });

  writeFileSync(fullPath, content);

  // Auto-sync skills symlinks when writing to skills/ directory
  if (isSkillsPath(filePath)) {
    syncSkillsSymlinks(workspacePath);
    if (isSupportedSkillsArchivePath(filePath)) {
      void extractArchiveInSkills(workspacePath, filePath);
    }
  }

  return filePath;
}
