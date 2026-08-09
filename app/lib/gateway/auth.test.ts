import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformClient: async (
    callback: (client: { query: typeof mocks.query }) => unknown,
  ) => await callback({ query: mocks.query }),
}));

import { authenticateGatewayRequest } from "./auth";

const pepper = "gateway-auth-test-pepper-with-more-than-32-bytes";
const plaintext = "gw_test-only-key-never-used-outside-unit-tests";
const issuer = "https://dream.example.test";
const audience = "ink-memory-gateway";
const originalEnvironment = {
  pepper: process.env.GATEWAY_API_KEY_PEPPER,
  issuer: process.env.GATEWAY_SUBJECT_JWT_ISSUER,
  audience: process.env.GATEWAY_SUBJECT_JWT_AUDIENCE,
};

type TokenInput = {
  subject?: string;
  clientId?: string;
  authorizedParty?: string;
  scope?: string;
  issuedAt?: number;
  expiresAt?: number;
  signingSecret?: string;
};

async function subjectToken(input: TokenInput = {}) {
  const now = Math.floor(Date.now() / 1_000);
  const claims: Record<string, string> = {
    scope: input.scope ?? "messages:create",
  };
  if (input.clientId !== "") claims.client_id = input.clientId ?? "dream-bff";
  if (input.authorizedParty !== undefined) claims.azp = input.authorizedParty;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.subject ?? "101")
    .setJti("gateway-subject-jti")
    .setIssuedAt(input.issuedAt ?? now)
    .setExpirationTime(input.expiresAt ?? now + 120)
    .sign(new TextEncoder().encode(input.signingSecret ?? plaintext));
}

function fixedKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    api_key_id: "key_fixed",
    platform_user_id: "usr_101",
    subject_mode: "fixed_user",
    service_client_id: null,
    scopes: ["messages:create", "models:list"],
    canonical_user_id: "101",
    source: "ink-dream",
    external_user_id: "101",
    tier: "free",
    daily_token_limit: 100_000,
    monthly_token_limit: null,
    ...overrides,
  };
}

function serviceKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    api_key_id: "key_service",
    platform_user_id: null,
    subject_mode: "canonical_subject",
    service_client_id: "dream-bff",
    scopes: ["messages:create", "models:list"],
    canonical_user_id: null,
    source: null,
    external_user_id: null,
    tier: null,
    daily_token_limit: null,
    monthly_token_limit: null,
    ...overrides,
  };
}

