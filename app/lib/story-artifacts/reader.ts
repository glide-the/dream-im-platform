import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { AdminError } from "../admin/errors";
import type { StoryArtifactSourceRecord } from "../story-source/repository";
import {
  artifactFileNames,
  episodeRegistrySchema,
  type EpisodeRegistry,
  type StoryArtifactKind,
  type StoryArtifactPreview,
  type StoryArtifactSurface,
  type StoryArtifactSurfaceFile,
} from "./contracts";

const MAX_REGISTRY_BYTES = 256 * 1024;
const MAX_PROJECT_BYTES = 256 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const HARD_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROJECT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_PATTERN = /^run_[0-9a-f]{32}$/;
const THREAD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const artifactLabels: Record<StoryArtifactKind, string> = {
  script: "剧本",
  episode_outline: "Episode 大纲",
  storyboard: "Storyboard",
  review_report: "Review report",
};

type VerifiedFile = {
  handle: FileHandle;
  path: string;
  root: string;
  segments: string[];
  stat: Stats;
};

function artifactMaxBytes() {
  const raw = process.env.ARTIFACT_PREVIEW_MAX_FILE_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_ARTIFACT_BYTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > HARD_MAX_ARTIFACT_BYTES) {
    throw new AdminError(
      "STORY_ARTIFACT_CONFIGURATION_INVALID",
      "The Artifact file-size limit is invalid",
      503,
    );
  }
  return parsed;
}

function assertSegment(value: string, label: string, pattern = SEGMENT_PATTERN) {
  if (!pattern.test(value) || value.includes("\0") || value === "." || value === "..") {
    throw new AdminError(
      "STORY_ARTIFACT_CONTRACT_INVALID",
      `The ${label} is not a valid Artifact resource identity`,
      422,
    );
  }
}

function isWithin(root: string, candidate: string) {
  const resolved = relative(root, candidate);
  return resolved === "" || (!resolved.startsWith(`..${sep}`) && resolved !== ".." && !isAbsolute(resolved));
}

async function canonicalRoot() {
  const configured = process.env.ARTIFACT_WORKSPACE_ROOT?.trim();
  if (!configured || !isAbsolute(configured)) {
    throw new AdminError(
      "STORY_ARTIFACT_STORE_UNAVAILABLE",
      "The shared Artifact filesystem is not configured",
      503,
    );
  }
  try {
    const rootStat = await lstat(configured);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("invalid root");
    return await realpath(configured);
  } catch {
    throw new AdminError(
      "STORY_ARTIFACT_STORE_UNAVAILABLE",
      "The shared Artifact filesystem is unavailable",
      503,
    );
  }
}

async function assertPathChain(root: string, segments: string[], finalFile: boolean) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    if (!isWithin(root, current)) {
      throw new AdminError(
        "STORY_ARTIFACT_PATH_DENIED",
        "The Artifact resource is outside the configured root",
        422,
      );
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new AdminError(
        "STORY_ARTIFACT_SYMLINK_DENIED",
        "Symbolic links are not allowed in Artifact resources",
        422,
      );
    }
    const isFinal = index === segments.length - 1;
    if ((isFinal && finalFile && !stat.isFile()) || ((!isFinal || !finalFile) && !stat.isDirectory())) {
      throw new AdminError(
        "STORY_ARTIFACT_CONTRACT_INVALID",
        "The Artifact resource has an invalid file type",
        422,
      );
    }
    const canonical = await realpath(current);
    if (!isWithin(root, canonical)) {
      throw new AdminError(
        "STORY_ARTIFACT_PATH_DENIED",
        "The Artifact resource escapes the configured root",
        422,
      );
    }
  }
  return current;
}

