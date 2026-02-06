import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { AGENT_WORKSPACE_BASE_PATH } from "@/lib/const";

const WORKSPACE_FILES_DIR = "files";
const WORKSPACE_LOGS_DIR = "logs";
const PROJECT_CONFIG_DIR = ".claude";
const PROJECT_MCP_CONFIG = ".mcp.json";

export interface WorkspaceInitOptions {
  conversationId?: string;
  taskId?: string;
  basePath?: string;
}

export interface WorkspaceContext {
  rootPath: string;
  filesDir: string;
  logsDir: string;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  type: "file" | "dir";
  size: number;
  updatedAt: string;
}

export async function initWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceContext> {
  const workspaceId = options.conversationId ?? options.taskId ?? randomUUID();
  const basePath = resolveBasePath(options.basePath ?? AGENT_WORKSPACE_BASE_PATH);
  const rootPath = path.join(basePath, workspaceId);
  const filesDir = path.join(rootPath, WORKSPACE_FILES_DIR);
  const logsDir = path.join(rootPath, WORKSPACE_LOGS_DIR);

  await fs.mkdir(filesDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  await copyProjectConfigs(rootPath);

  return {
    rootPath,
    filesDir,
    logsDir,
  };
}

export async function resolveWorkspaceCwd(conversationId: string): Promise<string> {
  const context = await initWorkspace({ conversationId });
  return context.rootPath;
}

export async function cleanupWorkspace(cwd: string): Promise<void> {
  const basePath = resolveBasePath(AGENT_WORKSPACE_BASE_PATH);
  const resolved = path.resolve(cwd);
  if (!isWithinBasePath(resolved, basePath)) {
    throw new Error("Workspace cleanup path is outside the configured base path.");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

export async function listWorkspaceFiles(cwd: string): Promise<WorkspaceFile[]> {
  const filesRoot = await ensureWorkspaceFilesRoot(cwd);
  const entries: WorkspaceFile[] = [];
  await walkWorkspace(filesRoot, filesRoot, entries);
  return entries;
}

export async function uploadToWorkspace(cwd: string, file: File): Promise<WorkspaceFile> {
  const filesRoot = await ensureWorkspaceFilesRoot(cwd);
  const safeName = path.basename(file.name || "upload");
  const targetPath = resolveWorkspacePath(filesRoot, safeName);
  const buffer = Buffer.from(await file.arrayBuffer());

  await fs.writeFile(targetPath, buffer);

  const stats = await fs.stat(targetPath);
  return toWorkspaceFile(filesRoot, safeName, stats.isDirectory(), stats);
}

export async function deleteFromWorkspace(cwd: string, filePath: string): Promise<void> {
  const filesRoot = await ensureWorkspaceFilesRoot(cwd);
  const resolved = resolveWorkspacePath(filesRoot, filePath);
  await fs.rm(resolved, { recursive: true, force: true });
}

export async function moveInWorkspace(cwd: string, from: string, to: string): Promise<void> {
  const filesRoot = await ensureWorkspaceFilesRoot(cwd);
  const resolvedFrom = resolveWorkspacePath(filesRoot, from);
  const resolvedTo = resolveWorkspacePath(filesRoot, to);

  await fs.mkdir(path.dirname(resolvedTo), { recursive: true });
  await fs.rename(resolvedFrom, resolvedTo);
}

function resolveBasePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

async function ensureWorkspaceFilesRoot(cwd: string): Promise<string> {
  const filesRoot = path.join(cwd, WORKSPACE_FILES_DIR);
  await fs.mkdir(filesRoot, { recursive: true });
  return filesRoot;
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, normalized);

  if (!isWithinBasePath(resolvedPath, resolvedRoot)) {
    throw new Error("Invalid workspace path.");
  }

  return resolvedPath;
}

function normalizeRelativePath(value: string): string {
  const trimmed = value.replace(/^\/+/, "");
  if (!trimmed) {
    throw new Error("Workspace path is required.");
  }
  return trimmed;
}

function isWithinBasePath(resolvedPath: string, basePath: string): boolean {
  return resolvedPath === basePath || resolvedPath.startsWith(`${basePath}${path.sep}`);
}

async function copyProjectConfigs(rootPath: string): Promise<void> {
  const projectRoot = process.cwd();
  const claudeSource = path.join(projectRoot, PROJECT_CONFIG_DIR);
  const claudeDestination = path.join(rootPath, PROJECT_CONFIG_DIR);

  if (await pathExists(claudeSource)) {
    if (!(await pathExists(claudeDestination))) {
      await fs.cp(claudeSource, claudeDestination, { recursive: true });
    }
  }

  const mcpSource = path.join(projectRoot, PROJECT_MCP_CONFIG);
  const mcpDestination = path.join(rootPath, PROJECT_MCP_CONFIG);
  if (await pathExists(mcpSource)) {
    if (!(await pathExists(mcpDestination))) {
      await fs.copyFile(mcpSource, mcpDestination);
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkWorkspace(
  root: string,
  current: string,
  entries: WorkspaceFile[]
): Promise<void> {
  const dirEntries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of dirEntries) {
    const fullPath = path.join(current, entry.name);
    const stats = await fs.stat(fullPath);
    const relativePath = toWorkspaceRelativePath(root, fullPath);

    entries.push(toWorkspaceFile(root, relativePath, entry.isDirectory(), stats));

    if (entry.isDirectory()) {
      await walkWorkspace(root, fullPath, entries);
    }
  }
}

function toWorkspaceRelativePath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

function toWorkspaceFile(
  root: string,
  relativePath: string,
  isDirectory: boolean,
  stats: { size: number; mtime: Date }
): WorkspaceFile {
  const name = path.basename(relativePath);
  return {
    path: toWorkspaceRelativePath(root, path.join(root, relativePath)),
    name,
    type: isDirectory ? "dir" : "file",
    size: isDirectory ? 0 : stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}
