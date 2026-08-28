import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock("../../../lib/admin/claude-agent-resources", () => ({
  handleClaudeAgentResourcesGet: mocks.get,
  handleClaudeAgentResourcesPatch: mocks.patch,
}));

import { GET, PATCH } from "./route";

describe("/api/admin/claude-agent-resources", () => {
  it("keeps the route thin for reads and writes", async () => {
    mocks.get.mockResolvedValueOnce(new Response(null, { status: 204 }));
    mocks.patch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const request = new Request("https://admin.test/api/admin/claude-agent-resources");
    expect((await GET(request)).status).toBe(204);
    expect((await PATCH(request)).status).toBe(204);
    expect(mocks.get).toHaveBeenCalledWith(request);
    expect(mocks.patch).toHaveBeenCalledWith(request);
  });
});