function sameFile(left: Stats, right: Stats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function openVerified(root: string, segments: string[]): Promise<VerifiedFile> {
  let path: string;
  try {
    path = await assertPathChain(root, segments, true);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      throw new AdminError(
        "STORY_ARTIFACT_NOT_FOUND",
        "The requested Artifact does not exist",
        404,
      );
    }
    throw error;
  }
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
    const [handleStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
    if (!handleStat.isFile() || pathStat.isSymbolicLink() || !sameFile(handleStat, pathStat)) {
      throw new AdminError(
        "STORY_ARTIFACT_CHANGED_DURING_READ",
        "The Artifact changed while it was being opened",
        409,
      );
    }
    return { handle, path, root, segments, stat: handleStat };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof AdminError) throw error;
    if (typeof error === "object" && error && "code" in error && error.code === "ELOOP") {
      throw new AdminError(
        "STORY_ARTIFACT_SYMLINK_DENIED",
        "Symbolic links are not allowed in Artifact resources",
        422,
      );
    }
    throw error;
  }
}

async function verifyAfterRead(file: VerifiedFile) {
  const [handleStat, pathStat] = await Promise.all([
    file.handle.stat(),
    lstat(file.path),
    assertPathChain(file.root, file.segments, true),
  ]);
  if (pathStat.isSymbolicLink() || !sameFile(file.stat, handleStat) || !sameFile(handleStat, pathStat)) {
    throw new AdminError(
      "STORY_ARTIFACT_CHANGED_DURING_READ",
      "The Artifact changed while it was being read",
      409,
    );
  }
}

async function readWholeUtf8(root: string, segments: string[], maxBytes: number) {
  const file = await openVerified(root, segments);
  try {
    if (file.stat.size > maxBytes) {
      throw new AdminError(
        "STORY_ARTIFACT_TOO_LARGE",
        "The Artifact exceeds the configured read limit",
        413,
      );
    }
    const buffer = Buffer.alloc(file.stat.size);
    const read = await file.handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead !== buffer.length) {
      throw new AdminError(
        "STORY_ARTIFACT_CHANGED_DURING_READ",
        "The Artifact changed while it was being read",
        409,
      );
    }
    await verifyAfterRead(file);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { content, buffer, stat: file.stat };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new AdminError(
        "STORY_ARTIFACT_ENCODING_INVALID",
        "The Artifact is not valid UTF-8 text",
        422,
      );
    }
    throw error;
  } finally {
    await file.handle.close();
  }
}

function sourceSegments(source: StoryArtifactSourceRecord) {
  assertSegment(source.sourceThreadRef, "thread reference", THREAD_PATTERN);
  assertSegment(source.sourceRunId, "run ID", RUN_PATTERN);
  assertSegment(source.sourceProjectId, "project ID", PROJECT_PATTERN);
  return {
    registry: [
      source.sourceThreadRef,
      ".dream",
      "runtime",
      "runs",
      source.sourceRunId,
      "episode.json",
    ],
    project: [
      source.sourceThreadRef,
      "stories",
      source.sourceProjectId,
      "project.yaml",
    ],
  };
}

function validateRegistry(registry: EpisodeRegistry, source: StoryArtifactSourceRecord) {
  if (registry.workflow_run_id !== source.sourceRunId || registry.story_slug !== source.sourceProjectId) {
    throw new AdminError(
      "STORY_ARTIFACT_SCOPE_CONFLICT",
      "The Artifact registry does not match the indexed Story scope",
      422,
    );
  }
  if (registry.schema_version === "dream-episode/v1") {
    if (registry.episode_root !== `stories/${source.sourceProjectId}/episodes/EP01`) {
      throw new AdminError("STORY_ARTIFACT_CONTRACT_INVALID", "The Episode binding is invalid", 422);
    }
    return [{ id: "EP01", uid: registry.episode_uid, active: true }];
  }
  const seen = new Set<string>();
  const episodes = registry.episodes.map((episode, index) => {
    const number = index + 1;
    const expectedCode = `EP${String(number).padStart(2, "0")}`;
    const expectedRoot = `stories/${source.sourceProjectId}/episodes/${expectedCode}`;
    if (
      episode.episode_number !== number ||
      episode.episode_code !== expectedCode ||
      episode.episode_root !== expectedRoot ||
      seen.has(episode.episode_uid)
    ) {
      throw new AdminError("STORY_ARTIFACT_CONTRACT_INVALID", "The Episode registry is invalid", 422);
    }
    seen.add(episode.episode_uid);
    return {
      id: episode.episode_code,
      uid: episode.episode_uid,
      active: episode.episode_uid === registry.active_episode_uid,
    };
  });
  if (!episodes.some((episode) => episode.active)) {
    throw new AdminError("STORY_ARTIFACT_CONTRACT_INVALID", "The active Episode binding is invalid", 422);
  }
  return episodes;
}

