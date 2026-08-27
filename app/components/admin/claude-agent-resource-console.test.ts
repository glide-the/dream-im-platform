import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  fetchClaudeAgentResources,
} from "./ClaudeAgentResourceConsole";

describe("Claude Agent resource console data client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the ten-second refresh contract", () => {
    expect(CLAUDE_AGENT_REFRESH_INTERVAL_MS).toBe(10_000);
  });

  it("passes the React Query cancellation signal to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { application: { status: "unknown" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchClaudeAgentResources(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/claude-agent-resources", expect.objectContaining({ signal: controller.signal }));
  });
});
