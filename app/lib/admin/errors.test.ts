// [Input] Safe domain errors, missing PostgreSQL capabilities and sensitive unknown failures.
// [Output] Actionable readiness 503 and redacted generic 500 regression evidence.
// [Pos] Provider-free Admin HTTP error contract; no database connection is opened.
// [Sync] 2026-10-06: cover missing migration diagnostics without weakening the fail-closed boundary.
import { describe, expect, it } from "vitest";

import { GatewayError } from "../gateway/errors";
import { PlatformSchemaNotReadyError } from "../platform-db";
import { adminErrorResponse } from "./errors";

describe("adminErrorResponse", () => {
  it("reports schema readiness failures as an actionable unavailable response", async () => {
    const response = adminErrorResponse(new PlatformSchemaNotReadyError(), "admin_schema_request");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("admin_schema_request");
    await expect(response.json()).resolves.toEqual({ error: {
      code: "PLATFORM_SCHEMA_NOT_READY",
      message: "数据库版本尚未更新，请先完成显式数据库迁移后再使用管理后台。",
      requestId: "admin_schema_request",
    } });
  });

  it("keeps unknown database errors redacted instead of exposing their messages", async () => {
    const response = adminErrorResponse(new Error("postgres://private-user:private-secret@db/private"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("ADMIN_INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("private-secret");
  });

  it("preserves safe Gateway configuration errors for actionable Admin feedback", async () => {
    const response = adminErrorResponse(
      new GatewayError(
        "PROVIDER_HOST_NOT_ALLOWED",
        "Provider host models.example.com is not in AI_PROVIDER_HOST_ALLOWLIST",
        503,
        "configuration_error",
      ),
      "admin_request_test",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PROVIDER_HOST_NOT_ALLOWED",
        message:
          "Provider host models.example.com is not in AI_PROVIDER_HOST_ALLOWLIST",
        requestId: "admin_request_test",
      },
    });
  });
});
