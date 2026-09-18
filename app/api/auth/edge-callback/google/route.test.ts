// [Input] A relay-alias Google callback request with its query in an internal header and a mocked canonical auth handler.
// [Output] Proof that canonical context is restored in memory, the transport header is removed, and redirects have explicit framing.
// [Pos] Transport alias regression; protocol behavior remains covered by the Better Auth boundary tests.
// [Sync] 2026-09-18: cover explicit redirect framing across the Alibaba, Cloudflare, and NATAPP relay chain.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { handleAuthRequest } = vi.hoisted(() => ({ handleAuthRequest: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ handleAuthRequest }));

describe("Google edge callback alias", () => {
  beforeEach(() => handleAuthRequest.mockReset());

  it("delegates the unchanged callback context on the canonical Better Auth path", async () => {
    const protocolHeaders = new Headers({ location: "/auth/sign-in" });
    protocolHeaders.append("set-cookie", "better-auth.session=opaque; HttpOnly");
    protocolHeaders.append("set-cookie", "better-auth.state=; Max-Age=0; HttpOnly");
    handleAuthRequest.mockResolvedValue(new Response(null, { status: 302, headers: protocolHeaders }));
    const request = new Request("http://work.example/api/auth/edge-callback/google", {
      headers: { cookie: "better-auth.state=opaque", "x-forwarded-host": "admin.example", "x-ink-google-callback-query": "state=opaque&code=opaque" },
    });

    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength("Redirecting")));
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual(protocolHeaders.getSetCookie());
    expect(await response.text()).toBe("Redirecting");
    expect(handleAuthRequest).toHaveBeenCalledOnce();
    const delegated = handleAuthRequest.mock.calls[0]?.[0] as Request;
    expect(new URL(delegated.url).pathname).toBe("/api/auth/callback/google");
    expect(new URL(delegated.url).search).toBe("?state=opaque&code=opaque");
    expect(delegated.headers.get("cookie")).toBe("better-auth.state=opaque");
    expect(delegated.headers.get("x-forwarded-host")).toBe("admin.example");
    expect(delegated.headers.get("x-ink-google-callback-query")).toBeNull();
  });

  it("rejects ambiguous or oversized relayed callback queries before Better Auth", async () => {
    const ambiguous = await GET(new Request("http://work.example/api/auth/edge-callback/google?state=url", {
      headers: { "x-ink-google-callback-query": "state=header" },
    }));
    expect(ambiguous.status).toBe(400);
    vi.stubEnv("AUTH_MAX_CALLBACK_QUERY_BYTES", "8");
    const oversized = await GET(new Request("http://work.example/api/auth/edge-callback/google", {
      headers: { "x-ink-google-callback-query": "state=long" },
    }));
    expect(oversized.status).toBe(400);
    expect(handleAuthRequest).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
