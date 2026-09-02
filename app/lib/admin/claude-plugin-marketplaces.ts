// [Input] Admin session/RBAC, Admin-owned PostgreSQL catalog tables, bounded HTTPS remotes, and Claude marketplace manifests.
// [Output] Global Remote Marketplace CRUD, commit-pinned GitHub raw/Git synchronization, immutable revisions, entry policy commands, and thin Route Handler responses.
// [Pos] ClaudePlugin Marketplace control-plane service; Dream consumes only approved entries through the published capability.
// [Sync] 2026-08-19: implement remote Git synchronization without a Marketplace object-storage bucket or user-scoped catalog.
// [Sync] 2026-09-02: sparsely materialize commit-pinned GitHub files when smart-Git/archive transport is unavailable and preserve actionable failures.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { z } from "zod";

import { claudePluginMarketplacePolicy } from "../../../config/claude-plugin-marketplace-policy.mjs";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

const execFileAsync = promisify(execFile);
const MANAGE_PERMISSION = "claude_plugin_marketplaces.manage";
export const REMOTE_MARKETPLACE_CAPABILITY =
  "dream.claude-plugin.remote-marketplace.v1";
const REMOTE_MARKETPLACE_CONTRACT_SHA256 =
  "d215cb2764f656ab32e364a4900b3aac73fca60c77ef4c9f3a914fd192a8c314";
const GITHUB_HOST = "github.com";
const GITHUB_API_HOST = "api.github.com";
const GITHUB_RAW_HOST = "raw.githubusercontent.com";
const MARKETPLACE_MANIFEST_PATH = ".claude-plugin/marketplace.json";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const remoteRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.split("/").some((segment) => segment.endsWith(".lock")),
    { message: "ref must be a safe Git branch or tag" },
  );

const createMarketplaceSchema = z
  .object({
    slug: identifierSchema,
    displayName: z.string().trim().min(1).max(160),
    remoteUrl: z.string().trim().min(1).max(2048),
    defaultRef: remoteRefSchema.optional(),
  })
  .strict();

const updateMarketplaceSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    defaultRef: remoteRefSchema.nullable().optional(),
    status: z.enum(["pending", "active", "disabled"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const syncMarketplaceSchema = z
  .object({
    ref: remoteRefSchema.optional(),
  })
  .strict();

const policySchema = z
  .object({
    decision: z.enum(["approved", "blocked"]),
    entryId: z.string().trim().min(1).max(160).nullable().optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "approved" && !value.entryId) {
      context.addIssue({
        code: "custom",
        path: ["entryId"],
        message: "entryId is required when approving an entry",
      });
    }
    if (value.decision === "blocked" && value.entryId) {
      context.addIssue({
        code: "custom",
        path: ["entryId"],
        message: "entryId must be omitted when blocking an entry",
      });
    }
  });

const marketplaceManifestSchema = z
  .object({
    name: identifierSchema,
    description: z.string().max(4000).optional(),
    owner: z
      .object({
        name: z.string().min(1).max(255),
        url: z.string().max(2048).optional(),
      })
      .passthrough()
      .optional(),
    plugins: z.array(z.unknown()),
  })
  .passthrough();

const marketplacePluginSchema = z
  .object({
    name: identifierSchema,
    source: z.string().min(1).max(1024),
    description: z.string().max(4000).optional(),
    homepage: z.string().max(2048).optional(),
  })
  .passthrough();

type MarketplaceRow = {
  id: string;
  slug: string;
  display_name: string;
  remote_url: string;
  default_ref: string | null;
  marketplace_name: string | null;
  status: "pending" | "active" | "disabled" | "error";
  last_sync_error_code: string | null;
  last_sync_error_summary: string | null;
};

type GitHubRepository = {
  owner: string;
  repository: string;
};

const githubCommitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
});

const githubTreeSchema = z.object({
  truncated: z.boolean().optional().default(false),
  tree: z.array(z.object({
    path: z.string().min(1).max(4096),
    mode: z.string().regex(/^[0-9]{6}$/),
    type: z.enum(["blob", "tree", "commit"]),
    size: z.number().int().nonnegative().optional(),
  })),
});

export type InspectedMarketplaceEntry = {
  id?: string;
  packageName: string;
  marketplaceName: string;
  packageSpec: string;
  displayName: string;
  description: string | null;
  version: string | null;
  homepage: string | null;
  sourcePath: string;
  sourceJson: Record<string, unknown>;
  pluginManifestJson: Record<string, unknown> | null;
  pluginManifestSha256: string | null;
  pluginDigest: string | null;
  componentInventory: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  validationStatus: "valid" | "invalid";
  validationErrors: string[];
};

export type InspectedMarketplaceRevision = {
  resolvedCommitSha: string;
  marketplaceName: string;
  manifestSha256: string;
  manifestJson: Record<string, unknown>;
  validationStatus: "valid" | "invalid";
  validationErrors: string[];
  entries: InspectedMarketplaceEntry[];
};

function parseJsonRequest<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AdminError(
      "ADMIN_VALIDATION_ERROR",
      "请求参数不符合 ClaudePlugin Marketplace 合同",
      400,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeMarketplaceRemoteUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_INVALID",
      "Marketplace remoteUrl 必须是有效的 HTTPS URL",
      400,
    );
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = claudePluginMarketplacePolicy.allowedHosts.some(
    (candidate: string) =>
      host === candidate || host.endsWith(`.${candidate}`),
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    parsed.search ||
    parsed.hash ||
    !allowed
  ) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_DENIED",
      "Marketplace remoteUrl 不符合 HTTPS host allowlist 策略",
      400,
      { policyRevision: claudePluginMarketplacePolicy.revision },
    );
  }
  parsed.hostname = host;
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export function parseGitHubMarketplaceRemote(
  remoteUrl: string,
): GitHubRepository | null {
  const parsed = new URL(remoteUrl);
  if (parsed.hostname !== GITHUB_HOST) return null;
  let segments: string[];
  try {
    segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/, "");
  const githubName = /^[A-Za-z0-9_.-]+$/;
  if (!githubName.test(owner) || !githubName.test(repository)) return null;
  return { owner, repository };
}

