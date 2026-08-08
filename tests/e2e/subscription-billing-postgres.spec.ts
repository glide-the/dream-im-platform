import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
let upstream: Server | undefined;
let upstreamUrl = "";

function diagnosticsFor(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      text.includes("unpkg.com/react-grab/") ||
      text === "Failed to load resource: net::ERR_FAILED" ||
      text === "Event"
    ) return;
    diagnostics.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes("unpkg.com/react-grab/")) return;
    diagnostics.push(`${request.failure()?.errorText}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

test.describe("subscription billing on owned PostgreSQL", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!bootstrapToken, "Requires an explicit owned PostgreSQL bootstrap token");

  test.beforeAll(async () => {
    if (process.env.E2E_PROVIDER_URL) {
      upstreamUrl = process.env.E2E_PROVIDER_URL;
      return;
    }
    upstream = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "msg_subscription_e2e",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "subscription-upstream",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream!.once("error", reject);
      upstream!.listen(0, "127.0.0.1", resolve);
    });
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    if (!upstream) return;
    await new Promise<void>((resolve, reject) => upstream!.close((error) => error ? reject(error) : resolve()));
  });

  test("covers immutable versions, lifecycle, allowance settlement and responsive UI", async ({ context, page, request, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    expect((await request.get(`${baseURL}/api/admin/subscription-plans`)).status()).toBe(401);

    await page.goto("/admin");
    await page.getByLabel("显示名称").fill("Subscription Owner");
    await page.getByLabel("管理员邮箱").fill("subscription-owner@example.test");
    await page.getByLabel("初始密码").fill("Subscription-owner-2026!");
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const diagnostics = diagnosticsFor(page);

    const api = context.request;
    const headers = { origin, "content-type": "application/json" };
    const provider = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: { code: "subscription-provider", name: "Subscription Provider", protocol: "anthropic", baseUrl: upstreamUrl, apiKey: "subscription-provider-test-secret", status: "active", timeoutMs: 5000, maxRetries: 0, config: { authMode: "x-api-key" } },
    });
    expect(provider.status()).toBe(201);
    const providerId = (await provider.json()).data.id;
    const model = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: { providerId, code: "subscription-model", upstreamModel: "subscription-upstream", displayName: "Subscription Model", contextWindow: 100000, maxOutputTokens: 1024, capabilities: { chat: true, streaming: true }, enabled: true },
    });
    expect(model.status()).toBe(201);
    const modelId = (await model.json()).data.id;
    expect((await api.post(`${baseURL}/api/admin/pricing-rules`, {
      headers,
      data: { modelId, userTier: "free", inputPriceMicrousdPerMillion: 1000000, outputPriceMicrousdPerMillion: 2000000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null },
    })).status()).toBe(201);

    const plan = await api.post(`${baseURL}/api/admin/subscription-plans`, {
      headers,
      data: { code: "dream-pro", name: "Dream Pro", description: "E2E plan", currency: "USD" },
    });
    expect(plan.status()).toBe(201);
    const planId = (await plan.json()).data.id;
    const createVersion = async (basePriceMicrousd: number) => {
      const response = await api.post(`${baseURL}/api/admin/subscription-plan-versions`, {
        headers,
        data: { planId, billingPeriod: "monthly", basePriceMicrousd, trialDays: 7, gracePeriodDays: 3, allowanceTokens: 100000, allowanceMicrousd: 0, overagePolicy: "cash_balance", effectiveFrom: null },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).data.id as string;
    };
    const publishVersion = async (id: string, suffix: string) => {
      expect((await api.post(`${baseURL}/api/admin/subscription-entitlements`, {
        headers,
        data: { planVersionId: id, modelId, gatewayScopes: ["messages:create", "models:list"], requestsPerMinute: 30, dailyTokenLimit: 50000, monthlyTokenLimit: 500000, storageBytesLimit: 1000000, enabled: true },
      })).status()).toBe(201);
      const response = await api.post(`${baseURL}/api/admin/subscription-plan-versions/${id}/publish`, {
        headers,
        data: { effectiveFrom: new Date().toISOString(), idempotencyKey: `publish:${suffix}:e2e`, reason: "E2E publish" },
      });
      expect(response.status()).toBe(200);
    };
    const versionOne = await createVersion(1_000_000);
    await publishVersion(versionOne, "v1");
    const immutable = await api.patch(`${baseURL}/api/admin/subscription-plan-versions/${versionOne}`, {
      headers,
      data: { basePriceMicrousd: 1 },
    });
    expect(immutable.status()).toBe(409);
    await expect(immutable.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_VERSION_IMMUTABLE" } });

    const activationKey = "activate:user-e2e:dream-pro:e2e";
    const activate = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: "user-e2e", planVersionId: versionOne, startInTrial: false, idempotencyKey: activationKey, reason: "E2E activation" },
    });
    expect(activate.status()).toBe(201);
    const subscriptionId = (await activate.json()).data.id as string;
    const duplicate = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: "user-e2e", planVersionId: versionOne, startInTrial: false, idempotencyKey: activationKey, reason: "E2E duplicate activation" },
    });
    expect(duplicate.status()).toBe(201);
    expect((await duplicate.json()).data.id).toBe(subscriptionId);
    expect((await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: "user-e2e", planVersionId: versionOne, startInTrial: false, idempotencyKey: "activate:user-e2e:conflict:e2e", reason: "E2E conflict" },
    })).status()).toBe(409);

    const gatewayKey = await api.post(`${baseURL}/api/admin/gateway-api-keys`, {
      headers,
      data: { platformUserId: "user-e2e", name: "subscription-e2e", scopes: ["messages:create", "models:list"], expiresAt: null },
    });
    expect(gatewayKey.status()).toBe(201);
    const plaintextKey = (await gatewayKey.json()).data.plaintextKey as string;
    const gateway = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": plaintextKey, "idempotency-key": "subscription-gateway-success-e2e" },
      data: { model: "subscription-model", max_tokens: 32, messages: [{ role: "user", content: "hello" }] },
    });
    expect(gateway.status()).toBe(200);
    const usage = await api.get(`${baseURL}/api/admin/usage?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(usage.status()).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({ data: [expect.objectContaining({ subscription_id: subscriptionId, subscription_coverage_mode: "token_allowance", allowance_charged_tokens: "15", reserved_microusd: "0" })] });

    const command = async (action: string, key: string, data: Record<string, unknown> = {}) => api.post(`${baseURL}/api/admin/subscriptions/${subscriptionId}/${action}`, { headers, data: { idempotencyKey: key, reason: `E2E ${action}`, ...data } });
    expect((await command("pause", "pause:subscription:e2e")).status()).toBe(200);
    const pausedCall = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": plaintextKey },
      data: { model: "subscription-model", max_tokens: 16, messages: [{ role: "user", content: "blocked" }] },
    });
    expect(pausedCall.status()).toBe(403);
    const pausedBody = await pausedCall.json();
    expect(pausedBody).toMatchObject({
      type: "error",
      error: { code: "SUBSCRIPTION_PAUSED", type: "permission_error" },
    });
    const pausedRequestId = pausedCall.headers()["x-request-id"];
    expect(pausedRequestId).toBeTruthy();
    const pausedPayload = await api.get(`${baseURL}/api/admin/gateway-requests/${encodeURIComponent(pausedRequestId)}/payload`, {
      headers: { "x-gateway-payload-confirmation": "reveal" },
    });
    expect(pausedPayload.status()).toBe(200);
    await expect(pausedPayload.json()).resolves.toMatchObject({
      data: {
        summary: { id: pausedRequestId, status: "rejected", outcome: "failed", http_status: 403, error_code: "SUBSCRIPTION_PAUSED" },
        request: { completion_status: "complete", body_json: { model: "subscription-model", messages: [{ role: "user", content: "blocked" }] } },
        response: { completion_status: "complete", http_status: 403, body_json: { type: "error", error: { code: "SUBSCRIPTION_PAUSED" } } },
      },
    });
    expect((await command("resume", "resume:subscription:e2e")).status()).toBe(200);

    const versionTwo = await createVersion(1_500_000);
    await publishVersion(versionTwo, "v2");
    const downgrade = await command("downgrade", "downgrade:subscription:e2e", { planVersionId: versionTwo });
    expect(downgrade.status()).toBe(200);
    expect((await downgrade.json()).data.pending_plan_version_id).toBe(versionTwo);
    const upgrade = await command("upgrade", "upgrade:subscription:e2e", { planVersionId: versionTwo });
    expect(upgrade.status()).toBe(200);
    expect((await upgrade.json()).data.plan_version_id).toBe(versionTwo);
    expect((await command("renew", "renew:subscription:e2e")).status()).toBe(200);
    const cancel = await command("cancel", "cancel:subscription:e2e");
    expect(cancel.status()).toBe(200);
    expect((await cancel.json()).data.status).toBe("cancel_at_period_end");

    const events = await api.get(`${baseURL}/api/admin/subscription-events?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(events.status()).toBe(200);
    expect((await events.json()).meta.total).toBe(7);
    expect((await api.delete(`${baseURL}/api/admin/subscriptions/${subscriptionId}`, { headers })).status()).toBe(405);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/subscriptions/users");
    await expect(page.getByRole("heading", { name: "用户订阅", exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "用户订阅清单" })
        .getByText("creator@example.test", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscriptions-desktop-1440x1000.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/subscriptions/plans");
    await expect(page.getByRole("heading", { name: "订阅套餐", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscriptions-mobile-390x844.png") });
    expect(diagnostics).toEqual([]);
  });
});
