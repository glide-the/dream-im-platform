// [Input] Validated Admin auth/service configuration and the dedicated auth Drizzle transaction.
// [Output] Redacted plan/receipt plus an idempotently reconciled Dream OAuth resource and public clients.
// [Pos] Release-time OAuth client catalog service; runtime auth routes only consume the registered rows.
// [Sync] 2026-09-16: add DTO-to-ORM provisioning for Dream browser/device public clients.
import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  oauthClient,
  oauthClientResource,
  oauthResource,
} from "@ink-memory/db/schema/auth-generated";
import {
  accessTokenLifetimeSeconds,
  authConfiguration,
  authScopes,
  AuthBoundaryError,
  dreamServiceClients,
  requiredAuthValue,
} from "./config";
import type { AuthRepositoryDatabase } from "./database";

const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";

export type OAuthCatalogClientDto = {
  clientId: string;
  name: string;
  uri: string | null;
  redirectUris: string[];
  scopes: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: "none";
  applicationType: "web" | "native";
  requirePKCE: boolean;
  subjectType: "public";
  disabled: false;
  skipConsent: false;
};

export type OAuthCatalogDto = {
  resource: {
    identifier: string;
    name: string;
    accessTokenTtl: number;
    signingAlgorithm: "ES256";
    allowedScopes: string[];
    disabled: false;
  };
  clients: OAuthCatalogClientDto[];
};

type OAuthCatalogSnapshot = {
  resource: OAuthCatalogDto["resource"] | null;
  clients: OAuthCatalogClientDto[];
  links: Array<{ clientId: string; resourceId: string }>;
};