async function assertMarketplaceCapability(client: PoolClient) {
  const { rows } = await client.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM drizzle.schema_capabilities
       WHERE capability = $1 AND version >= 1 AND contract_sha256 = $2
     ) AS ready`,
    [REMOTE_MARKETPLACE_CAPABILITY, REMOTE_MARKETPLACE_CONTRACT_SHA256],
  );
  if (!rows[0]?.ready) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_CAPABILITY_MISSING",
      "Remote Marketplace schema capability 尚未发布",
      503,
    );
  }
}

async function loadMarketplace(client: PoolClient, marketplaceId: string, lock = false) {
  const { rows } = await client.query<MarketplaceRow>(
    `SELECT id, slug, display_name, remote_url, default_ref, marketplace_name,
            status, last_sync_error_code, last_sync_error_summary
     FROM claude_plugin_marketplaces
     WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [marketplaceId],
  );
  if (!rows[0]) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_NOT_FOUND",
      "ClaudePlugin Marketplace 不存在",
      404,
    );
  }
  return rows[0];
}

async function readBoundedJson(
  path: string,
  maxBytes: number,
  code: string,
): Promise<{ payload: unknown; bytes: Buffer; digest: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new AdminError(code, `缺少 ${basename(path)}`, 422);
  }
  if (bytes.byteLength > maxBytes) {
    throw new AdminError(code, `${basename(path)} 超出同步策略大小限制`, 422);
  }
  try {
    return {
      payload: JSON.parse(bytes.toString("utf8")) as unknown,
      bytes,
      digest: sha256(bytes),
    };
  } catch {
    throw new AdminError(code, `${basename(path)} 不是有效 JSON`, 422);
  }
}

function pathInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function resolvePluginSource(checkoutRoot: string, source: string) {
  if (!source.startsWith("./") || source.includes("\0")) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_UNSUPPORTED",
      "v1 只接受远程仓库内的相对目录插件 source",
      422,
    );
  }
  const candidate = resolve(checkoutRoot, source);
  if (!pathInside(checkoutRoot, candidate)) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_ESCAPE",
      "插件 source 超出远程仓库根目录",
      422,
    );
  }
  const [rootReal, candidateReal] = await Promise.all([
    realpath(checkoutRoot),
    realpath(candidate).catch(() => ""),
  ]);
  if (!candidateReal || !pathInside(rootReal, candidateReal)) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_INVALID",
      "插件 source 不存在或通过链接逃逸仓库根目录",
      422,
    );
  }
  const stat = await lstat(candidateReal);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_INVALID",
      "插件 source 必须是仓库内真实目录",
      422,
    );
  }
  return candidateReal;
}

async function walkInventory(root: string) {
  const inventory: Record<string, unknown> = {
    skills: 0,
    commands: 0,
    agents: 0,
    hooks: 0,
    files: 0,
  };
  let totalBytes = 0;
  const digestFiles: Array<{ absolute: string; relative: string; size: number }> = [];

  function digestEntryExcluded(relativePath: string) {
    return relativePath.split("/").some(
      (part) =>
        part === ".git" ||
        part === ".in_use" ||
        part === ".DS_Store" ||
        part === "Thumbs.db" ||
        part === "desktop.ini" ||
        part.startsWith("._"),
    );
  }

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_SYMLINK_DENIED",
          "插件目录包含不允许的符号链接",
          422,
        );
      }
      if (stat.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!stat.isFile()) continue;
      inventory.files = Number(inventory.files) + 1;
      totalBytes += stat.size;
      if (Number(inventory.files) > claudePluginMarketplacePolicy.maxInventoryFiles) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_INVENTORY_TOO_LARGE",
          "插件文件数超出同步策略限制",
          422,
        );
      }
      const rel = relative(root, path).split(sep);
      const digestRelative = rel.join("/");
      if (!digestEntryExcluded(digestRelative)) {
        digestFiles.push({ absolute: path, relative: digestRelative, size: stat.size });
      }
      if (rel[0] === "skills" && entry.name === "SKILL.md") {
        inventory.skills = Number(inventory.skills) + 1;
      } else if (rel[0] === "commands" && entry.name.endsWith(".md")) {
        inventory.commands = Number(inventory.commands) + 1;
      } else if (rel[0] === "agents" && entry.name.endsWith(".md")) {
        inventory.agents = Number(inventory.agents) + 1;
      } else if (rel[0] === "hooks" && entry.name.endsWith(".json")) {
        inventory.hooks = Number(inventory.hooks) + 1;
      }
    }
  }

  await walk(root);
  const digest = createHash("sha256");
  digestFiles.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relative, "utf8"), Buffer.from(right.relative, "utf8")),
  );
  for (const file of digestFiles) {
    const relativeBytes = Buffer.from(file.relative, "utf8");
    const relativeLength = Buffer.alloc(4);
    relativeLength.writeUInt32BE(relativeBytes.byteLength);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(file.size));
    digest.update(relativeLength);
    digest.update(relativeBytes);
    digest.update(contentLength);
    digest.update(await readFile(file.absolute));
  }
  return {
    inventory,
    totalBytes,
    pluginDigest: digestFiles.length > 0 ? `sha256:${digest.digest("hex")}` : null,
  };
}