function validateProjectIdentity(text: string, projectId: string) {
  const declarations = text.match(/^[ \t]*project_id[ \t]*:/gm) ?? [];
  const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(`^project_id:[ \\t]*(?:${escaped}|"${escaped}"|'${escaped}')[ \\t]*$`, "m").test(text);
  const legacy = new RegExp(`^project:[ \\t]*\\r?\\n(?:[ \\t]*(?:#.*)?\\r?\\n)*[ \\t]+project_id:[ \\t]*(?:${escaped}|"${escaped}"|'${escaped}')[ \\t]*$`, "m").test(text);
  if (declarations.length !== 1 || (!direct && !legacy)) {
    throw new AdminError(
      "STORY_ARTIFACT_PROJECT_IDENTITY_INVALID",
      "The Project manifest identity does not match the indexed Story",
      422,
    );
  }
}

async function loadScope(source: StoryArtifactSourceRecord) {
  const root = await canonicalRoot();
  const segments = sourceSegments(source);
  let registryPayload: unknown;
  let projectText: string;
  try {
    const [registryFile, projectFile] = await Promise.all([
      readWholeUtf8(root, segments.registry, MAX_REGISTRY_BYTES),
      readWholeUtf8(root, segments.project, MAX_PROJECT_BYTES),
    ]);
    registryPayload = JSON.parse(registryFile.content);
    projectText = projectFile.content;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AdminError("STORY_ARTIFACT_REGISTRY_INVALID", "The Episode registry is invalid", 422);
    }
    throw error;
  }
  const parsed = episodeRegistrySchema.safeParse(registryPayload);
  if (!parsed.success) {
    throw new AdminError("STORY_ARTIFACT_REGISTRY_INVALID", "The Episode registry is invalid", 422);
  }
  validateProjectIdentity(projectText, source.sourceProjectId);
  const episodes = validateRegistry(parsed.data, source);
  return { root, registry: parsed.data, episodes };
}

function artifactSegments(source: StoryArtifactSourceRecord, episodeId: string, kind: StoryArtifactKind) {
  assertSegment(episodeId, "Episode ID", /^EP[0-9]{2}$/);
  return [
    source.sourceThreadRef,
    "stories",
    source.sourceProjectId,
    "episodes",
    episodeId,
    artifactFileNames[kind],
  ];
}

function revisionOf(buffer: Uint8Array) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function statArtifact(
  root: string,
  source: StoryArtifactSourceRecord,
  episodeId: string,
  kind: StoryArtifactKind,
): Promise<StoryArtifactSurfaceFile> {
  try {
    const file = await readWholeUtf8(root, artifactSegments(source, episodeId, kind), artifactMaxBytes());
    return {
      kind,
      label: artifactLabels[kind],
      fileName: artifactFileNames[kind],
      available: true,
      sizeBytes: file.stat.size,
      updatedAt: file.stat.mtime.toISOString(),
      revision: revisionOf(file.buffer),
    };
  } catch (error) {
    if (error instanceof AdminError && error.status === 404) {
      return {
        kind,
        label: artifactLabels[kind],
        fileName: artifactFileNames[kind],
        available: false,
        sizeBytes: null,
        updatedAt: null,
        revision: null,
      };
    }
    throw error;
  }
}

