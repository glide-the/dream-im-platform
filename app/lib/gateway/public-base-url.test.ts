import { describe, expect, it } from "vitest";
import { resolveGatewayBaseUrl } from "./public-base-url";

describe("resolveGatewayBaseUrl", () => {
  it("uses the incoming Host when the server binds to a wildcard address", () => {
    const request = new Request("http://0.0.0.0:3012/api/admin/gateway-api-keys", {
      headers: { host: "127.0.0.1:3012" },
    });

    expect(resolveGatewayBaseUrl(request)).toBe("http://127.0.0.1:3012");
  });

  it("uses the first trusted proxy-facing host and protocol values", () => {
    const request = new Request("http://10.0.0.8:3000/api/admin/gateway-api-keys", {
      headers: {
        host: "10.0.0.8:3000",
        "x-forwarded-host": "gateway.ink-memory.example, edge.internal",
        "x-forwarded-proto": "https, http",
      },
    });

    expect(resolveGatewayBaseUrl(request)).toBe("https://gateway.ink-memory.example");
  });

  it("ignores unsupported forwarded protocols", () => {
    const request = new Request("https://gateway.example/api/admin/gateway-api-keys", {
      headers: {
        host: "gateway.example",
        "x-forwarded-proto": "javascript",
      },
    });

    expect(resolveGatewayBaseUrl(request)).toBe("https://gateway.example");
  });
});