async function inspectEntry(
  checkoutRoot: string,
  marketplaceName: string,
  value: unknown,
): Promise<InspectedMarketplaceEntry> {
  const parsed = marketplacePluginSchema.safeParse(value);
  if (!parsed.success) {
    const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const packageName = typeof raw.name === "string" && identifierSchema.safeParse(raw.name).success
      ? raw.name
      : `invalid-${sha256(JSON.stringify(value)).slice(0, 12)}`;
    return {
      packageName,
      marketplaceName,
      packageSpec: `${packageName}@${marketplaceName}`,
      displayName: packageName,
      description: null,
      version: null,
      homepage: null,
      sourcePath: "",
      sourceJson: {},
      pluginManifestJson: null,
      pluginManifestSha256: null,
      pluginDigest: null,
      componentInventory: {},
      compatibility: {},
      validationStatus: "invalid",
      validationErrors: ["MARKETPLACE_ENTRY_SCHEMA_INVALID"],
    };
  }

  const entry = parsed.data;
  const validationErrors: string[] = [];
  let pluginRoot: string | null = null;
  try {
    pluginRoot = await resolvePluginSource(checkoutRoot, entry.source);
  } catch (error) {
    if (error instanceof AdminError) validationErrors.push(error.code);
    else validationErrors.push("CLAUDE_PLUGIN_MARKETPLACE_SOURCE_INVALID");
  }

  let pluginManifestJson: Record<string, unknown> | null = null;
  let pluginManifestSha256: string | null = null;
  let pluginDigest: string | null = null;
  let version: string | null = null;
  let compatibility: Record<string, unknown> = {};
  let componentInventory: Record<string, unknown> = {};

  if (pluginRoot) {
    const pluginManifestPath = join(pluginRoot, ".claude-plugin", "plugin.json");
    try {
      const pluginManifest = await readBoundedJson(
        pluginManifestPath,
        claudePluginMarketplacePolicy.maxPluginManifestBytes,
        "CLAUDE_PLUGIN_MANIFEST_INVALID",
      );
      if (!pluginManifest.payload || typeof pluginManifest.payload !== "object" || Array.isArray(pluginManifest.payload)) {
        validationErrors.push("CLAUDE_PLUGIN_MANIFEST_INVALID");
      } else {
        pluginManifestJson = pluginManifest.payload as Record<string, unknown>;
        pluginManifestSha256 = pluginManifest.digest;
        if (
          typeof pluginManifestJson.name === "string" &&
          pluginManifestJson.name !== entry.name
        ) {
          validationErrors.push("CLAUDE_PLUGIN_MANIFEST_NAME_MISMATCH");
        }
        version = typeof pluginManifestJson.version === "string"
          ? pluginManifestJson.version
          : null;
        compatibility = pluginManifestJson.compatibility && typeof pluginManifestJson.compatibility === "object" && !Array.isArray(pluginManifestJson.compatibility)
          ? pluginManifestJson.compatibility as Record<string, unknown>
          : {};
      }
    } catch (error) {
      validationErrors.push(
        error instanceof AdminError ? error.code : "CLAUDE_PLUGIN_MANIFEST_INVALID",
      );
    }
    try {
      const inspected = await walkInventory(pluginRoot);
      componentInventory = inspected.inventory;
      pluginDigest = inspected.pluginDigest;
      if (inspected.totalBytes > claudePluginMarketplacePolicy.maxRepositoryBytes) {
        validationErrors.push("CLAUDE_PLUGIN_MARKETPLACE_PLUGIN_TOO_LARGE");
      }
      const mcpServers = pluginManifestJson?.mcpServers;
      if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
        componentInventory.mcpServers = Object.keys(mcpServers).length;
      }
    } catch (error) {
      validationErrors.push(
        error instanceof AdminError ? error.code : "CLAUDE_PLUGIN_MARKETPLACE_INVENTORY_FAILED",
      );
    }
  }

  return {
    packageName: entry.name,
    marketplaceName,
    packageSpec: `${entry.name}@${marketplaceName}`,
    displayName: entry.name,
    description: entry.description ?? null,
    version,
    homepage: entry.homepage ?? null,
    sourcePath: entry.source,
    sourceJson: { type: "repository-directory", path: entry.source },
    pluginManifestJson,
    pluginManifestSha256,
    pluginDigest,
    componentInventory,
    compatibility,
    validationStatus: validationErrors.length === 0 ? "valid" : "invalid",
    validationErrors: [...new Set(validationErrors)],
  };
}

export async function inspectMarketplaceCheckout(
  checkoutRoot: string,
  resolvedCommitSha: string,
): Promise<InspectedMarketplaceRevision> {
  if (!/^[0-9a-f]{40}$/.test(resolvedCommitSha)) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_COMMIT_INVALID",
      "远程仓库没有返回可验证的 40 位 commit SHA",
      422,
    );
  }
  const manifest = await readBoundedJson(
    join(checkoutRoot, ".claude-plugin", "marketplace.json"),
    claudePluginMarketplacePolicy.maxMarketplaceManifestBytes,
    "CLAUDE_PLUGIN_MARKETPLACE_MANIFEST_INVALID",
  );
  const parsed = marketplaceManifestSchema.safeParse(manifest.payload);
  if (!parsed.success) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_MANIFEST_INVALID",
      "marketplace.json 不符合 Claude Marketplace 基础合同",
      422,
      parsed.error.flatten(),
    );
  }
  if (parsed.data.plugins.length > claudePluginMarketplacePolicy.maxEntries) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_ENTRY_LIMIT",
      "Marketplace 条目数超出同步策略限制",
      422,
    );
  }
  const entries: InspectedMarketplaceEntry[] = [];
  for (const value of parsed.data.plugins) {
    entries.push(await inspectEntry(checkoutRoot, parsed.data.name, value));
  }
  const duplicateNames = entries
    .map((entry) => entry.packageName)
    .filter((name, index, all) => all.indexOf(name) !== index);
  const uniqueEntries = entries.filter(
    (entry, index, all) =>
      all.findIndex((candidate) => candidate.packageName === entry.packageName) === index,
  );
  const validationErrors = [
    ...(duplicateNames.length > 0 ? ["CLAUDE_PLUGIN_MARKETPLACE_DUPLICATE_ENTRY"] : []),
    ...uniqueEntries.flatMap((entry) => entry.validationErrors.map((code) => `${entry.packageName}:${code}`)),
  ];
  return {
    resolvedCommitSha,
    marketplaceName: parsed.data.name,
    manifestSha256: manifest.digest,
    manifestJson: parsed.data as Record<string, unknown>,
    validationStatus: validationErrors.length === 0 ? "valid" : "invalid",
    validationErrors,
    entries: uniqueEntries,
  };
}

