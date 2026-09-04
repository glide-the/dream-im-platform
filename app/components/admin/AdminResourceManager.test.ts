import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { modelFields, pricingFields, providerFields } from "./AdminResourceViews";
import {
  adminListErrorPresentation,
  availableFieldOptions,
  buildPayload,
  validateJsonEditorValue,
  valuesFromRecord,
} from "./AdminResourceManager";
import { canonicalAdminResource } from "./providers";

describe("admin resource form serialization", () => {
  it("mounts Claude Code Runtime fields on both real AIModelRegistry form routes", () => {
    for (const relativePath of [
      "../../(admin)/admin/(workspace)/models/models/new/page.tsx",
      "../../(admin)/admin/(workspace)/models/models/[id]/edit/page.tsx",
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).toContain('id: "claude-runtime"');
      expect(source).toContain("claudeCodeAutoCompactWindow");
      expect(source).toContain("claudeCodeMaxContextTokens");
    }
  });

  it("keeps Provider secrets blank on edit and merges named config fields", () => {
    const values = valuesFromRecord(
      providerFields,
      {
        id: "provider-test",
        code: "relay",
        protocol: "anthropic",
        name: "Relay",
        base_url: "https://api.deepseek.com/anthropic",
        status: "active",
        timeout_ms: 8_000,
        max_retries: 1,
        config: {
          authMode: "bearer",
          outputTokenParam: "max_tokens",
          customFlag: true,
        },
        credential_configured: true,
        credential_validation_status: "valid",
        credential_validated_at: "2026-09-04T06:00:00.000Z",
        auth_revision: 7,
      },
      {},
      "edit",
    );

    expect(values.apiKey).toBe("");
    expect(values.expectedAuthRevision).toBe("7");
    expect(values.config).toBe(JSON.stringify({ customFlag: true }, null, 2));
    const payload = buildPayload(providerFields, values, "edit");
    expect(payload).toEqual({
      name: "Relay",
      baseUrl: "https://api.deepseek.com/anthropic",
      config: {
        customFlag: true,
        authMode: "bearer",
        outputTokenParam: "max_tokens",
      },
      status: "active",
      timeoutMs: 8_000,
      maxRetries: 1,
      expectedAuthRevision: 7,
    });
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("code");
    expect(payload).not.toHaveProperty("protocol");
  });

  it("labels bearer as a static credential rather than OAuth", () => {
    const authMode = providerFields.find((field) => field.key === "authMode");
    const bearer = authMode?.options?.find((option) => option.value === "bearer");

    expect(authMode?.label).toBe("静态凭据发送方式");
    expect(bearer?.label).toContain("静态凭据");
    expect(bearer?.label).toContain("非 OAuth");
  });

  it("only offers x-api-key to Anthropic and normalizes OpenAI to bearer", () => {
    const authMode = providerFields.find((field) => field.key === "authMode");
    expect(authMode).toBeDefined();
    expect(availableFieldOptions(authMode!, {
      protocol: "openai",
      authMode: "x-api-key",
    }).map((option) => option.value)).toEqual(["bearer"]);
    expect(availableFieldOptions(authMode!, {
      protocol: "anthropic",
      authMode: "x-api-key",
    }).map((option) => option.value)).toEqual(["x-api-key", "bearer"]);

    const values = valuesFromRecord(providerFields, undefined, {
      protocol: "openai",
      authMode: "x-api-key",
      config: {},
    }, "create");
    expect(values.authMode).toBe("bearer");
    expect(buildPayload(providerFields, values, "create")).toMatchObject({
      protocol: "openai",
      config: { authMode: "bearer" },
    });
  });

  it("does not leak named Provider config keys into the JSON editor", () => {
    const values = valuesFromRecord(
      providerFields,
      undefined,
      {
        protocol: "anthropic",
        authMode: "bearer",
        outputTokenParam: "max_tokens",
        config: {
          authMode: "x-api-key",
          outputTokenParam: "max_completion_tokens",
          region: "cn",
        },
      },
      "create",
    );

    expect(values.config).toBe(JSON.stringify({ region: "cn" }, null, 2));
    expect(values.authMode).toBe("bearer");
  });

  it("round-trips model request headers and nullable Claude Code Runtime settings", () => {
    const values = valuesFromRecord(modelFields, {
      provider_id: "provider-test",
      code: "hy3",
      upstream_model: "hy3-preview",
      display_name: "HY3 Preview",
      request_headers: { "user-agent": "OpenAI/JS 6.39.1" },
      capabilities: { chat: true },
      claude_code_auto_compact_window: 262144,
      claude_code_max_context_tokens: null,
      enabled: true,
    }, {}, "edit");

    expect(values.requestHeaders).toBe(JSON.stringify({
      "user-agent": "OpenAI/JS 6.39.1",
    }, null, 2));
    expect(buildPayload(modelFields, values, "edit")).toMatchObject({
      requestHeaders: { "user-agent": "OpenAI/JS 6.39.1" },
      claudeCodeAutoCompactWindow: 262144,
      claudeCodeMaxContextTokens: null,
    });
  });

  it("validates and formats the model request-header JSON editor", () => {
    expect(validateJsonEditorValue('{"User-Agent":"OpenAI/JS 6.39.1"}', "object")).toEqual({
      valid: true,
      parsed: { "User-Agent": "OpenAI/JS 6.39.1" },
      formatted: '{\n  "User-Agent": "OpenAI/JS 6.39.1"\n}',
    });
    expect(validateJsonEditorValue('{"User-Agent":}', "object")).toMatchObject({
      valid: false,
    });
    expect(validateJsonEditorValue('["User-Agent"]', "object")).toEqual({
      valid: false,
      error: "必须填写 JSON 对象，例如 {\"User-Agent\":\"OpenAI/JS 6.39.1\"}。",
    });
  });

  it("serializes Pricing USD and percentage controls to integer micro-USD and bps", () => {
    const values = valuesFromRecord(pricingFields, undefined, {
      modelId: "model-test",
      userTier: "default",
      inputPriceMicrousdPerMillion: 0,
      outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0,
      cacheWritePriceMicrousdPerMillion: 0,
      markupBps: 0,
      discountBps: 0,
      status: "active",
      effectiveFrom: "2026-08-08T00:00:00.000Z",
      effectiveTo: null,
    }, "create");
    values.inputPriceMicrousdPerMillion = "3.5";
    values.outputPriceMicrousdPerMillion = "16";
    values.markupBps = "2.25";
    values.discountBps = "0.5";

    expect(buildPayload(pricingFields, values, "create")).toMatchObject({
      inputPriceMicrousdPerMillion: 3_500_000,
      outputPriceMicrousdPerMillion: 16_000_000,
      markupBps: 225,
      discountBps: 50,
    });
  });

  it("canonicalizes the legacy Story alias and classifies list failures", () => {
    expect(canonicalAdminResource("stories")).toBe("story-stories");
    expect(canonicalAdminResource("story-workspaces")).toBe("story-workspaces");
    expect(
      adminListErrorPresentation(
        Object.assign(new Error("unavailable"), {
          statusCode: 503,
          code: "STORY_SOURCE_UNAVAILABLE",
          requestId: "request-test",
        }),
      ),
    ).toEqual({
      title: "PostgreSQL 数据源不可用",
      action: "重试连接",
      kind: "retry",
      requestId: "request-test",
    });
    expect(
      adminListErrorPresentation(
        Object.assign(new Error("bad filter"), { statusCode: 400 }),
      ).kind,
    ).toBe("reset");
  });
});
