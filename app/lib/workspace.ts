/**
 * Workspace initialization and management
 * 
 * Migrated from agent-sandbox sqlagent branch workspace pattern.
 * Creates isolated workspace directories for each agent session,
 * following the _init_workspace scaffolding from research_agent_processor.py.
 */
import { mkdirSync, existsSync, copyFileSync, cpSync, readdirSync, statSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Workspace directory structure constants
 */
export const WORKSPACE_DIRS = {
  FILES: "files",
  LOGS: "logs",
} as const;

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

  return workspacePath;
}

/**
 * Get workspace path for a given session, creating if necessary.
 * This is the primary entry point used by the API route.
 */
export function getOrCreateWorkspace(sessionId: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const workspacePath = join(workspaceRoot, sessionId);

  if (existsSync(workspacePath)) {
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
    const targetDir = join(fullToPath, "..");
    mkdirSync(targetDir, { recursive: true });
    renameSync(fullFromPath, fullToPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write uploaded file content to workspace.
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
  const parentDir = join(fullPath, "..");
  mkdirSync(parentDir, { recursive: true });

  writeFileSync(fullPath, content);
  return filePath;
}
