import type {
  AccessControlProvider,
  AuthProvider,
  BaseRecord,
  CrudFilter,
  DataProvider,
  HttpError,
} from "@refinedev/core";

// Browser-side Refine adapters. Server authorization remains authoritative.
const registeredResources = new Set([
  "users",
  "source-users",
  "platform-users",
  "providers",
  "models",
  "pricing-rules",
  "billing-accounts",
  "subscription-plans",
  "subscription-plan-versions",
  "subscription-entitlements",
  "subscriptions",
  "subscription-allowances",
  "subscription-events",
  "subscription-token-grants",
  "token-ledger",
  "usage",
  "ledger",
  "gateway-requests",
  "gateway-api-keys",
  "gateway-rate-limits",
  "user-model-permissions",
  "admin-users",
  "admin-roles",
  "admin-permissions",
  "roles",
  "permissions",
  "storage-resources",
  "audit-logs",
  "story-workspaces",
  "story-stories",
  "story-characters",
  "story-scenes",
]);

const resourcePermission: Record<
  string,
  { read: string; write: string; delete?: string }
> = {
  users: { read: "users.read", write: "users.write" },
  "source-users": { read: "users.read", write: "users.read" },
  "platform-users": { read: "users.read", write: "users.write" },
  "user-model-permissions": { read: "users.read", write: "users.write" },
  providers: { read: "providers.read", write: "providers.write" },
  models: { read: "models.read", write: "models.write" },
  "pricing-rules": { read: "pricing.read", write: "pricing.write" },
  "billing-accounts": { read: "billing.read", write: "billing.adjust" },
  "subscription-plans": { read: "subscriptions.read", write: "subscriptions.write" },
  "subscription-plan-versions": { read: "subscriptions.read", write: "subscriptions.write" },
  "subscription-entitlements": { read: "subscriptions.read", write: "subscriptions.write" },
  subscriptions: { read: "subscriptions.read", write: "subscriptions.write" },
  "subscription-allowances": { read: "subscriptions.read", write: "subscriptions.read" },
  "subscription-events": { read: "subscriptions.read", write: "subscriptions.read" },
  "subscription-token-grants": {
    read: "subscriptions.read",
    write: "subscriptions.grant",
  },
  "token-ledger": { read: "subscriptions.read", write: "subscriptions.read" },
  usage: { read: "billing.read", write: "billing.adjust" },
  ledger: { read: "billing.read", write: "billing.adjust" },
  "gateway-requests": { read: "gateway.read", write: "gateway.reconcile" },
  "gateway-api-keys": {
    read: "gateway.read",
    write: "gateway.keys.write",
  },
  "gateway-rate-limits": { read: "gateway.read", write: "gateway.reconcile" },
  "admin-users": { read: "access.read", write: "access.write" },
  "admin-roles": { read: "access.read", write: "access.write" },
  "admin-permissions": { read: "access.read", write: "access.write" },
  roles: { read: "access.read", write: "access.write" },
  permissions: { read: "access.read", write: "access.read" },
  "storage-resources": { read: "storage.read", write: "storage.write", delete: "storage.delete" },
  "audit-logs": { read: "audit.read", write: "audit.read" },
  "story-workspaces": { read: "story.read", write: "story.write" },
  "story-stories": { read: "story.read", write: "story.write" },
  "story-characters": { read: "story.read", write: "story.write" },
  "story-scenes": { read: "story.read", write: "story.write" },
};

export function canonicalAdminResource(resource: string) {
  return resource === "stories" ? "story-stories" : resource;
}

function resourceEndpoint(resource: string) {
  return `/api/admin/${canonicalAdminResource(resource)}`;
}

type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
};

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
};

function assertResource(resource: string) {
  if (!registeredResources.has(resource)) {
    throw Object.assign(new Error(`Unknown admin resource: ${resource}`), {
      statusCode: 400,
    }) as HttpError;
  }
}

async function fetchAdmin<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    throw Object.assign(
      new Error(body.error?.message ?? "Admin API request failed"),
      {
        statusCode: response.status,
        code: body.error?.code,
        message: body.error?.message ?? "Admin API request failed",
        errors: body.error?.details,
        requestId: body.error?.requestId,
      },
    ) as HttpError;
  }
  return body;
}