async function runGit(args: string[], cwd?: string) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: claudePluginMarketplacePolicy.syncTimeoutMs,
      maxBuffer: 1024 * 1024,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
    return result.stdout.trim();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (("killed" in error && error.killed === true) ||
        ("signal" in error && error.signal === "SIGTERM"))
    ) {
      throw new AdminError(
        "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT",
        "远程 Marketplace 在同步时限内未响应",
        504,
      );
    }
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_GIT_FAILED",
      "远程 Marketplace Git 读取失败",
      502,
    );
  }
}

function remoteTimeoutError() {
  return new AdminError(
    "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT",
    "远程 Marketplace 在同步时限内未响应",
    504,
  );
}

function remoteFetchError() {
  return new AdminError(
    "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_FETCH_FAILED",
    "无法读取远程 Marketplace，请检查仓库可访问性后重试",
    502,
  );
}

async function fetchGitHubJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  maxBytes = claudePluginMarketplacePolicy.maxMarketplaceManifestBytes,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "ink-memory-admin-marketplace-sync",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw remoteTimeoutError();
    throw remoteFetchError();
  }
  if (response.status === 404) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REF_NOT_FOUND",
      "远程 Marketplace 仓库或 ref 不存在",
      422,
    );
  }
  if (response.status === 403 || response.status === 429) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_RATE_LIMITED",
      "远程 Marketplace 服务暂时限制访问，请稍后重试",
      503,
    );
  }
  if (!response.ok) throw remoteFetchError();
  const bytes = await readBoundedResponse(response, maxBytes, signal);
  let payload: unknown;
  try {
    payload = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw remoteFetchError();
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw remoteFetchError();
  return parsed.data;
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) {
  if (!response.body) throw remoteFetchError();
  const contentLength = response.headers.get("content-length");
  const declaredBytes = contentLength === null ? null : Number(contentLength);
  if (
    declaredBytes !== null &&
    Number.isFinite(declaredBytes) &&
    declaredBytes > maxBytes
  ) {
    await response.body.cancel().catch(() => undefined);
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_CONTENT_TOO_LARGE",
      "远程 Marketplace 内容超出同步策略大小限制",
      422,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_CONTENT_TOO_LARGE",
          "远程 Marketplace 内容超出同步策略大小限制",
          422,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw remoteTimeoutError();
    if (error instanceof AdminError) throw error;
    throw remoteFetchError();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, receivedBytes);
}

async function fetchGitHubFile(
  repository: GitHubRepository,
  commitSha: string,
  repositoryPath: string,
  maxBytes: number,
  signal: AbortSignal,
) {
  const url = new URL(
    `/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/${commitSha}/${repositoryPath.split("/").map(encodeURIComponent).join("/")}`,
    `https://${GITHUB_RAW_HOST}`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "ink-memory-admin-marketplace-sync" },
      redirect: "error",
      signal,
    });
  } catch {
    if (signal.aborted) throw remoteTimeoutError();
    throw remoteFetchError();
  }
  if (response.status === 404 && repositoryPath === MARKETPLACE_MANIFEST_PATH) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_MANIFEST_INVALID",
      "远程仓库没有 Claude Marketplace manifest",
      422,
    );
  }
  if (!response.ok) throw remoteFetchError();
  return await readBoundedResponse(response, maxBytes, signal);
}

function declaredPluginSourceRoots(manifestBytes: Buffer) {
  let payload: unknown;
  try {
    payload = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    return [];
  }
  const manifest = marketplaceManifestSchema.safeParse(payload);
  if (!manifest.success) return [];
  return [...new Set(manifest.data.plugins.flatMap((value) => {
    const entry = marketplacePluginSchema.safeParse(value);
    if (!entry.success || !entry.data.source.startsWith("./")) return [];
    const source = entry.data.source.slice(2).replace(/\/+$/, "");
    const segments = source ? source.split("/") : [];
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return [];
    }
    return [segments.join("/")];
  }))];
}

function pathWithinSource(repositoryPath: string, sourceRoot: string) {
  return sourceRoot === "" ||
    repositoryPath === sourceRoot ||
    repositoryPath.startsWith(`${sourceRoot}/`);
}

