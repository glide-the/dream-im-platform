// [Input] Explicit configuration fixtures without credentials or live services.
// [Output] Success/failure evidence for exact origin/issuer and per-service permissions.
// [Pos] Provider-free auth configuration tests.
// [Sync] 2026-09-15: cover the exact Reflections executor background scope.
import { describe, expect, it } from "vitest";
import { authConfiguration, dreamServiceClients, exactAuthUrl } from "./config";

const environment = {
  BETTER_AUTH_URL: "https://admin.example.test/api/auth", BETTER_AUTH_SECRET: "fixture-secret-longer-than-32-bytes",
  AUTH_TRUSTED_ORIGINS: "https://admin.example.test,https://dream.example.test",
  DREAM_API_RESOURCE: "https://dream.example.test/api", GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
};

describe("auth configuration", () => {
  it("uses one exact issuer and explicit https cookie capability", () => {
    expect(authConfiguration(environment)).toMatchObject({ issuer: environment.BETTER_AUTH_URL, secureCookies: true });
    expect(exactAuthUrl("http://localhost:3000", true)).toBe("http://localhost:3000");
  });
  it.each(["http://admin.example.test", "https://admin.example.test/extra", "https://u:p@admin.example.test", "https://admin.example.test#fragment", "https://admin.example.test?url=evil"])("rejects unsafe origin %s", value => {
    expect(() => exactAuthUrl(value, true)).toThrow();
  });
  it("fails closed with missing secret or wrong issuer path", () => {
    expect(() => authConfiguration({ ...environment, GOOGLE_CLIENT_SECRET: "" })).toThrow("AUTH_NOT_CONFIGURED");
    expect(() => authConfiguration({ ...environment, BETTER_AUTH_URL: "https://admin.example.test" })).toThrow("AUTH_INVALID_ISSUER");
  });
  it("binds a service to its origin, callback and background subset", () => {
    const client = { id: "bff", secret: "fixture-service-longer-than-32-bytes", origin: "https://dream.example.test", oauthClientId: "browser", redirectUri: "https://dream.example.test/auth/callback", backgroundScopes: ["capabilities:read", "reflections:execute"] };
    expect(dreamServiceClients({ DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([client]) })[0].backgroundScopes).toEqual(["capabilities:read", "reflections:execute"]);
    expect(() => dreamServiceClients({ DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([{ ...client, redirectUri: "https://other.example.test/auth/callback" }]) })).toThrow("AUTH_INVALID_REDIRECT");
    expect(() => dreamServiceClients({ DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([{ ...client, backgroundScopes: ["*"] }]) })).toThrow("AUTH_NOT_CONFIGURED");
  });
});
