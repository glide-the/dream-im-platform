import { beforeEach, describe, expect, it, vi } from "vitest";

const storyQuery = vi.fn();
const auditQuery = vi.fn();

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
  recordAdminAuditOnClient: async (client: { query: typeof auditQuery }) =>
    await client.query("INSERT AUDIT"),
}));

vi.mock("../platform-db", () => ({
  withPlatformTransaction: async (
    handler: (client: { query: typeof auditQuery }) => Promise<unknown>,
  ) => await handler({ query: auditQuery }),
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
    auditQuery.mockReset().mockResolvedValue({ rows: [] });
  });

  it("updates only source workspace fields and records control-plane audit", async () => {
    storyQuery
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "旧名称", owner_id: 7 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "新名称", owner_id: 7 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "workspace-1", name: "新名称", owner_id: "7" }],
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
    expect(auditQuery).toHaveBeenCalledWith("INSERT AUDIT");
  });

  it("confirms a source story and cascades through the real bridge relation", async () => {
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-1", review_status: "confirmed", status: "published" }],
      })
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
    expect(storyQuery.mock.calls[2][0]).toContain("story_workspace_scenes");
    expect(storyQuery.mock.calls[3][0]).toContain(
      "story_workspace_story_characters",
    );
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