export async function readStoryArtifactSurface(
  source: StoryArtifactSourceRecord,
): Promise<StoryArtifactSurface> {
  const scope = await loadScope(source);
  const kinds = Object.keys(artifactFileNames) as StoryArtifactKind[];
  const episodes: StoryArtifactSurface["episodes"] = [];
  // Registry size is bounded at 99 Episodes. Read sequentially so a malicious
  // surface cannot multiply the per-file memory ceiling through concurrency.
  for (const episode of scope.episodes) {
    const artifacts: StoryArtifactSurfaceFile[] = [];
    for (const kind of kinds) {
      artifacts.push(await statArtifact(scope.root, source, episode.id, kind));
    }
    episodes.push({ id: episode.id, active: episode.active, artifacts });
  }
  return {
    storyId: source.id,
    projectId: source.sourceProjectId,
    sourceRunId: source.sourceRunId,
    registryRevision: scope.registry.revision,
    indexedScriptRevision: source.indexedScriptRevision,
    episodes,
  };
}

export async function readStoryArtifactPreview(input: {
  source: StoryArtifactSourceRecord;
  episodeId: string;
  kind: StoryArtifactKind;
  offset: number;
  limit: number;
  expectedRevision?: string;
}): Promise<StoryArtifactPreview> {
  const scope = await loadScope(input.source);
  if (!scope.episodes.some((episode) => episode.id === input.episodeId)) {
    throw new AdminError(
      "STORY_ARTIFACT_EPISODE_NOT_FOUND",
      "The requested Episode is not bound to this Story",
      404,
    );
  }
  const file = await openVerified(
    scope.root,
    artifactSegments(input.source, input.episodeId, input.kind),
  );
  try {
    const maxBytes = artifactMaxBytes();
    if (file.stat.size > maxBytes || input.offset > file.stat.size) {
      throw new AdminError(
        "STORY_ARTIFACT_RANGE_TOO_LARGE",
        "The requested Artifact range exceeds the configured limit",
        413,
      );
    }
    const fullBuffer = Buffer.alloc(file.stat.size);
    const fullRead = await file.handle.read(fullBuffer, 0, fullBuffer.length, 0);
    if (fullRead.bytesRead !== fullBuffer.length) {
      throw new AdminError("STORY_ARTIFACT_CHANGED_DURING_READ", "The Artifact changed while it was being read", 409);
    }
    await verifyAfterRead(file);
    const revision = revisionOf(fullBuffer);
    if (input.expectedRevision && input.expectedRevision !== revision) {
      throw new AdminError(
        "STORY_ARTIFACT_REVISION_CONFLICT",
        "The Artifact revision changed; reload its metadata before reading",
        409,
        { currentRevision: revision },
      );
    }
    if (
      input.offset < file.stat.size &&
      (fullBuffer[input.offset] & 0xc0) === 0x80
    ) {
      throw new AdminError(
        "STORY_ARTIFACT_RANGE_INVALID",
        "The Artifact range must begin at a UTF-8 character boundary",
        422,
      );
    }
    let end = Math.min(file.stat.size, input.offset + input.limit);
    while (
      end > input.offset &&
      end < file.stat.size &&
      (fullBuffer[end] & 0xc0) === 0x80
    ) {
      end -= 1;
    }
    const chunk = fullBuffer.subarray(input.offset, end);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(chunk);
    } catch {
      throw new AdminError("STORY_ARTIFACT_ENCODING_INVALID", "The Artifact chunk is not valid UTF-8 text", 422);
    }
    return {
      storyId: input.source.id,
      projectId: input.source.sourceProjectId,
      episodeId: input.episodeId,
      kind: input.kind,
      fileName: artifactFileNames[input.kind],
      content,
      offset: input.offset,
      nextOffset: end < file.stat.size ? end : null,
      totalBytes: file.stat.size,
      truncated: end < file.stat.size,
      updatedAt: file.stat.mtime.toISOString(),
      revision,
      etag: `"${revision}"`,
    };
  } finally {
    await file.handle.close();
  }
}
