import { beforeEach, describe, expect, it, vi } from "vitest";

const storyQuery = vi.fn();

vi.mock("../admin/guard", () => ({
  adminRequestId: () => "request-test",
  assertAdminMutationOrigin: () => undefined,
  requireAdminRequest: async () => ({
    id: "admin-1",
    email: "operator@example.com",
    displayName: "Operator",
    roles: ["operator"],
    permissions: ["story.read", "story.write"],
  }),
}));

vi.mock("../admin/audit", () => ({
  recordAdminAuditOnClient: async (client: { query: typeof storyQuery }) =>
    await client.query("INSERT AUDIT"),
}));

vi.mock("./db", () => ({
  withStoryTransaction: async (
    handler: (client: { query: typeof storyQuery }) => Promise<unknown>,
  ) => await handler({ query: storyQuery }),
  withStoryClient: async (
    handler: (client: { query: typeof storyQuery }) => Promise<unknown>,
  ) => await handler({ query: storyQuery }),
}));

import {
  handleStorySourceAction,
  handleStorySourceCreate,
  handleStorySourceUpdate,
} from "./mutations";

describe("Story source mutations", () => {
  beforeEach(() => {
    storyQuery.mockReset();
  });

  it("updates only source workspace fields and records control-plane audit", async () => {
    storyQuery
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "旧名称", owner_id: 7 }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "新名称", owner_id: 7 }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "新名称", owner_id: "7" }],
      })
      .mockResolvedValueOnce({
        rows: [{ stories: "2", latest_story_at: "2026-08-08T00:00:00Z" }],
      });

    const response = await handleStorySourceUpdate(
      new Request("http://localhost/api/admin/story-workspaces/workspace-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "新名称" }),
      }),
      "story-workspaces",
      "workspace-1",
    );

    expect(response.status).toBe(200);
    expect(storyQuery.mock.calls[0][0]).toContain(
      "story_workspace_workspaces",
    );
    expect(storyQuery.mock.calls[1][0]).toContain("SET name = $2");
    expect(storyQuery.mock.calls[1][0]).not.toContain("story_workspaces");
    expect(storyQuery.mock.calls[3][0]).toBe("INSERT AUDIT");
  });

  it("confirms only the canonical story and records an audit", async () => {
    storyQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "story-1",
            author_id: 7,
            agent_generated: 1,
            review_status: "pending",
            status: "draft",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-1", review_status: "confirmed", status: "published" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-1", review_status: "confirmed", status: "published" }],
      });

    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      "story-stories",
      "story-1",
      "confirm",
    );

    expect(response.status).toBe(200);
    expect(storyQuery.mock.calls[1][0]).toContain("story_workspace_stories");
    expect(storyQuery.mock.calls[3][0]).toBe("INSERT AUDIT");
    expect(storyQuery.mock.calls.flatMap((call) => call[0])).not.toContain(
      "story_workspace_story_characters",
    );
  });

  it("keeps workspace creation in the product workflow", async () => {
    const response = await handleStorySourceCreate(
      new Request("http://localhost/api/admin/story-workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: 7, name: "运营工作区", settings: {} }),
      }),
      "story-workspaces",
    );

    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("STORY_SOURCE_CREATE_DENIED");
    expect(storyQuery).not.toHaveBeenCalled();
  });

  it("rejects user status writes because the canonical users table has no status field", async () => {
    const response = await handleStorySourceUpdate(
      new Request("http://localhost/api/admin/users/7", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      }),
      "users",
      "7",
    );

    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("STORY_SOURCE_UPDATE_DENIED");
    expect(storyQuery).not.toHaveBeenCalled();
  });

  it("rejects parallel CRUD creation with 405", async () => {
    const response = await handleStorySourceCreate(
      new Request("http://localhost/api/admin/story-stories", {
        method: "POST",
      }),
      "story-stories",
    );
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe(
      "STORY_SOURCE_CREATE_DENIED",
    );
  });
});
