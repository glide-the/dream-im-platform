// [Input] Installed Better Auth composition with an injected opaque protocol/storage failure.
// [Output] Rethrow configuration, generic no-store 503 and RFC 8628 preflight error evidence.
// [Pos] Provider-free auth server error-boundary regression tests.
// [Sync] 2026-09-15: prevent Better Call from logging SQL parameters or protocol credentials.
// [Sync] 2026-09-16: cover Device token client binding, terminal states, polling slowdown and actor-input rejection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRepositoryDatabase, AuthTransaction } from "./database";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  handler: vi.fn(),
  transaction: vi.fn(),
  rollback: vi.fn(),
  drizzleAdapter: vi.fn(() => ({})),
  jwt: vi.fn(() => ({ id: "jwt" })),
  oauthProvider: vi.fn(() => ({ id: "oauth-provider" })),
  oauthDeviceAuthorization: vi.fn(() => ({ id: "oauth-device-authorization" })),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: mocks.drizzleAdapter }));
vi.mock("better-auth/plugins", () => ({ jwt: mocks.jwt }));
vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: mocks.oauthProvider,
  oauthDeviceAuthorization: mocks.oauthDeviceAuthorization,
}));
vi.mock("./config", () => ({
  accessTokenLifetimeSeconds: 300,
  authConfiguration: () => ({
    issuer: "https://admin.example.test/api/auth",
    secret: "opaque-fixture-secret-longer-than-32-bytes",
    origins: ["https://admin.example.test"],
    googleClientId: "fixture-google-client",
    googleClientSecret: "fixture-google-secret",
    resource: "https://dream.example.test/api",
    secureCookies: true,
  }),
  authScopes: ["threads:read"],
  AuthBoundaryError: class AuthBoundaryError extends Error {
    readonly code = "AUTH_NOT_CONFIGURED";
    readonly status = 503;
  },
  requiredAuthValue: () => "fixture-device-client",
}));
vi.mock("./database", () => ({ withAuthTransaction: mocks.transaction }));
vi.mock("./subjectRepository", () => ({
  SubjectRepository: class SubjectRepository {
    assertNewEmail = vi.fn();
    linkNewAccount = vi.fn();
    findActive = vi.fn();
    hasActiveAdmin = vi.fn();
  },
}));

import { createAdminAuth, handleAuthOnTransaction, handleAuthRequest } from "./server";

const transaction = {} as AuthTransaction;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handler.mockResolvedValue(new Response(null, { status: 204 }));
  mocks.betterAuth.mockImplementation(() => ({ handler: mocks.handler }));
  mocks.transaction.mockImplementation(async (action: (tx: AuthTransaction) => Promise<unknown>) => {
    try {
      return await action(transaction);
    } catch (error) {
      mocks.rollback();
      throw error;
    }
  });
});

afterEach(() => { vi.restoreAllMocks(); });

type DeviceRecord = {
  id: string;
  oauthClientId: string;
  expiresAt: Date;
  status: string;
  lastPolledAt: Date | null;
  pollingInterval: number | null;
};

function deviceTransaction(record: DeviceRecord | null) {
  const limit = vi.fn(async () => record ? [record] : []);
  const locked = { limit };
  const where = { for: vi.fn(() => locked) };
  const from = { where: vi.fn(() => where) };
  const select = vi.fn(() => ({ from: vi.fn(() => from) }));
  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  return {
    tx: { select, update } as unknown as AuthTransaction,
    select,
    set,
    updateWhere,
  };
}

function deviceTokenRequest(overrides: Record<string, string> = {}) {
  return new Request("https://admin.example.test/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "device-secret",
      client_id: "fixture-device-client",
      ...overrides,
    }),
  });
}

function pendingDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: "device-row",
    oauthClientId: "fixture-device-client",
    expiresAt: new Date(Date.now() + 60_000),
    status: "pending",
    lastPolledAt: null,
    pollingInterval: 5_000,
    ...overrides,
  };
}

describe("Admin auth server error boundary", () => {
  it("configures Better Auth to rethrow internal API failures", () => {
    createAdminAuth(transaction as AuthRepositoryDatabase);
    const options = mocks.betterAuth.mock.calls[0]?.[0] as {
      logger?: { disabled?: boolean };
      onAPIError?: { throw?: boolean };
    };
    expect(options.onAPIError).toEqual({ throw: true });
    expect(options.logger).toEqual({ disabled: true });
  });

  it("rolls back an opaque handler fault without logging it and returns a generic response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fault = Object.assign(new Error("opaque storage fault"), {
      query: "opaque statement",
      params: ["opaque parameter"],
    });
    mocks.handler.mockRejectedValue(fault);

    const response = await handleAuthRequest(new Request("https://admin.example.test/api/auth/oauth2/authorize"));

    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
  });
});

describe("Admin OAuth Device token preflight", () => {
  it("rejects caller-supplied actor identity before storage or plugin dispatch", async () => {
    const fixture = deviceTransaction(null);
    const response = await handleAuthOnTransaction(
      deviceTokenRequest({ user_id: "123" }),
      fixture.tx,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(fixture.select).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "client mismatch",
      record: pendingDevice(),
      request: { client_id: "other-client" },
      error: "invalid_grant",
    },
    {
      name: "expired code",
      record: pendingDevice({ expiresAt: new Date(Date.now() - 1_000) }),
      request: {},
      error: "expired_token",
    },
    {
      name: "denied code",
      record: pendingDevice({ status: "denied" }),
      request: {},
      error: "access_denied",
    },
  ])("returns $error for $name without entering Better Auth", async ({ record, request, error }) => {
    const fixture = deviceTransaction(record);
    const response = await handleAuthOnTransaction(deviceTokenRequest(request), fixture.tx);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("advances the persisted polling interval and returns slow_down", async () => {
    const fixture = deviceTransaction(pendingDevice({ lastPolledAt: new Date() }));
    const response = await handleAuthOnTransaction(deviceTokenRequest(), fixture.tx);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "slow_down" });
    expect(fixture.set).toHaveBeenCalledWith({ pollingInterval: 10_000 });
    expect(fixture.updateWhere).toHaveBeenCalledOnce();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("passes a valid pending poll to the installed Device plugin and preserves its error", async () => {
    const fixture = deviceTransaction(pendingDevice());
    mocks.handler.mockResolvedValueOnce(
      Response.json({ error: "authorization_pending" }, { status: 400 }),
    );

    const response = await handleAuthOnTransaction(deviceTokenRequest(), fixture.tx);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "authorization_pending" });
    expect(mocks.handler).toHaveBeenCalledOnce();
  });
});