function isSafeRepositoryPath(repositoryPath: string) {
  if (repositoryPath.startsWith("/") || repositoryPath.includes("\0")) return false;
  const segments = repositoryPath.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

async function materializeGitHubMarketplace(
  repository: GitHubRepository,
  commitSha: string,
  checkoutRoot: string,
  signal: AbortSignal,
) {
  const manifestBytes = await fetchGitHubFile(
    repository,
    commitSha,
    MARKETPLACE_MANIFEST_PATH,
    claudePluginMarketplacePolicy.maxMarketplaceManifestBytes,
    signal,
  );
  const manifestPath = join(checkoutRoot, MARKETPLACE_MANIFEST_PATH);
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath, manifestBytes, { flag: "wx", mode: 0o600 });

  const sourceRoots = declaredPluginSourceRoots(manifestBytes);
  if (sourceRoots.length === 0) return;
  const treeUrl = new URL(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/git/trees/${commitSha}`,
    `https://${GITHUB_API_HOST}`,
  );
  treeUrl.searchParams.set("recursive", "1");
  const tree = await fetchGitHubJson(
    treeUrl,
    githubTreeSchema,
    signal,
    claudePluginMarketplacePolicy.maxRepositoryBytes,
  );
  if (tree.truncated) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_INDEX_INVALID",
      "远程 Marketplace 文件索引不完整",
      422,
    );
  }
  const relevant = tree.tree.filter((entry) =>
    sourceRoots.some((sourceRoot) => pathWithinSource(entry.path, sourceRoot)),
  );
  if (relevant.some((entry) =>
    !isSafeRepositoryPath(entry.path) ||
    entry.mode === "120000" ||
    entry.type === "commit"
  )) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_INVALID",
      "远程 Marketplace 插件目录包含不安全的链接或子模块",
      422,
    );
  }
  const files = relevant.filter((entry) =>
    entry.type === "blob" && entry.path !== MARKETPLACE_MANIFEST_PATH,
  );
  if (files.length > claudePluginMarketplacePolicy.maxInventoryFiles) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_FILE_LIMIT",
      "插件文件数量超出同步策略限制",
      422,
    );
  }
  const declaredBytes = files.reduce((total, entry) => total + (entry.size ?? 0), 0);
  if (declaredBytes > claudePluginMarketplacePolicy.maxRepositoryBytes) {
    throw new AdminError(
      "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_CONTENT_TOO_LARGE",
      "远程 Marketplace 内容超出同步策略大小限制",
      422,
    );
  }
  let receivedBytes = 0;
  for (const entry of files) {
    const remainingBytes = claudePluginMarketplacePolicy.maxRepositoryBytes - receivedBytes;
    const bytes = await fetchGitHubFile(
      repository,
      commitSha,
      entry.path,
      remainingBytes,
      signal,
    );
    receivedBytes += bytes.byteLength;
    const outputPath = join(checkoutRoot, entry.path);
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  }
}

