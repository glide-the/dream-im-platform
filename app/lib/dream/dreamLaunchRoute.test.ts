// [Input] Registered launch component names at the production operation Route.
// [Output] Exact source/claim/finish delegation with the original Request.
// [Pos] Public dispatch gate; database and Runtime behavior have separate acceptance.
// [Sync] 2026-09-15: verify75 launch registration reaches the closed OAuth handlers.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn(), dispatch: vi.fn() }));
vi.mock("./dreamLaunchSourceHandler", async original => ({ ...await original<typeof import("./dreamLaunchSourceHandler")>(), handleDreamLaunchSource: mocks.source }));
vi.mock("./dreamLaunchDispatchHandler", async original => ({ ...await original<typeof import("./dreamLaunchDispatchHandler")>(), handleDreamLaunchDispatch: mocks.dispatch }));
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
beforeEach(() => vi.resetAllMocks());
it.each(["dream-launch-source.ensure", "dream-launch-dispatch.claim", "dream-launch-dispatch.finish"])("public POST delegates registered %s", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, { method: "POST" }), response = new Response("domain-result");
  const handler = operation === "dream-launch-source.ensure" ? mocks.source : mocks.dispatch;
  handler.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(handler).toHaveBeenCalledExactlyOnceWith(request, operation);
  expect(operation === "dream-launch-source.ensure" ? mocks.dispatch : mocks.source).not.toHaveBeenCalled();
});
