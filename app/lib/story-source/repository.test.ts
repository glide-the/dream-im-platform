import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./db", () => ({
  withStoryClient: async (handler: (client: { query: typeof query }) => Promise<unknown>) =>
    await handler({ query }),
}));

import {
  queryStorySourceItem,
  queryStorySourceList,
  storySourceError,
} from "./repository";

describe("Story PostgreSQL repository", () => {
  beforeEach(() => query.mockReset());

  it("lists the real source story table with whitelisted filters and total", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "story-1", title: "真实剧本" }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await queryStorySourceList(
      new Request(
        "http://localhost/api/admin/story-stories?page=1&pageSize=20&filter[review_status][eq]=pending",
      ),
      "story-stories",
    );

    expect(response.meta.total).toBe(1);
    expect(response.data[0]).toMatchObject({ id: "story-1" });
    expect(query.mock.calls[0][0]).toContain("story_workspace_stories AS s");
    expect(query.mock.calls[0][0]).toContain("LEFT JOIN users AS u");
    expect(query.mock.calls[0][0]).toContain("LEFT JOIN platform_users AS pu");
    expect(query.mock.calls[0][0]).toContain("char_length(s.content)");
    expect(query.mock.calls[0][0]).toContain("s.artifact_sync_status");
    expect(query.mock.calls[0][0]).not.toContain("s.source_thread_ref");
    expect(query.mock.calls[0][0]).not.toContain("s.type, s.content,");
    expect(query.mock.calls[0][0]).not.toContain("story_projects");
    expect(query.mock.calls[0][1]).toEqual(["pending", 20, 0]);
  });

  it("filters and counts Artifact health from PostgreSQL only", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "story-1", artifact_sync_status: "indexed" }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await queryStorySourceList(
      new Request(
        "http://localhost/api/admin/story-stories?filter[artifact_sync_status][eq]=indexed&filter[artifact_available][eq]=true&sort=artifact_indexed_at&order=desc",
      ),
      "story-stories",
    );

    expect(response.meta.total).toBe(1);
    expect(query.mock.calls[0][0]).toContain("s.artifact_sync_status = $1");
    expect(query.mock.calls[0][0]).toContain("s.artifact_available::text = $2");
    expect(query.mock.calls[1][0]).toContain("s.artifact_sync_status = $1");
    expect(query.mock.calls[1][1]).toEqual(["indexed", "true"]);
  });

  it("never selects the source password hash", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "7", email: "user@example.com", role: "user" }],
    });

    await queryStorySourceItem("source-users", "7");

    expect(query.mock.calls[0][0]).toContain("FROM users AS u");
    expect(query.mock.calls[0][0]).not.toContain("password_hash");
  });

  it("supports canonical users without inventing status and includes relation counts", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "7", email: "user@example.com", workspace_count: 2, story_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await queryStorySourceList(
      new Request("http://localhost/api/admin/users?sort=updated_at&order=desc"),
      "users",
    );

    expect(response.data[0]).toMatchObject({ workspace_count: 2, story_count: 3 });
    expect(query.mock.calls[0][0]).not.toContain("u.status");
    expect(query.mock.calls[0][0]).not.toContain("password_hash");
    expect(query.mock.calls[0][1]).toEqual([20, 0]);
  });

  it("maps missing source schema to a recoverable 503", () => {
    const error = storySourceError({ code: "42P01" });
    expect(error.status).toBe(503);
    expect(error.code).toBe("STORY_SOURCE_UNAVAILABLE");
  });

  it("supports status and updated range filters without changing count predicates", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "workspace-1", status: "active" }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    await queryStorySourceList(
      new Request(
        "http://localhost/api/admin/story-workspaces?filter[status][eq]=active&filter[updated_at][gte]=2026-08-01T00%3A00%3A00.000Z",
      ),
      "story-workspaces",
    );

    expect(query.mock.calls[0][0]).toContain("w.status = $1");
    expect(query.mock.calls[0][0]).toContain("w.updated_at >= $2");
    expect(query.mock.calls[1][0]).toContain("w.status = $1");
    expect(query.mock.calls[1][0]).toContain("w.updated_at >= $2");
    expect(query.mock.calls[0][1]).toEqual([
      "active",
      "2026-08-01T00:00:00.000Z",
      20,
      0,
    ]);
    expect(query.mock.calls[1][1]).toEqual([
      "active",
      "2026-08-01T00:00:00.000Z",
    ]);
  });
});
