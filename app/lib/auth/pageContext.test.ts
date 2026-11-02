// [Input] Installed-provider compatible signed query and controlled clock.
// [Output] Context forgery/expiry refusal and restricted login return verification.
// [Pos] Provider-free auth UI context tests.
import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { validConsentQuery, localLoginReturn, selectedGoogleLogin } from "./pageContext";
describe("auth page context", () => {
  it("continues only an exact unexpired signed Google selection", async () => {
    const secret = "fixture-signing-secret-longer-than-32-bytes", now = 1_000_000;
    const query = new URLSearchParams({ client_id: "original-browser", exp: "1100", identity_provider: "google" }); query.sort();
    query.set("sig", await makeSignature(query.toString(), secret));
    expect(await selectedGoogleLogin(query, secret, now)).toBe(true);
    expect(await selectedGoogleLogin(query, secret, now + 100_001)).toBe(false);
    for (const provider of ["github", "", "Google"]) {
      const changed = new URLSearchParams(query); changed.set("identity_provider", provider);
      expect(await selectedGoogleLogin(changed, secret, now)).toBe(false);
    }
    const duplicate = new URLSearchParams(query); duplicate.append("identity_provider", "google");
    expect(await selectedGoogleLogin(duplicate, secret, now)).toBe(false);
    query.set("client_id", "other-client"); expect(await selectedGoogleLogin(query, secret, now)).toBe(false);
    expect(await selectedGoogleLogin(new URLSearchParams({ identity_provider: "google" }), secret, now)).toBe(false);
  });
  it("accepts only the unexpired exact signed OAuth query", async () => {
    const secret = "fixture-signing-secret-longer-than-32-bytes", now = 1_000_000;
    const query = new URLSearchParams({ client_id: "browser", exp: "1100", scope: "openid dream:read" }); query.sort();
    query.set("sig", await makeSignature(query.toString(), secret));
    expect(await validConsentQuery(query, secret, now)).toBe(true);
    expect(await validConsentQuery(query, secret, now + 100_001)).toBe(false);
    query.set("scope", "openid dream:write"); expect(await validConsentQuery(query, secret, now)).toBe(false);
  });
  it("rejects duplicate signature and external/encoded local returns", async () => {
    const query = new URLSearchParams("sig=x&sig=x&exp=1000"); expect(await validConsentQuery(query, "secret", 1)).toBe(false);
    for (const candidate of ["//evil.example", "https://evil.example", "/auth/device?user_code=x&return_to=evil", "/%2f%2fevil"]) expect(localLoginReturn(new URLSearchParams({ return_to: candidate }))).toBe("/admin");
    expect(localLoginReturn(new URLSearchParams({ return_to: "/auth/device?user_code=ABCD-EFGH" }))).toBe("/auth/device?user_code=ABCD-EFGH");
  });
});