export type OAuthCatalogPlan = {
  resource: "create" | "update" | "unchanged";
  clients: Array<{ clientId: string; action: "create" | "update" | "unchanged" }>;
  links: Array<{ clientId: string; resourceId: string; action: "create" | "delete" | "unchanged" }>;
};

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function catalogId(kind: string, value: string) {
  return `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function normalizedClient(client: OAuthCatalogClientDto): OAuthCatalogClientDto {
  return {
    ...client,
    redirectUris: uniqueSorted(client.redirectUris),
    scopes: uniqueSorted(client.scopes),
    grantTypes: uniqueSorted(client.grantTypes),
    responseTypes: uniqueSorted(client.responseTypes),
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function dreamOAuthCatalogDto(environment: Record<string, string | undefined> = process.env): OAuthCatalogDto {
  const configuration = authConfiguration(environment);
  const services = dreamServiceClients(environment);
  const deviceClientId = requiredAuthValue("AUTH_DEVICE_CLIENT_ID", environment);
  const browsers = new Map<string, { origins: Set<string>; redirects: Set<string> }>();
  for (const service of services) {
    const current = browsers.get(service.oauthClientId) ?? { origins: new Set(), redirects: new Set() };
    current.origins.add(service.origin);
    current.redirects.add(service.redirectUri);
    browsers.set(service.oauthClientId, current);
  }
  if (browsers.has(deviceClientId)) throw new AuthBoundaryError("AUTH_CLIENT_CATALOG_INVALID");

  const browserClients = [...browsers.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([clientId, values]): OAuthCatalogClientDto => normalizedClient({
      clientId,
      name: "Ink Dream Browser",
      uri: values.origins.size === 1 ? [...values.origins][0] : null,
      redirectUris: [...values.redirects],
      scopes: [...authScopes],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      applicationType: "web",
      requirePKCE: true,
      subjectType: "public",
      disabled: false,
      skipConsent: false,
    }),
  );
  const deviceClient = normalizedClient({
    clientId: deviceClientId,
    name: "Ink Dream Device",
    uri: null,
    redirectUris: [],
    scopes: [...authScopes],
    grantTypes: [deviceGrant, "refresh_token"],
    responseTypes: [],
    tokenEndpointAuthMethod: "none",
    applicationType: "native",
    requirePKCE: false,
    subjectType: "public",
    disabled: false,
    skipConsent: false,
  });
  return {
    resource: {
      identifier: configuration.resource,
      name: "Dream API",
      accessTokenTtl: accessTokenLifetimeSeconds,
      signingAlgorithm: "ES256",
      allowedScopes: uniqueSorted(authScopes),
      disabled: false,
    },
    clients: [...browserClients, deviceClient],
  };
}

export function planDreamOAuthCatalog(target: OAuthCatalogDto, current: OAuthCatalogSnapshot): OAuthCatalogPlan {
  const resource = !current.resource
    ? "create"
    : sameValue(target.resource, current.resource) ? "unchanged" : "update";
  const currentClients = new Map(current.clients.map(client => [client.clientId, normalizedClient(client)]));
  const links = new Set(current.links.map(link => `${link.clientId}\u0000${link.resourceId}`));
  const targetLinks = target.clients.map(client => ({
    clientId: client.clientId,
    resourceId: target.resource.identifier,
    action: links.has(`${client.clientId}\u0000${target.resource.identifier}`) ? "unchanged" as const : "create" as const,
  }));
  const targetClientIds = new Set(target.clients.map(client => client.clientId));
  const obsoleteLinks = current.links
    .filter(link => targetClientIds.has(link.clientId) && link.resourceId !== target.resource.identifier)
    .sort((left, right) => `${left.clientId}\u0000${left.resourceId}`.localeCompare(`${right.clientId}\u0000${right.resourceId}`))
    .map(link => ({ ...link, action: "delete" as const }));
  return {
    resource,
    clients: target.clients.map(client => {
      const existing = currentClients.get(client.clientId);
      return { clientId: client.clientId, action: !existing ? "create" : sameValue(normalizedClient(client), existing) ? "unchanged" : "update" };
    }),
    links: [...targetLinks, ...obsoleteLinks],
  };
}

async function readSnapshot(database: AuthRepositoryDatabase, target: OAuthCatalogDto): Promise<OAuthCatalogSnapshot> {
  const [resourceRows, clientRows, linkRows] = await Promise.all([
    database.select({
      identifier: oauthResource.identifier,
      name: oauthResource.name,
      accessTokenTtl: oauthResource.accessTokenTtl,
      signingAlgorithm: oauthResource.signingAlgorithm,
      allowedScopes: oauthResource.allowedScopes,
      disabled: oauthResource.disabled,
    }).from(oauthResource).where(eq(oauthResource.identifier, target.resource.identifier)).limit(1),
    database.select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      uri: oauthClient.uri,
      redirectUris: oauthClient.redirectUris,
      scopes: oauthClient.scopes,
      grantTypes: oauthClient.grantTypes,
      responseTypes: oauthClient.responseTypes,
      tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
      applicationType: oauthClient.applicationType,
      requirePKCE: oauthClient.requirePKCE,
      subjectType: oauthClient.subjectType,
      disabled: oauthClient.disabled,
      skipConsent: oauthClient.skipConsent,
    }).from(oauthClient).where(inArray(oauthClient.clientId, target.clients.map(client => client.clientId))),
    database.select({ clientId: oauthClientResource.clientId, resourceId: oauthClientResource.resourceId })
      .from(oauthClientResource)
      .where(inArray(oauthClientResource.clientId, target.clients.map(client => client.clientId))),
  ]);
  const resource = resourceRows[0];
  return {
    resource: resource ? {
      identifier: resource.identifier,
      name: resource.name,
      accessTokenTtl: resource.accessTokenTtl ?? 0,
      signingAlgorithm: resource.signingAlgorithm === "ES256" ? "ES256" : resource.signingAlgorithm as "ES256",
      allowedScopes: uniqueSorted(resource.allowedScopes ?? []),
      disabled: Boolean(resource.disabled) as false,
    } : null,
    clients: clientRows.map(row => normalizedClient({
      clientId: row.clientId,
      name: row.name ?? "",
      uri: row.uri,
      redirectUris: row.redirectUris,
      scopes: row.scopes ?? [],
      grantTypes: row.grantTypes ?? [],
      responseTypes: row.responseTypes ?? [],
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod as "none",
      applicationType: row.applicationType as "web" | "native",
      requirePKCE: Boolean(row.requirePKCE),
      subjectType: row.subjectType as "public",
      disabled: Boolean(row.disabled) as false,
      skipConsent: Boolean(row.skipConsent) as false,
    })),
    links: linkRows,
  };
}

async function applyCatalog(database: AuthRepositoryDatabase, target: OAuthCatalogDto) {
  const now = new Date();
  await database.insert(oauthResource).values({
    id: catalogId("resource", target.resource.identifier),
    ...target.resource,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: oauthResource.identifier,
    set: {
      name: target.resource.name,
      accessTokenTtl: target.resource.accessTokenTtl,
      signingAlgorithm: target.resource.signingAlgorithm,
      allowedScopes: target.resource.allowedScopes,
      disabled: target.resource.disabled,
      updatedAt: now,
    },
  });
  for (const client of target.clients) {
    await database.insert(oauthClient).values({
      id: catalogId("client", client.clientId),
      clientId: client.clientId,
      clientSecret: null,
      clientCredentialsScopes: [],
      dpopBoundAccessTokens: false,
      ...client,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: oauthClient.clientId,
      set: {
        clientSecret: null,
        name: client.name,
        uri: client.uri,
        redirectUris: client.redirectUris,
        scopes: client.scopes,
        grantTypes: client.grantTypes,
        responseTypes: client.responseTypes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        applicationType: client.applicationType,
        requirePKCE: client.requirePKCE,
        subjectType: client.subjectType,
        disabled: client.disabled,
        skipConsent: client.skipConsent,
        dpopBoundAccessTokens: false,
        updatedAt: now,
      },
    });
    await database.insert(oauthClientResource).values({
      id: catalogId("client_resource", `${client.clientId}\u0000${target.resource.identifier}`),
      clientId: client.clientId,
      resourceId: target.resource.identifier,
      createdAt: now,
    }).onConflictDoNothing({ target: [oauthClientResource.clientId, oauthClientResource.resourceId] });
  }
  await database.delete(oauthClientResource).where(and(
    inArray(oauthClientResource.clientId, target.clients.map(client => client.clientId)),
    ne(oauthClientResource.resourceId, target.resource.identifier),
  ));
}

export async function provisionDreamOAuthCatalog(database: AuthRepositoryDatabase, apply: boolean) {
  const target = dreamOAuthCatalogDto();
  const before = await readSnapshot(database, target);
  const plan = planDreamOAuthCatalog(target, before);
  if (apply) await applyCatalog(database, target);
  const after = apply ? await readSnapshot(database, target) : before;
  const remaining = planDreamOAuthCatalog(target, after);
  if (apply && (remaining.resource !== "unchanged" || remaining.clients.some(item => item.action !== "unchanged") || remaining.links.some(item => item.action !== "unchanged"))) {
    throw new AuthBoundaryError("AUTH_CLIENT_CATALOG_WRITE_FAILED");
  }
  return { mode: apply ? "apply" as const : "dry-run" as const, resource: target.resource.identifier, plan, verified: apply };
}
