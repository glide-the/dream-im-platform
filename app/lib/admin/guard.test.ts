// [Input] Admin mutation request URL, Origin header, and explicit origin allowlist.
// [Output] Fail-closed same-origin and configured-origin regression coverage.
// [Pos] Focused tests for the shared Admin mutation trust boundary.
// [Sync] 2026-08-27: require Origin in every runtime mode.

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminError } from "./errors";
import { assertAdminMutationOrigin } from "./guard";

const originalAllowlist = process.env.ADMIN_ORIGIN_ALLOWLIST;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalAllowlist === undefined) {
    delete process.env.ADMIN_ORIGIN_ALLOWLIST;
  } else {
    process.env.ADMIN_ORIGIN_ALLOWLIST = originalAllowlist;
  }
});

describe("assertAdminMutationOrigin", () => {
  it("allows the request URL origin", () => {
    delete process.env.ADMIN_ORIGIN_ALLOWLIST;
    const request = new Request("https://admin.example.test/api/admin/models", {
      method: "POST",
      headers: { origin: "https://admin.example.test" },
    });

    expect(() => assertAdminMutationOrigin(request)).not.toThrow();
  });

  it.each(["development", "test", "production"])("denies a missing Origin in %s", (runtimeMode) => {
    vi.stubEnv("NODE_ENV", runtimeMode);
    const request = new Request("https://admin.example.test/api/admin/models", {
      method: "POST",
    });

    expect(() => assertAdminMutationOrigin(request)).toThrowError(
      expect.objectContaining<Partial<AdminError>>({
        code: "ADMIN_ORIGIN_REQUIRED",
        status: 403,
      }),
    );
  });

  it("does not trust a forwarded host supplied by the caller", () => {
    delete process.env.ADMIN_ORIGIN_ALLOWLIST;
    const request = new Request("https://admin.example.test/api/admin/models", {
      method: "POST",
      headers: {
        origin: "https://attacker.example.test",
        "x-forwarded-host": "attacker.example.test",
        "x-forwarded-proto": "https",
      },
    });

    expect(() => assertAdminMutationOrigin(request)).toThrowError(
      expect.objectContaining<Partial<AdminError>>({
        code: "ADMIN_ORIGIN_DENIED",
        status: 403,
      }),
    );
  });

  it("allows an explicitly configured deployment origin", () => {
    process.env.ADMIN_ORIGIN_ALLOWLIST = "https://console.example.test";
    const request = new Request("http://app:3000/api/admin/models", {
      method: "POST",
      headers: { origin: "https://console.example.test" },
    });

    expect(() => assertAdminMutationOrigin(request)).not.toThrow();
  });
});