function appendFilter(params: URLSearchParams, filter: CrudFilter) {
  if (!("field" in filter)) {
    throw Object.assign(new Error("Nested admin filters are not supported"), {
      statusCode: 400,
    }) as HttpError;
  }
  if (!["eq", "contains", "in", "gte", "lte"].includes(filter.operator)) {
    throw Object.assign(
      new Error(`Unsupported admin filter operator: ${filter.operator}`),
      { statusCode: 400 },
    ) as HttpError;
  }
  params.append(
    `filter[${filter.field}][${filter.operator}]`,
    Array.isArray(filter.value) ? filter.value.join(",") : String(filter.value),
  );
}

export const adminDataProvider: DataProvider = {
  getApiUrl: () => "/api/admin",
  async getList<TData extends BaseRecord>({
    resource,
    pagination,
    sorters,
    filters,
  }) {
    assertResource(resource);
    const params = new URLSearchParams({
      page: String(pagination?.currentPage ?? 1),
      pageSize: String(pagination?.pageSize ?? 20),
    });
    const sorter = sorters?.[0];
    if (sorter) {
      params.set("sort", sorter.field);
      params.set("order", sorter.order);
    }
    filters?.forEach((filter) => appendFilter(params, filter));
    const response = await fetchAdmin<{
      data: TData[];
      meta: { total: number };
    }>(`${resourceEndpoint(resource)}?${params}`);
    return { data: response.data, total: response.meta.total };
  },
  async getOne<TData extends BaseRecord>({ resource, id }) {
    assertResource(resource);
    const response = await fetchAdmin<{ data: TData }>(
      `${resourceEndpoint(resource)}/${encodeURIComponent(id)}`,
    );
    return { data: response.data };
  },
  async create<TData extends BaseRecord, TVariables>({ resource, variables }) {
    assertResource(resource);
    const response = await fetchAdmin<{ data: TData }>(
      resourceEndpoint(resource),
      { method: "POST", body: JSON.stringify(variables) },
    );
    return { data: response.data };
  },
  async update<TData extends BaseRecord, TVariables>({
    resource,
    id,
    variables,
  }) {
    assertResource(resource);
    const response = await fetchAdmin<{ data: TData }>(
      `${resourceEndpoint(resource)}/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(variables) },
    );
    return { data: response.data };
  },
  async deleteOne<TData extends BaseRecord>({ resource, id }) {
    assertResource(resource);
    const response = await fetchAdmin<{ data: TData }>(
      `${resourceEndpoint(resource)}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return { data: response.data };
  },
};

let identityCache: Promise<AdminIdentity | null> | undefined;

async function getIdentity() {
  identityCache ??= fetchAdmin<{ data: AdminIdentity }>("/api/admin/auth/me")
    .then((response) => response.data)
    .catch(() => null);
  return await identityCache;
}

export const adminAuthProvider: AuthProvider = {
  async login({ email, password }) {
    try {
      await fetchAdmin("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      identityCache = undefined;
      return { success: true, redirectTo: "/admin" };
    } catch (error) {
      return { success: false, error: error as HttpError };
    }
  },
  async logout() {
    await fetchAdmin("/api/admin/auth/logout", { method: "POST" }).catch(
      () => undefined,
    );
    identityCache = undefined;
    return { success: true, redirectTo: "/admin/login" };
  },
  async check() {
    const identity = await getIdentity();
    return identity
      ? { authenticated: true }
      : { authenticated: false, logout: true, redirectTo: "/admin/login" };
  },
  async onError(error) {
    const status = (error as HttpError)?.statusCode;
    return status === 401
      ? { logout: true, redirectTo: "/admin/login" }
      : { error: error as HttpError };
  },
  getIdentity,
  async getPermissions() {
    return (await getIdentity())?.permissions ?? [];
  },
};

export const adminAccessControlProvider: AccessControlProvider = {
  async can({ resource, action }) {
    if (!resource || !registeredResources.has(resource)) {
      return { can: false, reason: "Unknown admin resource" };
    }
    const identity = await getIdentity();
    if (!identity) return { can: false, reason: "Authentication required" };
    const permissions = resourcePermission[resource];
    const required = ["list", "show"].includes(action)
      ? permissions.read
      : action === "delete"
        ? permissions.delete ?? permissions.write
        : permissions.write;
    return {
      can: identity.permissions.includes(required),
      reason: `Permission ${required} is required`,
    };
  },
  options: {
    buttons: { enableAccessControl: true, hideIfUnauthorized: true },
  },
};
