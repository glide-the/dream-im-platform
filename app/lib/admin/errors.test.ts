import { describe, expect, it } from "vitest";

import { GatewayError } from "../gateway/errors";
import { adminErrorResponse } from "./errors";

describe("adminErrorResponse", () => {
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
