import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminError } from "../admin/errors";

vi.mock("server-only", () => ({}));

const {
  requireAdminRequest,
  queryStoryArtifactSourceRecord,
  readStoryArtifactSurface,
  readStoryArtifactPreview,
} = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  queryStoryArtifactSourceRecord: vi.fn(),
  readStoryArtifactSurface: vi.fn(),
  readStoryArtifactPreview: vi.fn(),
}));

vi.mock("../admin/guard", () => ({
  adminRequestId: () => "admin_test",
  requireAdminRequest,
}));

vi.mock("../story-source/repository", () => ({
  queryStoryArtifactSourceRecord,
}));

vi.mock("./reader", () => ({
  readStoryArtifactSurface,
  readStoryArtifactPreview,
}));

import {
  handleStoryArtifactPreview,
  handleStoryArtifactSurface,
} from "./service";

describe("Story Artifact Admin service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequest.mockResolvedValue({ id: "admin-1" });
    queryStoryArtifactSourceRecord.mockResolvedValue({ id: "story-1" });
  });

  it("requires story.read before resolving internal Artifact references", async () => {
    requireAdminRequest.mockRejectedValue(
      new AdminError("ADMIN_AUTH_REQUIRED", "login", 401),
    );
    const response = await handleStoryArtifactSurface(
      new Request("http://localhost/api/admin/story-stories/story-1/artifact-surface"),
      "story-1",
    );

    expect(response.status).toBe(401);
    expect(requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "story.read");
    expect(queryStoryArtifactSourceRecord).not.toHaveBeenCalled();
  });

  it("returns a private no-store surface without exposing source paths", async () => {
    readStoryArtifactSurface.mockResolvedValue({
      storyId: "story-1",
      projectId: "project-safe",
      episodes: [],
    });
    const response = await handleStoryArtifactSurface(
      new Request("http://localhost/api/admin/story-stories/story-1/artifact-surface"),
      "story-1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual({ storyId: "story-1", projectId: "project-safe", episodes: [] });
  });

  it("honors ETag with 304 and validates the allowlisted query contract", async () => {
    const revision = `sha256:${"a".repeat(64)}`;
    readStoryArtifactPreview.mockResolvedValue({
      storyId: "story-1",
      content: "safe",
      etag: `"${revision}"`,
      revision,
    });
    const response = await handleStoryArtifactPreview(
      new Request(
        `http://localhost/api/admin/story-stories/story-1/artifacts?episodeId=EP01&kind=script&offset=0&limit=64&revision=${revision}`,
        { headers: { "if-none-match": `"${revision}"` } },
      ),
      "story-1",
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${revision}"`);
    expect(readStoryArtifactPreview).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: "EP01", kind: "script", offset: 0, limit: 64 }),
    );

    const invalid = await handleStoryArtifactPreview(
      new Request(
        "http://localhost/api/admin/story-stories/story-1/artifacts?episodeId=../../etc&kind=secret",
      ),
      "story-1",
    );
    expect(invalid.status).toBe(422);
    expect(queryStoryArtifactSourceRecord).toHaveBeenCalledTimes(1);
  });
});
