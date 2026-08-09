import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ProductError } from "./errors";
import { requireProductPrincipal, verifyProductJwt } from "./auth";

const original = {
  secret: process.env.PRODUCT_API_JWT_SECRET,
  issuer: process.env.PRODUCT_API_JWT_ISSUER,
  audience: process.env.PRODUCT_API_JWT_AUDIENCE,
};
const secret = "jwt-test-secret-material-32-bytes-minimum";

beforeEach(() => {
  process.env.PRODUCT_API_JWT_SECRET = secret;
  process.env.PRODUCT_API_JWT_ISSUER = "https://dream.example.test";
  process.env.PRODUCT_API_JWT_AUDIENCE = "ink-memory-product-api";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    const name = {
      secret: "PRODUCT_API_JWT_SECRET",
      issuer: "PRODUCT_API_JWT_ISSUER",
      audience: "PRODUCT_API_JWT_AUDIENCE",
    }[key]!;
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function token(input: {
  subject?: string;
  scope?: string;
  clientId?: string;
  issuedAt?: number;
  expiresAt?: number;
} = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return await new SignJWT({
    scope: input.scope ?? "product:read",
    client_id: input.clientId ?? "dream-bff",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("https://dream.example.test")
    .setAudience("ink-memory-product-api")
    .setSubject(input.subject ?? "7")
    .setJti("token-jti-1")
    .setIssuedAt(input.issuedAt ?? now)
    .setExpirationTime(input.expiresAt ?? now + 120)
    .sign(new TextEncoder().encode(secret));
}

describe("Product JWT authentication", () => {
  it("verifies every required claim and required scope", async () => {
    const verified = await verifyProductJwt(
      new Headers({ authorization: `Bearer ${await token()}` }),
      "product:read",
    );
    expect(verified).toEqual({
      canonicalUserId: "7",
      clientId: "dream-bff",
      tokenId: "token-jti-1",
      scopes: ["product:read"],
    });
  });

  it("rejects non-canonical subjects, missing client identity and long tokens", async () => {
    await expect(
      verifyProductJwt(
        new Headers({ authorization: `Bearer ${await token({ subject: "007" })}` }),
        "product:read",
      ),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({ status: 401 }),
    );
    await expect(
      verifyProductJwt(
        new Headers({
          authorization: `Bearer ${await token({ clientId: "" })}`,
        }),
        "product:read",
      ),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({ status: 401 }),
    );
    const now = Math.floor(Date.now() / 1_000);
    await expect(
      verifyProductJwt(
        new Headers({
          authorization: `Bearer ${await token({ issuedAt: now, expiresAt: now + 301 })}`,
        }),
        "product:read",
      ),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({ status: 401 }),
    );
  });

  it("requires scope and reverse-resolves users to an active platform projection", async () => {
    await expect(
      verifyProductJwt(
        new Headers({ authorization: `Bearer ${await token()}` }),
        "product:write",
      ),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_SCOPE_REQUIRED",
        status: 403,
      }),
    );

    const verifyToken = vi.fn().mockResolvedValue({
      canonicalUserId: "7",
      clientId: "dream-bff",
      tokenId: "jti",
      scopes: ["product:read"],
    });
    const readUnitOfWork = vi.fn(async (handler) =>
      await handler({} as PoolClient),
    );
    const principal = await requireProductPrincipal(
      new Request("https://admin.test/api/product/v1/plans"),
      "product:read",
      {
        verifyToken,
        readUnitOfWork,
        findIdentity: vi.fn().mockResolvedValue({
          canonical_user_id: "7",
          platform_user_id: "usr_projection",
          platform_status: "active",
          tier: "creator",
        }),
      },
    );
    expect(principal.platformUserId).toBe("usr_projection");

    await expect(
      requireProductPrincipal(
        new Request("https://admin.test/api/product/v1/plans"),
        "product:read",
        {
          verifyToken,
          readUnitOfWork,
          findIdentity: vi.fn().mockResolvedValue({
            canonical_user_id: "7",
            platform_user_id: null,
            platform_status: null,
            tier: null,
          }),
        },
      ),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "CANONICAL_USER_REQUIRED",
        status: 403,
      }),
    );
  });
});