async function checkoutGitHubArchive(
  repository: GitHubRepository,
  requestedRef?: string | null,
) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ink-claude-marketplace-"));
  const checkoutRoot = join(tempRoot, "checkout");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    claudePluginMarketplacePolicy.syncTimeoutMs,
  );
  try {
    // GitHub resolves HEAD to the repository's default branch, so both the
    // implicit default and an explicit ref need only one rate-limited API call.
    const ref = requestedRef ?? "HEAD";
    const commitUrl = new URL(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/commits/${encodeURIComponent(ref)}`,
      `https://${GITHUB_API_HOST}`,
    );
    const commit = await fetchGitHubJson(
      commitUrl,
      githubCommitSchema,
      controller.signal,
    );
    await mkdir(checkoutRoot, { mode: 0o700 });
    await materializeGitHubMarketplace(
      repository,
      commit.sha,
      checkoutRoot,
      controller.signal,
    );
    return {
      tempRoot,
      revision: await inspectMarketplaceCheckout(checkoutRoot, commit.sha),
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkoutGitRemote(remoteUrl: string, requestedRef?: string | null) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ink-claude-marketplace-"));
  const checkoutRoot = join(tempRoot, "checkout");
  try {
    await runGit([
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
      "clone",
      "--depth",
      "1",
      "--no-tags",
      "--filter=blob:none",
      remoteUrl,
      checkoutRoot,
    ]);
    if (requestedRef) {
      await runGit(
        [
          "-c",
          "protocol.file.allow=never",
          "-c",
          "protocol.ext.allow=never",
          "fetch",
          "--depth",
          "1",
          "origin",
          requestedRef,
        ],
        checkoutRoot,
      );
      await runGit(["checkout", "--detach", "FETCH_HEAD"], checkoutRoot);
    }
    const resolvedCommitSha = await runGit(["rev-parse", "HEAD"], checkoutRoot);
    return {
      tempRoot,
      revision: await inspectMarketplaceCheckout(checkoutRoot, resolvedCommitSha),
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function checkoutRemoteMarketplace(
  remoteUrl: string,
  requestedRef?: string | null,
) {
  const normalizedRemoteUrl = normalizeMarketplaceRemoteUrl(remoteUrl);
  const githubRepository = parseGitHubMarketplaceRemote(normalizedRemoteUrl);
  if (githubRepository) {
    return await checkoutGitHubArchive(githubRepository, requestedRef);
  }
  return await checkoutGitRemote(normalizedRemoteUrl, requestedRef);
}

async function cleanupCheckout(tempRoot: string) {
  await rm(tempRoot, { recursive: true, force: true });
}

function response(data: unknown, requestId: string, init?: ResponseInit) {
  return Response.json(
    { data },
    {
      ...init,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
        ...init?.headers,
      },
    },
  );
}

export async function handleClaudePluginMarketplaceList(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, MANAGE_PERMISSION);
    const data = await withPlatformClient(async (client) => {
      await assertMarketplaceCapability(client);
      const { rows } = await client.query(
        `SELECT marketplace.*,
                revision.id AS latest_revision_id,
                revision.resolved_commit_sha AS latest_commit_sha,
                revision.validation_status AS latest_validation_status,
                revision.created_at AS latest_synced_at,
                COALESCE(entry_counts.entry_count, 0)::integer AS entry_count,
                COALESCE(entry_counts.approved_count, 0)::integer AS approved_count
         FROM claude_plugin_marketplaces AS marketplace
         LEFT JOIN LATERAL (
           SELECT id, resolved_commit_sha, validation_status, created_at
           FROM claude_plugin_marketplace_revisions
           WHERE marketplace_id = marketplace.id
           ORDER BY created_at DESC, id DESC LIMIT 1
         ) AS revision ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT entry.package_name) AS entry_count,
                  COUNT(DISTINCT policy.package_name)
                    FILTER (WHERE policy.decision = 'approved') AS approved_count
           FROM claude_plugin_marketplace_entries AS entry
           LEFT JOIN claude_plugin_marketplace_entry_policies AS policy
             ON policy.marketplace_id = entry.marketplace_id
            AND policy.package_name = entry.package_name
           WHERE entry.marketplace_id = marketplace.id
             AND entry.revision_id = revision.id
         ) AS entry_counts ON TRUE
         ORDER BY marketplace.created_at DESC, marketplace.id DESC`,
      );
      return rows;
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudePluginMarketplaceCreate(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, MANAGE_PERMISSION);
    const input = parseJsonRequest(
      createMarketplaceSchema,
      await request.json().catch(() => null),
    );
    const remoteUrl = normalizeMarketplaceRemoteUrl(input.remoteUrl);
    const data = await withPlatformTransaction(async (client) => {
      await assertMarketplaceCapability(client);
      const id = createPlatformId("cpm");
      let rows;
      try {
        ({ rows } = await client.query(
          `INSERT INTO claude_plugin_marketplaces (
             id, slug, display_name, remote_url, default_ref,
             created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING *`,
          [id, input.slug, input.displayName, remoteUrl, input.defaultRef ?? null, identity.id],
        ));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") {
          throw new AdminError(
            "CLAUDE_PLUGIN_MARKETPLACE_CONFLICT",
            "Marketplace slug 或 remoteUrl 已存在",
            409,
          );
        }
        throw error;
      }
      await recordAdminAuditOnClient(client, {
        identity,
        action: "claude_plugin_marketplace_create",
        resourceType: "claude_plugin_marketplace",
        resourceId: id,
        requestId,
        request,
        after: {
          slug: input.slug,
          displayName: input.displayName,
          remoteUrl,
          defaultRef: input.defaultRef ?? null,
        },
      });
      return rows[0];
    });
    return response(data, requestId, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudePluginMarketplaceGet(
  request: Request,
  marketplaceId: string,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, MANAGE_PERMISSION);
    const data = await withPlatformClient(async (client) => {
      await assertMarketplaceCapability(client);
      const marketplace = await loadMarketplace(client, marketplaceId);
      const [revisions, policies] = await Promise.all([
        client.query(
          `SELECT id, sync_run_id, resolved_commit_sha, marketplace_name,
                  manifest_sha256, entry_count, validation_status,
                  validation_errors, created_by, created_at
           FROM claude_plugin_marketplace_revisions
           WHERE marketplace_id = $1
           ORDER BY created_at DESC, id DESC LIMIT 50`,
          [marketplaceId],
        ),
        client.query(
          `SELECT policy.*, entry.revision_id, entry.version,
                  entry.validation_status AS entry_validation_status
           FROM claude_plugin_marketplace_entry_policies AS policy
           LEFT JOIN claude_plugin_marketplace_entries AS entry
             ON entry.id = policy.approved_entry_id
           WHERE policy.marketplace_id = $1
           ORDER BY policy.package_name`,
          [marketplaceId],
        ),
      ]);
      return { ...marketplace, revisions: revisions.rows, policies: policies.rows };
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudePluginMarketplaceUpdate(
  request: Request,
  marketplaceId: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, MANAGE_PERMISSION);
    const input = parseJsonRequest(
      updateMarketplaceSchema,
      await request.json().catch(() => null),
    );
    const data = await withPlatformTransaction(async (client) => {
      await assertMarketplaceCapability(client);
      const before = await loadMarketplace(client, marketplaceId, true);
      const { rows } = await client.query(
        `UPDATE claude_plugin_marketplaces SET
           display_name = COALESCE($2, display_name),
           default_ref = CASE WHEN $3::boolean THEN $4 ELSE default_ref END,
           status = COALESCE($5, status),
           updated_by = $6,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          marketplaceId,
          input.displayName ?? null,
          Object.prototype.hasOwnProperty.call(input, "defaultRef"),
          input.defaultRef ?? null,
          input.status ?? null,
          identity.id,
        ],
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "claude_plugin_marketplace_update",
        resourceType: "claude_plugin_marketplace",
        resourceId: marketplaceId,
        requestId,
        request,
        before,
        after: rows[0],
      });
      return rows[0];
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

async function markSyncFailure(
  request: Request,
  requestId: string,
  marketplaceId: string,
  runId: string,
  identity: Awaited<ReturnType<typeof requireAdminRequest>>,
  error: unknown,
) {
  const resolved = error instanceof AdminError
    ? error
    : new AdminError(
        "CLAUDE_PLUGIN_MARKETPLACE_SYNC_FAILED",
        "Remote Marketplace 同步失败",
        500,
      );
  await withPlatformTransaction(async (client) => {
    await client.query(
      `UPDATE claude_plugin_marketplace_sync_runs SET
         status = 'failed', error_code = $2, error_summary = $3, finished_at = now()
       WHERE id = $1 AND status = 'running'`,
      [runId, resolved.code, resolved.message.slice(0, 1000)],
    );
    await client.query(
      `UPDATE claude_plugin_marketplaces SET
         status = CASE WHEN status = 'disabled' THEN status ELSE 'error' END,
         last_sync_error_code = $2,
         last_sync_error_summary = $3,
         updated_by = $4,
         updated_at = now()
       WHERE id = $1`,
      [marketplaceId, resolved.code, resolved.message.slice(0, 1000), identity.id],
    );
    await recordAdminAuditOnClient(client, {
      identity,
      action: "claude_plugin_marketplace_sync_failed",
      resourceType: "claude_plugin_marketplace_sync_run",
      resourceId: runId,
      requestId,
      request,
      metadata: { marketplaceId, errorCode: resolved.code },
    });
  });
  return resolved;
}

export async function handleClaudePluginMarketplaceSync(
  request: Request,
  marketplaceId: string,
) {
  const requestId = adminRequestId(request);
  let runId: string | null = null;
  let identity: Awaited<ReturnType<typeof requireAdminRequest>> | null = null;
  let tempRoot: string | null = null;
  try {
    assertAdminMutationOrigin(request);
    identity = await requireAdminRequest(request, MANAGE_PERMISSION);
    const input = parseJsonRequest(
      syncMarketplaceSchema,
      await request.json().catch(() => ({})),
    );
    const prepared = await withPlatformTransaction(async (client) => {
      await assertMarketplaceCapability(client);
      const marketplace = await loadMarketplace(client, marketplaceId, true);
      const activeRun = await client.query(
        `SELECT id FROM claude_plugin_marketplace_sync_runs
         WHERE marketplace_id = $1 AND status = 'running' LIMIT 1`,
        [marketplaceId],
      );
      if (activeRun.rows[0]) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_SYNC_CONFLICT",
          "该 Marketplace 已有同步任务正在执行",
          409,
        );
      }
      const id = createPlatformId("cpms");
      const requestedRef = input.ref ?? marketplace.default_ref;
      try {
        await client.query(
          `INSERT INTO claude_plugin_marketplace_sync_runs (
             id, marketplace_id, requested_ref, requested_by
           ) VALUES ($1, $2, $3, $4)`,
          [id, marketplaceId, requestedRef ?? null, identity!.id],
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new AdminError(
            "CLAUDE_PLUGIN_MARKETPLACE_SYNC_CONFLICT",
            "该 Marketplace 已有同步任务正在执行",
            409,
          );
        }
        throw error;
      }
      await recordAdminAuditOnClient(client, {
        identity: identity!,
        action: "claude_plugin_marketplace_sync_requested",
        resourceType: "claude_plugin_marketplace_sync_run",
        resourceId: id,
        requestId,
        request,
        metadata: { marketplaceId, requestedRef: requestedRef ?? null },
      });
      return { runId: id, marketplace, requestedRef };
    });
    runId = prepared.runId;

    const checkout = await checkoutRemoteMarketplace(
      normalizeMarketplaceRemoteUrl(prepared.marketplace.remote_url),
      prepared.requestedRef,
    );
    tempRoot = checkout.tempRoot;
    const inspected = checkout.revision;

    const data = await withPlatformTransaction(async (client) => {
      const marketplace = await loadMarketplace(client, marketplaceId, true);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM claude_plugin_marketplace_revisions
         WHERE marketplace_id = $1 AND resolved_commit_sha = $2`,
        [marketplaceId, inspected.resolvedCommitSha],
      );
      let revisionId = existing.rows[0]?.id;
      if (!revisionId) {
        revisionId = createPlatformId("cpmr");
        await client.query(
          `INSERT INTO claude_plugin_marketplace_revisions (
             id, marketplace_id, sync_run_id, remote_url, requested_ref,
             resolved_commit_sha, marketplace_name, manifest_sha256,
             manifest_json, entry_count, validation_status,
             validation_errors, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13
           )`,
          [
            revisionId,
            marketplaceId,
            runId,
            marketplace.remote_url,
            prepared.requestedRef ?? null,
            inspected.resolvedCommitSha,
            inspected.marketplaceName,
            inspected.manifestSha256,
            JSON.stringify(inspected.manifestJson),
            inspected.entries.length,
            inspected.validationStatus,
            JSON.stringify(inspected.validationErrors),
            identity!.id,
          ],
        );
        for (const entry of inspected.entries) {
          const entryId = createPlatformId("cpme");
          entry.id = entryId;
          await client.query(
            `INSERT INTO claude_plugin_marketplace_entries (
               id, marketplace_id, revision_id, package_name,
               marketplace_name, package_spec, display_name, description,
               version, homepage, source_path, source_json,
               plugin_manifest_json, plugin_manifest_sha256, plugin_digest,
               component_inventory_json, compatibility_json,
               validation_status, validation_errors
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::jsonb, $13::jsonb, $14, $15, $16::jsonb, $17::jsonb,
               $18, $19::jsonb
             )`,
            [
              entryId,
              marketplaceId,
              revisionId,
              entry.packageName,
              entry.marketplaceName,
              entry.packageSpec,
              entry.displayName,
              entry.description,
              entry.version,
              entry.homepage,
              entry.sourcePath,
              JSON.stringify(entry.sourceJson),
              entry.pluginManifestJson ? JSON.stringify(entry.pluginManifestJson) : null,
              entry.pluginManifestSha256,
              entry.pluginDigest,
              JSON.stringify(entry.componentInventory),
              JSON.stringify(entry.compatibility),
              entry.validationStatus,
              JSON.stringify(entry.validationErrors),
            ],
          );
          await client.query(
            `INSERT INTO claude_plugin_marketplace_entry_policies (
               id, marketplace_id, package_name, decision, updated_by
             ) VALUES ($1, $2, $3, 'blocked', $4)
             ON CONFLICT (marketplace_id, package_name) DO NOTHING`,
            [createPlatformId("cpmp"), marketplaceId, entry.packageName, identity!.id],
          );
        }
      }

      const valid = inspected.validationStatus === "valid";
      await client.query(
        `UPDATE claude_plugin_marketplace_sync_runs SET
           status = $2, resolved_commit_sha = $3,
           error_code = $4, error_summary = $5, finished_at = now()
         WHERE id = $1 AND status = 'running'`,
        [
          runId,
          valid ? "succeeded" : "failed",
          inspected.resolvedCommitSha,
          valid ? null : "CLAUDE_PLUGIN_MARKETPLACE_REVISION_INVALID",
          valid ? null : "远程 Marketplace revision 未通过校验",
        ],
      );
      await client.query(
        `UPDATE claude_plugin_marketplaces SET
           marketplace_name = $2,
           status = CASE
             WHEN status = 'disabled' THEN status
             WHEN $3::boolean THEN 'active'
             ELSE 'error'
           END,
           last_sync_error_code = $4,
           last_sync_error_summary = $5,
           updated_by = $6,
           updated_at = now()
         WHERE id = $1`,
        [
          marketplaceId,
          inspected.marketplaceName,
          valid,
          valid ? null : "CLAUDE_PLUGIN_MARKETPLACE_REVISION_INVALID",
          valid ? null : "远程 Marketplace revision 未通过校验",
          identity!.id,
        ],
      );
      await recordAdminAuditOnClient(client, {
        identity: identity!,
        action: valid
          ? "claude_plugin_marketplace_sync_succeeded"
          : "claude_plugin_marketplace_sync_invalid",
        resourceType: "claude_plugin_marketplace_revision",
        resourceId: revisionId,
        requestId,
        request,
        metadata: {
          marketplaceId,
          runId,
          commitSha: inspected.resolvedCommitSha,
          manifestSha256: inspected.manifestSha256,
          entryCount: inspected.entries.length,
          reusedRevision: Boolean(existing.rows[0]),
          validationStatus: inspected.validationStatus,
        },
      });
      return {
        runId,
        revisionId,
        commitSha: inspected.resolvedCommitSha,
        manifestSha256: inspected.manifestSha256,
        marketplaceName: inspected.marketplaceName,
        entryCount: inspected.entries.length,
        validationStatus: inspected.validationStatus,
        validationErrors: inspected.validationErrors,
        reusedRevision: Boolean(existing.rows[0]),
      };
    });
    if (data.validationStatus !== "valid") {
      throw new AdminError(
        "CLAUDE_PLUGIN_MARKETPLACE_REVISION_INVALID",
        "远程 Marketplace 已记录，但 revision 未通过校验",
        422,
        data,
      );
    }
    return response(data, requestId);
  } catch (error) {
    if (runId && identity && !(error instanceof AdminError && error.code === "CLAUDE_PLUGIN_MARKETPLACE_REVISION_INVALID")) {
      const resolved = await markSyncFailure(
        request,
        requestId,
        marketplaceId,
        runId,
        identity,
        error,
      ).catch(() => error);
      return adminErrorResponse(resolved, requestId);
    }
    return adminErrorResponse(error, requestId);
  } finally {
    if (tempRoot) await cleanupCheckout(tempRoot).catch(() => undefined);
  }
}

export async function handleClaudePluginMarketplaceRuns(
  request: Request,
  marketplaceId: string,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, MANAGE_PERMISSION);
    const data = await withPlatformClient(async (client) => {
      await assertMarketplaceCapability(client);
      await loadMarketplace(client, marketplaceId);
      const { rows } = await client.query(
        `SELECT * FROM claude_plugin_marketplace_sync_runs
         WHERE marketplace_id = $1
         ORDER BY created_at DESC, id DESC LIMIT 100`,
        [marketplaceId],
      );
      return rows;
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudePluginMarketplaceRevision(
  request: Request,
  marketplaceId: string,
  revisionId: string,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, MANAGE_PERMISSION);
    const data = await withPlatformClient(async (client) => {
      await assertMarketplaceCapability(client);
      const revision = await client.query(
        `SELECT * FROM claude_plugin_marketplace_revisions
         WHERE id = $1 AND marketplace_id = $2`,
        [revisionId, marketplaceId],
      );
      if (!revision.rows[0]) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_REVISION_NOT_FOUND",
          "Marketplace revision 不存在",
          404,
        );
      }
      const entries = await client.query(
        `SELECT entry.*, policy.decision, policy.approved_entry_id,
                policy.reason AS policy_reason
         FROM claude_plugin_marketplace_entries AS entry
         LEFT JOIN claude_plugin_marketplace_entry_policies AS policy
           ON policy.marketplace_id = entry.marketplace_id
          AND policy.package_name = entry.package_name
         WHERE entry.revision_id = $1
         ORDER BY entry.package_name`,
        [revisionId],
      );
      return { ...revision.rows[0], entries: entries.rows };
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudePluginMarketplacePolicy(
  request: Request,
  marketplaceId: string,
  packageName: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, MANAGE_PERMISSION);
    const normalizedPackageName = identifierSchema.safeParse(packageName);
    if (!normalizedPackageName.success) {
      throw new AdminError(
        "ADMIN_VALIDATION_ERROR",
        "packageName 无效",
        400,
      );
    }
    const input = parseJsonRequest(
      policySchema,
      await request.json().catch(() => null),
    );
    const data = await withPlatformTransaction(async (client) => {
      await assertMarketplaceCapability(client);
      await loadMarketplace(client, marketplaceId, true);
      const previous = await client.query(
        `SELECT * FROM claude_plugin_marketplace_entry_policies
         WHERE marketplace_id = $1 AND package_name = $2 FOR UPDATE`,
        [marketplaceId, normalizedPackageName.data],
      );
      if (!previous.rows[0]) {
        throw new AdminError(
          "CLAUDE_PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND",
          "Marketplace 条目不存在",
          404,
        );
      }
      if (input.decision === "approved") {
        const entry = await client.query(
          `SELECT entry.id
           FROM claude_plugin_marketplace_entries AS entry
           JOIN claude_plugin_marketplace_revisions AS revision
             ON revision.id = entry.revision_id
           WHERE entry.id = $1
             AND entry.marketplace_id = $2
             AND entry.package_name = $3
             AND entry.validation_status = 'valid'
             AND entry.plugin_digest IS NOT NULL
             AND revision.validation_status = 'valid'`,
          [input.entryId, marketplaceId, normalizedPackageName.data],
        );
        if (!entry.rows[0]) {
          throw new AdminError(
            "CLAUDE_PLUGIN_MARKETPLACE_ENTRY_NOT_APPROVABLE",
            "只能批准当前 Marketplace 中校验通过的 revision 条目",
            409,
          );
        }
      }
      const { rows } = await client.query(
        `UPDATE claude_plugin_marketplace_entry_policies SET
           decision = $3,
           approved_entry_id = $4,
           reason = $5,
           updated_by = $6,
           updated_at = now()
         WHERE marketplace_id = $1 AND package_name = $2
         RETURNING *`,
        [
          marketplaceId,
          normalizedPackageName.data,
          input.decision,
          input.decision === "approved" ? input.entryId : null,
          input.reason ?? null,
          identity.id,
        ],
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "claude_plugin_marketplace_entry_policy_update",
        resourceType: "claude_plugin_marketplace_entry_policy",
        resourceId: rows[0].id,
        requestId,
        request,
        before: previous.rows[0],
        after: rows[0],
      });
      return rows[0];
    });
    return response(data, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
