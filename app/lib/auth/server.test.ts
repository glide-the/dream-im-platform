// [Input] Installed Better Auth composition with an injected opaque protocol/storage failure.
// [Output] Rethrow configuration plus rollback, generic no-store 503 and zero exception logging evidence.
// [Pos] Provider-free auth server error-boundary regression tests.
// [Sync] 2026-09-15: prevent Better Call from logging SQL parameters or protocol credentials.
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

import { createAdminAuth, handleAuthRequest } from "./server";

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
