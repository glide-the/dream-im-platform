import "server-only";

import { AdminError, adminErrorResponse } from "../admin/errors";
import { adminRequestId, requireAdminRequest } from "../admin/guard";
import { queryStoryArtifactSourceRecord } from "../story-source/repository";
import { storyArtifactPreviewQuerySchema } from "./contracts";
import {
  readStoryArtifactPreview,
  readStoryArtifactSurface,
} from "./reader";

function artifactError(error: unknown) {
  if (error instanceof AdminError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (["ENOENT", "ENOTDIR"].includes(code)) {
    return new AdminError(
      "STORY_ARTIFACT_NOT_FOUND",
      "The requested Artifact does not exist",
      404,
    );
  }
  if (["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE"].includes(code)) {
    return new AdminError(
      "STORY_ARTIFACT_STORE_UNAVAILABLE",
      "The shared Artifact filesystem is unavailable",
      503,
    );
  }
  return new AdminError(
    "STORY_ARTIFACT_READ_FAILED",
    "The Artifact could not be read safely",
    500,
  );
}

export async function handleStoryArtifactSurface(request: Request, storyId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "story.read");
    const source = await queryStoryArtifactSourceRecord(storyId);
    const data = await readStoryArtifactSurface(source);
    return Response.json(
      { data },
      { headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(artifactError(error), requestId);
  }
}

export async function handleStoryArtifactPreview(request: Request, storyId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "story.read");
    const url = new URL(request.url);
    const parsed = storyArtifactPreviewQuerySchema.safeParse({
      episodeId: url.searchParams.get("episodeId"),
      kind: url.searchParams.get("kind"),
      offset: url.searchParams.get("offset") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      revision: url.searchParams.get("revision") ?? undefined,
    });
    if (!parsed.success) {
      throw new AdminError(
        "STORY_ARTIFACT_QUERY_INVALID",
        "The Artifact preview query is invalid",
        422,
      );
    }
    const source = await queryStoryArtifactSourceRecord(storyId);
    const data = await readStoryArtifactPreview({
      source,
      episodeId: parsed.data.episodeId,
      kind: parsed.data.kind,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
      expectedRevision: parsed.data.revision,
    });
    if (request.headers.get("if-none-match") === data.etag) {
      return new Response(null, {
        status: 304,
        headers: { etag: data.etag, "cache-control": "private, no-cache", "x-request-id": requestId },
      });
    }
    return Response.json(
      { data },
      { headers: { etag: data.etag, "cache-control": "private, no-cache", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(artifactError(error), requestId);
  }
}
