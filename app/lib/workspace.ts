/**
 * Workspace initialization and management
 * 
 * Migrated from agent-sandbox sqlagent branch workspace pattern.
 * Creates isolated workspace directories for each agent session,
 * following the _init_workspace scaffolding from research_agent_processor.py.
 */
import { mkdirSync, existsSync, copyFileSync, cpSync, readdirSync, statSync, rmSync, renameSync, writeFileSync, symlinkSync, lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
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

export function listWorkspaceFiles(
  workspacePath: string,
  subPath: string = ""
): WorkspaceFileInfo[] {
  const targetDir = subPath ? join(workspacePath, subPath) : workspacePath;

  if (!existsSync(targetDir)) {
    return [];
  }

  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const fullPath = join(targetDir, entry.name);
        const relativePath = subPath ? join(subPath, entry.name) : entry.name;
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

/**
 * Delete a file or directory in a workspace.
 * If the deleted path is in the skills/ directory, automatically cleans up symlinks.
 */
export function deleteWorkspaceFile(
  workspacePath: string,
  filePath: string
): boolean {
  const fullPath = join(workspacePath, filePath);

  // Security: ensure the path is within the workspace
  const resolvedPath = resolve(fullPath);
  const resolvedWorkspace = resolve(workspacePath);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error("Path traversal not allowed");
  }

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
  const fullFromPath = join(workspacePath, fromPath);
  const fullToPath = join(workspacePath, toPath);

  // Security: ensure both paths are within the workspace
  const resolvedFrom = resolve(fullFromPath);
  const resolvedTo = resolve(fullToPath);
  const resolvedWorkspace = resolve(workspacePath);
  if (!resolvedFrom.startsWith(resolvedWorkspace) || !resolvedTo.startsWith(resolvedWorkspace)) {
    throw new Error("Path traversal not allowed");
  }

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
 * Write uploaded file content to workspace.
 * If the file is written to the skills/ directory, automatically syncs symlinks.
 */
export function writeWorkspaceFile(
  workspacePath: string,
  filePath: string,
  content: Buffer
): string {
  const fullPath = join(workspacePath, filePath);

  // Security: ensure the path is within the workspace
  const resolvedPath = resolve(fullPath);
  const resolvedWorkspace = resolve(workspacePath);
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error("Path traversal not allowed");
  }

  // Ensure parent directory exists
  const parentDir = dirname(fullPath);
  mkdirSync(parentDir, { recursive: true });

  writeFileSync(fullPath, content);

  // Auto-sync skills symlinks when writing to skills/ directory
  if (isSkillsPath(filePath)) {
    syncSkillsSymlinks(workspacePath);
  }

  return filePath;
}
