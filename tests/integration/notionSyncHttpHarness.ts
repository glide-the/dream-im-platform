// [Input] Primary-created private isolated fixture and loopback port.
// [Output] HTTP transport around unchanged production Route Handlers, with explicit response-loss injection.
// [Pos] Technical harness only; no duplicate DTO, authentication, state machine or business API.
// [Sync] 2026-10-07: explicit isolated clock injection and original receipt recovery after response loss.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { NotionSyncRunRepository } from "../../app/lib/dream/notionSyncRunRepository";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { GET as capabilities } from "../../app/api/internal/dream/v1/capabilities/route";
const fixture = JSON.parse(readFileSync(process.env.NOTION_SYNC_VALIDATION_FIXTURE!, "utf8")) as { env: Record<string, string>; port: number; clockShiftAllowed?: boolean; databaseName: string };
Object.assign(process.env, fixture.env);
const clockShift = new AsyncLocalStorage<number>();
// Harness-only dependency injection: retain the actual DB clock query and all
// production transitions. Never enable this on a normal database/server.
if (fixture.clockShiftAllowed) {
  if (!fixture.databaseName.startsWith("ink_notion_sync_ownership_test_")) throw new Error("Named clock isolation required");
  const prototype = NotionSyncRunRepository.prototype as unknown as { clock: () => Promise<Date> };
  const originalClock = prototype.clock;
  prototype.clock = async function () {
    return new Date((await originalClock.call(this)).getTime() + (clockShift.getStore() ?? 0) * 1000);
  };
}
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = `http://127.0.0.1:${fixture.port}${incoming.url}`;
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers(); for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(url, { method: incoming.method, headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const path = new URL(url).pathname;
    const operation = path.match(/^\/api\/internal\/dream\/v1\/operations\/([^/]+)$/);
    const receipt = path.match(/^\/api\/internal\/dream\/v1\/receipts\/([^/]+)$/);
    const rawShift = headers.get("x-harness-clock-offset-seconds");
    const offset = rawShift === null ? 0 : Number(rawShift);
    if (!Number.isSafeInteger(offset) || offset < 0 || (offset !== 0 && !fixture.clockShiftAllowed)) throw new Error("Invalid isolated clock injection");
    const response = await clockShift.run(offset, async () => operation ? await POST(request, { params: Promise.resolve({ operation: operation[1] }) })
      : receipt ? await GET(request, { params: Promise.resolve({ requestId: receipt[1] }) })
      : path === "/api/internal/dream/v1/capabilities" ? await capabilities(request) : new Response("Missing", { status: 404 }));
    if (headers.get("x-harness-drop-response") === "after-commit" && response.ok) { outgoing.destroy(); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end("Transport harness failed"); }
});
server.listen(fixture.port, "127.0.0.1", () => console.log(JSON.stringify({ harness: "notion-sync-production-routes", listening: true, port: fixture.port })));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
