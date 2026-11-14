// [Input] The actual server adapter and application hooks on an owned loopback HTTP harness.
// [Output] Streaming lifetime, identity deduplication, cancellation, privacy and bounded tracking evidence.
// [Pos] Provider-free transport contract; no production API, real account or model is represented.
import { test, expect } from "@playwright/test";
import http from "node:http";
import { once } from "node:events";
import adapter from "../../deploy/observability/capacity-observer.cjs";
import { observeAuthenticatedActor } from "../../app/lib/observability/capacity";

function metricHarness() {
  const callbacks = new Set<(result: unknown) => void>();
  const records: { name: string; value: number; attributes: Record<string, unknown> }[] = [];
  const meter = {
    createCounter: (name: string) => ({ add: (value: number, attributes = {}) => records.push({ name, value, attributes }) }),
    createHistogram: (name: string) => ({ record: (value: number, attributes = {}) => records.push({ name, value, attributes }) }),
    createObservableGauge: (name: string) => ({ name }),
    addBatchObservableCallback: (callback: (result: unknown) => void) => callbacks.add(callback),
    removeBatchObservableCallback: (callback: (result: unknown) => void) => callbacks.delete(callback),
  };
  return {
    meter, records,
    collect() {
      const values: typeof records = [];
      for (const callback of callbacks) callback({ observe: (instrument: { name: string }, value: number, attributes = {}) => values.push({ name: instrument.name, value, attributes }) });
      return values;
    },
  };
}

function value(rows: ReturnType<ReturnType<typeof metricHarness>["collect"]>, name: string, domain?: string) {
  return rows.find(row => row.name === name && (!domain || row.attributes.domain === domain))?.value;
}

test("counts two authenticated SSE lifetimes and one user until actual HTTP finish", async ({ request }) => {
  const metrics = metricHarness();
  const observer = adapter.createCapacityObserver({ meter: metrics.meter, policy: { activeWindowMs: 300_000, maxTrackedUsers: 8 } });
  const dispose = observer.install(http);
  const held: http.ServerResponse[] = [];
  let reached: () => void;
  const both = new Promise<void>(resolve => { reached = resolve; });
  const server = http.createServer((_req, response) => {
    observeAuthenticatedActor("gateway", "private-synthetic-account");
    observeAuthenticatedActor("gateway", "private-synthetic-account");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: held\n\n");
    held.push(response);
    if (held.length === 2) reached();
  });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const first = request.get(`http://127.0.0.1:${port}/v1/chat/completions?credential=not-a-label`);
    const second = request.get(`http://127.0.0.1:${port}/v1/chat/completions`);
    await both;
    const active = metrics.collect();
    expect(value(active, "ink_requests_inflight", "gateway")).toBe(2);
    expect(value(active, "ink_users_active", "gateway")).toBe(1);
    expect(value(active, "ink_account_inflight_max", "gateway")).toBe(2);
    expect(value(active, "ink_capacity_window_ready")).toBe(0);
    for (const response of held) response.end("data: [DONE]\n\n");
    expect((await Promise.all([first, second])).every(response => response.ok())).toBeTruthy();
    const done = metrics.collect();
    expect(value(done, "ink_requests_inflight", "gateway")).toBe(0);
    expect(value(done, "ink_account_inflight_max", "gateway")).toBe(0);
    expect(value(done, "ink_users_active", "gateway")).toBe(1);
    expect(metrics.records.filter(row => row.name === "ink_requests_completed_total")).toHaveLength(2);
    expect(JSON.stringify([...active, ...done, ...metrics.records])).not.toContain("private-synthetic-account");
    expect(JSON.stringify([...active, ...done, ...metrics.records])).not.toContain("credential=");
  } finally {
    for (const response of held) response.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); dispose();
  }
});

test("releases cancelled HTTP requests and reports actor-budget overflow rather than silently truncating", async () => {
  const metrics = metricHarness();
  const observer = adapter.createCapacityObserver({ meter: metrics.meter, policy: { activeWindowMs: 300_000, maxTrackedUsers: 1 } });
  const dispose = observer.install(http);
  let closed: () => void;
  const cancelled = new Promise<void>(resolve => { closed = resolve; });
  const server = http.createServer((req, response) => {
    observeAuthenticatedActor("gateway", req.url?.includes("second") ? "second-synthetic" : "first-synthetic");
    if (req.url?.includes("second")) { response.end("done"); return; }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: pending\n\n");
    response.once("close", closed);
  });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => {
      const client = http.get(`http://127.0.0.1:${port}/v1/messages`, response => response.once("data", () => { client.destroy(); resolve(); }));
      client.once("error", reject);
    });
    await cancelled;
    await new Promise<void>((resolve, reject) => http.get(`http://127.0.0.1:${port}/v1/messages?second=1`, response => { response.resume(); response.once("end", resolve); }).once("error", reject));
    const rows = metrics.collect();
    expect(value(rows, "ink_requests_inflight", "gateway")).toBe(0);
    expect(value(rows, "ink_capacity_observation_complete")).toBe(0);
    expect(metrics.records.some(row => row.name === "ink_observations_dropped_total")).toBeTruthy();
    expect(metrics.records.filter(row => row.name === "ink_requests_completed_total" && row.attributes.outcome === "cancelled")).toHaveLength(1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); dispose();
  }
});
