// [Input] Provider-free Gateway service-key fixtures and a mocked Drizzle repository.
// [Output] DTO, secret-proof, exact-scope and secret-safe rotation contract evidence.
// [Pos] Unit contract for release-time canonical-subject key rotation.
// [Sync] 2026-09-17: cover explicit same-scope emergency rotation without plaintext receipts.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGatewayApiKey } from "./api-keys";
import {
  GatewayServiceKeyRotationError,
  GatewayServiceKeyRotationService,
  gatewayServiceKeyTargetDto,
} from "./service-key-rotation";

const pepper = "gateway-key-rotation-test-pepper-at-least-32-bytes";
const target = {
  serviceClientId: "ink-dream-runtime",
  scopes: ["messages:create", "messages:count_tokens", "models:list"] as const,
  requestId: "release-20260916-runtime-scopes",
};

function databaseFor(
  current: ReturnType<typeof createGatewayApiKey>,
  scopes: string[] = ["messages:create", "models:list"],
) {
  const returning = vi.fn().mockResolvedValue([{ id: "old-key" }]);
  const database = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            const rows = [{
              id: "old-key", name: "Dream Runtime", keyPrefix: current.prefix,
              keyHash: current.hash, scopes, expiresAt: null,
            }];
            return Object.assign(Promise.resolve(rows), { for: vi.fn().mockResolvedValue(rows) });
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  };
  return database;
}

describe("Gateway service key rotation", () => {
  beforeEach(() => vi.stubEnv("GATEWAY_API_KEY_PEPPER", pepper));

  it("accepts only unique canonical Gateway scopes", () => {
    expect(gatewayServiceKeyTargetDto.safeParse(target).success).toBe(true);
    expect(gatewayServiceKeyTargetDto.parse({ ...target, force: true }).force).toBe(true);
    expect(gatewayServiceKeyTargetDto.safeParse({
      ...target, scopes: ["messages:create", "messages:create"],
    }).success).toBe(false);
    expect(gatewayServiceKeyTargetDto.safeParse({
      ...target, scopes: ["chat:create"],
    }).success).toBe(false);
  });

  it("forces a same-scope rotation through the same Drizzle boundary", async () => {
    const current = createGatewayApiKey(pepper);
    const database = databaseFor(current, [...target.scopes]);
    const service = new GatewayServiceKeyRotationService(database as never);

    await expect(service.plan(target, current.plaintext)).resolves.toMatchObject({ action: "unchanged" });
    await expect(service.plan({ ...target, force: true }, current.plaintext)).resolves.toMatchObject({ action: "rotate" });
    const result = await service.rotate({ ...target, force: true }, current.plaintext);

    expect(result.receipt).toMatchObject({ action: "rotate", currentScopes: target.scopes, targetScopes: target.scopes });
    expect(result.plaintextKey).toMatch(/^gw_/);
    expect(JSON.stringify(result.receipt)).not.toContain(current.plaintext);
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(database.insert).toHaveBeenCalledTimes(2);
  });

  it("rotates through Drizzle operations and never returns the old secret in its receipt", async () => {
    const current = createGatewayApiKey(pepper);
    const database = databaseFor(current);
    const result = await new GatewayServiceKeyRotationService(database as never).rotate(target, current.plaintext);
    expect(result.receipt).toMatchObject({ action: "rotate", currentKeyMatchesSecret: true, targetScopes: target.scopes });
    expect(result.plaintextKey).toMatch(/^gw_/);
    expect(result.plaintextKey).not.toBe(current.plaintext);
    expect(JSON.stringify(result.receipt)).not.toContain(current.plaintext);
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(database.insert).toHaveBeenCalledTimes(2);
  });

  it("fails before writes when the deployed secret does not match the active row", async () => {
    const current = createGatewayApiKey(pepper);
    const database = databaseFor(current);
    const different = createGatewayApiKey(pepper);
    await expect(new GatewayServiceKeyRotationService(database as never).rotate(target, different.plaintext))
      .rejects.toEqual(expect.objectContaining<Partial<GatewayServiceKeyRotationError>>({ code: "GATEWAY_SERVICE_KEY_SECRET_MISMATCH" }));
    expect(database.update).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });
});