function mockGatewayDatabase(
  keyRow: Record<string, unknown>,
  identities: Record<string, Record<string, unknown>> = {},
) {
  mocks.query.mockImplementation(
    async (statementValue: unknown, parameters?: unknown[]) => {
      const statement = String(statementValue);
      if (statement.includes("FROM gateway_api_keys AS k")) {
        return { rows: [keyRow] };
      }
      if (statement.includes("FROM users AS canonical_user")) {
        const subject = String(parameters?.[0] ?? "");
        return { rows: identities[subject] ? [identities[subject]] : [] };
      }
      if (statement.includes("UPDATE gateway_api_keys")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected test query: ${statement}`);
    },
  );
}

beforeEach(() => {
  mocks.query.mockReset();
  process.env.GATEWAY_API_KEY_PEPPER = pepper;
  process.env.GATEWAY_SUBJECT_JWT_ISSUER = issuer;
  process.env.GATEWAY_SUBJECT_JWT_AUDIENCE = audience;
});

afterEach(() => {
  const names = {
    pepper: "GATEWAY_API_KEY_PEPPER",
    issuer: "GATEWAY_SUBJECT_JWT_ISSUER",
    audience: "GATEWAY_SUBJECT_JWT_AUDIENCE",
  } as const;
  for (const [key, name] of Object.entries(names)) {
    const original = originalEnvironment[key as keyof typeof originalEnvironment];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("Gateway canonical subject authentication", () => {
  it("preserves a legacy fixed-user key after canonical ownership checks", async () => {
    mockGatewayDatabase(fixedKeyRow({ subject_mode: null }));

    await expect(
      authenticateGatewayRequest(
        new Headers({ authorization: `Bearer ${plaintext}` }),
        "messages:create",
      ),
    ).resolves.toMatchObject({
      apiKeyId: "key_fixed",
      platformUserId: "usr_101",
      externalUserId: "101",
      scopes: ["messages:create", "models:list"],
    });
    expect(
      mocks.query.mock.calls.some(([statement]) =>
        String(statement).includes("last_used_at"),
      ),
    ).toBe(true);
  });

  it("rejects a fixed-user key whose internal mapping has no canonical user", async () => {
    mockGatewayDatabase(fixedKeyRow({ canonical_user_id: null }));

    await expect(
      authenticateGatewayRequest(
        new Headers({ "x-api-key": plaintext }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ code: "GATEWAY_API_KEY_INVALID", status: 401 });

    expect(String(mocks.query.mock.calls[0]?.[0])).toContain(
      "LEFT JOIN users AS canonical_user",
    );
  });

  it("maps two JWT subjects through one service key without binding usage to the key owner", async () => {
    mockGatewayDatabase(serviceKeyRow(), {
      "101": {
        canonical_user_id: "101",
        platform_user_id: "usr_101",
        source: "ink-dream",
        external_user_id: "101",
        tier: "creator",
        daily_token_limit: 200_000,
        monthly_token_limit: 2_000_000,
      },
      "202": {
        canonical_user_id: "202",
        platform_user_id: "usr_202",
        source: "ink-dream",
        external_user_id: "202",
        tier: "free",
        daily_token_limit: 100_000,
        monthly_token_limit: null,
      },
    });

    const first = await authenticateGatewayRequest(
      new Headers({
        "x-api-key": plaintext,
        authorization: `Bearer ${await subjectToken({ subject: "101" })}`,
      }),
      "messages:create",
    );
    const second = await authenticateGatewayRequest(
      new Headers({
        "x-api-key": plaintext,
        authorization: `Bearer ${await subjectToken({ subject: "202" })}`,
      }),
      "messages:create",
    );

    expect(first).toMatchObject({
      apiKeyId: "key_service",
      platformUserId: "usr_101",
      externalUserId: "101",
    });
    expect(second).toMatchObject({
      apiKeyId: "key_service",
      platformUserId: "usr_202",
      externalUserId: "202",
    });
    const identitySubjects = mocks.query.mock.calls
      .filter(([statement]) =>
        String(statement).includes("FROM users AS canonical_user"),
      )
      .map(([, parameters]) => parameters?.[0]);
    expect(identitySubjects).toEqual(["101", "202"]);
  });

  it("rejects forged signatures, invalid subjects and missing canonical projections", async () => {
    mockGatewayDatabase(serviceKeyRow());

    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ signingSecret: "different-secret-material-that-cannot-verify" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_SUBJECT_TOKEN_INVALID",
      status: 401,
    });
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ subject: "qa-user" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_SUBJECT_TOKEN_INVALID",
      status: 401,
    });
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ subject: "303" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_CANONICAL_USER_REQUIRED",
      status: 403,
    });
  });

  it("rejects client, scope and lifetime forgery", async () => {
    mockGatewayDatabase(serviceKeyRow());

    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ clientId: "other-service" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ clientId: "dream-bff", authorizedParty: "other-service" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ scope: "models:list" })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ code: "GATEWAY_SCOPE_REQUIRED", status: 403 });

    const now = Math.floor(Date.now() / 1_000);
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ issuedAt: now, expiresAt: now + 301 })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken({ issuedAt: now - 600, expiresAt: now - 300 })}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed when service JWT configuration or the subject token is missing", async () => {
    mockGatewayDatabase(serviceKeyRow());

    await expect(
      authenticateGatewayRequest(
        new Headers({ "x-api-key": plaintext }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_SUBJECT_TOKEN_REQUIRED",
      status: 401,
    });

    delete process.env.GATEWAY_SUBJECT_JWT_ISSUER;
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          authorization: `Bearer ${await subjectToken()}`,
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_AUTH_NOT_CONFIGURED",
      status: 503,
    });
  });

  it("forbids identity override headers before any database lookup", async () => {
    await expect(
      authenticateGatewayRequest(
        new Headers({
          "x-api-key": plaintext,
          "x-platform-user-id": "usr_qa",
        }),
        "messages:create",
      ),
    ).rejects.toMatchObject({
      code: "GATEWAY_SUBJECT_OVERRIDE_FORBIDDEN",
      status: 400,
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
