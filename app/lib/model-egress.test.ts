// [Input] Controlled PostgreSQL policy and local HTTP proxy, without real credentials or model calls.
// [Output] Routing, cancellation, invalid configuration and safe failure evidence.
// [Pos] Provider-free shared transport contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./platform-db", () => ({ withPlatformClient: async (fn: (c: { query: typeof mocks.query }) => unknown) => fn({ query: mocks.query }) }));
import { modelEgressFetch, modelEgressProxyUrl, readModelEgressPolicy } from "./model-egress";

beforeEach(() => { mocks.query.mockResolvedValue({ rows: [] }); vi.stubEnv("MODEL_EGRESS_PROXY_URL", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("model network policy", () => {
  it("preserves the original network by default and exposes no endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("original")); vi.stubGlobal("fetch", fetcher);
    const init = { method: "POST", body: "original body" };
    await modelEgressFetch("https://upstream.invalid", init);
    expect(fetcher).toHaveBeenCalledWith("https://upstream.invalid", init);
    expect(await readModelEgressPolicy({ query: mocks.query } as never)).toEqual({ defaultEnabled: false, desiredEnabled: false, effectiveEnabled: false, configured: false, revision: null, status: "disabled" });
  });
  it.each(["http://external.invalid:1234", "http://secret@127.0.0.1:1234", "http://127.0.0.1:1234/path", "socks5://localhost:1234", "http://127.0.0.1:1234?secret=1"])("rejects unsafe endpoint %s without echoing it", (url) => {
    expect(() => modelEgressProxyUrl({ MODEL_EGRESS_PROXY_URL: url })).toThrow("本机 Docker NAT 代理配置无效");
  });
  it("fails closed if enabled configuration disappears or the database fails", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    mocks.query.mockResolvedValue({ rows: [{ value: { enabled: true, revision: 1 }, status: "active", is_secret: false }] });
    await expect(modelEgressFetch("https://upstream.invalid")).rejects.toMatchObject({ code: "MODEL_EGRESS_PROXY_UNAVAILABLE" });
    expect((await readModelEgressPolicy({ query: mocks.query } as never)).status).toBe("unavailable");
    mocks.query.mockRejectedValue(new Error("private DSN"));
    await expect(modelEgressFetch("https://upstream.invalid")).rejects.toThrow("暂时无法读取模型网络配置");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not read configuration or dispatch an already-aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    mocks.query.mockClear();
    await expect(modelEgressFetch("https://upstream.invalid", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("honors cancellation while the policy read is still pending", async () => {
    mocks.query.mockImplementationOnce(() => new Promise(() => undefined));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const pending = modelEgressFetch("https://upstream.invalid", { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("routes real HTTP through CONNECT then restores the original path after disabling", async () => {
    const upstream = createServer((_request, response) => response.end("upstream"));
    const proxy = createServer((_request, response) => response.end("proxy"));
    const tunnels: string[] = [];
    proxy.on("connect", (request, socket, head) => {
      tunnels.push(request.url ?? "");
      const target = connect((upstream.address() as AddressInfo).port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        target.write(head); target.pipe(socket); socket.pipe(target);
      });
      target.on("error", () => socket.destroy()); socket.on("error", () => target.destroy());
    });
    upstream.listen(0, "127.0.0.1"); proxy.listen(0, "127.0.0.1");
    await Promise.all([once(upstream, "listening"), once(proxy, "listening")]);
    try {
      vi.stubEnv("MODEL_EGRESS_PROXY_URL", `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
      mocks.query.mockResolvedValue({ rows: [{ value: { enabled: true, revision: 1 }, status: "active", is_secret: false }] });
      const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      expect(await (await modelEgressFetch(url)).text()).toBe("upstream");
      expect(tunnels).toHaveLength(1);
      mocks.query.mockResolvedValue({ rows: [{ value: { enabled: false, revision: 2 }, status: "active", is_secret: false }] });
      expect(await (await modelEgressFetch(url)).text()).toBe("upstream");
      expect(tunnels).toHaveLength(1);
    } finally { proxy.closeAllConnections(); upstream.closeAllConnections(); proxy.close(); upstream.close(); }
  });
});
