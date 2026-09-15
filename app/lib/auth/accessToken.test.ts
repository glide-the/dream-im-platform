// [Input] Locally generated ES256 signing keys and signed OAuth/ID/Session token fixtures.
// [Output] Positive access-token verification and negative type/scope/audience/lifetime evidence.
// [Pos] Deterministic verifier contract tests; no provider or database access.
// [Sync] 2026-09-14: assert only Admin target access tokens pass the protocol boundary.
import { beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { verifyAdminAccessToken } from "./accessToken";

const configuration = { issuer: "https://admin.example.test/api/auth", resource: "https://dream.example.test/api" };
let privateKey: CryptoKey;
let keys: JSONWebKeySet;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256"); privateKey = pair.privateKey;
  keys = { keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture", alg: "ES256" }] };
});
async function token(input: { typ?: string; scope?: string; audience?: string; lifetime?: number } = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ scope: input.scope ?? "dream:read", client_id: "browser" }).setProtectedHeader({ alg: "ES256", kid: "fixture", typ: input.typ ?? "at+jwt" })
    .setSubject("auth-user").setJti("fixture-token").setIssuer(configuration.issuer).setAudience(input.audience ?? configuration.resource)
    .setIssuedAt(now).setExpirationTime(now + (input.lifetime ?? 300)).sign(privateKey);
}
describe("Admin target OAuth access token", () => {
  it("verifies OAuth sub without interpreting it as canonical user_id", async () => {
    expect(await verifyAdminAccessToken(new Headers({ authorization: `Bearer ${await token()}` }), "dream:read", { configuration, keys })).toMatchObject({ subject: "auth-user", clientId: "browser", scopes: ["dream:read"] });
  });
  it.each([{ typ: "JWT" }, { typ: "id+jwt" }, { audience: "https://google.example.test" }, { lifetime: 301 }, { lifetime: -1 }])("rejects non-target or invalid lifetime %o", async input => {
    await expect(verifyAdminAccessToken(new Headers({ authorization: `Bearer ${await token(input)}` }), "dream:read", { configuration, keys })).rejects.toMatchObject({ status: 401 });
  });
  it("distinguishes an authenticated scope failure", async () => {
    await expect(verifyAdminAccessToken(new Headers({ authorization: `Bearer ${await token()}` }), "dream:write", { configuration, keys })).rejects.toMatchObject({ status: 403 });
  });
});
