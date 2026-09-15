// [Input] Registered create/retry names at the actual public operation Route.
// [Output] Exact delegation to the closed creation Handler with the original Request.
// [Pos] Thin public dispatch regression; domain/DB contracts are validated independently.
// [Sync] 2026-09-15: verify newly registered operations reach their OAuth creation boundary.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("./workflowRunCreationHandler", async original => ({ ...await original<typeof import("./workflowRunCreationHandler")>(), handleWorkflowRunCreation: mocks.handle }));
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
beforeEach(() => vi.resetAllMocks());
it.each(["workflow-run.create", "workflow-run.retry"])("actual public POST delegates registered %s", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, { method: "POST" }), response = new Response("domain-result");
  mocks.handle.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response); expect(mocks.handle).toHaveBeenCalledExactlyOnceWith(request, operation);
});
