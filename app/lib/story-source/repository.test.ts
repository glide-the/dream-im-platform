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
    expect(query.mock.calls[0][0]).not.toContain("story_projects");
    expect(query.mock.calls[0][1]).toEqual(["pending", 20, 0]);
  });

  it("never selects the source password hash", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "7", email: "user@example.com", role: "user" }],
    });

    await queryStorySourceItem("source-users", "7");

    expect(query.mock.calls[0][0]).toContain("FROM users AS u");
    expect(query.mock.calls[0][0]).not.toContain("password_hash");
  });

  it("supports the canonical users resource with status and relation counts", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "7", email: "user@example.com", status: "active", workspace_count: 2, story_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await queryStorySourceList(
      new Request("http://localhost/api/admin/users?filter[status][eq]=active&sort=updated_at&order=desc"),
      "users",
    );

    expect(response.data[0]).toMatchObject({ workspace_count: 2, story_count: 3 });
    expect(query.mock.calls[0][0]).toContain("u.status");
    expect(query.mock.calls[0][0]).not.toContain("password_hash");
    expect(query.mock.calls[0][1]).toEqual(["active", 20, 0]);
  });

  it("maps missing source schema to a recoverable 503", () => {
    const error = storySourceError({ code: "42P01" });
    expect(error.status).toBe(503);
    expect(error.code).toBe("STORY_SOURCE_UNAVAILABLE");
  });
});
