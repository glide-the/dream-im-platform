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
    const revision = `sha256:${"a".repeat(64)}`;
    storyQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "story-1",
            author_id: 7,
            agent_generated: 1,
            review_status: "pending",
            status: "draft",
            script_revision: revision,
            reviewed_script_revision: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-1", review_status: "confirmed", status: "draft", script_revision: revision, reviewed_script_revision: revision }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-1", review_status: "confirmed", status: "published" }],
      });

    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedScriptRevision: revision }),
      }),
      "story-stories",
      "story-1",
      "confirm",
    );

    expect(response.status).toBe(200);
    expect(storyQuery.mock.calls[1][0]).toContain("story_workspace_stories");
    expect(storyQuery.mock.calls[1][0]).toContain("reviewed_script_revision = script_revision");
    expect(storyQuery.mock.calls[1][0]).not.toContain("status = 'published'");
    expect(storyQuery.mock.calls[3][0]).toBe("INSERT AUDIT");
    expect(storyQuery.mock.calls.flatMap((call) => call[0])).not.toContain(
      "story_workspace_story_characters",
    );
  });

  it("rejects the current Story revision and clears confirmed_at", async () => {
    const revision = `sha256:${"c".repeat(64)}`;
    storyQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "story-2",
          agent_generated: 1,
          review_status: "pending",
          status: "draft",
          script_revision: revision,
          reviewed_script_revision: null,
          confirmed_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: "story-2",
          review_status: "rejected",
          status: "draft",
          script_revision: revision,
          reviewed_script_revision: revision,
          confirmed_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-2", review_status: "rejected", status: "draft" }],
      });

    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-2/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedScriptRevision: revision,
          reviewNotes: "结构冲突需重写",
        }),
      }),
      "story-stories",
      "story-2",
      "reject",
    );

    expect(response.status).toBe(200);
    expect(storyQuery.mock.calls[1][0]).toContain(
      "reviewed_script_revision = script_revision",
    );
    expect(storyQuery.mock.calls[1][0]).toContain("confirmed_at = NULL");
    expect(storyQuery.mock.calls[3][0]).toBe("INSERT AUDIT");
  });

  it("requires review notes when rejecting a Story", async () => {
    const revision = `sha256:${"d".repeat(64)}`;
    storyQuery.mockResolvedValueOnce({
      rows: [{
        id: "story-3",
        agent_generated: 1,
        review_status: "pending",
        status: "draft",
        script_revision: revision,
      }],
    });

    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-3/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedScriptRevision: revision }),
      }),
      "story-stories",
      "story-3",
      "reject",
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      "STORY_ARTIFACT_REVIEW_NOTES_REQUIRED",
    );
    expect(storyQuery).toHaveBeenCalledTimes(1);
  });

  it("replays an exact Story review request without a second mutation or audit", async () => {
    const revision = `sha256:${"e".repeat(64)}`;
    storyQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "story-4",
          agent_generated: 1,
          review_status: "confirmed",
          status: "draft",
          script_revision: revision,
          reviewed_script_revision: revision,
          review_notes: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: "story-4", review_status: "confirmed", status: "draft" }],
      });

    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-4/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "review-replay-1",
        },
        body: JSON.stringify({ expectedScriptRevision: revision }),
      }),
      "story-stories",
      "story-4",
      "confirm",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    expect(storyQuery.mock.calls[1][0]).toContain("admin_audit_logs");
    expect(storyQuery.mock.calls.map((call) => call[0])).not.toContain(
      "INSERT AUDIT",
    );
    expect(storyQuery.mock.calls.map((call) => call[0]).join("\n")).not.toContain(
      "UPDATE story_workspace_stories",
    );
  });

  it("rejects Story metadata PATCH because Dream owns the canonical Story", async () => {
    const response = await handleStorySourceUpdate(
      new Request("http://localhost/api/admin/story-stories/story-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Admin 不应改写" }),
      }),
      "story-stories",
      "story-1",
    );

    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("STORY_SOURCE_UPDATE_DENIED");
    expect(storyQuery).not.toHaveBeenCalled();
  });

  it("rejects review when the indexed script revision has changed", async () => {
    storyQuery.mockResolvedValueOnce({
      rows: [{
        id: "story-1",
        agent_generated: 1,
        review_status: "pending",
        status: "draft",
        script_revision: `sha256:${"b".repeat(64)}`,
      }],
    });
    const response = await handleStorySourceAction(
      new Request("http://localhost/api/admin/story-stories/story-1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedScriptRevision: `sha256:${"a".repeat(64)}` }),
      }),
      "story-stories",
      "story-1",
      "confirm",
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("STORY_ARTIFACT_REVISION_CONFLICT");
    expect(storyQuery).toHaveBeenCalledTimes(1);
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
