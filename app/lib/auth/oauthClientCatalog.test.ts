// [Sync] 2026-10-11: enforce same-client exact callbacks and reject incompatible DPoP without changing token protocol.
// [Input] Provider-free auth configuration and catalog snapshots.
// [Output] Deterministic DTO, drift plan and collision validation evidence.
// [Pos] Unit contract for release-time Dream OAuth client catalog provisioning.
// [Sync] 2026-10-31: keep new account callbacks with their original Client and gate additive native metadata changes without permission drift.
// [Sync] 2026-09-28: register task-return dispatch for normal confidential client credentials.
import { describe, expect, it } from "vitest";
import { dreamOAuthCatalogDto, planDreamOAuthCatalog, planDreamBrowserRedirects, publishedBrowserRedirectAvailable } from "./oauthClientCatalog";

const service = {
  id: "dream-service",
  secret: "fixture-service-secret-longer-than-32-bytes",
  origin: "https://dream.example.test",
  oauthClientId: "dream-browser",
  redirectUri: "https://dream.example.test/auth/callback",
  backgroundScopes: ["capabilities:read", "task-return:dispatch"],
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
  it("derives two public clients, one confidential service client and one configured resource without plaintext secrets", () => {
    const target = dreamOAuthCatalogDto(environment);
    expect(target.resource).toMatchObject({ identifier: environment.DREAM_API_RESOURCE, signingAlgorithm: "ES256", accessTokenTtl: 300 });
    expect(target.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: "dream-browser", redirectUris: [service.redirectUri], tokenEndpointAuthMethod: "none", requirePKCE: true, grantTypes: ["authorization_code", "refresh_token"] }),
      expect.objectContaining({ clientId: "dream-device", redirectUris: [], tokenEndpointAuthMethod: "none", applicationType: "native", requirePKCE: false, grantTypes: ["refresh_token", "urn:ietf:params:oauth:grant-type:device_code"] }),
      expect.objectContaining({ clientId: "dream-service", redirectUris: [], tokenEndpointAuthMethod: "client_secret_basic", grantTypes: ["client_credentials"], clientCredentialsScopes: ["capabilities:read", "task-return:dispatch"] }),
    ]));
    expect(JSON.stringify(target)).not.toContain(service.secret);
    expect(target.clients.find(client => client.clientId === service.id)?.clientSecretHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
    expect(planDreamOAuthCatalog(target, { ...exact, clients: [{ ...target.clients[0], scopes: [] }, ...target.clients.slice(1)] }).clients[0].action).toBe("update");
    expect(planDreamOAuthCatalog(target, {
      ...exact,
      links: [...exact.links, { clientId: target.clients[0].clientId, resourceId: "https://stale.example.test/api" }],
    }).links).toContainEqual({ clientId: target.clients[0].clientId, resourceId: "https://stale.example.test/api", action: "delete" });
  });

  it("rejects reusing one identifier for browser and device roles", () => {
    expect(() => dreamOAuthCatalogDto({ ...environment, AUTH_DEVICE_CLIENT_ID: service.oauthClientId })).toThrow("AUTH_CLIENT_CATALOG_INVALID");
  });

  it("rejects reusing a service identifier for a public client role", () => {
    expect(() => dreamOAuthCatalogDto({ ...environment, AUTH_DEVICE_CLIENT_ID: service.id })).toThrow("AUTH_CLIENT_CATALOG_INVALID");
    expect(() => dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([{ ...service, id: service.oauthClientId }]) })).toThrow("AUTH_CLIENT_CATALOG_INVALID");
  });
});


