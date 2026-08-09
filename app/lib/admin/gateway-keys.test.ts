import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  gatewayKeyCreateSchema,
  insertGatewayKeyOnClient,
} from "./mutations";

const pepper = "gateway-key-create-test-pepper-with-at-least-32-bytes";
const originalPepper = process.env.GATEWAY_API_KEY_PEPPER;

beforeEach(() => {
  process.env.GATEWAY_API_KEY_PEPPER = pepper;
});

afterEach(() => {
  if (originalPepper === undefined) delete process.env.GATEWAY_API_KEY_PEPPER;
  else process.env.GATEWAY_API_KEY_PEPPER = originalPepper;
});

describe("Admin Gateway key create contract", () => {
  it("requires an explicit, internally consistent subject mode", () => {
    const common = {
      name: "Dream Gateway",
      scopes: ["messages:create"] as const,
      expiresAt: null,
    };

    expect(
      gatewayKeyCreateSchema.safeParse({
        ...common,
        subjectMode: "fixed_user",
        platformUserId: "usr_101",
      }).success,
    ).toBe(true);
    expect(
      gatewayKeyCreateSchema.safeParse({
        ...common,
        subjectMode: "canonical_subject",
        serviceClientId: "dream-bff",
      }).success,
    ).toBe(true);
    expect(
      gatewayKeyCreateSchema.safeParse({
        ...common,
        platformUserId: "usr_101",
      }).success,
    ).toBe(false);
    expect(
      gatewayKeyCreateSchema.safeParse({
        ...common,
        subjectMode: "canonical_subject",
        serviceClientId: "dream-bff",
        platformUserId: "usr_qa",
      }).success,
    ).toBe(false);
    expect(
      gatewayKeyCreateSchema.safeParse({
        ...common,
        subjectMode: "fixed_user",
        platformUserId: "usr_101",
        serviceClientId: "dream-bff",
      }).success,
    ).toBe(false);
  });

  it("stores a hash and service identity while returning plaintext only once", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "gkey_test",
          platform_user_id: null,
          subject_mode: "canonical_subject",
          service_client_id: "dream-bff",
          name: "Dream Gateway",
          key_prefix: "gw_prefix",
          scopes: ["messages:create"],
          status: "active",
          expires_at: null,
          created_at: new Date("2026-08-09T00:00:00.000Z"),
        },
      ],
    });

    const created = await insertGatewayKeyOnClient(
      { query } as unknown as PoolClient,
      {
        subjectMode: "canonical_subject",
        serviceClientId: "dream-bff",
        name: "Dream Gateway",
        scopes: ["messages:create"],
        expiresAt: null,
      },
    );

    expect(created.plaintextKey).toMatch(/^gw_/);
    const [statement, values] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("subject_mode");
    expect(statement).toContain("service_client_id");
    expect(statement).not.toContain("RETURNING key_hash");
    expect(values[1]).toBeNull();
    expect(values[2]).toBe("canonical_subject");
    expect(values[3]).toBe("dream-bff");
    expect(values[6]).not.toBe(created.plaintextKey);
    expect(JSON.stringify(created)).not.toContain(String(values[6]));
  });
});
