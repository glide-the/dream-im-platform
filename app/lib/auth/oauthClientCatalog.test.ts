// [Input] Provider-free auth configuration and catalog snapshots.
// [Output] Deterministic DTO, drift plan and collision validation evidence.
// [Pos] Unit contract for release-time Dream OAuth client catalog provisioning.
// [Sync] 2026-09-16: cover browser/device public client DTO and idempotent planning.
import { describe, expect, it } from "vitest";
import { dreamOAuthCatalogDto, planDreamOAuthCatalog } from "./oauthClientCatalog";

const service = {
  id: "dream-service",
  secret: "fixture-service-secret-longer-than-32-bytes",
  origin: "https://dream.example.test",
  oauthClientId: "dream-browser",
  redirectUri: "https://dream.example.test/auth/callback",
  backgroundScopes: ["capabilities:read"],
};
const environment = {
  BETTER_AUTH_URL: "https://admin.example.test/api/auth",
  BETTER_AUTH_SECRET: "fixture-admin-secret-longer-than-32-bytes",
  AUTH_TRUSTED_ORIGINS: "https://admin.example.test,https://dream.example.test",
  DREAM_API_RESOURCE: "https://dream.example.test/api",
  GOOGLE_CLIENT_ID: "fixture-google",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  AUTH_DEVICE_CLIENT_ID: "dream-device",
  DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service]),
};

describe("Dream OAuth client catalog", () => {
  it("derives two public clients and one configured resource without secrets", () => {
    const target = dreamOAuthCatalogDto(environment);
    expect(target.resource).toMatchObject({ identifier: environment.DREAM_API_RESOURCE, signingAlgorithm: "ES256", accessTokenTtl: 300 });
    expect(target.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: "dream-browser", redirectUris: [service.redirectUri], tokenEndpointAuthMethod: "none", requirePKCE: true, grantTypes: ["authorization_code", "refresh_token"] }),
      expect.objectContaining({ clientId: "dream-device", redirectUris: [], tokenEndpointAuthMethod: "none", applicationType: "native", requirePKCE: false, grantTypes: ["refresh_token", "urn:ietf:params:oauth:grant-type:device_code"] }),
    ]));
    expect(JSON.stringify(target)).not.toContain(service.secret);
  });

  it("plans create, converged no-op and controlled drift", () => {
    const target = dreamOAuthCatalogDto(environment);
    const empty = { resource: null, clients: [], links: [] };
    expect(planDreamOAuthCatalog(target, empty).resource).toBe("create");
    const exact = {
      resource: target.resource,
      clients: target.clients,
      links: target.clients.map(client => ({ clientId: client.clientId, resourceId: target.resource.identifier })),
    };
    expect(planDreamOAuthCatalog(target, exact)).toMatchObject({
      resource: "unchanged",
      clients: target.clients.map(client => ({ clientId: client.clientId, action: "unchanged" })),
      links: target.clients.map(client => ({ clientId: client.clientId, action: "unchanged" })),
    });
    expect(planDreamOAuthCatalog(target, { ...exact, clients: [{ ...target.clients[0], scopes: [] }, target.clients[1]] }).clients[0].action).toBe("update");
    expect(planDreamOAuthCatalog(target, {
      ...exact,
      links: [...exact.links, { clientId: target.clients[0].clientId, resourceId: "https://stale.example.test/api" }],
    }).links).toContainEqual({ clientId: target.clients[0].clientId, resourceId: "https://stale.example.test/api", action: "delete" });
  });

  it("rejects reusing one identifier for browser and device roles", () => {
    expect(() => dreamOAuthCatalogDto({ ...environment, AUTH_DEVICE_CLIENT_ID: service.oauthClientId })).toThrow("AUTH_CLIENT_CATALOG_INVALID");
  });
});