it("registers the existing application's exact callbacks without exchanging client or service identities", () => {
  const local = { ...service, id: "local-service", oauthClientId: "local-browser", origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback" };
  const target = dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, local]) });
  for (const client of target.clients.filter(item => item.grantTypes.includes("authorization_code"))) {
    expect(client.redirectUris).toEqual([service.redirectUri, local.redirectUri].sort());
    expect(client.requirePKCE).toBe(true);
  }
  const current = { resource: target.resource, clients: target.clients.map(item => ({ ...item,
    redirectUris: item.clientId === local.oauthClientId ? [local.redirectUri]
      : item.clientId === service.oauthClientId ? [service.redirectUri] : item.redirectUris })), links: target.clients.map(client => ({ clientId: client.clientId, resourceId: target.resource.identifier })),
    dpop: { resourceRequired: false, clients: target.clients.map(client => ({ clientId: client.clientId, bound: false })) } };
  expect(planDreamBrowserRedirects(target, current)).toEqual(expect.arrayContaining([
    { clientId: local.oauthClientId, redirectUris: [service.redirectUri, local.redirectUri].sort(), added: [service.redirectUri] },
    { clientId: service.oauthClientId, redirectUris: [service.redirectUri, local.redirectUri].sort(), added: [local.redirectUri] },
  ]));
  expect(planDreamBrowserRedirects(target, { ...current, clients: target.clients })).toEqual([]);
  expect(() => planDreamBrowserRedirects(target, { ...current, clients: current.clients.map(item => ({ ...item, scopes: [] })) })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  expect(() => planDreamBrowserRedirects(target, { ...current, links: [] })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  expect(() => planDreamBrowserRedirects(target, { ...current, clients: current.clients.map(item => item.clientId === local.oauthClientId ? { ...item, redirectUris: [...item.redirectUris, "https://custom.example/auth/callback"] } : item) })).toThrow("AUTH_BROWSER_REDIRECT_SHRINK_DENIED");
  for (const resourceRequired of [true, null]) {
    expect(() => planDreamBrowserRedirects(target, { ...current, dpop: { ...current.dpop, resourceRequired } })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  }
  expect(() => planDreamBrowserRedirects(target, { ...current, dpop: undefined })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  expect(() => planDreamBrowserRedirects(target, { ...current, dpop: { ...current.dpop, clients: current.dpop.clients.map(row => row.clientId === local.oauthClientId ? { ...row, bound: true } : row) } })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
});

it("rejects DPoP-incompatible or inactive published Browser clients before presenting login", async () => {
  const active = { disabled: false, resourceDisabled: false, requirePKCE: true, authentication: "none",
    grants: ["authorization_code"], responses: ["code"], redirects: [service.redirectUri], clientDpop: false, resourceDpop: false };
  for (const [changes, expected] of [
    [{}, true], [{ clientDpop: true }, false], [{ resourceDpop: true }, false], [{ clientDpop: null }, false],
    [{ disabled: true }, false], [{ resourceDisabled: true }, false], [{ redirects: [service.redirectUri, service.redirectUri] }, false],
  ] as const) {
    const query = { innerJoin: () => query, where: async () => [{ ...active, ...changes }] };
    const database = { select: () => ({ from: () => query }) } as unknown as Parameters<typeof publishedBrowserRedirectAvailable>[0];
    expect(await publishedBrowserRedirectAvailable(database, service.oauthClientId, environment.DREAM_API_RESOURCE, service.redirectUri)).toBe(expected);
  }
});

it("adds private account callbacks only to their configured public Client while preserving original Web callbacks and grants", () => {
  const app = "com.inkmemory.example.auth:/auth/callback", otherApp = "com.inkmemory.other.auth:/auth/callback";
  const local = { ...service, id: "local-service", oauthClientId: "local-browser", origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback", redirectUris: [app] };
  const other = { ...local, id: "other-service", oauthClientId: "other-browser", origin: "http://localhost:5174", redirectUri: "http://localhost:5174/auth/callback", redirectUris: [otherApp] };
  const baseline = dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, { ...local, redirectUris: undefined }, { ...other, redirectUris: undefined }]) });
  const target = dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, local, other]) });
  for (const [id, expected] of [[local.oauthClientId, app], [other.oauthClientId, otherApp]] as const) {
    const client = target.clients.find(item => item.clientId === id)!;
    expect(client.redirectUris).toContain(expected);
    expect(client.redirectUris).not.toContain(expected === app ? otherApp : app);
    expect(client.applicationType).toBe("native");
    const before = baseline.clients.find(item => item.clientId === id)!;
    expect({ ...client, applicationType: before.applicationType, redirectUris: before.redirectUris }).toEqual(before);
  }
  expect(target.clients.find(item => item.clientId === service.oauthClientId)).toEqual(baseline.clients.find(item => item.clientId === service.oauthClientId));
  expect(target.clients.find(item => item.clientId === environment.AUTH_DEVICE_CLIENT_ID)).toEqual(baseline.clients.find(item => item.clientId === environment.AUTH_DEVICE_CLIENT_ID));
});

it("publishes only additive redirects and the required existing public Client web-to-native metadata transition", () => {
  const app = "com.inkmemory.example.auth:/auth/callback";
  const local = { ...service, id: "local-service", oauthClientId: "local-browser", origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback" };
  const before = dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, local]) });
  const target = dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, { ...local, redirectUris: [app] }]) });
  const current = { resource: before.resource, clients: before.clients, links: before.clients.map(client => ({ clientId: client.clientId, resourceId: before.resource.identifier })),
    dpop: { resourceRequired: false, clients: before.clients.map(client => ({ clientId: client.clientId, bound: false })) } };
  expect(planDreamBrowserRedirects(target, current)).toEqual([{ clientId: local.oauthClientId,
    redirectUris: target.clients.find(client => client.clientId === local.oauthClientId)!.redirectUris, added: [app], applicationType: "native" }]);
  expect(planDreamBrowserRedirects(target, { ...current, clients: target.clients })).toEqual([]);
  const drifted = current.clients.map(client => client.clientId === local.oauthClientId ? { ...client, scopes: [] } : client);
  expect(() => planDreamBrowserRedirects(target, { ...current, clients: drifted })).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  const metadataOnly = { ...before, clients: before.clients.map(client => client.clientId === local.oauthClientId ? { ...client, applicationType: "native" as const } : client) };
  expect(() => planDreamBrowserRedirects(metadataOnly, current)).toThrow("AUTH_BROWSER_REDIRECT_CATALOG_DRIFT");
  const shrink = { ...current, clients: current.clients.map(client => client.clientId === local.oauthClientId ? { ...client, redirectUris: [...client.redirectUris, "https://custom.example.test/auth/callback"] } : client) };
  expect(() => planDreamBrowserRedirects(target, shrink)).toThrow("AUTH_BROWSER_REDIRECT_SHRINK_DENIED");
});

it("fails closed when a retained application callback conflicts with the installed native registration URI rules", () => {
  const local = { ...service, id: "local-service", oauthClientId: "local-browser", origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback", redirectUris: ["com.inkmemory.example.auth:/auth/callback"] };
  const incompatible = { ...service, id: "loopback-https-service", oauthClientId: "loopback-https-browser", origin: "https://localhost:5174", redirectUri: "https://localhost:5174/auth/callback" };
  expect(() => dreamOAuthCatalogDto({ ...environment, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service, local, incompatible]) })).toThrow("AUTH_CLIENT_CATALOG_INVALID");
});
