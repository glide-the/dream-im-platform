// [Input] The production operation route with in-memory Next request and child spans.
// [Output] Concrete names for registered operations and a bounded fallback for unknown names.
// [Pos] Provider-free trace naming and dispatch contract.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { context, ROOT_CONTEXT, SpanStatusCode, trace, type Span } from "next/dist/compiled/@opentelemetry/api";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { POST as resourcePolicyRead } from "../../api/internal/dream/v1/operations/resource-policy.read/route";
import { withDataTransaction, type DataDatabase } from "../dream/database";
import { getDreamOperationTrace } from "../dream/operationRegistry";
import { registerDreamOperationTrace, traceDreamOperationHandler, traceDreamOperationStep } from "./dreamOperationTrace";

const mocks = vi.hoisted(() => ({ tracer: vi.fn(), resolve: vi.fn(), fallback: vi.fn(), service: vi.fn() }));
vi.mock("next/dist/server/lib/trace/tracer", () => ({ getTracer: mocks.tracer }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("next/dist/compiled/@opentelemetry/api", async original => {
  const api = await original<typeof import("next/dist/compiled/@opentelemetry/api")>();
  return {
    ...api,
    context: { active: vi.fn(), with: vi.fn() },
    trace: { getActiveSpan: vi.fn(), getTracer: vi.fn() },
  };
});
vi.mock("../dream/deckDefaultPluginResolveHandler", async original => ({
  ...await original<typeof import("../dream/deckDefaultPluginResolveHandler")>(),
  handleDeckDefaultPluginResolve: mocks.resolve,
}));
vi.mock("../dream/chatThreadHandler", async original => ({
  ...await original<typeof import("../dream/chatThreadHandler")>(), handleChatThreadOperation: mocks.fallback,
}));

const prefix = "/api/internal/dream/v1/operations/";
const template = `${prefix}[operation]`;
const attributes = new Map<string, string>();
const span = { isRecording: () => true, setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
const startActiveSpan = vi.fn((_name, _options, invoke: (child: Span) => unknown) => invoke(span as unknown as Span));
let activeContext = ROOT_CONTEXT;
let server: { getRootSpanAttributes: () => Map<string, string>; trace: (...args: unknown[]) => unknown };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockResolvedValue({ id: "trace-fixture" });
  attributes.clear();
  attributes.set("next.route", template);
  activeContext = ROOT_CONTEXT;
  vi.mocked(context.active).mockImplementation(() => activeContext);
  vi.mocked(context.with).mockImplementation((scope, fn, thisArg, ...args) => {
    activeContext = scope;
    return fn.apply(thisArg, args);
  });
  vi.mocked(trace.getActiveSpan).mockReturnValue(span as unknown as Span);
  startActiveSpan.mockImplementation((_name, _options, invoke) => invoke(span as unknown as Span));
  vi.mocked(trace.getTracer).mockReturnValue({ startActiveSpan } as unknown as ReturnType<typeof trace.getTracer>);
  server = { getRootSpanAttributes: () => attributes, trace: (_type, _options, invoke) => (invoke as (active: typeof span) => unknown)(span) };
  mocks.tracer.mockReturnValue(server);
  registerDreamOperationTrace();
});
afterEach(() => vi.unstubAllEnvs());

function callRoute(request: Request, operation: string, invoke = () => POST(request, { params: Promise.resolve({ operation }) })): Promise<Response> {
  const options = { attributes: { "http.method": request.method, "http.target": new URL(request.url).pathname } };
  return server.trace("BaseServer.handleRequest", options, invoke) as Promise<Response>;
}

it.each([200, 403])("names the registered operation and preserves status %i", async status => {
  const operation = "deck.default-plugin.resolve";
  const route = prefix + operation;
  const request = new Request(`http://admin.test${route}?opaque=excluded`, { method: "POST" });
  const response = new Response(null, { status });
  mocks.resolve.mockResolvedValue(response);

  expect(await callRoute(request, operation)).toBe(response);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(request, operation);
  expect(attributes.get("next.route")).toBe(route);
  expect(span.setAttribute).toHaveBeenCalledExactlyOnceWith("ink.dream.operation", operation);
  expect(startActiveSpan).toHaveBeenCalledExactlyOnceWith("handleDeckDefaultPluginResolve", {
    attributes: {
      "ink.dream.operation": operation,
      "code.function.name": "handleDeckDefaultPluginResolve",
      "code.file.path": "app/lib/dream/deckDefaultPluginResolveHandler.ts",
    },
  }, expect.any(Function));
});

it("keeps the shared template for unregistered path input", async () => {
  const operation = "unregistered.private-token";
  const request = new Request(`http://admin.test${prefix}${operation}`, { method: "POST" });
  const response = new Response(null, { status: 404 });
  mocks.fallback.mockResolvedValue(response);

  expect(await callRoute(request, operation)).toBe(response);
  expect(attributes.get("next.route")).toBe(template);
  expect(span.setAttribute).not.toHaveBeenCalled();
  expect(startActiveSpan).not.toHaveBeenCalled();
});

it("dispatches the original request without an active probe", async () => {
  const operation = "deck.default-plugin.resolve";
  const request = new Request(`http://admin.test${prefix}${operation}`, { method: "POST" });
  const response = new Response(null, { status: 200 });
  mocks.resolve.mockResolvedValue(response);
  vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(request, operation);
  expect(startActiveSpan).not.toHaveBeenCalled();
});

it("ends the child span and forwards an operation exception without recording its message", async () => {
  const error = new Error("detail to exclude");
  const run = vi.fn().mockRejectedValue(error);
  await expect(traceDreamOperationHandler(getDreamOperationTrace("deck.default-plugin.resolve"),
    "handleDeckDefaultPluginResolve", "app/lib/dream/deckDefaultPluginResolveHandler.ts",
    () => traceDreamOperationStep("parseAuthDto", "app/lib/auth/internalHandler.ts", run, true))).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
  expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
  expect(span.end).toHaveBeenCalledTimes(2);
});

it.each([
  ["scheduled-task.v3.create", "handleChatScheduledTaskOperation", 'chatScheduledTaskV3OperationContracts["scheduled-task.v3.create"].input', "chatScheduledTaskDto"],
  ["managed-mcp.servers.list", "handleManagedMcp", 'managedMcpOperationContracts["managed-mcp.servers.list"].input', "managedMcpDto"],
  ["resource-policy.read", "handleResourcePolicyRead", "resourcePolicyReadInputDto", "resourceDto"],
])("traces the actual handler and DTO of %s", async (operation, handler, dtoName, dtoFile) => {
  const request = new Request(`http://admin.test${prefix}${operation}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  const invoke = operation === "resource-policy.read" ? () => resourcePolicyRead(request) : undefined;
  expect((await callRoute(request, operation, invoke)).status).toBe(400);
  expect(startActiveSpan.mock.calls.map(([name]) => name)).toEqual([handler, "requireDreamService", "parseAuthDto"]);
  expect(startActiveSpan).toHaveBeenLastCalledWith("parseAuthDto", {
    attributes: {
      "ink.dream.operation": operation,
      "code.function.name": "parseAuthDto",
      "code.file.path": "app/lib/auth/internalHandler.ts",
      "ink.dream.dto.name": dtoName,
      "ink.dream.dto.file": `app/lib/dream/${dtoFile}.ts`,
    },
  }, expect.any(Function));
});

it("traces the actual transaction and batch capability check for an operation", async () => {
  const operation = getDreamOperationTrace("managed-mcp.servers.list");
  const capability = { capability: "fixture", version: 1, contractSha256: "a".repeat(64) };
  const query = vi.fn().mockResolvedValue([capability]);
  const transaction = { select: () => ({ from: () => ({ where: query }) }) };
  const database = { transaction: (invoke: (tx: typeof transaction) => unknown) => invoke(transaction) } as unknown as DataDatabase;
  const result = await traceDreamOperationHandler(operation, "handleManagedMcp", "app/lib/dream/managedMcpHandler.ts",
    () => withDataTransaction([capability], async () => "result", database));
  expect(result).toBe("result");
  expect(query).toHaveBeenCalledTimes(1);
  expect(startActiveSpan.mock.calls.map(([name]) => name)).toEqual([
    "handleManagedMcp", "withDataTransaction", "readSchemaCapabilities",
  ]);
});
