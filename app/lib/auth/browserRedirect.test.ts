// [Input] Installed provider's fetch redirect and browser login continuation.
// [Output] Google/device context survives callback; malformed response cannot execute script navigation.
// [Pos] Provider-free interaction contract tests.
import { describe, expect, it } from "vitest";
import { authResponseRedirect, googleLoginCallback } from "./browserRedirect";
describe("authentication continuation", () => {
  it("uses installed OAuth response url for consent success and denial", () => {
    expect(authResponseRedirect({ redirect: true, url: "https://dream.example/callback?code=opaque&state=s" })).toBe("https://dream.example/callback?code=opaque&state=s");
    expect(authResponseRedirect({ redirect: true, url: "https://dream.example/callback?error=access_denied&state=s" })).toContain("access_denied");
    for (const data of [null, {}, { url: "javascript:alert(1)" }, { url: "https://user:pass@host.example" }]) expect(authResponseRedirect(data)).toBeNull();
  });
  it("preserves the entire signed OAuth query across Google callback", () => {
    const query = "?client_id=browser&scope=openid+dream%3Aread&state=s&sig=signed&exp=1800000000&ba_iat=1&ba_param=client_id";
    expect(googleLoginCallback("https://admin.example", "/admin", query)).toBe(`https://admin.example/auth/sign-in${query}`);
    expect(googleLoginCallback("https://admin.example", "/auth/device?user_code=ABCD-EFGH", "")).toBe("https://admin.example/auth/device?user_code=ABCD-EFGH");
  });
});
